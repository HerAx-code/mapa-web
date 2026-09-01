import Layout from '../../components/Layout'
import { useState, useEffect, useCallback } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy, Timestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import {
  MdAdd, MdEdit, MdDelete, MdClose, MdBuildCircle,
  MdWarning, MdInfo, MdCampaign, MdSchedule, MdCheckCircle,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import AnnouncementBanner from '../../components/AnnouncementBanner'
import { tsToDate } from '../../utils/dates'

// ── Config ────────────────────────────────────────────────────────────────
// TYPE_CONFIG lives in utils/announcements now (broke a circular import
// once Layout's live banner needed it via AnnouncementBanner). Re-exported
// here so existing consumers (agency/Announcements) keep working without
// a path update.
import { TYPE_CONFIG } from '../../utils/announcements'
export { TYPE_CONFIG }

// ── Helpers ───────────────────────────────────────────────────────────────

export const fmtDt = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—'
}

export const getCountdown = (ts) => {
  const d = tsToDate(ts)
  if (!d) return null
  const diff = d.getTime() - Date.now()
  if (diff <= 0) return null
  const hrs  = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (hrs > 48) return `${Math.floor(hrs / 24)} days`
  if (hrs > 0)  return `${hrs}h ${mins}m`
  return `${mins}m`
}

export const getStatus = (ann) => {
  const now   = Date.now()
  const start = ann.startAt?.toDate?.()?.getTime() ?? 0
  const end   = ann.endAt?.toDate?.()?.getTime()   ?? 0
  if (!ann.active)            return 'inactive'
  if (now >= start && now <= end) return 'active'
  if (now < start)            return 'upcoming'
  return 'expired'
}

const tsToInputs = (ts) => {
  const d = tsToDate(ts)
  if (!d) return { date: '', time: '' }
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 5),
  }
}

const inputsToTs = (date, time) => {
  if (!date || !time) return null
  return Timestamp.fromDate(new Date(`${date}T${time}`))
}

// ── Banner Preview (shared between form and management page) ───────────────

// Renders the announcement banner exactly as it will appear in the
// app's chrome (via the shared AnnouncementBanner component). The
// date range below is a form-only caption -- the live banner shows
// just the countdown, not the full window.
function BannerPreview({ type, title, message, startAt, endAt }) {
  const countdown = endAt ? getCountdown(endAt) : null
  return (
    <div>
      <AnnouncementBanner
        type={type}
        title={title}
        message={message}
        countdownLabel={countdown ? `Ends in ${countdown}` : null}
        placeholder
      />
      {(startAt || endAt) && (
        <p className="text-xs text-gray-500 mt-1.5">
          {fmtDt(startAt)} – {fmtDt(endAt)}
        </p>
      )}
    </div>
  )
}

// ── Create / Edit Modal ───────────────────────────────────────────────────

