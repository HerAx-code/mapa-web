import { useState, useEffect, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  collection, doc, query, where, onSnapshot,
  updateDoc, deleteDoc, setDoc, serverTimestamp, getDocs,
} from 'firebase/firestore'
import {
  getAuth, createUserWithEmailAndPassword,
  signOut as fbSignOut, sendPasswordResetEmail,
} from 'firebase/auth'
import { initializeApp, getApps } from 'firebase/app'
import { db, auth, firebaseConfig } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { notify } from '../../utils/notifications'
import { getOrCreateConversation } from '../../utils/messages'
import { AgencyModal } from './Agencies'
import {
  MdArrowBack, MdEdit, MdDelete, MdLock, MdLockOpen, MdKey,
  MdAdd, MdClose, MdWarning, MdRefresh, MdMessage,
  MdVisibility, MdVisibilityOff, MdLocationOn, MdPhone,
  MdAttachMoney,
} from 'react-icons/md'
import { PERIOD_ADJECTIVE } from '../../utils/constants'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────

const getSecondaryAuth = () => {
  const existing = getApps().find(a => a.name === 'secondary')
  const app = existing ?? initializeApp(firebaseConfig, 'secondary')
  return getAuth(app)
}

const fmtDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Add Coordinator Modal ─────────────────────────────────────────────────

