import { useState } from 'react'
import { doc, setDoc, collection, getDocs, writeBatch, arrayUnion, updateDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { accessCodePrefixFor } from '../config/org'
// Single source of truth for the catalogs (shared with the app + bootstrap).
import { DOCUMENT_TYPES, ASSISTANCE_TYPES, CORE_DOC_IDS } from '../data/referenceData'
import { AGENCIES, INITIAL_BUDGET } from '../data/agencies.seed'

// Document + assistance catalogs are imported from src/data/referenceData.js
// (single source of truth). The legacy flat checklist still needs a `required`
// flag + `order`, derived from the canonical core set + array order below.

// SEED_USERS moved to scripts/bootstrap-users.js — the tightened
// users/create rule (allowing self-create only with role=='patient')
// blocks the prior web-flow approach of signing in as each user
// and writing their own doc with elevated role. The admin-SDK script
// bypasses Firestore rules and handles every role cleanly.
//
// Before re-seeding the reference data below, run:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//     node scripts/bootstrap-users.js
// then sign in as the admin account and click Seed Database here.

// 20 demo access codes under the active issuing prefix, e.g. MAPA-2026-00001.
const SEED_ID_PREFIX = accessCodePrefixFor(new Date().getFullYear())
const SEED_IDS = Array.from({ length: 20 }, (_, i) =>
  `${SEED_ID_PREFIX}${String(i + 1).padStart(5, '0')}`
)

export default function Seed() {
  if (import.meta.env.VITE_ENABLE_SEED !== 'true') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="card p-8 max-w-sm text-center">
          <p className="text-3xl mb-3">🔒</p>
          <p className="text-base font-semibold text-gray-800 mb-1">Seed Disabled</p>
          <p className="text-sm text-gray-500">
            The seed page is disabled in this environment.
            Set <code className="bg-gray-100 px-1 rounded">VITE_ENABLE_SEED=true</code> to enable it.
          </p>
        </div>
      </div>
    )
  }
  const [log, setLog]     = useState([])
  const [running, setRunning] = useState(false)
  const [done, setDone]   = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillDone, setBackfillDone] = useState(false)

  const push = (msg) => setLog(prev => [...prev, msg])

  // One-shot migration for the documents.read scope tightening.
  // Walks every applications doc, collects (documentId, agencyId) pairs
  // from attachedDocuments, and arrayUnions the agencyId onto each
  // document. Idempotent — safe to re-run.
  //
  // After running this on prod data, the legacy "(!('agencyIds' in
  // resource.data))" fallback in firestore.rules documents.read can be
  // removed.
  const handleBackfillDocAgencyIds = async () => {
    setBackfilling(true)
    setLog([])
    try {
      push('Scanning applications...')
      const appsSnap = await getDocs(collection(db, 'applications'))
      push(`  Found ${appsSnap.size} applications`)

      // Aggregate { documentId -> Set<agencyId> } so repeated docs across
      // siblings only produce one update each.
      const pairs = new Map()
      for (const d of appsSnap.docs) {
        const data = d.data()
        if (!data.agencyId) continue
        for (const att of data.attachedDocuments ?? []) {
          if (!att?.documentId) continue
          const set = pairs.get(att.documentId) ?? new Set()
          set.add(data.agencyId)
          pairs.set(att.documentId, set)
        }
      }
      push(`  Found ${pairs.size} unique documents to stamp`)

      // Walk the Map and arrayUnion each agencyId onto the document.
      // Done as individual updates (not a batch) so a per-doc rule denial
      // doesn't poison the whole run.
      let ok = 0
      let failed = 0
      for (const [docId, agencyIdSet] of pairs.entries()) {
        try {
          await updateDoc(doc(db, 'documents', docId), {
            agencyIds: arrayUnion(...Array.from(agencyIdSet)),
          })
          ok++
        } catch (err) {
          failed++
          console.error(`[backfill] ${docId}:`, err?.code, err?.message)
        }
      }
      push(`Done. Stamped ${ok} documents (${failed} failed — see console).`)
      push('You can now remove the "!agencyIds in resource.data" legacy')
      push('clause from firestore.rules documents.read.')
      setBackfillDone(true)
    } catch (err) {
      console.error('[backfill] fatal:', err)
      push(`Fatal: ${err?.message ?? err}`)
    } finally {
      setBackfilling(false)
    }
  }

  const handleSeed = async () => {
    setRunning(true)
    setLog([])

    // 1. Sanity check: the operator must already be signed in as a
    //    super_admin before any privileged write can succeed. User
    //    creation is now scripts/bootstrap-users.js (admin-SDK); this
    //    page only seeds reference data + runs migrations.
    if (!auth.currentUser) {
      push('❌ Not signed in. Run scripts/bootstrap-users.js first, then sign in as the admin account and re-open this page.')
      setRunning(false)
      return
    }
    push(`✅ Signed in as ${auth.currentUser.email}`)

    // 2. Seed Hospital IDs
    for (const id of SEED_IDS) {
      try {
        await setDoc(doc(db, 'hospitalIds', id), {
          status: 'available', usedBy: null, patId: null,
          date: new Date().toLocaleDateString(), time: '',
        }, { merge: true })
      } catch (err) {
        push(`❌ Failed ID ${id}: ${err.message}`)
      }
    }
    push(`✅ Seeded ${SEED_IDS.length} Hospital IDs`)

    // 2b. Patch existing users missing active field
    try {
      const { getDocs, collection: col, query: q, where, updateDoc, doc } = await import('firebase/firestore')
      const snap = await getDocs(q(col(db, 'users'), where('active', '==', null)))
      // Also patch any user where active is simply not set
      const all = await getDocs(col(db, 'users'))
      for (const d of all.docs) {
        if (d.data().active === undefined) {
          await updateDoc(doc(db, 'users', d.id), { active: true })
        }
      }
      push('✅ Patched existing users with active field')
    } catch (e) { push(`⚠️ Patch skipped: ${e.message}`) }

    // 3. Seed Agencies (from the canonical src/data/agencies.seed.js). Strip the
    //    id (it's the doc key) and initialize the budget block so lists don't
    //    render NaN on first seed — matches scripts/bootstrap-reference-data.js.
    for (const { id, ...data } of AGENCIES) {
      try {
        await setDoc(doc(db, 'agencies', id), {
          ...data, budget: { ...INITIAL_BUDGET }, createdAt: new Date(),
        }, { merge: true })
      } catch (err) {
        push(`❌ Failed agency ${data.name}: ${err.message}`)
      }
    }
    push(`✅ Seeded ${AGENCIES.length} Agencies`)

    // 4a. Clear existing doc types and assistance types to prevent duplicates
    try {
      const clearCollection = async (col) => {
        const snap = await getDocs(collection(db, col))
        if (snap.empty) return
        const batch = writeBatch(db)
        snap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      await clearCollection('documentTypes')
      await clearCollection('assistanceTypes')
      push('✅ Cleared existing document types and assistance types')
    } catch (e) { push(`⚠️ Clear skipped: ${e.message}`) }

    // 4. Seed Document Types (ids from referenceData; core docs → required:true)
    for (const [i, dt] of DOCUMENT_TYPES.entries()) {
      try {
        await setDoc(doc(db, 'documentTypes', dt.id), {
          name: dt.name, description: dt.description, reusable: !!dt.reusable,
          required: CORE_DOC_IDS.includes(dt.id), order: i, createdAt: new Date(),
        }, { merge: true })
      } catch (err) {
        push(`❌ Failed doc type ${dt.name}: ${err.message}`)
      }
    }
    push(`✅ Seeded ${DOCUMENT_TYPES.length} Document Types`)

    // 5. Seed Assistance Types (ids from referenceData — safe to re-run)
    for (const at of ASSISTANCE_TYPES) {
      try {
        await setDoc(doc(db, 'assistanceTypes', at.id), {
          name: at.name, description: at.description, order: at.order, createdAt: new Date(),
        }, { merge: true })
      } catch (err) {
        push(`❌ Failed assistance type ${at.name}: ${err.message}`)
      }
    }
    push(`✅ Seeded ${ASSISTANCE_TYPES.length} Assistance Types`)


    setRunning(false)
    setDone(true)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md card p-6">
        <h1 className="text-lg font-bold text-gray-800 mb-1">Database Seeder</h1>
        <p className="text-xs text-gray-500 mb-4">
          Creates admin, agency coordinator accounts, and seeds reference data. Safe to re-run — uses merge for most records.
        </p>

        {!done && (
          <button
            className="btn-primary w-full py-2.5 mb-4"
            onClick={handleSeed}
            disabled={running || backfilling}
          >
            {running ? 'Seeding...' : 'Seed Database'}
          </button>
        )}

        {/* One-shot migration: stamp agencyIds[] onto every document that
            sits on an existing application's attachedDocuments. Idempotent.
            See firestore.rules documents.read comment for context. */}
        <div className="mb-4 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">One-shot migrations</p>
          <button
            className="w-full py-2 rounded-lg text-sm font-medium border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            onClick={handleBackfillDocAgencyIds}
            disabled={running || backfilling}>
            {backfilling ? 'Backfilling…' : backfillDone ? 'Backfill agencyIds — Done' : 'Backfill document.agencyIds (after rules tighten)'}
          </button>
          <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
            Stamps every legacy /documents/* row with the agencyId of any application it's attached to. Required once after deploying the tightened documents.read rule, so pre-existing scans stay readable to the right agency.
          </p>
        </div>

        {log.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-4 text-xs font-mono space-y-1 max-h-60 overflow-y-auto">
            {log.map((l, i) => <div key={i} className="text-green-400">{l}</div>)}
          </div>
        )}

        {done && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 font-medium text-center">
            Seeding complete! <a href="/login" className="underline">Go to Login →</a>
          </div>
        )}
      </div>
    </div>
  )
}