export function AnnouncementForm({ announcement, onClose, onSave, audienceNote, promo = false, embedded = false }) {
  const isEdit = !!announcement
  const noun   = promo ? 'Promotion' : 'Announcement'

  // Promotions are positive notices, so they skip the maintenance/warning
  // alert types and always render in the neutral "info" style.
  const [type,      setType]      = useState(announcement?.type    ?? (promo ? 'info' : 'maintenance'))
  const [title,     setTitle]     = useState(announcement?.title   ?? '')
  const [message,   setMessage]   = useState(announcement?.message ?? '')
  const [saving,    setSaving]    = useState(false)
  // Escape closes the dialog in modal mode only — in embedded mode it's an
  // inline panel, not an overlay, so Escape shouldn't wipe the form.
  useEscapeKey(onClose, !embedded && !saving)

  // R38: surface + targetRoles. Promos are locked at 'feed' / ['patient']
  // (agency promotions never go in the top strip and only target patients).
  // For admin announcements, defaults respect the migration rule -- when
  // editing an existing pre-R38 doc that has no surface field, initialize
  // to 'banner' so the operator sees the surface that actually matches
  // the current behavior, not a silent switch to "Both".
  const [surface, setSurface] = useState(
    promo ? 'feed' : (announcement?.surface ?? (isEdit ? 'banner' : 'both'))
  )
  const [targetRoles, setTargetRoles] = useState(
    promo
      ? ['patient']
      : (Array.isArray(announcement?.targetRoles) && announcement.targetRoles.length > 0
          ? announcement.targetRoles
          : ['patient', 'agency', 'agency_admin'])
  )
  const toggleRole = (role) => setTargetRoles(prev =>
    prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
  )

  const startInputs = tsToInputs(announcement?.startAt)
  const endInputs   = tsToInputs(announcement?.endAt)
  const [startDate, setStartDate] = useState(startInputs.date)
  const [startTime, setStartTime] = useState(startInputs.time || '08:00')
  const [endDate,   setEndDate]   = useState(endInputs.date)
  const [endTime,   setEndTime]   = useState(endInputs.time || '10:00')

  const previewStartAt = startDate && startTime ? inputsToTs(startDate, startTime) : null
  const previewEndAt   = endDate   && endTime   ? inputsToTs(endDate,   endTime)   : null

  const handleSave = async () => {
    if (!title.trim())   { toast.error('Title is required.'); return }
    if (!message.trim()) { toast.error('Message is required.'); return }
    if (!startDate || !startTime) { toast.error('Start date and time are required.'); return }
    if (!endDate || !endTime)     { toast.error('End date and time are required.'); return }
    if (!promo && targetRoles.length === 0) {
      toast.error('Pick at least one audience.')
      return
    }
    const startTs = inputsToTs(startDate, startTime)
    const endTs   = inputsToTs(endDate,   endTime)
    if (endTs.toDate() <= startTs.toDate()) {
      toast.error('End time must be after start time.')
      return
    }
    setSaving(true)
    try {
      await onSave({
        type, title: title.trim(), message: message.trim(),
        startAt: startTs, endAt: endTs,
        surface, targetRoles,
      })
    } finally {
      setSaving(false)
    }
  }

  const shell = (
      <div className={embedded
        ? 'card flex flex-col overflow-hidden'
        : 'bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden'}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? `Edit ${noun}` : `New ${noun}`}
          </h2>
          {/* In embedded mode the X clears any in-progress edit back to a fresh
              "new" form; in modal mode it closes the dialog. */}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title={isEdit ? 'Cancel edit' : 'Close'}><MdClose size={20} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Type selector — alert types are for CRMC system notices only;
              promotions always use the neutral info style. */}
          {!promo && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
              <div className="flex gap-2">
                {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
                  const Icon = cfg.icon
                  const active = type === key
                  return (
                    <button key={key} type="button"
                      onClick={() => setType(key)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        active ? cfg.pillActive : cfg.pillInact
                      }`}>
                      <Icon size={15} /> {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Title <span className="text-red-400">*</span></label>
              <span className="text-xs text-gray-400">{title.length}/60</span>
            </div>
            <input className="input" placeholder={promo ? 'e.g. Free chemotherapy medicines available' : 'e.g. Scheduled System Maintenance'}
              value={title} onChange={e => setTitle(e.target.value.slice(0, 60))} />
          </div>

          {/* Message */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Message <span className="text-red-400">*</span></label>
              <span className="text-xs text-gray-400">{message.length}/300</span>
            </div>
            <textarea className="input resize-none" rows={3}
              placeholder={promo ? 'Describe the program or offer patients should know about…' : 'Describe what users should expect during this period…'}
              value={message} onChange={e => setMessage(e.target.value.slice(0, 300))} />
          </div>

          {/* Live preview — placed high so operators see the banner update
              as they type the title and message, rather than below the fold. */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Preview</p>
            <BannerPreview
              type={type} title={title} message={message}
              startAt={previewStartAt} endAt={previewEndAt}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              This is how the banner will appear to {audienceNote ?? 'all users'}.
            </p>
          </div>

          {/* R38: surface + audience. Hidden for promotions -- agency
              promos are always feed-only / patients-only. */}
          {!promo && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Where it appears
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'banner', label: 'Top banner only', hint: 'Thin strip on every page' },
                    { value: 'feed',   label: 'Dashboard card',   hint: 'In "What’s new"' },
                    { value: 'both',   label: 'Both',             hint: 'Banner + card' },
                  ].map(opt => {
                    const active = surface === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSurface(opt.value)}
                        className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                          active
                            ? 'bg-brand-50 border-brand-300 text-brand-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <p className={`font-medium ${active ? 'text-brand-700' : 'text-gray-700'}`}>{opt.label}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{opt.hint}</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Audience <span className="text-red-400">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'patient',       label: 'Patients'        },
                    { value: 'agency',        label: 'Coordinators'    },
                    { value: 'agency_admin',  label: 'Agency admins'   },
                    { value: 'admin',         label: 'CRMC staff'      },
                  ].map(opt => {
                    const active = targetRoles.includes(opt.value)
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleRole(opt.value)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                          active
                            ? 'bg-brand-500 text-white border-brand-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Audience is a UX filter on who sees this. It does not restrict who can read the document.
                </p>
              </div>
            </>
          )}

          {/* Date/time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start date <span className="text-red-400">*</span></label>
              <input type="date" className="input text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start time <span className="text-red-400">*</span></label>
              <input type="time" className="input text-sm" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End date <span className="text-red-400">*</span></label>
              <input type="date" className="input text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End time <span className="text-red-400">*</span></label>
              <input type="time" className="input text-sm" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="px-5 pb-4 pt-3 flex gap-2 justify-end border-t border-gray-100 flex-shrink-0">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : `Create ${noun}`}
          </button>
        </div>
      </div>
  )

  if (embedded) return shell
  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      {shell}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Announcements() {
  const { user }                        = useAuth()
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading]           = useState(true)
  const [editing, setEditing]           = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting]         = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'announcements'), orderBy('createdAt', 'desc')))
      setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) { console.error(err); toast.error('Failed to load announcements. Please refresh the page.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Actions ────────────────────────────────────────────────────────────

  const handleSave = async (data) => {
    try {
      const detailSuffix = `Type: ${data.type} · Surface: ${data.surface ?? 'banner'} · Audience: ${(data.targetRoles ?? []).join('+') || 'none'}`
      if (editing) {
        await updateDoc(doc(db, 'announcements', editing.id), { ...data, updatedAt: serverTimestamp() })
        logAudit(user, { action: 'announcement_updated', targetType: 'announcement', targetName: data.title, details: detailSuffix })
        toast.success('Announcement updated.')
      } else {
        const ref = await addDoc(collection(db, 'announcements'), {
          ...data,
          active:       true,
          reminderSent: false,
          createdAt:    serverTimestamp(),
          createdBy:    user.name ?? 'Admin',
          createdById:  user.uid,
        })

        logAudit(user, { action: 'announcement_created', targetType: 'announcement', targetId: ref.id, targetName: data.title, details: `${detailSuffix} · ${fmtDt(data.startAt)} – ${fmtDt(data.endAt)}` })

        // Notify all users — fire-and-forget
        const cfg = TYPE_CONFIG[data.type] ?? TYPE_CONFIG.info
        const window = `${fmtDt(data.startAt)} – ${fmtDt(data.endAt)}`
        getDocs(collection(db, 'users')).then(snap =>
          Promise.all(snap.docs.map(d =>
            notify(d.id, {
              type:  'system_announcement',
              title: data.title,
              body:  `${data.message} · ${window}`,
            }).catch(() => {})
          ))
        ).catch(() => {})

        toast.success('Announcement created and all users notified.')
      }
      setEditing(null)
      load()
    } catch {
      toast.error('Failed to save announcement.')
    }
  }

  const handleToggleActive = async (ann) => {
    try {
      await updateDoc(doc(db, 'announcements', ann.id), { active: !ann.active })
      logAudit(user, { action: 'announcement_updated', targetType: 'announcement', targetName: ann.title, details: ann.active ? 'Deactivated' : 'Activated' })
      toast.success(ann.active ? 'Announcement deactivated.' : 'Announcement activated.')
      load()
    } catch (err) { console.error(err); toast.error('Failed to update announcement. Please try again.') }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'announcements', confirmDelete.id))
      logAudit(user, { action: 'announcement_deleted', targetType: 'announcement', targetName: confirmDelete.title, details: 'Announcement permanently deleted' })
      toast.success('Announcement deleted.')
      setConfirmDelete(null)
      load()
    } catch (err) { console.error(err); toast.error('Failed to delete.') }
    finally { setDeleting(false) }
  }

  // ── Group by status ────────────────────────────────────────────────────

  const active   = announcements.filter(a => getStatus(a) === 'active')
  const upcoming = announcements.filter(a => getStatus(a) === 'upcoming')
  const past     = announcements.filter(a => ['expired', 'inactive'].includes(getStatus(a)))

  const totalActive = active.length
  const totalUpcoming = upcoming.length

  // ── Card renderer ──────────────────────────────────────────────────────

  const renderCard = (ann) => {
    const status  = getStatus(ann)
    const cfg     = TYPE_CONFIG[ann.type] ?? TYPE_CONFIG.info
    const Icon    = cfg.icon
    const isLive  = status === 'active'
    const isUpcoming = status === 'upcoming'
    const countdown  = isLive ? getCountdown(ann.endAt) : isUpcoming ? getCountdown(ann.startAt) : null
    const isDeleting = confirmDelete?.id === ann.id

    return (
      <div key={ann.id} className={`card overflow-hidden ${!ann.active || status === 'expired' ? 'opacity-60' : ''}`}>
        <div className={`flex items-start gap-4 p-4 ${isLive ? cfg.bg : ''}`}>
          {/* Type icon */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg} border ${cfg.border}`}>
            <Icon size={20} className={cfg.iconColor} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="text-sm font-semibold text-gray-900">{ann.title}</p>
              {/* Status badge */}
              {isLive && (
                <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  LIVE
                </span>
              )}
              {isUpcoming && (
                <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                  UPCOMING
                </span>
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
            <p className="text-xs text-gray-400 mt-1">Created by {ann.createdBy}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button title="Edit"
              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
              onClick={() => setEditing(ann)}>
              <MdEdit size={15} />
            </button>
            {(status === 'active' || status === 'upcoming') && ann.active && (
              <button title="Deactivate"
                className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                onClick={() => handleToggleActive(ann)}>
                <MdClose size={15} />
              </button>
            )}
            {!ann.active && (
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

        {/* Delete confirmation */}
        {isDeleting && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-3 flex items-center gap-3">
            <MdWarning size={16} className="text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700 flex-1">
              Delete <strong>"{ann.title}"</strong>? The banner will disappear for all users immediately.
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

  // ── Section renderer ───────────────────────────────────────────────────

  const renderSection = (label, items, emptyText) => (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
        {label}
        {items.length > 0 && (
          <span className="text-gray-300 font-normal normal-case tracking-normal">({items.length})</span>
        )}
      </p>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-6 flex items-center gap-3 text-gray-400">
          <MdCampaign size={18} className="flex-shrink-0" />
          <p className="text-sm">{emptyText}</p>
        </div>
      ) : (
        <div className="space-y-3">{items.map(renderCard)}</div>
      )}
    </div>
  )

  return (
    <Layout breadcrumb="Announcements">
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="eyebrow">Broadcasts</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Announcements</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage system-wide banners for scheduled maintenance and important notices.
            </p>
          </div>
          <button className="btn-secondary flex items-center gap-1.5 text-sm"
            onClick={() => setEditing(null)}
            title="Clear the compose form to start a new announcement">
            <MdAdd size={16} /> New / clear
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Active Now',  value: totalActive,              color: totalActive > 0 ? 'text-green-600' : 'text-gray-400' },
            { label: 'Upcoming',    value: totalUpcoming,            color: totalUpcoming > 0 ? 'text-blue-600' : 'text-gray-400' },
            { label: 'Total',       value: announcements.length,     color: 'text-gray-800' },
          ].map((m, i) => (
            <div key={i} className="stat-tile">
              <p className="stat-label mt-0">{m.label}</p>
              <p className={`stat-num mt-1 ${m.color}`}>{loading ? '—' : m.value}</p>
            </div>
          ))}
        </div>

        {/* Info banner */}
        <div className="bg-brand-50 border border-brand-100 rounded-xl p-3 mb-6 flex items-start gap-2">
          <MdCampaign size={16} className="text-brand-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-brand-700">
            When you create an announcement, all registered users receive an immediate notification in their bell.
            A second reminder is automatically sent when the maintenance window is within 24 hours.
            The banner appears to all logged-in users until it expires or is deactivated.
          </p>
        </div>

        {/* Split layout: the compose form lives in a sticky left panel and the
            feed of announcements fills the right — instead of a modal floating
            over a narrow centred list. Editing a card loads it into the same
            left form (keyed so it re-initialises). */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-5 items-start">
          <aside className="lg:sticky lg:top-[68px]">
            <AnnouncementForm
              embedded
              key={editing?.id ?? 'new'}
              announcement={editing}
              onSave={handleSave}
              onClose={() => setEditing(null)}
            />
          </aside>

          <div className="min-w-0">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-48" />
                    <div className="h-2.5 bg-gray-100 rounded w-64" />
                    <div className="h-2.5 bg-gray-100 rounded w-40" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {renderSection('Active Now', active, 'No announcements are currently live.')}
            {renderSection('Upcoming', upcoming, 'No scheduled announcements.')}
            {renderSection('Past / Inactive', past, 'No past announcements.')}
          </div>
        )}
          </div>{/* /feed column */}
        </div>{/* /split grid */}
      </div>
    </Layout>
  )
}
