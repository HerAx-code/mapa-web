import Layout from '../../components/Layout'
import SearchableSelect from '../../components/ui/SearchableSelect'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { ORG } from '../../config/org'
import { useAuth } from '../../contexts/AuthContext'
import {
  MdArrowBack, MdSave, MdPrint, MdCheckCircle,
  MdInfo, MdAdd, MdDelete, MdLock, MdAutorenew,
  MdGroups, MdWork, MdReceipt, MdMedicalServices, MdAssignment,
  MdHourglassEmpty, MdErrorOutline, MdSend, MdEdit,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import {
  MEANS_CATEGORIES, EMPLOYMENT_TYPES, EMPTY_FAMILY_MEMBER, RELATIONSHIPS, EXPENSE_FIELDS,
  blankSheet, isIntakeComplete, requiredFieldsStatus, meansTestSuggestion, needsMeansTestReason,
  PATIENT_FACT_KEYS, factsOf, sameFact, factChanges, mergeRemoteFacts,
  SHORTFALL_SOURCES, monthlyShortfall,
  FACT_SECTIONS, sectionFacts, sectionVerification, allSectionsVerified, sectionsNeedingCorrection,
} from '../../utils/intakeSheet'
import { logAudit } from '../../utils/auditLog'
import { notify } from '../../utils/notifications'
import { tsToDate } from '../../utils/dates'
import { buildIntakeSheetHTML } from '../../utils/intakeSheetHTML'
import { fetchHospitalBranding } from '../../utils/hospitals'
import { useHospitalBranding } from '../../hooks/useHospitals'
import { isGatewayAdminRole } from '../../utils/constants'
// Phase 2.3: Field + PesoInput live in components/ui/ now so other
// intake-style forms can share them without re-declaring the helpers.
import Field from '../../components/ui/Field'
import PesoInput from '../../components/ui/PesoInput'
import AssessmentSnapshot from '../../components/AssessmentSnapshot'

const AUTOSAVE_MS = 1500

const SECTIONS = [
  { id: 'family',   label: 'Family Composition',  Icon: MdGroups            },
  { id: 'income',   label: 'Income & Employment', Icon: MdWork              },
  { id: 'expenses', label: 'Monthly Expenses',    Icon: MdReceipt           },
  { id: 'medical',  label: 'Medical Information', Icon: MdMedicalServices   },
  { id: 'assess',   label: 'Assessment',          Icon: MdAssignment        },
]

// Maps each required field to the section that contains it, so the merged
// rail can show how many required fields remain per section.
const REQ_SECTION = {
  householdSize:     'family',
  monthlyIncome:     'income',
  diagnosis:         'medical',
  recommendation:    'assess',
  meansTestCategory: 'assess',
  completedBy:       'assess',
  meansTestOverrideReason: 'assess',
  'verify.family':   'family',
  'verify.income':   'income',
  'verify.expenses': 'expenses',
  'verify.medical':  'medical',
}

// Staff-only intake fields set by their own actions rather than the form.
const STAFF_CONTROL_KEYS = [
  'factsVerification', 'factsLocked', 'factsLockedAt', 'factsLockedBy',
  'encodedOnBehalf', 'correctionRequestedAt', 'correctionRequestedBy',
]

const meansShortLabel = (cat) => (MEANS_CATEGORIES.find(c => c.value === cat)?.label ?? cat).split('—')[0].trim()

const fmtRelative = (date) => {
  if (!date) return ''
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 5)   return 'just now'
  if (diff < 60)  return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Page ──────────────────────────────────────────────────────────────────

// Used by both the agency (per-application, legacy) and the gateway (per-request,
// the redesign's assessment step) — `collectionName` switches which doc the
// same Unified Intake form reads and writes.
export default function IntakeSheet({ collectionName = 'applications', patientFacts = false } = {}) {
  const { id }      = useParams()
  const navigate    = useNavigate()
  const { user }    = useAuth()
  const isRequestMode = collectionName === 'requests'
  // patientFacts: the patient fills the socioeconomic + medical facts on their
  // own request (the Assessment section stays the gateway-only and is hidden here).
  const backList = patientFacts ? '/patient/request' : isRequestMode ? '/admin/requests' : '/agency/inbox'
  const visibleSections = patientFacts ? SECTIONS.filter(s => s.id !== 'assess') : SECTIONS

  const [app, setApp]           = useState(null)
  // Phase 8: the case's hospital (an agency viewer has no hospital of its own).
  const caseOrg                 = useHospitalBranding(app?.tenantId)
  const [loading, setLoading]   = useState(true)
  const [sheet, setSheet]       = useState(() => blankSheet())
  const [hydrated, setHydrated] = useState(false)
  const [saveState, setSaveState] = useState({ status: 'idle', lastSavedAt: null })
  const [activeSection, setActiveSection] = useState('family')
  // Under the co-funding redesign the assessment is owned by the gateway on the
  // parent request. The legacy agency intake route still loads a slice doc
  // (no edits possible — see canEdit below), but we mirror the request's
  // intake into the displayed sheet so the agency actually sees what the gateway
  // filled in instead of the slice's empty field.
  const [parentRequest, setParentRequest] = useState(null)

  const dirtyRef       = useRef(false)
  const saveTimerRef   = useRef(null)
  const sectionRefs    = useRef({})
  // Always holds the latest sheet so the debounced performSave writes the
  // current values, not the ones captured in the render that scheduled the
  // timer (that stale closure dropped the last edit — e.g. a single
  // "Use suggestion" click). Timers are cleared on id-change, so this never
  // crosses documents.
  const sheetRef       = useRef(sheet)
  useEffect(() => { sheetRef.current = sheet }, [sheet])
  // Last means-test category / override reason written to the audit log, so
  // each change is logged once rather than on every autosave.
  const lastAuditedCategoryRef = useRef(null)
  const lastAuditedReasonRef   = useRef('')
  // Latest loaded doc, for the debounced save (its closure can be a render old).
  const appRef = useRef(null)
  // The patient facts as last seen from Firestore — the "base" of the
  // three-way merge that keeps a patient's update from being overwritten.
  const baselineFactsRef = useRef(null)
  // Facts the patient changed since the social worker last reviewed them
  // (intakeSheet.reviewedFacts vs the current facts). Request mode only.
  const [patientChanges, setPatientChanges] = useState([])
  // Revision 9: encoding the patient's answers on their behalf (only when the
  // patient never filled the sheet). Ref mirror for the debounced save.
  const [encodeMode, setEncodeMode] = useState(false)
  const encodeModeRef = useRef(false)
  useEffect(() => { encodeModeRef.current = encodeMode }, [encodeMode])
  const [showEncodeModal, setShowEncodeModal] = useState(false)
  const [encodeReason, setEncodeReason] = useState('')

  // Subscribe to application — use a ref for the "have we hydrated" flag
  // so the snapshot subscription doesn't tear down + recreate the moment
  // hydration completes (which was the prior behavior with `hydrated`
  // in the deps array).
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!id) return
    hydratedRef.current = false
    const unsub = onSnapshot(doc(db, collectionName, id), snap => {
      if (!snap.exists()) {
        toast.error(isRequestMode ? 'Request not found.' : 'Application not found.')
        navigate(backList)
        return
      }
      const data = { id: snap.id, ...snap.data() }
      setApp(data)
      appRef.current = data
      const remoteFacts = factsOf(data.intakeSheet)

      // Hydrate the local sheet once from the remote intake. After that, a
      // remote change to a patient FACT is merged in only where the worker
      // hasn't edited that fact (mergeRemoteFacts) — so the patient's update
      // shows up instead of being overwritten by the next autosave, and the
      // worker's own in-progress edits are never clobbered.
      if (!hydratedRef.current) {
        setSheet({ ...blankSheet(), ...(data.intakeSheet ?? {}) })
        lastAuditedCategoryRef.current = data.intakeSheet?.meansTestCategory || null
        lastAuditedReasonRef.current   = data.intakeSheet?.meansTestOverrideReason?.trim() ?? ''
        // Resume encoding if this worker started it and the patient still
        // hasn't filled the sheet themselves.
        setEncodeMode(!!(data.intakeSheet?.encodedOnBehalf?.byUid && data.intakeSheet.encodedOnBehalf.byUid === user?.uid
          && !data.intakeSheet?.patientFilledAt))
        setHydrated(true)
        hydratedRef.current = true
      } else if (isRequestMode) {
        const base = baselineFactsRef.current
        if (!PATIENT_FACT_KEYS.every(k => sameFact(remoteFacts[k], base?.[k]))) {
          setSheet(local => mergeRemoteFacts(local, base, data.intakeSheet))
        }
      }
      baselineFactsRef.current = remoteFacts
      if (isRequestMode) setPatientChanges(factChanges(data.intakeSheet?.reviewedFacts, remoteFacts))
      setLoading(false)
    }, () => { setLoading(false); toast.error('Failed to load application.') })
    return unsub
  }, [id, navigate])

  // Agency mode only: load the parent request and re-hydrate the displayed
  // sheet from request.intakeSheet (the actual source of truth). Skipped in
  // patient/the gateway modes because they already load from the request directly.
  useEffect(() => {
    if (patientFacts || isRequestMode || !app?.requestId) return
    const unsub = onSnapshot(doc(db, 'requests', app.requestId),
      snap => {
        if (!snap.exists()) return
        const reqData = { id: snap.id, ...snap.data() }
        setParentRequest(reqData)
        if (reqData.intakeSheet) {
          setSheet({ ...blankSheet(), ...reqData.intakeSheet })
        }
      },
      (err) => console.error('[IntakeSheet] parent request snapshot error:', err),
    )
    return unsub
  }, [app?.requestId, patientFacts, isRequestMode])

  // Permission: the gateway admins edit the request's intake; patients fill the
  // facts portion on their own request. Under the co-funding redesign the
  // assessment is single-sourced on the parent request, so the legacy
  // agency-application intake is view-only (kept accessible for old slices
  // whose data was written before the redesign).
  const canEdit = app && (
    patientFacts
      ? app.patientId === user?.uid && !['closed', 'rejected', 'fully_funded'].includes(app.status)
      : isRequestMode
        ? isGatewayAdminRole(user?.role) && !['closed', 'rejected', 'fully_funded'].includes(app.status)
        : false
  )
  // Revision 9: the patient's answers are read-only for staff unless they are
  // encoding on behalf of a patient who never filled the sheet. If the
  // patient fills it after all, encoding ends and the facts become theirs.
  const remoteIntake = app?.intakeSheet ?? {}
  const canEditFacts = !!canEdit && (!isRequestMode || (encodeMode && !remoteIntake.patientFilledAt))
  // Verification state comes from the STORED sheet (staff-only fields).
  const verificationRequired = isRequestMode && (remoteIntake.verificationRequired ?? !isIntakeComplete(app?.intakeSheet))
  const verifySheet = { ...remoteIntake, verificationRequired }

  // Autosave (debounced)
  // acknowledge: the worker clicked "Mark as reviewed" on the patient-changes
  // banner — record every current fact as reviewed.
  const performSave = async ({ acknowledge = false } = {}) => {
    if (!app || !dirtyRef.current) return
    setSaveState(prev => ({ ...prev, status: 'saving' }))
    try {
      // Read the LATEST sheet (via ref), not this render's captured `sheet`.
      const s = sheetRef.current
      const remote = appRef.current?.intakeSheet ?? {}
      const cleanedMembers = (s.familyMembers ?? [])
        .filter(m => m.name?.trim() || m.relationship?.trim())
      const payload = {
        ...s,
        familyMembers: cleanedMembers,
        householdSize:      s.householdSize === '' ? null : Number(s.householdSize),
        monthlyIncome:      s.monthlyIncome === '' ? null : Number(s.monthlyIncome),
        estimatedTotalCost: s.estimatedTotalCost === '' ? null : Number(s.estimatedTotalCost),
        expenses: Object.fromEntries(
          Object.entries(s.expenses ?? {}).map(([k, v]) => [k, v === '' ? null : Number(v)])
        ),
        completedBy:   app.intakeSheet?.completedBy ?? user.name,
        completedAt:   app.intakeSheet?.completedAt ?? serverTimestamp(),
        lastEditedBy:  user.name,
        lastEditedAt:  serverTimestamp(),
      }

      if (isRequestMode) {
        // Revision 9: the patient's answers are written exactly as stored —
        // staff verify them, they don't edit them (firestore.rules refuses a
        // staff write that changes a fact). Only while encoding on behalf of
        // a patient who never filled the sheet do the form's facts go out.
        const encoding = encodeModeRef.current && !remote.patientFilledAt && remote.encodedOnBehalf?.byUid === user.uid
        if (!encoding) {
          for (const k of PATIENT_FACT_KEYS) { if (k in remote) payload[k] = remote[k]; else delete payload[k] }
        }
        // Staff control fields are written by their own actions (verify,
        // lock, send back, encode) — always carry the stored value through,
        // never this form's possibly stale copy.
        for (const k of STAFF_CONTROL_KEYS) { if (k in remote) payload[k] = remote[k]; else delete payload[k] }
        // Grandfathering: only sheets that weren't already complete when staff
        // first worked them need section verification before endorsement.
        payload.verificationRequired = remote.verificationRequired ?? !isIntakeComplete(remote)
      }

      // reviewedFacts = the patient facts as the social worker last reviewed
      // them (the patient can't write it — firestore.rules). A fact the patient
      // changed since then stays "unreviewed" (keeps its old reviewed value, so
      // the banner keeps showing it) until the worker clicks Mark as reviewed;
      // every other fact takes the worker's current value, so the worker's
      // own edits never show up as "patient changes".
      if (isRequestMode) {
        const facts = factsOf(payload)
        const prev  = remote.reviewedFacts
        payload.reviewedFacts = (!prev || acknowledge)
          ? facts
          : Object.fromEntries(PATIENT_FACT_KEYS.map(k => [k, sameFact(remote[k], prev[k]) ? facts[k] : (prev[k] ?? null)]))
      }

      // Lock the patient's answers the first time the assessment is complete
      // (A2). Only when the lock has never been set: once a worker explicitly
      // unlocks for a correction, autosave must not silently re-lock it.
      const autoLock = isRequestMode && remote.factsLocked === undefined && isIntakeComplete(payload)
      if (autoLock) Object.assign(payload, { factsLocked: true, factsLockedAt: serverTimestamp(), factsLockedBy: user.name })

      await updateDoc(doc(db, collectionName, app.id), {
        intakeSheet: payload,
        updatedAt:   serverTimestamp(),
      })
      if (autoLock) {
        setSheet(p => ({ ...p, factsLocked: true }))
        logAudit(user, {
          action: 'intake_facts_locked', targetType: 'request', targetId: app.id, targetName: app.requestId ?? '',
          details: 'Assessment complete — patient answers locked automatically',
          requestId: app.id, patientId: app.patientId ?? null,
        })
      }
      // Audit every means-test classification change (CLAUDE.md: admin actions
      // call logAudit). Logged once per change, not per autosave, and carries
      // the advisory suggestion + the written reason when the worker departed
      // from it — so every exception is traceable.
      const savedCategory = lastAuditedCategoryRef.current
      if (s.meansTestCategory && s.meansTestCategory !== savedCategory) {
        const suggestion = meansTestSuggestion({ monthlyIncome: s.monthlyIncome, householdSize: s.householdSize })
        logAudit(user, {
          action: 'means_test_set', targetType: collectionName === 'requests' ? 'request' : 'application',
          targetId: app.id, targetName: app.requestId ?? app.appId ?? '',
          details: `Means-test: ${meansShortLabel(s.meansTestCategory)}`
            + (suggestion ? ` (suggested ${meansShortLabel(suggestion.category)})` : '')
            + (needsMeansTestReason(s) && s.meansTestOverrideReason?.trim() ? ` · reason: ${s.meansTestOverrideReason.trim()}` : ''),
          requestId: collectionName === 'requests' ? app.id : (app.requestId ?? null),
          patientId: app.patientId ?? null,
        })
        lastAuditedCategoryRef.current = s.meansTestCategory
        lastAuditedReasonRef.current   = s.meansTestOverrideReason?.trim() ?? ''
      }
      dirtyRef.current = false
      setSaveState({ status: 'saved', lastSavedAt: new Date() })
    } catch (err) {
      console.error(err)
      setSaveState(prev => ({ ...prev, status: 'error' }))
      toast.error('Failed to save assessment.')
    }
  }

  const scheduleAutosave = () => {
    if (!canEdit) return
    dirtyRef.current = true
    setSaveState(prev => ({ ...prev, status: 'saving' }))
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(performSave, AUTOSAVE_MS)
  }

  // Cancel any pending autosave when the application id changes or the
  // page unmounts. Critical: do NOT flush the timer on id-change —
  // the queued performSave closes over the previous `app` ref via closure,
  // so flushing would write the prior intake's draft data into the new
  // intake document (silent cross-application data corruption when a
  // coordinator clicks between two patients faster than the 1.5s debounce).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      dirtyRef.current = false
    }
  }, [id])

  // Also rehydrate when navigating to a different application id so the
  // local sheet draft doesn't bleed across documents.
  useEffect(() => {
    setHydrated(false)
    setSheet(blankSheet())
    setSaveState({ status: 'idle', lastSavedAt: null })
  }, [id])

  // Warn user about unsaved changes on tab close
  useEffect(() => {
    const handler = (e) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Scroll-spy: highlight which section the user is reading
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) setActiveSection(e.target.id)
      })
    }, { rootMargin: '-30% 0px -60% 0px' })
    Object.values(sectionRefs.current).forEach(el => el && observer.observe(el))
    return () => observer.disconnect()
  }, [hydrated])

  // ── Setters ──────────────────────────────────────────────────────────

  const set = (field) => (e) => {
    setSheet(p => ({ ...p, [field]: e.target.value }))
    scheduleAutosave()
  }
  const setExp = (field) => (e) => {
    setSheet(p => ({ ...p, expenses: { ...p.expenses, [field]: e.target.value } }))
    scheduleAutosave()
  }
  const toggleCoverage = (v) => {
    setSheet(p => {
      const cur = p.shortfallCoverage ?? []
      const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]
      return { ...p, shortfallCoverage: next, shortfallCoverageOther: next.includes('other') ? (p.shortfallCoverageOther ?? '') : '' }
    })
    scheduleAutosave()
  }
  const setEmployment = (v) => {
    // Leaving "Other" discards its description so a stale one isn't saved.
    setSheet(p => ({ ...p, employmentType: v, employmentTypeOther: v === 'other' ? (p.employmentTypeOther ?? '') : '' }))
    scheduleAutosave()
  }
  // Log the written reason once the social worker leaves the box (the
  // category change itself is logged in performSave, usually before the
  // reason is typed).
  const auditReason = () => {
    const reason = sheet.meansTestOverrideReason?.trim() ?? ''
    if (!canEdit || !reason || reason === lastAuditedReasonRef.current || !needsMeansTestReason(sheet)) return
    logAudit(user, {
      action: 'means_test_reason', targetType: isRequestMode ? 'request' : 'application',
      targetId: app.id, targetName: app.requestId ?? app.appId ?? '',
      details: `Means-test ${meansShortLabel(sheet.meansTestCategory)} · reason: ${reason}`,
      requestId: isRequestMode ? app.id : (app.requestId ?? null),
      patientId: app.patientId ?? null,
    })
    lastAuditedReasonRef.current = reason
  }
  const setMember = (idx, field, val) => {
    setSheet(p => {
      const next = [...p.familyMembers]
      next[idx] = { ...next[idx], [field]: val }
      return { ...p, familyMembers: next }
    })
    scheduleAutosave()
  }
  const addMember = () => {
    setSheet(p => ({ ...p, familyMembers: [...p.familyMembers, { ...EMPTY_FAMILY_MEMBER }] }))
    scheduleAutosave()
  }
  const removeMember = (idx) => {
    setSheet(p => ({ ...p, familyMembers: p.familyMembers.filter((_, i) => i !== idx) }))
    scheduleAutosave()
  }

  // A3: the worker has read the patient's changes.
  const markChangesReviewed = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    dirtyRef.current = true
    await performSave({ acknowledge: true })
    logAudit(user, {
      action: 'intake_changes_reviewed', targetType: 'request', targetId: app.id, targetName: app.requestId ?? '',
      details: `Reviewed patient changes: ${patientChanges.map(c => `${c.label} ${c.from} → ${c.to}`).join('; ')}`,
      requestId: app.id, patientId: app.patientId ?? null,
    })
    toast.success('Marked as reviewed.')
  }

  // A2: lock / unlock the patient's answers by hand. Unlocking lets the
  // patient correct something after the assessment; it never re-locks itself.
  const setFactsLock = async (locked) => {
    if (!canEdit) return
    // Flush pending edits first so the save can't race the lock write.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (dirtyRef.current) await performSave()
    try {
      await updateDoc(doc(db, collectionName, app.id), {
        'intakeSheet.factsLocked':   locked,
        'intakeSheet.factsLockedAt': serverTimestamp(),
        'intakeSheet.factsLockedBy': user.name,
        updatedAt: serverTimestamp(),
      })
      setSheet(p => ({ ...p, factsLocked: locked }))
      logAudit(user, {
        action: locked ? 'intake_facts_locked' : 'intake_facts_unlocked', targetType: 'request',
        targetId: app.id, targetName: app.requestId ?? '',
        details: locked ? 'Patient answers locked' : 'Patient answers unlocked for correction',
        requestId: app.id, patientId: app.patientId ?? null,
      })
      if (!locked && app.patientId) {
        notify(app.patientId, {
          type:  'app_advanced',
          title: 'You can update your household information',
          body:  `${ORG.gatewayName} has reopened your household information so you can correct it. Open your request to make changes.`,
        }).catch(() => {})
      }
      toast.success(locked ? 'Patient answers locked.' : 'Patient can now edit their answers.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to change the lock.')
    }
  }

  // Flush the debounced save so an action's own write can't race it.
  const flushSave = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (dirtyRef.current) await performSave()
  }

  // Revision 9b: verify a section, or flag it for the patient to correct.
  // Stores a copy of the section's answers so a later patient change reads
  // as "changed — check again" (sectionVerification) without another write.
  const setSectionVerification = async (sectionKey, status, note = '') => {
    if (!canEdit || !isRequestMode) return
    await flushSave()
    const remote = appRef.current?.intakeSheet ?? {}
    const sec = FACT_SECTIONS.find(x => x.key === sectionKey)
    const entry = {
      status, note: note.trim(), by: user.name, byUid: user.uid,
      at: serverTimestamp(), facts: sectionFacts(remote, sectionKey),
    }
    const updates = { [`intakeSheet.factsVerification.${sectionKey}`]: entry, updatedAt: serverTimestamp() }
    if (remote.verificationRequired === undefined) updates['intakeSheet.verificationRequired'] = !isIntakeComplete(remote)
    // 9d: once every section is verified, the answers lock again.
    const after = { ...remote, factsVerification: { ...(remote.factsVerification ?? {}), [sectionKey]: entry } }
    const lockNow = allSectionsVerified(after) && remote.factsLocked !== true
    if (lockNow) Object.assign(updates, {
      'intakeSheet.factsLocked': true, 'intakeSheet.factsLockedAt': serverTimestamp(), 'intakeSheet.factsLockedBy': user.name,
    })
    try {
      await updateDoc(doc(db, collectionName, app.id), updates)
      setSheet(p => ({ ...p, ...(lockNow ? { factsLocked: true } : {}) }))
      logAudit(user, {
        action: status === 'verified' ? 'intake_section_verified' : 'intake_section_flagged',
        targetType: 'request', targetId: app.id, targetName: app.requestId ?? '',
        details: `${sec.label}: ${status === 'verified' ? 'verified' : `needs correction — ${entry.note}`}`
          + (lockNow ? ' · all sections verified, patient answers locked' : ''),
        requestId: app.id, patientId: app.patientId ?? null,
      })
      toast.success(status === 'verified' ? `${sec.label} verified.` : `${sec.label} marked for correction.`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to save the verification.')
    }
  }

  // Revision 9c: return the flagged sections to the patient. Unlocks their
  // answers and tells them what to fix; they correct it themselves.
  const sendBackForCorrection = async () => {
    const flagged = sectionsNeedingCorrection(appRef.current?.intakeSheet ?? {})
    if (!canEdit || !flagged.length) return
    await flushSave()
    try {
      await updateDoc(doc(db, collectionName, app.id), {
        'intakeSheet.factsLocked':           false,
        'intakeSheet.factsLockedAt':         serverTimestamp(),
        'intakeSheet.factsLockedBy':         user.name,
        'intakeSheet.correctionRequestedAt': serverTimestamp(),
        'intakeSheet.correctionRequestedBy': user.name,
        updatedAt: serverTimestamp(),
      })
      setSheet(p => ({ ...p, factsLocked: false }))
      const list = flagged.map(f => `${f.label}: ${f.note}`).join(' · ')
      logAudit(user, {
        action: 'intake_correction_requested', targetType: 'request', targetId: app.id, targetName: app.requestId ?? '',
        details: `Sent back to patient — ${list}`, requestId: app.id, patientId: app.patientId ?? null,
      })
      if (app.patientId) {
        notify(app.patientId, {
          type:  'app_advanced',
          title: 'Please correct your household information',
          body:  `${ORG.gatewayName} asked you to correct: ${list}. Open your request to update your answers.`,
        }).catch(() => {})
      }
      toast.success('Sent back to the patient for correction.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to send back for correction.')
    }
  }

  // Revision 9 (decision 1): encode on behalf of a patient who can't fill the
  // sheet themselves. Labelled with who + why; firestore.rules only accepts
  // staff fact edits carrying this, and only before the patient has filled it.
  const startEncoding = async () => {
    const reason = encodeReason.trim()
    if (!canEdit || reason.length < 10 || remoteIntake.patientFilledAt) return
    const entry = { by: user.name, byUid: user.uid, reason, at: serverTimestamp() }
    try {
      await updateDoc(doc(db, collectionName, app.id), { 'intakeSheet.encodedOnBehalf': entry, updatedAt: serverTimestamp() })
      setEncodeMode(true)
      setShowEncodeModal(false)
      setEncodeReason('')
      logAudit(user, {
        action: 'intake_encoded_on_behalf', targetType: 'request', targetId: app.id, targetName: app.requestId ?? '',
        details: `Encoding the patient's answers on their behalf — reason: ${reason}`,
        requestId: app.id, patientId: app.patientId ?? null,
      })
      toast.success("You can now encode the patient's answers.")
    } catch (err) {
      console.error(err)
      toast.error('Failed to start encoding.')
    }
  }

  const handleManualSave = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    dirtyRef.current = true
    await performSave()
    toast.success('Assessment saved.')
  }

  const handleScrollTo = (sectionId) => {
    const el = sectionRefs.current[sectionId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handlePrintFormalSheet = async () => {
    // Flush any pending edits first so the printout reflects the latest data
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (dirtyRef.current) await performSave()

    try {
      const html = buildIntakeSheetHTML({
        app,
        sheet,
        agency: null,
        currentUser: user,
        org: await fetchHospitalBranding(app.tenantId),
      })
      const blob = new Blob([html], { type: 'text/html' })
      const url  = URL.createObjectURL(blob)
      const win  = window.open(url, '_blank', 'width=900,height=1100')
      if (!win) {
        URL.revokeObjectURL(url)
        toast.error('Please allow pop-ups to print the Intake Sheet.')
        return
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate Intake Sheet for printing.')
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────

  // Source for "completedBy": in agency mode prefer the parent request's
  // intake (the single source of truth under co-funding).
  const intakeSource = (!patientFacts && !isRequestMode && parentRequest?.intakeSheet)
    ? parentRequest.intakeSheet
    : app?.intakeSheet
  const required = useMemo(
    () => requiredFieldsStatus({
      ...sheet,
      factsVerification: remoteIntake.factsVerification,
      verificationRequired,
      completedBy: intakeSource?.completedBy ?? user?.name,
    }, user?.name),
    [sheet, remoteIntake.factsVerification, verificationRequired, intakeSource?.completedBy, user?.name]
  )
  const verifyBar = (key) => (isRequestMode
    ? <SectionVerify state={sectionVerification(verifySheet, key)} canAct={!!canEdit}
        onVerify={() => setSectionVerification(key, 'verified')}
        onFlag={(note) => setSectionVerification(key, 'needs_correction', note)} />
    : null)
  const flaggedSections = isRequestMode ? sectionsNeedingCorrection(verifySheet) : []
  const completedCount = required.filter(r => r.done).length
  const completion     = Math.round((completedCount / required.length) * 100)
  const complete       = completedCount === required.length

  const totalExpenses = Object.values(sheet.expenses ?? {})
    .reduce((sum, v) => sum + (Number(v) || 0), 0)

  const suggestion   = meansTestSuggestion({ monthlyIncome: sheet.monthlyIncome, householdSize: sheet.householdSize })
  const reasonNeeded = needsMeansTestReason(sheet)
  // The amount the patient still needs — gateway mode loads the request
  // itself; agency mode reads it off the parent request.
  const billSource = isRequestMode ? app : parentRequest
  const billAmount = billSource?.amountNeeded ?? billSource?.totalBill ?? sheet.estimatedTotalCost

  // Section completion (rough — used for nav indicators)
  const sectionDone = {
    family:   !!sheet.householdSize && Number(sheet.householdSize) > 0,
    income:   sheet.monthlyIncome !== '' && Number(sheet.monthlyIncome) >= 0,
    expenses: totalExpenses > 0,
    medical:  !!sheet.diagnosis?.trim(),
    assess:   !!sheet.recommendation?.trim() && !!sheet.meansTestCategory,
  }

  if (loading || !app) return (
    <Layout breadcrumb="Case Assessment">
      <div className="w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="card p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-48 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-64" />
          </div>
        ))}
      </div>
    </Layout>
  )

  return (
    <Layout breadcrumb={`Case Assessment · ${app.patientName}`}>
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Sticky header */}
        <div className="sticky top-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-gray-50/95 backdrop-blur border-b border-gray-100 z-20 mb-5 print:hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Link to={isRequestMode ? backList : `/agency/applications/${app.id}`}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600 font-medium">
                <MdArrowBack size={14} /> {patientFacts ? 'Back to my request' : isRequestMode ? 'Back to requests' : 'Back to application'}
              </Link>
              <span className="text-gray-300">/</span>
              <p className="text-sm font-semibold text-gray-800 truncate">{app.patientName}</p>
              <span className="text-xs text-gray-500 truncate hidden sm:inline">· Unified Intake Sheet</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Save state indicator */}
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                {saveState.status === 'saving' && (
                  <><MdAutorenew size={13} className="text-brand-500 animate-spin" /> Saving…</>
                )}
                {saveState.status === 'saved' && (
                  <><MdCheckCircle size={13} className="text-green-500" /> Saved {fmtRelative(saveState.lastSavedAt)}</>
                )}
                {saveState.status === 'error' && (
                  <span className="text-red-500">Save failed</span>
                )}
                {saveState.status === 'idle' && hydrated && app.intakeSheet && (
                  <><MdCheckCircle size={13} className="text-gray-300" /> All changes saved</>
                )}
              </span>
              <button className="btn-secondary text-sm flex items-center gap-1.5"
                onClick={handlePrintFormalSheet}
                title="Open a printable Unified Intake Sheet in a new window">
                <MdPrint size={14} /> Print Form
              </button>
              <button className="btn-primary text-sm flex items-center gap-1.5"
                onClick={handleManualSave} disabled={!canEdit}>
                <MdSave size={14} /> Save now
              </button>
            </div>
          </div>
        </div>

        {/* When-to-fill banner. Coordinators previously got confused
            seeing this form before the interview was conducted and tried
            to pre-fill it from documents alone. The assessment is meant
            to record what the social worker LEARNS from the patient
            interview — not a pre-interview prep doc. This banner
            disambiguates and stays visible until the application is
            approved (at which point editing is locked anyway). */}
        {canEdit && (
          <div className="mb-5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-2 print:hidden">
            <MdInfo size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-800 leading-relaxed">
              <p className="font-medium mb-0.5">Fill this during or after the patient interview.</p>
              <p className="text-blue-700">
                The assessment records what you learn from talking to <strong>{app.patientName}</strong> —
                family situation, income, expenses, medical history, and your recommendation. It is not
                meant to be pre-filled from documents alone. You can save partial answers and return
                anytime.
              </p>
            </div>
          </div>
        )}

        {/* Read-only banner */}
        {!canEdit && (
          <div className="mb-5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2 print:hidden">
            <MdLock size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              {app.status === 'rejected'
                ? `This ${isRequestMode ? 'request' : 'application'} was rejected — the assessment is now read-only.`
                : isRequestMode
                  ? `You are viewing this case assessment in read-only mode. Only ${caseOrg.gatewayName} staff can edit it.`
                  : `The case assessment is owned by ${caseOrg.gatewayName} on the parent request. This view is read-only.`}
            </p>
          </div>
        )}

        {/* ── Two-column layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 print:grid-cols-1 print:gap-2">

          {/* Section nav (1/4, sticky) */}
          <aside className="lg:col-span-1 print:hidden">
            <div className="lg:sticky lg:top-24 space-y-3">

              {/* Progress + section nav (merged) */}
              <div className="card p-4">
                <div className="flex items-baseline gap-2 mb-2">
                  <p className="text-2xl font-bold text-gray-800">{completedCount}</p>
                  <p className="text-xs text-gray-500">of {required.length} required</p>
                  {complete && (
                    <span className="ml-auto badge badge-green text-xs">Complete</span>
                  )}
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
                  <div className={`h-full rounded-full ${complete ? 'bg-green-500' : 'bg-amber-400'}`}
                    style={{ width: `${completion}%` }} />
                </div>
                <nav className="space-y-0.5">
                  {visibleSections.map(s => {
                    const active      = activeSection === s.id
                    const Icon        = s.Icon
                    const remaining   = required.filter(r => REQ_SECTION[r.key] === s.id && !r.done).length
                    const hasRequired = required.some(r => REQ_SECTION[r.key] === s.id)
                    const done        = remaining === 0 && (hasRequired || sectionDone[s.id])
                    return (
                      <button key={s.id} onClick={() => handleScrollTo(s.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                          active
                            ? 'bg-brand-50 text-brand-700 font-medium'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}>
                        <Icon size={16} className={`flex-shrink-0 ${active ? 'text-brand-500' : 'text-gray-500'}`} />
                        <span className="flex-1 truncate">{s.label}</span>
                        {remaining > 0
                          ? <span className="text-xs text-amber-600 flex-shrink-0">{remaining} left</span>
                          : done
                            ? <MdCheckCircle size={14} className="text-green-400 flex-shrink-0" />
                            : null}
                      </button>
                    )
                  })}
                </nav>
                {complete && (
                  <p className="text-xs text-green-600 mt-3 leading-relaxed">
                    {isRequestMode
                      ? '✓ Ready to endorse. Return to the request to endorse it to agencies.'
                      : '✓ Ready for approval. Return to the application to issue a Guarantee Letter.'}
                  </p>
                )}
              </div>

              {/* Financial snapshot + advisory means-test suggestion — a gateway
                  assessment aid that fills the rail and turns the entered
                  figures into decision support. Not shown while a patient fills
                  their factual portion (it's staff decision support, and would
                  otherwise be English-only on a patient-facing surface). */}
              {!patientFacts && (
                <AssessmentSnapshot
                  sheet={sheet}
                  bill={billAmount}
                  showMeansTest
                  canEdit={canEdit}
                  onApplyMeansTest={(cat) => {
                    setSheet(p => ({ ...p, meansTestCategory: cat }))
                    scheduleAutosave()
                  }}
                />
              )}

              {/* A2: whether the patient can still change their answers. */}
              {isRequestMode && (
                <div className="card p-3">
                  <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    {sheet.factsLocked
                      ? <><MdLock size={13} className="text-gray-500" /> Patient answers locked</>
                      : <><MdInfo size={13} className="text-gray-500" /> Patient can edit their answers</>}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {sheet.factsLocked
                      ? <>Locked{app.intakeSheet?.factsLockedBy ? <> by <strong className="text-gray-700">{app.intakeSheet.factsLockedBy}</strong></> : null}
                          {tsToDate(app.intakeSheet?.factsLockedAt) ? ` on ${tsToDate(app.intakeSheet.factsLockedAt).toLocaleDateString('en-PH')}` : ''}.
                          The facts your assessment used can't change.</>
                      : 'Locks automatically when the assessment is complete.'}
                  </p>
                  {canEdit && (
                    <button className="btn-secondary text-xs mt-2 w-full"
                      onClick={() => setFactsLock(!sheet.factsLocked)}>
                      {sheet.factsLocked ? 'Allow patient to correct answers' : 'Lock patient answers now'}
                    </button>
                  )}
                </div>
              )}

              {/* Editor info — agency mode prefers the parent request's
                  intake authorship (the real source); other modes use
                  the loaded doc itself. */}
              {(() => {
                const src = (!patientFacts && !isRequestMode && parentRequest?.intakeSheet)
                  ? parentRequest.intakeSheet
                  : app.intakeSheet
                if (!src?.completedBy) return null
                return (
                  <div className="card p-3">
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Originally completed by <strong className="text-gray-700">{src.completedBy}</strong>.
                      {src.lastEditedBy && src.lastEditedBy !== src.completedBy && (
                        <> Last edited by <strong className="text-gray-700">{src.lastEditedBy}</strong>.</>
                      )}
                    </p>
                  </div>
                )
              })()}
            </div>
          </aside>

          {/* Main content (3/4) */}
          <div className="lg:col-span-3 space-y-5 print:col-span-1">

            {/* Revision 9: whose answers these are, and what the assessor can do. */}
            {isRequestMode && (
              <div className="card p-4 border-blue-100 bg-blue-50/40 print:hidden">
                {remoteIntake.encodedOnBehalf ? (
                  <p className="text-xs text-blue-900 leading-relaxed">
                    <strong>Answers encoded by {remoteIntake.encodedOnBehalf.by} for the patient</strong> — reason: {remoteIntake.encodedOnBehalf.reason}
                    {remoteIntake.patientFilledAt && ' The patient has since filled in their own answers.'}
                  </p>
                ) : !remoteIntake.patientFilledAt ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-blue-900">The patient hasn't filled in their household information yet.</p>
                    {canEdit && (
                      <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => setShowEncodeModal(true)}>
                        <MdEdit size={13} /> Encode on their behalf
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-blue-900 leading-relaxed">
                    <strong>The applicant's answers are read-only.</strong> Verify each section below, or mark it for
                    correction and send it back — the patient corrects their own answers.
                  </p>
                )}
                {flaggedSections.length > 0 && (
                  <div className="mt-3 border-t border-blue-100 pt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-gray-700">
                      <strong>{flaggedSections.length}</strong> section{flaggedSections.length === 1 ? '' : 's'} marked for correction:
                      {' '}{flaggedSections.map(f => f.label).join(', ')}
                    </p>
                    {remoteIntake.factsLocked === false && remoteIntake.correctionRequestedAt ? (
                      <p className="text-xs text-gray-600 italic">
                        Sent back {tsToDate(remoteIntake.correctionRequestedAt)?.toLocaleDateString('en-PH') ?? ''} — waiting for the patient.
                      </p>
                    ) : canEdit && (
                      <button className="btn-primary text-xs flex items-center gap-1.5" onClick={sendBackForCorrection}>
                        <MdSend size={13} /> Send back to patient
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* A3: what the patient changed since the worker last reviewed. */}
            {isRequestMode && patientChanges.length > 0 && (
              <div className="card p-4 border-amber-200 bg-amber-50/60 print:hidden" role="status">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      The patient changed {patientChanges.length} answer{patientChanges.length === 1 ? '' : 's'} since your last review
                    </p>
                    {tsToDate(app.intakeSheet?.patientFilledAt) && (
                      <p className="text-xs text-amber-800 mt-0.5">
                        Last patient update: {tsToDate(app.intakeSheet.patientFilledAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={markChangesReviewed}>
                      <MdCheckCircle size={14} /> Mark as reviewed
                    </button>
                  )}
                </div>
                <dl className="mt-3 divide-y divide-amber-100 text-xs">
                  {patientChanges.map(c => (
                    <div key={c.key} className="grid grid-cols-1 sm:grid-cols-3 gap-1 py-1.5">
                      <dt className="font-medium text-gray-700">{c.label}</dt>
                      <dd className="sm:col-span-2 text-gray-700">
                        <span className="line-through text-gray-500">{c.from}</span>
                        <span className="mx-1.5 text-gray-400" aria-hidden="true">→</span>
                        <span className="sr-only">changed to</span>
                        <strong className="text-gray-900">{c.to}</strong>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Print-only header */}
            <div className="hidden print:block mb-4">
              <h1 className="text-xl font-bold text-gray-900">Unified Intake Sheet</h1>
              <p className="text-sm text-gray-700 mt-1">{app.patientName} · {app.appId}</p>
              <p className="text-xs text-gray-500">Agency: {app.agencyName}</p>
              <hr className="my-3 border-gray-300" />
            </div>

            {/* Section: Family */}
            <section ref={el => sectionRefs.current.family = el} id="family" className="card p-5 scroll-mt-24">
              <div className="flex items-center gap-2 mb-4">
                <MdGroups className="text-brand-500" size={18} />
                <h2 className="text-sm font-semibold text-gray-800">Family Composition</h2>
              </div>
              {verifyBar('family')}

              <div className="space-y-2 mb-3">
                {/* Column headers — visible on sm+ where the row is
                    horizontal. Match the grid spans of each input row
                    exactly so the labels sit above their fields. The
                    headers are screen-reader hidden (their inputs get
                    explicit aria-label) so AT users hear the field
                    purpose without the header echoing it. */}
                {/* Headers match the grid spans below. Age was previously
                    col-span-1 (~50 px on a typical 600 px form area) which
                    squashed the number input's spinner arrows over the
                    digits. col-span-2 = ~95 px, enough room for the
                    spinner + 2 digits with room to spare. */}
                <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-xs font-medium text-gray-500 uppercase tracking-wide mb-1" aria-hidden="true">
                  <span className="col-span-3">Name</span>
                  <span className="col-span-2">Relationship</span>
                  <span className="col-span-2">Age</span>
                  <span className="col-span-2">Occupation</span>
                  <span className="col-span-2">Monthly ₱</span>
                  <span className="col-span-1" />
                </div>

                {sheet.familyMembers.map((m, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-start">
                    <input className="input col-span-12 sm:col-span-3 text-sm"
                      placeholder="Juan Dela Cruz" aria-label={`Family member ${i + 1} name`}
                      value={m.name} onChange={e => setMember(i, 'name', e.target.value)} disabled={!canEditFacts} />
                    <SearchableSelect
                      className="col-span-6 sm:col-span-2 text-sm"
                      ariaLabel={`Family member ${i + 1} relationship`}
                      value={m.relationship ?? ''}
                      onChange={v => setMember(i, 'relationship', v)}
                      disabled={!canEditFacts}
                      options={[
                        { value: '', label: 'Select…' },
                        ...RELATIONSHIPS.map(r => ({ value: r.value, label: r.label })),
                        // A free-text value saved before the dropdown existed stays
                        // visible (and selectable) until someone picks a list value.
                        ...(m.relationship && !RELATIONSHIPS.some(r => r.value === m.relationship)
                          ? [{ value: m.relationship, label: `${m.relationship} (old entry)` }] : []),
                      ]} />
                    <input className="input col-span-3 sm:col-span-2 text-sm" type="number"
                      placeholder="—" aria-label={`Family member ${i + 1} age`}
                      value={m.age} onChange={e => setMember(i, 'age', e.target.value)} disabled={!canEditFacts} />
                    <input className="input col-span-3 sm:col-span-2 text-sm"
                      placeholder="e.g. Driver" aria-label={`Family member ${i + 1} occupation`}
                      value={m.occupation} onChange={e => setMember(i, 'occupation', e.target.value)} disabled={!canEditFacts} />
                    <PesoInput
                      wrapperClassName="col-span-10 sm:col-span-2"
                      className="text-sm"
                      ariaLabel={`Family member ${i + 1} monthly contribution`}
                      value={m.monthlyContribution}
                      onChange={e => setMember(i, 'monthlyContribution', e.target.value)}
                      disabled={!canEditFacts} />
                    <button
                      className="col-span-2 sm:col-span-1 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 flex items-center justify-center"
                      onClick={() => removeMember(i)}
                      aria-label={`Remove family member ${i + 1}`}
                      disabled={!canEditFacts || sheet.familyMembers.length === 1}>
                      <MdDelete size={16} />
                    </button>
                  </div>
                ))}
                {canEditFacts && (
                  <button className="btn-secondary text-xs flex items-center gap-1.5 mt-3"
                    onClick={addMember}>
                    <MdAdd size={14} /> Add family member
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-50">
                <Field label="Household Size" required>
                  <input type="number" className="input" min={1}
                    value={sheet.householdSize} onChange={set('householdSize')} disabled={!canEditFacts} />
                  <p className="text-xs text-gray-500 mt-1 leading-snug">
                    {sheet.familyMembers.length} family member{sheet.familyMembers.length !== 1 ? 's' : ''} listed above.
                    Total household size includes the patient and any dependents not listed individually.
                  </p>
                </Field>
              </div>
            </section>

            {/* Section: Income */}
            <section ref={el => sectionRefs.current.income = el} id="income" className="card p-5 scroll-mt-24">
              <div className="flex items-center gap-2 mb-4">
                <MdWork className="text-brand-500" size={18} />
                <h2 className="text-sm font-semibold text-gray-800">Income & Employment</h2>
              </div>
              {verifyBar('income')}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Monthly Household Income" required>
                  <PesoInput
                    value={sheet.monthlyIncome}
                    onChange={set('monthlyIncome')}
                    disabled={!canEditFacts} />
                </Field>
                <Field label="Employment Type">
                  <SearchableSelect
                    value={sheet.employmentType}
                    onChange={setEmployment}
                    disabled={!canEditFacts}
                    options={EMPLOYMENT_TYPES.map(t => ({ value: t.value, label: t.label }))} />
                </Field>
                {sheet.employmentType === 'other' && (
                  <Field label="Describe Work Situation" required>
                    <input className="input" value={sheet.employmentTypeOther ?? ''}
                      onChange={set('employmentTypeOther')} placeholder="e.g. Seasonal farm work" disabled={!canEditFacts} />
                  </Field>
                )}
                <Field label="Employer">
                  <input className="input" value={sheet.employer} onChange={set('employer')} disabled={!canEditFacts} />
                </Field>
                <Field label="Length of Employment">
                  <input className="input" value={sheet.lengthOfEmployment}
                    onChange={set('lengthOfEmployment')} placeholder="e.g. 3 years" disabled={!canEditFacts} />
                </Field>
                <Field label="Other Income Source" colSpan={2}>
                  <input className="input" value={sheet.incomeSource}
                    onChange={set('incomeSource')} placeholder="Pension, remittance, etc." disabled={!canEditFacts} />
                </Field>
              </div>
            </section>

            {/* Section: Expenses */}
            <section ref={el => sectionRefs.current.expenses = el} id="expenses" className="card p-5 scroll-mt-24">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MdReceipt className="text-brand-500" size={18} />
                  <h2 className="text-sm font-semibold text-gray-800">Monthly Expenses</h2>
                </div>
                <span className="text-xs text-gray-500">Total: <strong>₱{totalExpenses.toLocaleString()}</strong></span>
              </div>
              {verifyBar('expenses')}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {EXPENSE_FIELDS.map(({ key: k, label }) => (
                  <Field key={k} label={label}>
                    <PesoInput
                      value={sheet.expenses?.[k] ?? ''}
                      onChange={setExp(k)}
                      disabled={!canEditFacts} />
                  </Field>
                ))}
              </div>
              {monthlyShortfall(sheet) > 0 && (
                <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                  <p className="text-xs font-semibold text-gray-700">
                    Expenses exceed income by ₱{monthlyShortfall(sheet).toLocaleString()} / month — how is the difference covered?
                  </p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {SHORTFALL_SOURCES.map(src => (
                      <label key={src.value} className="flex items-center gap-2 text-sm text-gray-700 py-1 cursor-pointer">
                        <input type="checkbox" className="accent-brand-600" disabled={!canEditFacts}
                          checked={(sheet.shortfallCoverage ?? []).includes(src.value)}
                          onChange={() => toggleCoverage(src.value)} />
                        {src.label}
                      </label>
                    ))}
                  </div>
                  {(sheet.shortfallCoverage ?? []).includes('other') && (
                    <input className="input mt-2" placeholder="Describe how else" value={sheet.shortfallCoverageOther ?? ''}
                      onChange={set('shortfallCoverageOther')} disabled={!canEditFacts} />
                  )}
                </div>
              )}
            </section>

            {/* Section: Medical */}
            <section ref={el => sectionRefs.current.medical = el} id="medical" className="card p-5 scroll-mt-24">
              <div className="flex items-center gap-2 mb-4">
                <MdMedicalServices className="text-brand-500" size={18} />
                <h2 className="text-sm font-semibold text-gray-800">Medical Information</h2>
              </div>
              {verifyBar('medical')}
              <div className="space-y-3">
                <Field label="Primary Diagnosis" required>
                  <input className="input" value={sheet.diagnosis} onChange={set('diagnosis')} disabled={!canEditFacts} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Attending Physician">
                    <input className="input" value={sheet.attendingPhysician}
                      onChange={set('attendingPhysician')} disabled={!canEditFacts} />
                  </Field>
                  <Field label="Hospital Case # (IHOMIS)">
                    <input className="input" value={sheet.hospitalCaseNumber}
                      onChange={set('hospitalCaseNumber')} disabled={!canEdit} />
                  </Field>
                  <Field label="Date of Admission">
                    <input type="date" className="input" value={sheet.dateOfAdmission}
                      onChange={set('dateOfAdmission')} disabled={!canEditFacts} />
                  </Field>
                  <Field label="Estimated Total Cost">
                    <PesoInput
                      value={sheet.estimatedTotalCost}
                      onChange={set('estimatedTotalCost')}
                      disabled={!canEditFacts} />
                  </Field>
                </div>
              </div>
            </section>

            {/* Section: Assessment — the gateway social worker only (hidden when the
                patient is filling their factual portion). */}
            {!patientFacts && (
            <section ref={el => sectionRefs.current.assess = el} id="assess" className="card p-5 scroll-mt-24">
              <div className="flex items-center gap-2 mb-4">
                <MdAssignment className="text-brand-500" size={18} />
                <h2 className="text-sm font-semibold text-gray-800">Social Worker Assessment</h2>
              </div>
              <div className="space-y-3">
                <Field label="Means-Test Category" required
                  hint="Manually classified by the social worker based on income, household size, and observed conditions.">
                  <SearchableSelect
                    value={sheet.meansTestCategory}
                    onChange={v => set('meansTestCategory')({ target: { value: v } })}
                    disabled={!canEdit}
                    options={MEANS_CATEGORIES.map(c => ({ value: c.value, label: c.label }))} />
                  {suggestion && (
                    <p className="text-xs text-gray-600 mt-1.5">
                      Suggested from income ÷ household size: <strong>{meansShortLabel(suggestion.category)}</strong>
                      {' '}({(Math.floor(suggestion.ratio * 10) / 10).toFixed(1)}× the poverty line)
                    </p>
                  )}
                </Field>
                {reasonNeeded && (
                  <Field label="Reason for this category" required
                    hint={sheet.meansTestCategory === 'above_threshold'
                      ? 'Explain why an Above Threshold patient is still being assessed for assistance (e.g. catastrophic bill vs income). Saved to the audit log.'
                      : `Your category differs from the suggestion (${suggestion ? meansShortLabel(suggestion.category) : '—'}). Explain what the figures don't show. Saved to the audit log.`}>
                    <textarea className="input resize-none" rows={2} maxLength={500}
                      value={sheet.meansTestOverrideReason ?? ''}
                      onChange={set('meansTestOverrideReason')} onBlur={auditReason} disabled={!canEdit} />
                    <p className="text-xs text-gray-500 mt-0.5 text-right">{(sheet.meansTestOverrideReason ?? '').length} / 500</p>
                  </Field>
                )}
                <Field label="Social Case Study Narrative"
                  hint="Family background, circumstances of illness, observations during home visit or interview.">
                  <textarea className="input resize-none" rows={4} maxLength={2000}
                    value={sheet.caseStudyNarrative}
                    onChange={set('caseStudyNarrative')} disabled={!canEdit} />
                  <p className="text-xs text-gray-500 mt-0.5 text-right">{(sheet.caseStudyNarrative ?? '').length} / 2000</p>
                </Field>
                <Field label="Recommendation" required
                  hint="Your professional recommendation for this case.">
                  <textarea className="input resize-none" rows={3} maxLength={1000}
                    value={sheet.recommendation}
                    onChange={set('recommendation')} disabled={!canEdit} />
                  <p className="text-xs text-gray-500 mt-0.5 text-right">{(sheet.recommendation ?? '').length} / 1000</p>
                </Field>
              </div>
            </section>
            )}

            {/* Footer hint */}
            <div className="card p-4 bg-blue-50/40 border-blue-100 print:hidden">
              <div className="flex items-start gap-2">
                <MdInfo size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  Changes save automatically as you type. {complete
                    ? (isRequestMode
                        ? 'All required fields are filled — return to the request and endorse it to agencies.'
                        : 'All required fields are filled — you can return to the application and click Approve & Issue GL.')
                    : `Fill the ${required.length - completedCount} remaining required field${required.length - completedCount === 1 ? '' : 's'} to unlock ${isRequestMode ? 'endorsement' : 'approval'}.`}
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Revision 9: encode on behalf — a reason is required and recorded. */}
      {showEncodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="encode-title">
          <div className="card w-full max-w-md p-5">
            <h2 id="encode-title" className="text-base font-semibold text-gray-900">Encode on the patient's behalf?</h2>
            <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">
              Only when the patient can't fill in their household information themselves. The answers will be labelled
              as encoded by you, with your reason, and recorded in the audit log. If the patient fills in their own
              answers later, theirs replace yours.
            </p>
            <label htmlFor="encode-reason" className="mt-4 block text-xs font-medium text-gray-700">Reason (at least 10 characters)</label>
            <textarea id="encode-reason" className="input mt-1 resize-none" rows={3} maxLength={300} autoFocus
              placeholder="e.g. Patient is 82, has no phone; information given by daughter at the ward."
              value={encodeReason} onChange={e => setEncodeReason(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary text-sm" onClick={() => { setShowEncodeModal(false); setEncodeReason('') }}>Cancel</button>
              <button className="btn-primary text-sm" disabled={encodeReason.trim().length < 10} onClick={startEncoding}>Start encoding</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

// Phase 2.3: Field + PesoInput were inlined here originally; promoted
// to src/components/ui/ so the patient IntakeWizard, future budget
// forms, etc. can share the same components.

// Revision 9b: per-section verification of the applicant's answers. The
// assessor never edits them — they mark a section verified, or flag it with a
// note for the patient to correct. `state` comes from sectionVerification().
function SectionVerify({ state, canAct, onVerify, onFlag }) {
  const [flagging, setFlagging] = useState(false)
  const [note, setNote]         = useState('')
  const when = tsToDate(state.at)
  const who  = state.by ? ` · ${state.by}${when ? `, ${when.toLocaleDateString('en-PH')}` : ''}` : ''
  const chip = {
    pending:          { cls: 'bg-gray-100 text-gray-600',   Icon: MdHourglassEmpty, text: 'Not yet verified' },
    verified:         { cls: 'bg-green-50 text-green-700',  Icon: MdCheckCircle,    text: `Verified${who}` },
    needs_correction: { cls: 'bg-red-50 text-red-700',      Icon: MdErrorOutline,   text: `Needs correction${who}` },
    changed:          { cls: 'bg-amber-50 text-amber-800',  Icon: MdAutorenew,      text: 'Patient updated this — verify again' },
  }[state.status]
  const saveFlag = () => { onFlag(note); setFlagging(false) }

  return (
    <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${chip.cls}`}>
          <chip.Icon size={13} /> {chip.text}
        </span>
        {canAct && !flagging && (
          <div className="flex items-center gap-1">
            {state.status !== 'verified' && (
              <button className="btn-secondary text-xs flex items-center gap-1" onClick={onVerify}>
                <MdCheckCircle size={13} /> Mark verified
              </button>
            )}
            <button className="text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg px-2.5 py-1.5"
              onClick={() => { setNote(state.note ?? ''); setFlagging(true) }}>
              Needs correction
            </button>
          </div>
        )}
      </div>
      {!flagging && state.note && ['needs_correction', 'changed'].includes(state.status) && (
        <p className={`mt-1.5 text-xs ${state.status === 'changed' ? 'text-amber-800' : 'text-red-700'}`}>
          {state.status === 'changed' ? 'Earlier note' : 'Note to patient'}: {state.note}
        </p>
      )}
      {flagging && (
        <div className="mt-2 space-y-2">
          <textarea className="input resize-none text-sm" rows={2} maxLength={300} autoFocus
            placeholder="What should the patient correct? e.g. Payslip shows ₱12,000, not ₱8,000."
            value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="text-xs text-gray-600 px-2.5 py-1.5" onClick={() => setFlagging(false)}>Cancel</button>
            <button className="btn-primary text-xs" disabled={note.trim().length < 5} onClick={saveFlag}>Save note</button>
          </div>
        </div>
      )}
    </div>
  )
}
