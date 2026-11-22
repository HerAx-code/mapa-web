const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { assertStaffMfa } = require('./mfaPolicy')
const { DEFAULT_HOSPITAL_ID, ACCESS_CODE_PREFIX_PATTERN } = require('./orgConfig')
const { fail, loadCaller, loadUser, writeAudit } = require('./serverWrites')
const { codeProof, blankCodeExpired } = require('./codeIssue')

/**
 * Access codes on the server (Phase 3 PR 3.4 — docs/phase3-evidence-codes-plan.md):
 *
 *   issueAccessCode — a gateway desk issues a patient-bound code (gaps M10).
 *                     The next number comes from a per-prefix counter in a
 *                     transaction, so two desks issuing at once never pick the
 *                     same number and a deleted number is never reissued. It
 *                     warns (does not block) when that patient already holds an
 *                     open code. The prefix is the ISSUING hospital's own
 *                     (hospitals/{tenantId}.accessCodePrefix), not the
 *                     deployment default.
 *   claimAccessCode — the one claim path for sign-up and filing (gap R4). It
 *                     compares the code's recorded last name + birthdate with
 *                     THE ACCOUNT's own profile (gap I1: Juan can't claim Ana's
 *                     code), moves the patient's current hospital and records
 *                     the claim. A fresh account (no profile name yet) adopts the
 *                     code's recorded identity, as sign-up did before.
 *
 * After this, the rules refuse browser writes to hospitalIds claim fields and
 * privateInfo; these functions are the only path.
 */

const GATEWAY = ['super_admin', 'staff_admin']
const NAME_OK = /^[A-Za-zÀ-ÿÑñ .'-]+$/
const PREFIX_RE = new RegExp(`^${ACCESS_CODE_PREFIX_PATTERN}$`)
const CODE_RE = new RegExp(`^${ACCESS_CODE_PREFIX_PATTERN}-\\d{4}-\\d{5}$`)
const COURSE_MAX_DAYS = 93 // the rules' ceiling (IssueCodeModal offers 90)
const DAY_MS = 24 * 3600 * 1000

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const isBirthdate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) && !Number.isNaN(Date.parse(s))
// A code covers a course of treatment while its courseUntil is still ahead.
const courseActiveAt = (c, nowMs) => {
  const ms = c?.courseUntil?.toMillis ? c.courseUntil.toMillis() : null
  return ms != null && ms > nowMs
}
// The claimant may use a code that is available, or one they already hold and
// have not yet backed a request with — or a course code still running.
const claimableBy = (c, uid, nowMs) =>
  c.status === 'available' ||
  (c.status === 'used' && c.patId === uid && (!c.requestId || courseActiveAt(c, nowMs)))

