import Layout from '../../components/Layout'
import { useState, useEffect, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  MdSearch, MdMessage, MdSchedule, MdDelete, MdClose,
  MdRestoreFromTrash, MdDeleteForever, MdWarning,
  MdPhone, MdLocationOn, MdLocalHospital, MdCalendarToday, MdBadge,
} from 'react-icons/md'
import { deleteDoc, getDocs, writeBatch } from 'firebase/firestore'
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { tsToDate } from '../../utils/dates'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { getOrCreateConversation } from '../../utils/messages'
import { deleteDocumentStorage } from '../../utils/uploadDocument'
import GLDocumentPanel from '../../components/GLDocumentPanel'
import toast from 'react-hot-toast'

// ── Profile Modal ─────────────────────────────────────────────────────────

function ProfileModal({ patient, onClose }) {
  const [activeApp,   setActiveApp]   = useState(null)
  const [glApps,      setGlApps]      = useState([])
  const [docSummary,  setDocSummary]  = useState(null)
  const [ctxLoading,  setCtxLoading]  = useState(true)

  useEffect(() => {
    if (!patient?.uid) return
    Promise.all([
      getDocs(query(collection(db, 'applications'), where('patientId', '==', patient.uid))),
      getDocs(query(collection(db, 'documents'),    where('patientId', '==', patient.uid))),
    ]).then(([appsSnap, docsSnap]) => {
      const apps = appsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setActiveApp(apps.find(a => !['rejected', 'certificate'].includes(a.status)) ?? null)
      // All approved/certificate apps for the GL document section
      setGlApps(
        apps
          .filter(a => ['approved', 'certificate'].includes(a.status) && a.approvedAmount != null)
          // Sort via tsToDate so legacy data stored as JS Date or ISO
          // string still sorts correctly. The previous `.seconds`
          // accessor was Firestore-Timestamp-only; legacy entries
          // fell back to 0 and clustered at the top.
          .sort((a, b) => (tsToDate(b.approvedAt)?.getTime() ?? 0) - (tsToDate(a.approvedAt)?.getTime() ?? 0))
      )
      const docs = docsSnap.docs.map(d => d.data())
      setDocSummary({ total: docs.length, verified: docs.filter(d => d.status === 'verified').length })
      setCtxLoading(false)
    }).catch(() => setCtxLoading(false))
  }, [patient?.uid])

  const fmt = (ts) => {
    const d = tsToDate(ts)
    return d ? d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : '—'
  }

  const rows = [
    { icon: MdPhone,         label: 'Contact Number', value: patient.contact    || '—' },
    { icon: MdLocationOn,    label: 'Address',        value: patient.address    || '—' },
    { icon: MdLocalHospital, label: 'Access Code',    value: patient.hospitalId || '—' },
    { icon: MdCalendarToday, label: 'Registered',     value: fmt(patient.createdAt) },
    { icon: MdSchedule,      label: 'Holding Period', value: patient.cooldown > 0 ? 'Active' : 'None' },
    { icon: MdBadge,         label: 'Patient ID',     value: patient.patientId  || '—' },
  ]

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Patient Profile</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <MdClose size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Avatar + name */}
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
            {patient.photoURL ? (
              <img src={patient.photoURL} alt={patient.name}
                className="w-14 h-14 rounded-full object-cover border-2 border-brand-200 flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-brand-50 border-2 border-brand-200 flex items-center justify-center text-xl font-bold text-brand-600 flex-shrink-0">
                {patient.name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-gray-900 truncate">{patient.name}</p>
              <p className="text-xs text-gray-400 truncate">{patient.email}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className={`badge text-xs ${patient.deletion ? 'badge-red' : 'badge-green'}`}>
                  {patient.deletion ? 'Marked for Deletion' : 'Active'}
                </span>
                {patient.cooldown > 0 && (
                  <span className="badge badge-amber text-xs">Holding Period Active</span>
                )}
              </div>
            </div>
          </div>

          {/* Application + document context */}
          {ctxLoading ? (
            <div className="grid grid-cols-2 gap-2 animate-pulse">
              <div className="h-14 bg-gray-100 rounded-xl" />
              <div className="h-14 bg-gray-100 rounded-xl" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-xl p-3 ${activeApp ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
                <p className="text-xs text-gray-400 mb-0.5">Active Application</p>
                {activeApp ? (
                  <>
                    <p className="text-sm font-semibold text-blue-700 truncate">{activeApp.agencyName}</p>
                    <span className="text-xs text-blue-500 capitalize">{activeApp.status}</span>
                  </>
                ) : (
                  <p className="text-sm font-medium text-gray-400">None</p>
                )}
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-0.5">Documents</p>
                {docSummary ? (
                  <>
                    <p className="text-sm font-semibold text-gray-800">
                      {docSummary.verified}/{docSummary.total} verified
                    </p>
                    <p className="text-xs text-gray-400">
                      {docSummary.total - docSummary.verified > 0
                        ? `${docSummary.total - docSummary.verified} pending/rejected`
                        : 'All verified'}
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-medium text-gray-400">—</p>
                )}
              </div>
            </div>
          )}

          {/* Active application warning */}
          {activeApp && patient.deletion && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                This patient has an active application at <strong>{activeApp.agencyName}</strong>.
                Deleting this account will affect their application.
              </p>
            </div>
          )}

          {/* Detail rows */}
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="flex items-start gap-3">
                <r.icon size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-400">{r.label}</p>
                  <p className="text-sm text-gray-800 font-medium">{r.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Guarantee Letters (read-only audit view) */}
          {glApps.length > 0 && (
            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                Guarantee Letters ({glApps.length})
              </p>
              <div className="space-y-2">
                {glApps.map(a => (
                  <div key={a.id} className="space-y-1">
                    <p className="text-xs text-gray-500">
                      <strong className="text-gray-700">{a.agencyName}</strong> · {a.appId}
                    </p>
                    <GLDocumentPanel app={a} compact />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end border-t border-gray-100">
          <button className="btn-secondary text-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Patients() {
  const navigate              = useNavigate()
  const { user: adminUser }   = useAuth()
  const isSuperAdmin          = adminUser?.role === 'super_admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const [patients,             setPatients]             = useState([])
  const [confirmDeletePatient, setConfirmDeletePatient] = useState(null)
  const [loading,              setLoading]              = useState(true)
  const [search,               setSearch]               = useState('')
  const [tab,                  setTab]                  = useState('active')
  const [viewProfile,          setViewProfile]          = useState(null)
  const [activeApplicantIds,   setActiveApplicantIds]   = useState(new Set())
  const [confirmHolding,       setConfirmHolding]       = useState(null)
  const [confirmDeletion,      setConfirmDeletion]      = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'patient'))
    const unsub = onSnapshot(q, snap => {
      setPatients(snap.docs.map(d => ({ uid: d.id, ...d.data() })))
      setLoading(false)
    }, () => {
      setLoading(false)
      toast.error('Failed to load patients. Please refresh the page.')
    })
    return unsub
  }, [])

  // Deep-link: open profile when ?openId=<uid> matches a loaded patient
  useEffect(() => {
    const openId = searchParams.get('openId')
    if (!openId || viewProfile) return
    const target = patients.find(p => p.uid === openId)
    if (target) {
      setViewProfile(target)
      searchParams.delete('openId')
      setSearchParams(searchParams, { replace: true })
    }
  }, [patients, searchParams])

  // "Active applicant" = a patient with at least one non-terminal slice.
  // Covers both the co-funding slice statuses (endorsed before patient
  // Proceed, reviewing while agency assesses, awaiting_info while patient
  // gathers more docs, approved with GL pending issuance) and the legacy
  // pre-redesign statuses (pending, interview). Without including
  // 'endorsed' here, the previous version missed patients with brand-new
  // CRMC endorsements waiting on the patient to accept the coverage plan.
  useEffect(() => {
    getDocs(query(
      collection(db, 'applications'),
      where('status', 'in', ['pending', 'endorsed', 'reviewing', 'awaiting_info', 'interview', 'approved'])
    )).then(snap => {
      setActiveApplicantIds(new Set(snap.docs.map(d => d.data().patientId).filter(Boolean)))
    }).catch(err => console.error('[Patients] active applicants query failed:', err))
  }, [])

  const filtered = patients.filter(p => {
    if (tab === 'deletion' && !p.deletion) return false
    if (tab === 'active'   &&  p.deletion) return false
    const q = search.toLowerCase()
    return p.name?.toLowerCase().includes(q) ||
           p.email?.toLowerCase().includes(q) ||
           p.contact?.includes(q)
  })

  const formatDate = (ts) => {
    const d = tsToDate(ts)
    return d ? d.toLocaleDateString() : '—'
  }

  // ── Actions ──────────────────────────────────────────────────────────

  const handleMessage = async (patient) => {
    try {
      await getOrCreateConversation(adminUser.uid, patient.uid, {
        names: { [adminUser.uid]: adminUser.name, [patient.uid]: patient.name },
        roles: { [adminUser.uid]: adminUser.role, [patient.uid]: 'patient' },
        subject: `Admin Message — ${patient.name}`,
      })
      navigate('/admin/messages')
      toast.success('Conversation opened in Messages.')
    } catch (err) { console.error(err); toast.error('Failed to open conversation.') }
  }

  const handleToggleHolding = async (patient) => {
    try {
      const newCooldown = patient.cooldown > 0 ? 0 : 1
      await updateDoc(doc(db, 'users', patient.uid), { cooldown: newCooldown })
      await notify(patient.uid, {
        type:  'app_advanced',
        title: newCooldown > 0 ? 'Holding period applied' : 'Holding period removed',
        body:  newCooldown > 0
          ? 'A holding period has been applied to your account by the administrator.'
          : 'Your holding period has been removed. You may submit a new assistance request anytime.',
      })
      logAudit(adminUser, { action: newCooldown > 0 ? 'holding_applied' : 'holding_removed', targetType: 'patient', targetId: patient.uid, targetName: patient.name, details: newCooldown > 0 ? 'Holding period applied' : 'Holding period removed' })
      toast.success(`Holding period ${newCooldown > 0 ? 'applied to' : 'removed from'} ${patient.name}.`)
    } catch (err) { console.error(err); toast.error('Failed to update holding period. Please try again.') }
  }

  const handleToggleDeletion = async (patient) => {
    try {
      const newDeletion = !patient.deletion
      await updateDoc(doc(db, 'users', patient.uid), { deletion: newDeletion })
      await notify(patient.uid, {
        type:  newDeletion ? 'account_deactivated' : 'account_activated',
        title: newDeletion ? 'Account marked for deletion' : 'Account restored',
        body:  newDeletion
          ? 'Your account has been marked for deletion by the administrator. Contact CRMC for assistance.'
          : 'Your account has been restored and is now active.',
      })
      logAudit(adminUser, { action: newDeletion ? 'patient_marked' : 'patient_unmarked', targetType: 'patient', targetId: patient.uid, targetName: patient.name, details: newDeletion ? 'Marked for deletion' : 'Restored to active' })
      toast.success(`${patient.name} ${newDeletion ? 'marked for deletion' : 'restored to active'}.`)
    } catch (err) { console.error(err); toast.error('Failed to update account status. Please try again.') }
  }

  const handleDeleteAccount = async (patient) => {
    const uid = patient.uid

    // Batch-delete all docs in a snapshot, chunked at 500 (Firestore batch limit)
    const batchDelete = async (snap) => {
      if (snap.empty) return
      for (let i = 0; i < snap.docs.length; i += 500) {
        const batch = writeBatch(db)
        snap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
    }

    try {
      // R20: Fetch every collection that holds the patient's data so the
      // cascade is complete. Previously this missed `requests` (parent
      // of slices -- left orphaned with patient name/amount visible to
      // admin/Requests forever), `certificates/{appId}`, and
      // `conversations` the patient participated in. RA 10173 §16(e)
      // right-to-erasure expects all PII removed when the admin commits
      // to a delete; orphan parent docs were a real privacy gap.
      //
      // Note `conversations` and `certificates/{appId}` use document IDs
      // we have to look up via separate queries (no patientId field on
      // certificates -- the doc ID IS the appId, so we look up via the
      // already-fetched applications list).
      const [docsSnap, contentsSnap, appsSnap, requestsSnap, notifsSnap, convsSnap] = await Promise.all([
        getDocs(query(collection(db, 'documents'),        where('patientId', '==', uid))),
        getDocs(query(collection(db, 'documentContents'), where('patientId', '==', uid))),
        getDocs(query(collection(db, 'applications'),     where('patientId', '==', uid))),
        getDocs(query(collection(db, 'requests'),         where('patientId', '==', uid))),
        getDocs(collection(db, 'notifications', uid, 'items')),
        getDocs(query(collection(db, 'conversations'),    where('participants', 'array-contains', uid))),
      ])

      // Certificates: keyed by appId, no patientId field to query on.
      // Resolve via the application snapshots we just fetched.
      const certSnaps = await Promise.all(
        appsSnap.docs.map(a => getDocs(query(
          collection(db, 'certificates'),
          where('__name__', '==', a.id),
        )).catch(() => null))
      )

      // Delete Storage objects for any docs that have been migrated to
      // (or freshly uploaded into) Cloud Storage. deleteDocumentStorage
      // is silent on already-missing objects so legacy docs whose content
      // still lives in documentContents don't produce false-positive
      // errors.
      await Promise.all(docsSnap.docs.map(d => deleteDocumentStorage({
        storagePath: d.data()?.storagePath,
      })))

      // Delete associated records. Conversation thread messages live
      // under conversations/{id}/messages -- batch-delete those first,
      // then the parent conversation docs.
      const convMsgSnaps = await Promise.all(
        convsSnap.docs.map(c => getDocs(collection(db, 'conversations', c.id, 'messages')))
      )

      await Promise.all([
        batchDelete(docsSnap),
        batchDelete(contentsSnap),
        batchDelete(appsSnap),
        batchDelete(requestsSnap),
        batchDelete(notifsSnap),
        // Per-conversation: messages then the conversation doc itself.
        ...convMsgSnaps.map(s => batchDelete(s)),
        batchDelete(convsSnap),
        // Certificates: each query above returned at most one doc.
        ...certSnaps.filter(Boolean).map(s => batchDelete(s)),
      ])
      await deleteDoc(doc(db, 'notifications', uid)).catch(() => {})
      // user doc last so the admin can retry the cascade on partial failure
      await deleteDoc(doc(db, 'users', uid))

      logAudit(adminUser, {
        action: 'account_deleted', targetType: 'patient',
        targetId: uid, targetName: patient.name,
        details: `Permanently deleted: ${docsSnap.size} document(s), ${appsSnap.size} application(s), ${requestsSnap.size} request(s), ${convsSnap.size} conversation(s), and all notifications`,
      })
      setConfirmDeletePatient(null)
      toast.success(`${patient.name}'s account and all associated data permanently deleted.`)
    } catch (err) {
      // R20: the previous bare `catch {}` swallowed every error. Without
      // a log the admin had no way to tell whether the cascade failed
      // mid-flight (some data deleted, some left) or never started.
      console.error('[Patients] cascade delete failed:', err)
      toast.error('Failed to delete account. Some data may not have been removed — please try again.')
    }
  }

  const deletionCount = patients.filter(p => p.deletion).length

  return (
    <Layout breadcrumb="Patient Accounts">
      <div className="p-4 sm:p-6">

        <div className="mb-5">
          <h1 className="page-title">Patient Accounts</h1>
          <p className="page-sub">View and manage all registered patient accounts.</p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Total Accounts',      value: patients.length,                          color: 'text-gray-800',  tabKey: null        },
            { label: 'Active',              value: patients.filter(p => !p.deletion).length, color: 'text-green-600', tabKey: 'active'    },
            { label: 'Marked for Deletion', value: deletionCount,                            color: deletionCount > 0 ? 'text-red-500' : 'text-gray-400', tabKey: 'deletion' },
          ].map((m, i) => (
            <div key={i}
              className={`card p-4 ${m.tabKey ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''} ${tab === m.tabKey ? 'ring-2 ring-brand-400' : ''}`}
              onClick={() => m.tabKey && setTab(m.tabKey)}>
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-3xl font-semibold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {[['active', 'Active Accounts'], ['deletion', 'Marked for Deletion']].map(([key, label]) => (
            <button key={key}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${tab === key ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              onClick={() => setTab(key)}>
              {label}
              {key === 'deletion' && deletionCount > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'deletion' ? 'bg-white/20' : 'bg-red-100 text-red-600'}`}>
                  {deletionCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9" placeholder="Search by name, email or contact..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {search && (
          <p className="text-xs text-gray-400 mb-3">
            {filtered.length} of {patients.filter(p => tab === 'active' ? !p.deletion : p.deletion).length} patients
          </p>
        )}

        {/* Table */}
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Contact</th>
                <th>Date Registered</th>
                <th>Holding Period</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
                      <div className="space-y-1.5">
                        <div className="h-3 bg-gray-100 rounded w-28" />
                        <div className="h-2.5 bg-gray-100 rounded w-36" />
                      </div>
                    </div>
                  </td>
                  <td><div className="h-3 bg-gray-100 rounded w-24" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
                  <td><div className="h-6 bg-gray-100 rounded w-16" /></td>
                </tr>
              ))}
              {!loading && filtered.map(p => {
                const hasActiveApp  = activeApplicantIds.has(p.uid)
                const isIncomplete  = !p.contact || !p.address
                return (
                <Fragment key={p.uid}>
                <tr
                  className={`cursor-pointer hover:bg-gray-50 transition-colors ${p.deletion ? 'opacity-60' : ''}`}
                  onClick={() => setViewProfile(p)}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      {p.photoURL ? (
                        <img src={p.photoURL} alt={p.name}
                          className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-xs font-semibold text-gray-500 flex-shrink-0">
                          {p.name?.[0] ?? '?'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-gray-800 text-sm">{p.name}</p>
                          {hasActiveApp && (
                            <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              Active application
                            </span>
                          )}
                          {isIncomplete && (
                            <span className="text-xs font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              Incomplete profile
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 truncate">{p.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="text-xs text-gray-500">{p.contact ? `📞 ${p.contact}` : '—'}</td>
                  <td className="text-xs text-gray-400">{formatDate(p.createdAt)}</td>
                  <td>
                    {p.cooldown > 0
                      ? <span className="badge badge-amber text-xs">Holding Period Active</span>
                      : <span className="text-xs text-gray-400">—</span>
                    }
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button title="Send Message"
                        className="p-1.5 text-gray-400 hover:text-brand-500 hover:bg-brand-50 rounded-lg transition-colors"
                        onClick={() => handleMessage(p)}>
                        <MdMessage size={15} />
                      </button>
                      <button title={p.cooldown > 0 ? 'Remove Holding Period' : 'Apply Holding Period'}
                        className={`p-1.5 rounded-lg transition-colors ${confirmHolding?.uid === p.uid ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50'}`}
                        onClick={() => setConfirmHolding(confirmHolding?.uid === p.uid ? null : p)}>
                        <MdSchedule size={15} />
                      </button>
                      {p.deletion ? (
                        <button title="Restore Account"
                          className={`p-1.5 rounded-lg transition-colors ${confirmDeletion?.uid === p.uid ? 'text-green-600 bg-green-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                          onClick={() => setConfirmDeletion(confirmDeletion?.uid === p.uid ? null : p)}>
                          <MdRestoreFromTrash size={15} />
                        </button>
                      ) : (
                        <button title="Mark for Deletion"
                          className={`p-1.5 rounded-lg transition-colors ${confirmDeletion?.uid === p.uid ? 'text-red-500 bg-red-50' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                          onClick={() => setConfirmDeletion(confirmDeletion?.uid === p.uid ? null : p)}>
                          <MdDelete size={15} />
                        </button>
                      )}
                      {isSuperAdmin && p.deletion && (
                        <button title="Delete Permanently"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          onClick={() => setConfirmDeletePatient(p)}>
                          <MdDeleteForever size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Holding period inline confirmation */}
                {confirmHolding?.uid === p.uid && (
                  <tr key={p.uid + '_hold'} className="bg-amber-50">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <MdSchedule size={16} className="text-amber-500 flex-shrink-0" />
                        <p className="text-sm text-amber-700 flex-1">
                          {p.cooldown > 0
                            ? <>Remove holding period from <strong>{p.name}</strong>? They will be able to submit new assistance requests again.</>
                            : <>Apply a holding period to <strong>{p.name}</strong>? They will not be able to submit new assistance requests until it is removed.</>
                          }
                        </p>
                        <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0"
                          onClick={() => setConfirmHolding(null)}>Cancel</button>
                        <button className="text-xs text-white bg-amber-500 px-3 py-1.5 rounded-lg hover:bg-amber-600 flex-shrink-0"
                          onClick={() => { handleToggleHolding(p); setConfirmHolding(null) }}>Confirm</button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Mark/Restore deletion inline confirmation */}
                {confirmDeletion?.uid === p.uid && (
                  <tr key={p.uid + '_del'} className={p.deletion ? 'bg-green-50' : 'bg-red-50'}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.deletion
                          ? <MdRestoreFromTrash size={16} className="text-green-500 flex-shrink-0" />
                          : <MdDelete size={16} className="text-red-500 flex-shrink-0" />
                        }
                        <p className={`text-sm flex-1 ${p.deletion ? 'text-green-700' : 'text-red-700'}`}>
                          {p.deletion
                            ? <>Restore <strong>{p.name}</strong>'s account? They will be notified and can use the portal normally again.</>
                            : <>Mark <strong>{p.name}</strong>'s account for deletion? They will be notified immediately.</>
                          }
                        </p>
                        <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0"
                          onClick={() => setConfirmDeletion(null)}>Cancel</button>
                        <button className={`text-xs text-white px-3 py-1.5 rounded-lg flex-shrink-0 ${p.deletion ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
                          onClick={() => { handleToggleDeletion(p); setConfirmDeletion(null) }}>Confirm</button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8">
                    <p className="text-sm text-gray-400">
                      {search
                        ? 'No patients match your search.'
                        : tab === 'deletion'
                          ? 'No patients are currently marked for deletion.'
                          : 'No patients found.'}
                    </p>
                    {search && (
                      <button
                        onClick={() => setSearch('')}
                        className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                        Clear search
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Profile modal */}
        {viewProfile && (
          <ProfileModal patient={viewProfile} onClose={() => setViewProfile(null)} />
        )}

        {/* Permanent delete confirmation */}
        {confirmDeletePatient && (
          <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <p className="text-base font-semibold text-gray-900 mb-2">Delete Account Permanently?</p>
              <p className="text-sm text-gray-500 mb-1">
                You are about to permanently delete <strong>{confirmDeletePatient.name}</strong>'s account and all associated data.
              </p>
              <p className="text-xs text-red-500 mb-3">
                This will erase all uploaded documents, file contents, application history, and notifications.
                This cannot be undone and satisfies the patient's right to erasure under RA 10173.
              </p>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5 leading-relaxed">
                <strong>Note:</strong> Their Firebase Auth account can't be deleted from the browser. The email stays registered until you also remove it from Firebase Console → Authentication. Required for full RA 10173 erasure.
              </p>
              <div className="flex gap-2 justify-end">
                <button className="btn-secondary text-sm" onClick={() => setConfirmDeletePatient(null)}>Cancel</button>
                <button className="btn-danger text-sm" onClick={() => handleDeleteAccount(confirmDeletePatient)}>
                  Delete Permanently
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
