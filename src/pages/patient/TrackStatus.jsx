import { useState, useEffect } from 'react'
import { MdTimeline, MdHistory, MdDownload } from 'react-icons/md'
import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, orderBy, onSnapshot, doc, getDoc, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import GLDocumentPanel from '../../components/GLDocumentPanel'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  approved:    'badge-green',
  rejected:    'badge-red',
  reviewing:   'badge-amber',
  pending:     'badge-blue',
  interview:   'badge-purple',
  certificate: 'badge-green',
}

const STATUS_LABEL = {
  pending:     'Pending Review',
  reviewing:   'Under Review',
  interview:   'Interview Scheduled',
  approved:    'Approved',
  rejected:    'Rejected',
  certificate: 'Guarantee Letter Issued',
}

const FALLBACK_COLOR = 'bg-gray-400'

const formatDate = (ts) => {
  if (!ts) return null
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

// Build stages from application status
const buildStages = (app) => {
  const STAGE_DEFS = [
    { key: 'submitted',   label: 'Application Submitted', note: 'Your application was successfully submitted.' },
    { key: 'docs',        label: 'Document Verification', note: 'Upload your required documents. The administrator will verify them before your application proceeds.' },
    { key: 'reviewing',   label: 'Under Agency Review',   note: 'The agency is reviewing your application.' },
    { key: 'interview',   label: 'Interview Scheduled',   note: 'You have been scheduled for a video interview.' },
    { key: 'approved',    label: 'Application Approved',  note: 'Your application has been approved.' },
    { key: 'certificate', label: 'Guarantee Letter Issued', note: 'Your Guarantee Letter has been issued.' },
  ]

  const doneMap = {
    pending:     ['submitted'],
    reviewing:   ['submitted', 'docs'],
    interview:   ['submitted', 'docs', 'reviewing'],
    approved:    ['submitted', 'docs', 'reviewing', 'interview'],
    certificate: ['submitted', 'docs', 'reviewing', 'interview', 'approved'],
    rejected:    ['submitted'],
  }

  const activeMap = {
    pending:     'docs',
    reviewing:   'reviewing',
    interview:   'interview',
    approved:    'approved',
    certificate: 'certificate',
    rejected:    null,
  }

  const doneKeys  = doneMap[app.status]  ?? ['submitted']
  const activeKey = activeMap[app.status] ?? null

  // Use stages stored on document if available, else build from status
  if (app.stages?.length) {
    return app.stages.map((s, i) => ({
      ...s,
      done:   doneKeys.includes(s.key),
      active: s.key === activeKey,
    }))
  }

  return STAGE_DEFS.map(s => ({
    ...s,
    done:   doneKeys.includes(s.key),
    active: s.key === activeKey,
    date:   s.key === 'submitted' ? formatDate(app.submittedAt) : null,
  }))
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function TrackStatus() {
  const { user }                        = useAuth()
  const navigate                        = useNavigate()
  const { t }                           = useTranslation()
  const [applications, setApplications] = useState([])
  const [agencyMap,    setAgencyMap]    = useState({})
  const [loading,      setLoading]      = useState(true)
  const [tab,          setTab]          = useState('active')
  const [downloading,      setDownloading]      = useState(null)
  const [expandedApps,     setExpandedApps]     = useState(new Set())
  const [confirmWithdrawId, setConfirmWithdrawId] = useState(null)
  const [withdrawing,      setWithdrawing]      = useState(null)

  const handleWithdraw = async (app) => {
    setWithdrawing(app.id)
    try {
      // Mark as rejected with withdrawal reason
      await updateDoc(doc(db, 'applications', app.id), {
        status:          'rejected',
        rejectionReason: 'Withdrawn by applicant.',
        updatedAt:       serverTimestamp(),
        stages: (app.stages ?? []).map(s => ({
          ...s,
          done:   s.key === 'submitted',
          active: false,
        })),
      })

      // Restore slot if submitted today
      const submittedDate = app.submittedAt?.toDate?.()
      const isToday = submittedDate &&
        submittedDate.toDateString() === new Date().toDateString()
      if (isToday) {
        try {
          const agencySnap = await getDoc(doc(db, 'agencies', app.agencyId))
          const current = agencySnap.data()?.slots?.remaining ?? 0
          const total   = agencySnap.data()?.slots?.total    ?? 0
          await updateDoc(doc(db, 'agencies', app.agencyId), {
            'slots.remaining': Math.min(current + 1, total),
          })
        } catch {}
      }

      // Notify agency users
      const agencyUsers = await getDocs(query(
        collection(db, 'users'),
        where('agencyId', '==', app.agencyId),
        where('role', '==', 'agency')
      ))
      await Promise.all(agencyUsers.docs.map(d => notify(d.id, {
        type:  'app_withdrawn',
        title: 'Application withdrawn',
        body:  `${app.patientName} has withdrawn their application (${app.appId}).`,
      }))).catch(() => {})

      setConfirmWithdrawId(null)
      toast.success('Application withdrawn. You may now apply to another program.')
    } catch (err) {
      console.error('Withdraw error:', err)
      toast.error('Failed to withdraw. Please try again.')
    } finally {
      setWithdrawing(null)
    }
  }

  const toggleStages = (id) => setExpandedApps(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'applications'),
      where('patientId', '==', user.uid),
      orderBy('submittedAt', 'desc')
    )
    const unsub = onSnapshot(q,
      snap => {
        setApplications(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      err => {
        console.error('TrackStatus query error:', err)
        setLoading(false)
      }
    )
    return unsub
  }, [user])

  const activeApps = applications.filter(a =>
    !['rejected', 'certificate'].includes(a.status)
  )
  const pastApps = applications.filter(a =>
    ['rejected', 'certificate'].includes(a.status)
  )

  // Fetch agency color/initials for agencies not stored on the application doc
  useEffect(() => {
    const uniqueIds = [...new Set(applications.map(a => a.agencyId).filter(Boolean))]
    if (uniqueIds.length === 0) return
    Promise.all(uniqueIds.map(id => getDoc(doc(db, 'agencies', id))))
      .then(snaps => {
        const map = {}
        snaps.forEach(s => { if (s.exists()) map[s.id] = s.data() })
        setAgencyMap(map)
      })
  }, [applications])

  const agencyColor    = (app) =>
    app.agencyColor ?? agencyMap[app.agencyId]?.color ?? FALLBACK_COLOR

  const agencyInitials = (app) =>
    app.agencyInitials
    ?? agencyMap[app.agencyId]?.initials
    ?? app.agencyName?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    ?? '?'

  const handleDownloadCertificate = async (app) => {
    setDownloading(app.id)
    try {
      const snap = await getDoc(doc(db, 'certificates', app.id))
      if (!snap.exists()) { toast.error('Certificate not yet available. Please check back later.'); return }
      const { base64, fileName } = snap.data()
      const a = document.createElement('a')
      a.href     = base64
      a.download = fileName ?? `guarantee-letter-${app.appId}.jpg`
      a.click()
    } catch {
      toast.error('Failed to download Guarantee Letter.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <Layout breadcrumb={t('patient.track.title')}>
      <div className="p-4 sm:p-6">

        <div className="max-w-2xl mx-auto">

        <div className="mb-5">
          <h1 className="page-title">{t('patient.track.title')}</h1>
          <p className="page-sub">{t('patient.track.subtitle')}</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          <button
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'active' ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            onClick={() => setTab('active')}>
            <MdTimeline size={16} /> {t('patient.track.tabInProgress')}
            {activeApps.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === 'active' ? 'bg-white/20' : 'bg-brand-100 text-brand-600'}`}>
                {activeApps.length}
              </span>
            )}
          </button>
          <button
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'past' ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            onClick={() => setTab('past')}>
            <MdHistory size={16} /> {t('patient.track.tabPast')}
          </button>
        </div>

        {/* Skeleton loading */}
        {loading && (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-50">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-gray-100 rounded w-40" />
                    <div className="h-2.5 bg-gray-100 rounded w-56" />
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full w-24" />
                </div>
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
                      <div className="flex-1 space-y-1.5 pt-1">
                        <div className="h-3 bg-gray-100 rounded w-36" />
                        <div className="h-2.5 bg-gray-100 rounded w-48" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Active Applications ── */}
        {!loading && tab === 'active' && (
          <>
            {activeApps.length === 0 ? (
              <div className="card p-10 text-center">
                <p className="text-3xl mb-3">📋</p>
                <p className="text-sm font-medium text-gray-600 mb-1">No applications in progress</p>
                <p className="text-xs text-gray-400 mb-4">
                  {pastApps.length > 0
                    ? 'Your previous applications are in the History tab.'
                    : 'You have not applied to any program yet.'}
                </p>
                {pastApps.length > 0 ? (
                  <button className="btn-secondary text-sm" onClick={() => setTab('past')}>
                    View History →
                  </button>
                ) : (
                  <button className="btn-primary text-sm" onClick={() => navigate('/patient/screening')}>
                    Find a Program →
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {activeApps.map(app => {
                  const stages = buildStages(app)
                  const color    = agencyColor(app)
                  const initials = agencyInitials(app)

                  const isExpanded    = expandedApps.has(app.id)
                  const visibleStages = isExpanded
                    ? stages
                    : stages.filter(s => s.done || s.active)
                  const hiddenCount   = stages.filter(s => !s.done && !s.active).length

                  return (
                    <div key={app.id} className="card p-5">
                      {/* App header */}
                      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-50">
                        <div className={`w-10 h-10 ${color} rounded-xl text-white text-xs font-bold flex items-center justify-center`}>
                          {initials}
                        </div>
                        <div>
                          <h2 className="text-sm font-semibold text-gray-800">{app.agencyName}</h2>
                          <p className="text-sm text-gray-500">
                            {app.appId} · Submitted {formatDate(app.submittedAt)}
                          </p>
                        </div>
                        <span className={`badge ${STATUS_BADGE[app.status] ?? 'badge-gray'} ml-auto`}>
                          {STATUS_LABEL[app.status] ?? app.status}
                        </span>
                      </div>

                      {/* What to do next — shown FIRST before timeline */}
                      {app.status === 'pending' && (
                        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3">
                          <p className="text-sm text-blue-700 font-medium">
                            📬 Your application has been received. The agency will review it soon — no action needed right now.
                          </p>
                        </div>
                      )}
                      {app.status === 'interview' && (
                        <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center justify-between gap-3">
                          <p className="text-sm text-purple-700 font-medium">
                            📅 You have an interview scheduled. Tap to see the details.
                          </p>
                          <button
                            className="flex-shrink-0 text-xs bg-purple-500 hover:bg-purple-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                            onClick={() => navigate('/patient/interviews')}>
                            View Interview →
                          </button>
                        </div>
                      )}
                      {app.status === 'reviewing' && (
                        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3">
                          <p className="text-sm text-amber-700 font-medium">
                            📋 Make sure all required documents are uploaded.
                          </p>
                          <button
                            className="flex-shrink-0 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                            onClick={() => navigate('/patient/documents')}>
                            Check Docs →
                          </button>
                        </div>
                      )}
                      {(app.status === 'approved' || app.status === 'certificate') && app.approvedAmount != null && (
                        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-3">
                          <p className="text-sm text-green-700 font-medium mb-2">
                            {app.status === 'certificate' && app.certificateUploaded
                              ? '🎉 Your Guarantee Letter is ready to download.'
                              : app.status === 'certificate'
                                ? '📋 Your Guarantee Letter has been issued. The agency is preparing the signed copy — you can download it once they upload it below.'
                                : '✅ Your application is approved. Your Guarantee Letter is being prepared.'}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="bg-white/60 rounded-lg px-3 py-2">
                              <p className="text-xs text-green-600 uppercase tracking-wide">Approved Amount</p>
                              <p className="text-base font-bold text-green-700">₱{Number(app.approvedAmount).toLocaleString()}</p>
                            </div>
                            {app.purposeOfAssistance?.length > 0 && (
                              <div className="bg-white/60 rounded-lg px-3 py-2">
                                <p className="text-xs text-green-600 uppercase tracking-wide">For</p>
                                <p className="text-sm font-medium text-green-700">{app.purposeOfAssistance.join(', ')}</p>
                              </div>
                            )}
                            {app.payableTo && (
                              <div className="bg-white/60 rounded-lg px-3 py-2 sm:col-span-2">
                                <p className="text-xs text-green-600 uppercase tracking-wide">Payable To</p>
                                <p className="text-sm font-medium text-green-700">{app.payableTo}</p>
                                <p className="text-xs text-green-500 mt-1">Present your Guarantee Letter at this provider.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {app.status === 'approved' && app.approvedAmount == null && (
                        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-3">
                          <p className="text-sm text-green-700 font-medium">
                            ✅ Your application is approved. Your Guarantee Letter will be prepared soon.
                          </p>
                        </div>
                      )}

                      {/* GL document panel */}
                      {(app.status === 'approved' || app.status === 'certificate') && app.approvedAmount != null && (
                        <div className="mb-4">
                          <GLDocumentPanel app={app} compact />
                        </div>
                      )}

                      {/* Timeline — completed + current only by default */}
                      <div className="space-y-0">
                        {visibleStages.map((stage, i) => (
                          <div key={stage.key} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold z-10
                                ${stage.done
                                  ? 'bg-brand-500 border-brand-500 text-white'
                                  : stage.active
                                  ? 'border-amber-400 bg-amber-50 text-amber-500'
                                  : 'border-gray-200 bg-white text-gray-300'}`}>
                                {stage.done ? '✓' : i + 1}
                              </div>
                              {i < visibleStages.length - 1 && (
                                <div className={`w-0.5 flex-1 my-1 ${stage.done ? 'bg-brand-300' : 'bg-gray-100'}`}
                                  style={{ minHeight: '28px' }} />
                              )}
                            </div>
                            <div className={`flex-1 pb-5 ${i === visibleStages.length - 1 ? 'pb-0' : ''}`}>
                              <div className="flex items-start justify-between">
                                <p className={`text-sm font-medium ${stage.done ? 'text-gray-800' : stage.active ? 'text-amber-700' : 'text-gray-400'}`}>
                                  {stage.label}
                                  {stage.active && <span className="ml-2 badge badge-amber text-xs">Current</span>}
                                </p>
                                {stage.date && <span className="text-xs text-gray-400">{stage.date}</span>}
                              </div>
                              <p className={`text-sm mt-0.5 ${stage.done || stage.active ? 'text-gray-500' : 'text-gray-300'}`}>
                                {stage.note}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Expand / collapse future stages */}
                      {hiddenCount > 0 && (
                        <button
                          className="mt-3 text-sm text-brand-500 hover:text-brand-600 font-medium border border-brand-200 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors"
                          onClick={() => toggleStages(app.id)}>
                          {isExpanded
                            ? 'Hide future steps ↑'
                            : `See all steps (${hiddenCount} upcoming) ↓`}
                        </button>
                      )}

                      {/* Withdraw — only when pending and agency hasn't started reviewing */}
                      {app.status === 'pending' && (
                        <div className="mt-4 pt-3 border-t border-gray-50">
                          {confirmWithdrawId === app.id ? (
                            <div className="flex items-center gap-3">
                              <p className="text-xs text-gray-500 flex-1">
                                Withdraw this application? This cannot be undone.
                              </p>
                              <button
                                className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                                onClick={() => setConfirmWithdrawId(null)}>
                                Cancel
                              </button>
                              <button
                                className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
                                onClick={() => handleWithdraw(app)}
                                disabled={withdrawing === app.id}>
                                {withdrawing === app.id ? 'Withdrawing...' : 'Yes, Withdraw'}
                              </button>
                            </div>
                          ) : (
                            <button
                              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                              onClick={() => setConfirmWithdrawId(app.id)}>
                              Withdraw Application
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── Past Applications ── */}
        {!loading && tab === 'past' && (
          <div className="space-y-3">
            {pastApps.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-sm text-gray-400">No past applications found.</p>
                <p className="text-xs text-gray-400 mt-1">Completed or rejected applications will appear here.</p>
                <button className="btn-primary mt-3 text-sm" onClick={() => navigate('/patient/screening')}>
                  Find a Program →
                </button>
              </div>
            ) : (
              pastApps.map(app => (
                <div key={app.id} className="card p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className={`w-9 h-9 ${agencyColor(app)} rounded-xl text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                      {agencyInitials(app)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{app.agencyName}</p>
                      <p className="text-sm text-gray-500">{app.appId} · {formatDate(app.submittedAt)}</p>
                    </div>
                    <span className={`badge ${STATUS_BADGE[app.status] ?? 'badge-gray'}`}>
                      {STATUS_LABEL[app.status] ?? app.status}
                    </span>
                    {app.certificateUploaded && (
                      <button
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 transition-colors font-medium disabled:opacity-60"
                        onClick={() => handleDownloadCertificate(app)}
                        disabled={downloading === app.id}>
                        <MdDownload size={14} />
                        {downloading === app.id ? 'Downloading...' : 'Download Guarantee Letter'}
                      </button>
                    )}
                  </div>
                  {app.status === 'rejected' && app.rejectionReason && (
                    <div className="mt-3 bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700">
                      <strong>Reason for rejection:</strong> {app.rejectionReason}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        </div> {/* end max-w-2xl mx-auto */}
      </div>
    </Layout>
  )
}