function AddCoordinatorModal({ agencyId, agencyName, onClose }) {
  const { user: currentUser }     = useAuth()
  const [form, setForm]           = useState({ name: '', email: '', password: '' })
  const [sendReset, setSendReset] = useState(true)
  const [showPw, setShowPw]       = useState(false)
  const [saving, setSaving]       = useState(false)
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  const handleCreate = async () => {
    if (!form.name.trim())        { toast.error('Name is required.'); return }
    if (!form.email.trim())       { toast.error('Email is required.'); return }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters.'); return }
    setSaving(true)
    try {
      const secondaryAuth = getSecondaryAuth()
      const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email.trim(), form.password)
      const uid  = cred.user.uid
      await fbSignOut(secondaryAuth)
      await setDoc(doc(db, 'users', uid), {
        name: form.name.trim(), email: form.email.trim(),
        role: 'agency', agencyId,
        contact: null, rank: null, active: true,
        cooldown: 0, deletion: false, createdAt: serverTimestamp(),
      })
      if (sendReset) await sendPasswordResetEmail(auth, form.email.trim())
      logAudit(currentUser, {
        action: 'account_created', targetType: 'account', targetId: uid,
        targetName: form.name.trim(), details: `Agency coordinator for ${agencyName}`,
      })
      toast.success(`Coordinator account created.${sendReset ? ' Password reset email sent.' : ''}`)
      onClose()
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') toast.error('This email is already registered.')
      else toast.error(err.message || 'Failed to create account.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add Coordinator</h2>
            <p className="text-xs text-gray-400 mt-0.5">{agencyName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Full Name <span className="text-red-400">*</span></label>
            <input className="input" placeholder="Juan Dela Cruz" value={form.name} onChange={set('name')} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email Address <span className="text-red-400">*</span></label>
            <input type="email" className="input" placeholder="coordinator@agency.gov.ph" value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password <span className="text-red-400">*</span></label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} className="input pr-10"
                placeholder="Min. 6 characters" value={form.password} onChange={set('password')} />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPw(p => !p)}>
                {showPw ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 accent-brand-500"
              checked={sendReset} onChange={e => setSendReset(e.target.checked)} />
            Send password reset email to coordinator
          </label>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating...' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Coordinator Modal ────────────────────────────────────────────────

function EditCoordinatorModal({ coordinator, onClose }) {
  const { user: currentUser } = useAuth()
  const [form, setForm]       = useState({ name: coordinator.name ?? '', contact: coordinator.contact ?? '' })
  const [saving, setSaving]   = useState(false)
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required.'); return }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', coordinator.uid), {
        name: form.name.trim(), contact: form.contact.trim() || null,
      })
      logAudit(currentUser, {
        action: 'account_updated', targetType: 'account',
        targetId: coordinator.uid, targetName: form.name.trim(),
        details: 'Coordinator profile updated',
      })
      toast.success('Coordinator updated.')
      onClose()
    } catch { toast.error('Failed to update. Please try again.') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Edit Coordinator</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Full Name <span className="text-red-400">*</span></label>
            <input className="input" value={form.name} onChange={set('name')} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contact Number</label>
            <input className="input" placeholder="09XXXXXXXXX" value={form.contact} onChange={set('contact')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email Address</label>
            <input className="input bg-gray-50 text-gray-400 cursor-not-allowed" value={coordinator.email} disabled />
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed after account creation.</p>
          </div>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function AgencyDetail() {
  const { id }        = useParams()
  const navigate      = useNavigate()
  const { user }      = useAuth()
  const isSuperAdmin  = user?.role === 'super_admin'

  const [agency,        setAgency]        = useState(null)
  const [coordinators,  setCoordinators]  = useState([])
  const [appStats,      setAppStats]      = useState(null)
  const [loading,       setLoading]       = useState(true)

  // Modal states
  const [showEdit,      setShowEdit]      = useState(false)
  const [showAddCoord,  setShowAddCoord]  = useState(false)
  const [editCoord,     setEditCoord]     = useState(null)
  const [confirmCoord,  setConfirmCoord]  = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Slot editing
  const [editSlots, setEditSlots] = useState(false)
  const [newTotal,  setNewTotal]  = useState(0)

  // Budget editing state removed — budget is administered by the agency
  // (agency_admin role) via /agency/allocation. This page is read-only.

  // ── Data loading ──────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'agencies', id), snap => {
      if (!snap.exists()) { navigate('/admin/agencies'); return }
      setAgency({ id: snap.id, ...snap.data() })
      setLoading(false)
    }, () => { setLoading(false); toast.error('Failed to load agency.') })
    return unsub
  }, [id])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('agencyId', '==', id), where('role', '==', 'agency')),
      snap => setCoordinators(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      () => {}
    )
    return unsub
  }, [id])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'applications'), where('agencyId', '==', id)),
      snap => {
        const s = { total: 0, pending: 0, approved: 0, rejected: 0 }
        snap.docs.forEach(d => {
          const status = d.data().status
          s.total++
          if (status === 'approved' || status === 'certificate') s.approved++
          else if (status === 'rejected') s.rejected++
          else s.pending++
        })
        setAppStats(s)
      },
      () => {}
    )
    return unsub
  }, [id])

  // ── Agency actions ────────────────────────────────────────────────────

  const handleSaveAgency = async (data) => {
    try {
      await updateDoc(doc(db, 'agencies', id), { ...data, updatedAt: serverTimestamp() })
      logAudit(user, { action: 'agency_updated', targetType: 'agency', targetId: id, targetName: data.name, details: 'Agency details updated' })
      toast.success('Agency updated.')
      setShowEdit(false)
    } catch { toast.error('Failed to save agency.') }
  }

  const handleToggleEnabled = async () => {
    try {
      const nowEnabled = !agency.enabled
      await updateDoc(doc(db, 'agencies', id), { enabled: nowEnabled })
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('agencyId', '==', id), where('role', '==', 'agency')))
        await Promise.all(snap.docs.map(d => notify(d.id, {
          type:  nowEnabled ? 'agency_enabled' : 'agency_disabled',
          title: nowEnabled ? 'Agency Enabled' : 'Agency Disabled',
          body:  nowEnabled
            ? `${agency.name} has been re-enabled.`
            : `${agency.name} has been disabled.`,
        }).catch(() => {})))
      } catch {}
      logAudit(user, { action: nowEnabled ? 'agency_enabled' : 'agency_disabled', targetType: 'agency', targetId: id, targetName: agency.name, details: `Agency ${nowEnabled ? 're-enabled' : 'disabled'}` })
      toast.success(`${agency.name} ${nowEnabled ? 'enabled' : 'disabled'}.`)
    } catch { toast.error('Failed to update agency status.') }
  }

  const handleSaveSlots = async () => {
    if (newTotal < 1) { toast.error('Must be at least 1.'); return }
    try {
      await updateDoc(doc(db, 'agencies', id), { 'slots.total': newTotal })
      logAudit(user, { action: 'agency_updated', targetType: 'agency', targetId: id, targetName: agency.name, details: `Slot capacity changed to ${newTotal}` })
      setEditSlots(false)
      toast.success('Slot capacity updated.')
    } catch { toast.error('Failed to update slots.') }
  }

  const handleResetSlots = async () => {
    try {
      const total = agency.slots?.total ?? 25
      await updateDoc(doc(db, 'agencies', id), { 'slots.remaining': total })
      toast.success(`Slots reset to ${total}.`)
    } catch { toast.error('Failed to reset slots.') }
  }

  // handleSaveBudget / handleResetBudgetPeriod moved to agency/Allocation.jsx
  // (agency_admin owns budget authority — CRMC is read-only).

  const handleDeleteAgency = async () => {
    try {
      await deleteDoc(doc(db, 'agencies', id))
      logAudit(user, { action: 'agency_deleted', targetType: 'agency', targetId: id, targetName: agency.name, details: 'Agency permanently deleted' })
      toast.success('Agency deleted.')
      navigate('/admin/agencies')
    } catch { toast.error('Failed to delete agency.') }
  }

  const handleMessage = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('agencyId', '==', id), where('role', '==', 'agency')))
      if (snap.empty) { toast.error('No user account linked to this agency.'); return }
      const agencyUser = { uid: snap.docs[0].id, ...snap.docs[0].data() }
      await getOrCreateConversation(user.uid, agencyUser.uid, {
        names:   { [user.uid]: user.name, [agencyUser.uid]: agencyUser.name },
        roles:   { [user.uid]: user.role, [agencyUser.uid]: 'agency' },
        subject: `Admin Message — ${agency.name}`,
      })
      navigate('/admin/messages')
      toast.success('Conversation opened in Messages.')
    } catch { toast.error('Failed to open conversation.') }
  }

  // ── Coordinator actions ───────────────────────────────────────────────

  const handleToggleCoord = async (coord) => {
    try {
      const nowActive = coord.active === false
      await updateDoc(doc(db, 'users', coord.uid), { active: nowActive })
      await notify(coord.uid, {
        type:  nowActive ? 'account_activated' : 'account_deactivated',
        title: nowActive ? 'Account Reactivated' : 'Account Deactivated',
        body:  nowActive ? 'Your coordinator account has been reactivated.' : 'Your coordinator account has been deactivated.',
      })
      logAudit(user, { action: nowActive ? 'account_activated' : 'account_deactivated', targetType: 'account', targetId: coord.uid, targetName: coord.name, details: `Agency coordinator ${nowActive ? 'reactivated' : 'deactivated'}` })
      toast.success(`${coord.name} ${nowActive ? 'reactivated' : 'deactivated'}.`)
    } catch { toast.error('Failed to update account.') }
  }

  const handleResetPassword = async (coord) => {
    try {
      await sendPasswordResetEmail(auth, coord.email)
      await notify(coord.uid, { type: 'password_reset_sent', title: 'Password Reset Email Sent', body: 'A password reset link has been sent to your email.' })
      toast.success(`Password reset email sent to ${coord.email}.`)
    } catch { toast.error('Failed to send reset email.') }
  }

  const handleDeleteCoord = async (coord) => {
    try {
      await deleteDoc(doc(db, 'users', coord.uid))
      logAudit(user, { action: 'account_deleted', targetType: 'account', targetId: coord.uid, targetName: coord.name, details: 'Agency coordinator account deleted' })
      setConfirmCoord(null)
      toast.success(`${coord.name}'s account deleted.`)
    } catch { toast.error('Failed to delete account.') }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Layout breadcrumb="Agency">
        <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-100 rounded w-40" />
              <div className="h-3 bg-gray-100 rounded w-64" />
              <div className="h-3 bg-gray-100 rounded w-48" />
            </div>
          ))}
        </div>
      </Layout>
    )
  }

  if (!agency) return null

  const usedSlots    = (agency.slots?.total ?? 0) - (agency.slots?.remaining ?? 0)
  const slotPct      = agency.slots?.total > 0 ? Math.round((usedSlots / agency.slots.total) * 100) : 0
  const barColor     = slotPct >= 100 ? 'bg-red-400' : slotPct >= 75 ? 'bg-amber-400' : 'bg-brand-500'
  const approvalRate = appStats?.total > 0 ? Math.round((appStats.approved / appStats.total) * 100) : null

  return (
    <Layout breadcrumb={agency.name}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">

        {/* Back */}
        <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-5"
          onClick={() => navigate('/admin/agencies')}>
          <MdArrowBack size={16} /> Back to Agencies
        </button>

        {/* ── Agency header ── */}
        <div className="card p-5 mb-4">
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 ${agency.color ?? 'bg-gray-400'} rounded-2xl text-white font-bold text-lg flex items-center justify-center flex-shrink-0`}>
              {agency.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-lg font-bold text-gray-900">{agency.name}</h1>
                <span className={`badge text-xs ${agency.enabled ? 'badge-green' : 'badge-red'}`}>
                  {agency.enabled ? 'Active' : 'Disabled'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                {agency.location && <span className="flex items-center gap-1"><MdLocationOn size={11} />{agency.location}</span>}
                {agency.phone    && <span className="flex items-center gap-1"><MdPhone size={11} />{agency.phone}</span>}
                {agency.processingTime && <span>· {agency.processingTime}</span>}
              </div>
              {agency.description && (
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">{agency.description}</p>
              )}
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button className="p-1.5 text-gray-400 hover:text-brand-500 hover:bg-brand-50 rounded-lg transition-colors" title="Message"
                onClick={handleMessage}><MdMessage size={16} /></button>
              {isSuperAdmin && (
                <>
                  <button className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Edit"
                    onClick={() => setShowEdit(true)}><MdEdit size={16} /></button>
                  <button
                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${agency.enabled ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}
                    onClick={handleToggleEnabled}>
                    {agency.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete"
                    onClick={() => setConfirmDelete(true)}><MdDelete size={16} /></button>
                </>
              )}
            </div>
          </div>

          {/* Delete confirmation */}
          {confirmDelete && (
            <div className="mt-4 border-t border-red-100 pt-4 flex items-center gap-3">
              <MdWarning size={16} className="text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700 flex-1">
                Delete <strong>{agency.name}</strong> permanently? Patients will no longer see this agency.
              </p>
              <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50"
                onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600"
                onClick={handleDeleteAgency}>Delete</button>
            </div>
          )}
        </div>

        {/* ── Details grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">

          {/* Requirements */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Requirements</p>
            {agency.requirements?.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {agency.requirements.map((r, i) => (
                  <span key={i} className="badge badge-gray text-xs">{r}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No requirements listed.</p>
            )}
          </div>

          {/* Assistance Types */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Assistance Types</p>
            {agency.assistanceTypes?.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {agency.assistanceTypes.map((t, i) => (
                  <span key={i} className="badge badge-blue text-xs">{t}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No assistance types listed.</p>
            )}
          </div>
        </div>

        {/* ── Stats + Slots ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">

          {/* Application stats */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Applications</p>
            {appStats ? (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total',    value: appStats.total,    color: 'text-gray-800'  },
                  { label: 'Pending',  value: appStats.pending,  color: 'text-amber-600' },
                  { label: 'Approved', value: appStats.approved, color: 'text-green-600' },
                  { label: 'Rejected', value: appStats.rejected, color: 'text-red-500'   },
                ].map((s, i) => (
                  <div key={i}>
                    <p className="text-xs text-gray-400">{s.label}</p>
                    <p className={`text-xl font-semibold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No applications yet.</p>
            )}
            {approvalRate !== null && (
              <div className="mt-3 pt-3 border-t border-gray-50">
                <p className="text-xs text-gray-400 mb-1">Approval rate</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-400 rounded-full" style={{ width: `${approvalRate}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-green-600">{approvalRate}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Slot management */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Today's Slots</p>
              {isSuperAdmin && !editSlots && (
                <div className="flex items-center gap-2">
                  <button className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                    onClick={() => { setEditSlots(true); setNewTotal(agency.slots?.total ?? 25) }}>
                    Edit capacity ({agency.slots?.total ?? 0})
                  </button>
                  <span className="text-gray-200">·</span>
                  <button className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-600"
                    onClick={handleResetSlots}>
                    <MdRefresh size={12} /> Reset
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mb-2">
              <p className="text-2xl font-semibold text-gray-800">{agency.slots?.remaining ?? 0}</p>
              <p className="text-xs text-gray-400">of {agency.slots?.total ?? 0} remaining · {usedSlots} used</p>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(slotPct, 100)}%` }} />
            </div>
            {editSlots && isSuperAdmin && (
              <div className="flex items-center gap-2 mt-3">
                <input type="number" min={1} className="input w-20 text-sm text-center py-1 px-2"
                  value={newTotal} onChange={e => setNewTotal(Number(e.target.value))} />
                <button className="btn-primary text-xs py-1 px-3" onClick={handleSaveSlots}>Save</button>
                <button className="btn-secondary text-xs py-1 px-3" onClick={() => setEditSlots(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Budget (read-only oversight view for CRMC) ──
            CRMC has no fund authority — agencies bring their own money and
            the agency_admin sets the allocation. This card is informational
            only: it lets CRMC route patients sensibly and follow up with
            under-funded agencies, without giving any edit capability. */}
        {(() => {
          const budget    = agency.budget ?? { period: 'monthly', allocated: 0, committed: 0, disbursed: 0 }
          const allocated = budget.allocated ?? 0
          const committed = budget.committed ?? 0
          const disbursed = budget.disbursed ?? 0
          const remaining = Math.max(0, allocated - committed)
          const utilization = allocated > 0 ? Math.round((committed / allocated) * 100) : 0
          const bar = utilization >= 90 ? 'bg-red-400' : utilization >= 70 ? 'bg-amber-400' : 'bg-green-400'

          if (allocated === 0) {
            return (
              <div className="card p-4 mb-5 bg-amber-50 border-amber-200">
                <div className="flex items-start gap-3">
                  <MdWarning size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 mb-1">No budget allocated yet</p>
                    <p className="text-xs text-amber-700 leading-relaxed">
                      This agency hasn't set up its budget allocation. Approvals will proceed but won't draw against a budget. Consider following up with the Agency Administrator so they can allocate from their funding source.
                    </p>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div className="card p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MdAttachMoney size={16} className="text-gray-400" />
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {PERIOD_ADJECTIVE[budget.period] ?? 'Current'} Budget
                  </p>
                  <span className="badge badge-gray text-xs">Read-only</span>
                </div>
                {budget.periodStart && (
                  <p className="text-xs text-gray-400">
                    Period started {(budget.periodStart.toDate ? budget.periodStart.toDate() : new Date(budget.periodStart)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div>
                  <p className="text-xs text-gray-400">Allocated</p>
                  <p className="text-lg font-semibold text-gray-800">₱{allocated.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Committed</p>
                  <p className="text-lg font-semibold text-amber-600">₱{committed.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Disbursed</p>
                  <p className="text-lg font-semibold text-purple-600">₱{disbursed.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Remaining</p>
                  <p className="text-lg font-semibold text-green-600">₱{remaining.toLocaleString()}</p>
                </div>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${Math.min(utilization, 100)}%` }} />
              </div>
              <p className="text-xs text-gray-400">
                {utilization}% utilized · the agency administrator manages this allocation from <code>/agency/allocation</code>
              </p>
              {budget.fundSource && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400 mb-0.5">Fund source</p>
                  <p className="text-sm font-medium text-gray-700">{budget.fundSource}</p>
                  {budget.fundSourceNotes && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{budget.fundSourceNotes}</p>
                  )}
                </div>
              )}
            </div>
          )
        })()}


        {/* ── Coordinator Accounts ── */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
            <div>
              <p className="text-sm font-semibold text-gray-800">Coordinator Accounts</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {coordinators.length === 0
                  ? 'No one can log in to process applications for this agency.'
                  : `${coordinators.length} account${coordinators.length !== 1 ? 's' : ''} linked to this agency.`}
              </p>
            </div>
            {isSuperAdmin && (
              <button className="btn-secondary text-xs flex items-center gap-1.5"
                onClick={() => setShowAddCoord(true)}>
                <MdAdd size={14} /> Add Coordinator
              </button>
            )}
          </div>

          {coordinators.length === 0 ? (
            <div className="px-5 py-6 flex flex-col items-center text-center">
              <MdWarning size={28} className="text-amber-300 mb-2" />
              <p className="text-sm font-medium text-gray-600 mb-1">No coordinator assigned</p>
              <p className="text-xs text-gray-400 mb-4">
                Add a coordinator account so someone can log in and process patient applications.
              </p>
              {isSuperAdmin && (
                <button className="btn-primary text-sm flex items-center gap-1.5"
                  onClick={() => setShowAddCoord(true)}>
                  <MdAdd size={15} /> Add Coordinator
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {coordinators.map(coord => {
                const isActive   = coord.active !== false
                const isDeleting = confirmCoord?.uid === coord.uid
                return (
                  <Fragment key={coord.uid}>
                    <div className={`flex items-center gap-3 px-5 py-4 ${!isActive ? 'opacity-50' : ''}`}>
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {coord.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-800">{coord.name}</p>
                          <span className={`badge text-xs ${isActive ? 'badge-green' : 'badge-red'}`}>
                            {isActive ? 'Active' : 'Deactivated'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">{coord.email}</p>
                        {coord.contact && <p className="text-xs text-gray-400">📞 {coord.contact}</p>}
                        <p className="text-xs text-gray-300 mt-0.5">Added {fmtDate(coord.createdAt)}</p>
                      </div>
                      {isSuperAdmin && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button title="Edit" onClick={() => setEditCoord(coord)}
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                            <MdEdit size={15} />
                          </button>
                          <button title="Reset password" onClick={() => handleResetPassword(coord)}
                            className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors">
                            <MdKey size={15} />
                          </button>
                          <button title={isActive ? 'Deactivate' : 'Reactivate'} onClick={() => handleToggleCoord(coord)}
                            className={`p-1.5 rounded-lg transition-colors ${isActive ? 'text-gray-400 hover:text-orange-500 hover:bg-orange-50' : 'text-gray-400 hover:text-green-500 hover:bg-green-50'}`}>
                            {isActive ? <MdLock size={15} /> : <MdLockOpen size={15} />}
                          </button>
                          <button title="Delete" onClick={() => setConfirmCoord(coord)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <MdDelete size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                    {isDeleting && (
                      <div className="bg-red-50 border-t border-red-100 px-5 py-3 flex items-center gap-3">
                        <MdWarning size={16} className="text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-700 flex-1">
                          Delete <strong>{coord.name}</strong>? They will lose portal access immediately.
                        </p>
                        <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50"
                          onClick={() => setConfirmCoord(null)}>Cancel</button>
                        <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600"
                          onClick={() => handleDeleteCoord(coord)}>Delete</button>
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>

      </div>

      {showEdit && (
        <AgencyModal agency={agency} onClose={() => setShowEdit(false)} onSave={handleSaveAgency} />
      )}
      {showAddCoord && (
        <AddCoordinatorModal agencyId={id} agencyName={agency.name} onClose={() => setShowAddCoord(false)} />
      )}
      {editCoord && (
        <EditCoordinatorModal coordinator={editCoord} onClose={() => setEditCoord(null)} />
      )}
    </Layout>
  )
}