// Manila-local y-m-d for the code's display `date` (parity with fmtDate en-PH).
function manilaDate(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`
}
function manilaTime(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000)
  let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, '0')
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  return `${h}:${m} ${ap}`
}

async function loadGatewayCaller(db, callerUid) {
  const caller = await loadCaller(db, callerUid)
  if (!GATEWAY.includes(caller.role) || !caller.tenantId) fail('permission-denied', "Only the hospital's staff can issue a code.")
  return caller
}

// ── issueAccessCode ──────────────────────────────────────────────────────────

// Mirror of src/components/admin/IssueCodeModal.jsx validateIssue — kept here so
// the server never trusts the page. Returns the cleaned record or fails.
function cleanIssueInput(data, nowMs) {
  const f = {
    lastName: str(data?.lastName), firstName: str(data?.firstName), middleName: str(data?.middleName),
    suffix: str(data?.suffix), birthdate: str(data?.birthdate), contact: str(data?.contact),
    visitDate: str(data?.visitDate), caseNumber: str(data?.caseNumber), idType: str(data?.idType),
    idLast4: str(data?.idLast4), course: data?.course === true, courseUntil: str(data?.courseUntil),
  }
  const todayIso = new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10)
  if (!f.lastName || !NAME_OK.test(f.lastName)) fail('invalid-argument', 'Enter the last name (letters only).')
  if (!f.firstName || !NAME_OK.test(f.firstName)) fail('invalid-argument', 'Enter the first name (letters only).')
  if (f.middleName && !NAME_OK.test(f.middleName)) fail('invalid-argument', 'Middle name: letters only.')
  if (!isBirthdate(f.birthdate) || f.birthdate > todayIso) fail('invalid-argument', 'Enter a valid birthdate.')
  if (f.contact && !/^09\d{9}$/.test(f.contact)) fail('invalid-argument', 'Mobile number: 11 digits starting with 09.')
  if (!isBirthdate(f.visitDate) || f.visitDate > todayIso) fail('invalid-argument', 'Enter the date of the visit or admission.')
  if (!f.idType) fail('invalid-argument', 'Select the ID you saw.')
  if (f.idLast4 && !/^[A-Za-z0-9]{4}$/.test(f.idLast4)) fail('invalid-argument', 'Last 4 characters of the ID number.')
  if (f.course) {
    if (!isBirthdate(f.courseUntil) || f.courseUntil <= todayIso) fail('invalid-argument', 'Choose a course end date in the future.')
    const untilMs = Date.parse(`${f.courseUntil}T00:00:00+08:00`)
    if (untilMs > nowMs + COURSE_MAX_DAYS * DAY_MS) fail('invalid-argument', `A course may run at most ${COURSE_MAX_DAYS} days.`)
  }
  return f
}

// Does this patient (same normalized last name + birthdate) already hold a code
// that is still open — claimed but not yet backing a finished-up request, or a
// running course, or an unclaimed bound code issued to them? A warning, not a
// block (the desk confirms).
async function openCodeFor(db, tenantId, proof, nowMs) {
  const snap = await db.collection('hospitalIds')
    .where('tenantId', '==', tenantId).where('bound', '==', true).get()
  for (const d of snap.docs) {
    const c = d.data()
    if (c.status === 'used' && c.requestId && !courseActiveAt(c, nowMs)) continue // used up
    // Match on the issued proof (normalized last name + birthdate).
    const issued = await d.ref.collection('privateInfo').doc('issued').get()
    if (issued.exists && issued.data().proof === proof) return d.id
  }
  return null
}

async function handleIssueAccessCode({ callerUid, data, db, now = () => Date.now(), serverTimestamp = () => FieldValue.serverTimestamp() }) {
  const caller = await loadGatewayCaller(db, callerUid)
  const nowMs = now()
  const f = cleanIssueInput(data, nowMs)
  const confirm = data?.confirm === true

  const hSnap = await db.doc(`hospitals/${caller.tenantId}`).get()
  const prefix = str(hSnap.exists ? hSnap.data().accessCodePrefix : '')
  if (!PREFIX_RE.test(prefix)) fail('failed-precondition', 'This hospital has no access-code prefix set.')
  if (hSnap.exists && hSnap.data().enabled === false) fail('failed-precondition', 'This hospital is not taking new codes right now.')

  const nameParts = { firstName: f.firstName, middleName: f.middleName, lastName: f.lastName, suffix: f.suffix }
  const name = [f.firstName, f.middleName, f.lastName, f.suffix].filter(Boolean).join(' ')
  const proof = codeProof(f.lastName, f.birthdate)

  // Open-code check: warn (don't block) unless the desk already confirmed.
  if (!confirm) {
    const open = await openCodeFor(db, caller.tenantId, proof, nowMs)
    if (open) return { needsConfirm: true, openCode: open, name }
  }

  const year = new Date(nowMs + 8 * 3600 * 1000).getUTCFullYear()
  const counterRef = db.doc(`accessCodeCounters/${prefix}__${year}`)

  const id = await db.runTransaction(async (tx) => {
    const cSnap = await tx.get(counterRef)
    if (!cSnap.exists) {
      // No counter yet. Safe only when the prefix has no codes for this year —
      // otherwise seed it first so we never collide with an existing number.
      fail('failed-precondition', `The code counter for ${prefix}-${year} needs seeding. Run scripts/seed-code-counters.mjs (report-first), then issue again.`)
    }
    const next = Number(cSnap.data().next) || 1
    const codeId = `${prefix}-${year}-${String(next).padStart(5, '0')}`
    // Belt and braces: the counter is monotonic, but prove the id is free so a
    // mis-seeded counter can never overwrite a live code.
    const existing = await tx.get(db.doc(`hospitalIds/${codeId}`))
    if (existing.exists) fail('failed-precondition', `The code counter for ${prefix}-${year} is behind the existing codes. Re-run scripts/seed-code-counters.mjs.`)

    tx.update(counterRef, { next: next + 1, updatedAt: serverTimestamp() })
    tx.set(db.doc(`hospitalIds/${codeId}`), {
      tenantId: caller.tenantId, status: 'available', patId: null, bound: true,
      date: manilaDate(nowMs), time: '', createdAt: serverTimestamp(),
      ...(f.course ? { courseUntil: Timestamp.fromMillis(Date.parse(`${f.courseUntil}T23:59:59+08:00`)) } : {}),
    })
    tx.set(db.doc(`hospitalIds/${codeId}/privateInfo/issued`), {
      name, nameParts, birthdate: f.birthdate, proof,
      contact: f.contact || null, visitDate: f.visitDate, caseNumber: f.caseNumber || null,
      idType: f.idType, idLast4: f.idLast4 ? f.idLast4.toUpperCase() : null,
      issuedBy: caller.name ?? '', issuedByUid: caller.uid, issuedAt: serverTimestamp(),
    })
    return codeId
  })

  await writeAudit(db, caller, {
    action: 'hospitalid_issued', targetType: 'hospitalId', targetId: id, targetName: id,
    details: `Issued to ${name} (visit ${f.visitDate}; ID seen: ${f.idType}${f.idLast4 ? ` …${f.idLast4.toUpperCase()}` : ''})${f.course ? `; course of treatment until ${f.courseUntil}` : ''}`,
    tenantId: caller.tenantId,
  })
  return { id, name, courseUntil: f.course ? f.courseUntil : null }
}

// ── claimAccessCode ──────────────────────────────────────────────────────────

async function handleClaimAccessCode({ callerUid, data, db, now = () => Date.now(), serverTimestamp = () => FieldValue.serverTimestamp() }) {
  if (!callerUid) fail('unauthenticated', 'Sign in required.')
  const nowMs = now()
  const code = String(data?.code ?? '').trim().toUpperCase()
  if (!CODE_RE.test(code)) fail('invalid-argument', 'That access code is not in the right format.')
  const typedLast = str(data?.lastName)
  const typedBirth = str(data?.birthdate)

  const user = await loadUser(db, callerUid)
  // A fresh sign-up account may not have a profile doc yet; it adopts the code's
  // recorded identity. An established account must match its OWN profile (I1).
  const account = user || null

  const codeRef = db.doc(`hospitalIds/${code}`)
  const pre = await codeRef.get()
  if (!pre.exists) fail('not-found', 'That access code was not found.')
  const c = pre.data()
  const tenantId = c.tenantId || DEFAULT_HOSPITAL_ID

  const hSnap = await db.doc(`hospitals/${tenantId}`).get()
  if (hSnap.exists && hSnap.data().enabled === false) fail('failed-precondition', 'This hospital is not taking new requests right now.')

  // Blank codes printed before patient-bound issuing stop working at the cutoff.
  if (c.bound !== true && blankCodeExpired(new Date(nowMs))) fail('failed-precondition', 'That access code has expired. Ask the hospital for a new one.')

  // Patient-bound codes: prove identity. For an established account we compare
  // the code's issued proof against the ACCOUNT's own last name + birthdate, so
  // one patient can never claim another's code. A fresh account takes the typed
  // values (which also become its profile) and must still match the issued proof.
  let adoptName = null
  if (c.bound === true) {
    const issued = await codeRef.collection('privateInfo').doc('issued').get()
    const issuedProof = issued.exists ? issued.data().proof : null
    const haveProfile = account && str(account.lastName) && str(account.birthdate)
    const compareLast = haveProfile ? account.lastName : typedLast
    const compareBirth = haveProfile ? account.birthdate : typedBirth
    if (!str(compareLast) || !isBirthdate(compareBirth)) fail('invalid-argument', 'Enter the patient’s last name and birthdate.')
    if (!issuedProof || codeProof(compareLast, compareBirth) !== issuedProof) {
      fail('permission-denied', 'That code was issued to a different patient (last name and birthdate do not match).')
    }
    if (!haveProfile && issued.exists) adoptName = issued.data() // a fresh account takes the recorded identity
  }

  const changed = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(codeRef)
    if (!fresh.exists) fail('not-found', 'That access code was not found.')
    const cc = fresh.data()
    if (!claimableBy(cc, callerUid, nowMs)) fail('failed-precondition', 'That access code has already been used.')
    const mine = cc.status === 'used' && cc.patId === callerUid

    const userSnap = account ? null : await tx.get(db.doc(`users/${callerUid}`))
    const existing = account || (userSnap && userSnap.exists ? { uid: callerUid, ...userSnap.data() } : null)
    const prevIds = Array.isArray(existing?.tenantIds) ? existing.tenantIds : []
    const nextIds = [...new Set([...prevIds, ...(existing?.tenantId ? [existing.tenantId] : []), tenantId])]

    const fields = {
      tenantId, tenantIds: nextIds, hospitalId: code,
      ...(adoptName ? {
        name: adoptName.name,
        lastName: adoptName.nameParts?.lastName ?? adoptName.name?.split(' ').slice(-1)[0] ?? '',
        birthdate: adoptName.birthdate,
        ...(adoptName.nameParts?.suffix ? { suffix: adoptName.nameParts.suffix } : {}),
      } : {}),
    }

    if (!mine) {
      tx.update(codeRef, {
        status: 'used', patId: callerUid,
        date: manilaDate(nowMs), time: manilaTime(nowMs),
      })
      tx.set(db.doc(`hospitalIds/${code}/privateInfo/details`), {
        usedBy: fields.name ?? existing?.name ?? '', usedById: callerUid, createdAt: serverTimestamp(),
        ...(cc.bound === true ? { proof: codeProof(fields.lastName ?? existing?.lastName, fields.birthdate ?? existing?.birthdate) } : {}),
      })
    }
    tx.set(db.doc(`users/${callerUid}`), fields, { merge: true })
    return fields
  })
  return changed
}

// ── Callables ──────────────────────────────────────────────────────────────

const wrap = (name, handler) => onCall({ region: 'asia-southeast1', timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  try {
    // Two-factor stage 2 (Phase 5 PR 5.4): off until enabled in mfaPolicy.js.
    await assertStaffMfa(getFirestore(), request.auth)
    return await handler({ callerUid: request.auth?.uid, data: request.data, db: getFirestore() })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error(`[${name}] failed`, { err: err.message })
    throw new HttpsError('internal', 'Something went wrong. Nothing was changed; try again.')
  }
})

exports.handleIssueAccessCode = handleIssueAccessCode
exports.handleClaimAccessCode = handleClaimAccessCode
exports.openCodeFor = openCodeFor
exports.issueAccessCode = wrap('issueAccessCode', handleIssueAccessCode)
exports.claimAccessCode = wrap('claimAccessCode', handleClaimAccessCode)
