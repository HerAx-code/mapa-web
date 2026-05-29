import Layout from '../../components/Layout'
import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, getDoc, serverTimestamp, query, where,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import {
  TYPE_CONFIG, AnnouncementForm, getStatus, getCountdown, fmtDt,
} from '../admin/Announcements'
import {
  MdAdd, MdEdit, MdDelete, MdClose, MdCheckCircle,
  MdWarning, MdSchedule, MdCampaign, MdLockOutline,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// Agency-side announcements. Authored by the Agency Administrator and shown
// to ALL patients via the Layout banner (source: 'agency'). Distinct from
// CRMC system announcements — agencies only see/manage their own.
export default function AgencyAnnouncements() {
  const { user }          = useAuth()
  const isAgencyAdmin     = user?.role === 'agency_admin'

  const [agencyName,    setAgencyName]    = useState('')
  const [announcements, setAnnouncements] = useState([])
  const [loading,       setLoading]       = useState(true)
  const [showForm,      setShowForm]      = useState(false)
  const [editing,       setEditing]       = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting,      setDeleting]      = useState(false)

  useEffect(() => {
    if (!user?.agencyId) return
    getDoc(doc(db, 'agencies', user.agencyId))
      .then(s => { if (s.exists()) setAgencyName(s.data().name ?? '') })
      .catch(() => {})
  }, [user?.agencyId])

  // Query own-agency announcements only. No orderBy (avoids a composite index
  // requirement on agencyId + createdAt) — sort client-side instead.
  const load = useCallback(async () => {
    if (!user?.agencyId) return
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'announcements'), where('agencyId', '==', user.agencyId)))
      setAnnouncements(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
      )
    } catch { toast.error('Failed to load announcements. Please refresh.') }
    finally { setLoading(false) }
  }, [user?.agencyId])

  useEffect(() => { load() }, [load])

  const handleSave = async (data) => {
    try {
      if (editing) {
        await updateDoc(doc(db, 'announcements', editing.id), { ...data, updatedAt: serverTimestamp() })
        logAudit(user, { action: 'announcement_updated', targetType: 'announcement', targetId: editing.id, targetName: data.title, details: `Agency announcement · ${data.type}` })
        toast.success('Announcement updated.')
      } else {
        const ref = await addDoc(collection(db, 'announcements'), {
          ...data,
          source:       'agency',
          agencyId:     user.agencyId,
          agencyName:   agencyName || 'Your agency',
          audience:     'patients',
          active:       true,
          // Promotions are pull-only: they surface on the Find Programs
          // catalog, not the alert banner, and don't push a notification to
          // every patient. reminderSent stays true so the banner reminder
          // path never picks them up.
          reminderSent: true,
          createdAt:    serverTimestamp(),
          createdBy:    user.name ?? 'Agency',
          createdById:  user.uid,
        })
        logAudit(user, { action: 'announcement_created', targetType: 'announcement', targetId: ref.id, targetName: data.title, details: `Agency promotion to patients · ${data.type}` })

        toast.success('Promotion posted. Patients will see it on Find Programs.')
      }
      setShowForm(false); setEditing(null); load()
    } catch { toast.error('Failed to save announcement.') }
  }

  const handleToggleActive = async (ann) => {
    try {
      await updateDoc(doc(db, 'announcements', ann.id), { active: !ann.active })
      logAudit(user, { action: 'announcement_updated', targetType: 'announcement', targetId: ann.id, targetName: ann.title, details: ann.active ? 'Deactivated' : 'Activated' })
      toast.success(ann.active ? 'Announcement deactivated.' : 'Announcement activated.')
      load()
    } catch { toast.error('Failed to update. Please try again.') }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'announcements', confirmDelete.id))
      logAudit(user, { action: 'announcement_deleted', targetType: 'announcement', targetId: confirmDelete.id, targetName: confirmDelete.title, details: 'Agency announcement deleted' })
      toast.success('Announcement deleted.')
      setConfirmDelete(null); load()
    } catch { toast.error('Failed to delete.') }
    finally { setDeleting(false) }
  }

  if (!isAgencyAdmin) {
    return (
      <Layout breadcrumb="Announcements">
        <div className="p-4 sm:p-6 max-w-2xl">
          <div className="card p-6 bg-amber-50 border-amber-200 flex items-start gap-3">
            <MdLockOutline size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800 mb-1">Restricted to Agency Administrators</p>
              <p className="text-xs text-amber-700">Only the Agency Administrator can post promotions to patients.</p>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  const renderCard = (ann) => {
    const status     = getStatus(ann)
    const cfg        = TYPE_CONFIG[ann.type] ?? TYPE_CONFIG.info
    const Icon       = cfg.icon
    const isLive     = status === 'active'
    const isUpcoming = status === 'upcoming'
    const countdown  = isLive ? getCountdown(ann.endAt) : isUpcoming ? getCountdown(ann.startAt) : null
    const isDeleting = confirmDelete?.id === ann.id

    return (
      <div key={ann.id} className={`card overflow-hidden ${!ann.active || status === 'expired' ? 'opacity-60' : ''}`}>
        <div className={`flex items-start gap-4 p-4 ${isLive ? cfg.bg : ''}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg} border ${cfg.border}`}>
            <Icon size={20} className={cfg.iconColor} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="text-sm font-semibold text-gray-900">{ann.title}</p>
              {isLive && (
                <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /> LIVE
                </span>
              )}
              {isUpcoming && (
                <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">UPCOMING</span>
              )}
              {status === 'expired' && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Expired</span>
              )}
              {status === 'inactive' && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-1">{ann.message}</p>
            <p className="text-xs text-gray-400">
              <MdSchedule size={11} className="inline mr-0.5" />
              {fmtDt(ann.startAt)} – {fmtDt(ann.endAt)}
            </p>
            {countdown && (
              <p className={`text-xs font-medium mt-1 ${cfg.iconColor}`}>
                {isLive ? `Ends in ${countdown}` : `Starts in ${countdown}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button title="Edit"
              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
              onClick={() => { setEditing(ann); setShowForm(true) }}>
              <MdEdit size={15} />
            </button>
            {ann.active ? (
              <button title="Deactivate"
                className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                onClick={() => handleToggleActive(ann)}>
                <MdClose size={15} />
              </button>
            ) : (
              <button title="Activate"
                className="p-1.5 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded-lg transition-colors"
                onClick={() => handleToggleActive(ann)}>
                <MdCheckCircle size={15} />
              </button>
            )}
            <button title="Delete"
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              onClick={() => setConfirmDelete(ann)}>
              <MdDelete size={15} />
            </button>
          </div>
        </div>
        {isDeleting && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-3 flex items-center gap-3">
            <MdWarning size={16} className="text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700 flex-1">
              Delete <strong>"{ann.title}"</strong>? Patients will no longer see this on Find Programs.
            </p>
            <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50"
              onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600"
              onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Layout breadcrumb="Announcements">
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">

        <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h1 className="page-title">Promote Your Programs</h1>
            <p className="page-sub">Post promotions patients see on the Find Programs page (e.g. new assistance offerings, open slots, requirements updates).</p>
          </div>
          <button className="btn-primary flex items-center gap-1.5 text-sm"
            onClick={() => { setEditing(null); setShowForm(true) }}>
            <MdAdd size={16} /> New Promotion
          </button>
        </div>

        <div className="bg-brand-50 border border-brand-100 rounded-xl p-3 mb-6 flex items-start gap-2">
          <MdCampaign size={16} className="text-brand-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-brand-700">
            Your promotions appear on the patient <strong>Find Programs</strong> page under your agency while within the
            scheduled window, then auto-hide after the end time. They're informational — patients still submit one request
            to CRMC, which routes it to the right agencies.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-48" />
                    <div className="h-2.5 bg-gray-100 rounded w-64" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <div className="card p-10 text-center">
            <MdCampaign size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-600 mb-1">No promotions yet</p>
            <p className="text-xs text-gray-400">Post one to show your programs on the patient Find Programs page.</p>
          </div>
        ) : (
          <div className="space-y-3">{announcements.map(renderCard)}</div>
        )}
      </div>

      {showForm && (
        <AnnouncementForm
          announcement={editing}
          promo
          audienceNote="patients on the Find Programs page"
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </Layout>
  )
}