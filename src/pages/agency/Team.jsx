import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import ConfirmModal from '../../components/ConfirmModal'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import {
  collection, query, where, onSnapshot, doc, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import {
  getAuth, createUserWithEmailAndPassword,
  signOut as fbSignOut, sendPasswordResetEmail, deleteUser,
} from 'firebase/auth'
import { initializeApp, getApps } from 'firebase/app'
import { db, auth, firebaseConfig } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { notify } from '../../utils/notifications'
import { generateTempPassword } from '../../utils/password'
import {
  MdAdd, MdLock, MdLockOpen, MdKey, MdClose, MdLockOutline,
  MdStar, MdStarOutline, MdVisibility, MdVisibilityOff, MdEdit,
  MdContentCopy, MdRefresh,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import { tsToDate } from '../../utils/dates'

const getSecondaryAuth = () => {
  const existing = getApps().find(a => a.name === 'secondary')
  const app = existing ?? initializeApp(firebaseConfig, 'secondary')
  return getAuth(app)
}

const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

// ── Add Coordinator Modal ──────────────────────────────────────────────────

function AddCoordModal({ agencyId, agencyName, onClose }) {
  const { user } = useAuth()
  const [form, setForm]     = useState(() => ({ name: '', email: '', password: generateTempPassword(), contact: '' }))
  const [sendReset, setSendReset] = useState(true)
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)

  useEscapeKey(onClose, !saving)

  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))
  const regeneratePw = () => setForm(p => ({ ...p, password: generateTempPassword() }))
  const copyPw = async () => {
    try { await navigator.clipboard.writeText(form.password); toast.success('Temporary password copied.') }
    catch { toast.error('Could not copy. Show it and copy manually.') }
  }

  const handleSave = async () => {
    if (!form.name.trim())        { toast.error('Name is required.'); return }
    if (!form.email.trim())       { toast.error('Email is required.'); return }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters.'); return }
    setSaving(true)
    try {
      const secondaryAuth = getSecondaryAuth()
      const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email.trim(), form.password)
      const uid  = cred.user.uid
      // Create the Firestore user doc BEFORE signing out -- if setDoc
      // fails (rules denial, network blip), we still have the Auth
      // session and can deleteUser to roll back. Without this, a failed
      // create leaves the email permanently registered with no Firestore
      // doc; the agency admin can't retry from this page (the next
      // attempt hits auth/email-already-in-use), and the orphaned Auth
      // user can technically sign in but is invisible to the app.
      try {
        await setDoc(doc(db, 'users', uid), {
          name:      form.name.trim(),
          email:     form.email.trim(),
          role:      'agency',
          agencyId,
          contact:   form.contact.trim() || null,
          rank:      null,
          active:    true,
          cooldown:  0,
          deletion:  false,
          createdAt: serverTimestamp(),
        })
      } catch (setDocErr) {
        try { await deleteUser(cred.user) } catch (cleanupErr) {
          console.error('[Team] orphaned Auth user cleanup failed for', form.email.trim(), cleanupErr)
        }
        await fbSignOut(secondaryAuth).catch(() => {})
        throw setDocErr
      }
      await fbSignOut(secondaryAuth)

      if (sendReset) await sendPasswordResetEmail(auth, form.email.trim())

      logAudit(user, {
        action:     'account_created',
        targetType: 'account',
        targetId:   uid,
        targetName: form.name.trim(),
        details:    `Coordinator added to ${agencyName} by agency admin`,
      })
      toast.success(`${form.name.trim()} added.${sendReset ? ' Reset email sent.' : ''}`)
      onClose()
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') toast.error('This email is already registered.')
      else toast.error(err.message || 'Failed to add coordinator.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Add Coordinator</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            Adding to <strong>{agencyName}</strong>. The new coordinator can approve cases but cannot edit the budget.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Full Name <span className="text-red-400">*</span></label>
            <input className="input" placeholder="Juan Dela Cruz" value={form.name} onChange={set('name')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email Address <span className="text-red-400">*</span></label>
            <input type="email" className="input" placeholder="coordinator@agency.gov.ph" value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contact Number</label>
            <input className="input" placeholder="09XXXXXXXXX" value={form.contact} onChange={set('contact')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password <span className="text-gray-400 font-normal">(auto-generated)</span></label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} readOnly
                className="input pr-24 font-mono tracking-wide" value={form.password} />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button type="button" title="Show / hide"
                  className="p-1.5 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPw(p => !p)}>
                  {showPw ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
                </button>
                <button type="button" title="Copy"
                  className="p-1.5 text-gray-400 hover:text-brand-500"
                  onClick={copyPw}>
                  <MdContentCopy size={15} />
                </button>
                <button type="button" title="Generate a new one"
                  className="p-1.5 text-gray-400 hover:text-brand-500"
                  onClick={regeneratePw}>
                  <MdRefresh size={16} />
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">Auto-generated. The reset email below lets them set their own.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 accent-brand-500"
              checked={sendReset} onChange={e => setSendReset(e.target.checked)} />
            Send password reset email so they can set their own password
          </label>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Adding…' : 'Add Coordinator'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Profile Modal ────────────────────────────────────────────────────

function EditCoordModal({ coord, currentUser, onClose }) {
  const [form, setForm]     = useState({ name: coord.name ?? '', contact: coord.contact ?? '' })
  const [saving, setSaving] = useState(false)

  useEscapeKey(onClose, !saving)

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name cannot be empty.'); return }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', coord.uid), {
        name:    form.name.trim(),
        contact: form.contact.trim() || null,
      })
      logAudit(currentUser, {
        action:     'account_updated',
        targetType: 'account',
        targetId:   coord.uid,
        targetName: form.name.trim(),
        details:    'Profile updated by agency admin',
      })
      toast.success('Coordinator updated.')
      onClose()
    } catch (err) {
      console.error('[EditCoordModal] update failed:', err)
      toast.error('Failed to update.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Edit Coordinator</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
            <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email Address</label>
            <input className="input bg-gray-50" value={coord.email} disabled />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contact Number</label>
            <input className="input" placeholder="09XXXXXXXXX" value={form.contact}
              onChange={e => setForm(p => ({ ...p, contact: e.target.value }))} />
          </div>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function AgencyTeam() {
  const { user }    = useAuth()
  const navigate    = useNavigate()
  const [agency,    setAgency]    = useState(null)
  const [team,      setTeam]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showAdd,   setShowAdd]   = useState(false)
  const [editing,   setEditing]   = useState(null)
  // Coordinator awaiting promote/demote confirmation in the in-app modal.
  const [promotionTarget, setPromotionTarget] = useState(null)
  const [promoting,       setPromoting]       = useState(false)

  const isAgencyAdmin = user?.role === 'agency_admin'

  useEffect(() => {
    if (!user?.agencyId) return
    const unsub = onSnapshot(doc(db, 'agencies', user.agencyId),
      snap => snap.exists() && setAgency({ id: snap.id, ...snap.data() }),
      (err) => console.error('[Team] agency snapshot error:', err),
    )
    return unsub
  }, [user?.agencyId])

  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(
      collection(db, 'users'),
      where('agencyId', '==', user.agencyId),
      where('role', 'in', ['agency_admin', 'agency']),
    )
    const unsub = onSnapshot(q,
      snap => {
        setTeam(snap.docs.map(d => ({ uid: d.id, ...d.data() })))
        setLoading(false)
      },
      (err) => {
        setLoading(false)
        console.error('[Team] team snapshot error:', err)
      },
    )
    return unsub
  }, [user?.agencyId])

  if (!isAgencyAdmin) {
    return (
      <Layout breadcrumb="Team">
        <div className="p-4 sm:p-6 max-w-2xl">
          <div className="card p-6 bg-amber-50 border-amber-200 flex items-start gap-3">
            <MdLockOutline size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800 mb-1">Restricted to Agency Administrators</p>
              <p className="text-xs text-amber-700">
                Only the Agency Administrator can add, deactivate, or promote coordinators.
              </p>
              <button onClick={() => navigate('/agency/dashboard')}
                className="mt-3 text-xs font-medium text-amber-700 hover:text-amber-800 underline">
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  const handleToggleActive = async (coord) => {
    try {
      const nowActive = coord.active === false
      await updateDoc(doc(db, 'users', coord.uid), { active: nowActive })
      await notify(coord.uid, {
        type:  nowActive ? 'account_activated' : 'account_deactivated',
        title: nowActive ? 'Account Reactivated' : 'Account Deactivated',
        body:  nowActive
          ? 'Your account has been reactivated by your agency administrator.'
          : 'Your account has been deactivated. Contact your agency administrator.',
      })
      logAudit(user, {
        action:     nowActive ? 'account_activated' : 'account_deactivated',
        targetType: 'account',
        targetId:   coord.uid,
        targetName: coord.name,
        details:    `Toggled by agency admin`,
      })
      toast.success(`${coord.name} ${nowActive ? 'reactivated' : 'deactivated'}.`)
    } catch (err) {
      console.error('[Team] toggle active error:', err)
      toast.error('Failed to update. Please try again.')
    }
  }

  const handleResetPassword = async (coord) => {
    try {
      await sendPasswordResetEmail(auth, coord.email)
      await notify(coord.uid, {
        type:  'password_reset_sent',
        title: 'Password Reset Email Sent',
        body:  'A password reset link has been sent to your email by your agency administrator.',
      })
      toast.success(`Password reset email sent to ${coord.email}.`)
    } catch (err) {
      console.error('[Team] password reset failed:', err)
      toast.error('Failed to send reset email.')
    }
  }

  const handleTogglePromotion = (coord) => {
    const promoting = coord.role !== 'agency_admin'

    // Don't let an agency_admin demote themselves or the last agency_admin
    if (!promoting) {
      if (coord.uid === user.uid) {
        toast.error('You cannot demote yourself. Promote another coordinator first, then ask them to demote you.', { duration: 8000 })
        return
      }
      const peers = team.filter(c => c.role === 'agency_admin' && c.uid !== coord.uid)
      if (peers.length === 0) {
        toast.error(`${coord.name} is the only other Agency Administrator. Cannot demote.`, { duration: 8000 })
        return
      }
    }
    setPromotionTarget(coord)
  }

  const performTogglePromotion = async () => {
    const coord = promotionTarget
    if (!coord || promoting) return
    const isPromoting = coord.role !== 'agency_admin'
    const next = isPromoting ? 'agency_admin' : 'agency'

    setPromoting(true)
    try {
      await updateDoc(doc(db, 'users', coord.uid), { role: next })
      await notify(coord.uid, {
        type:  isPromoting ? 'role_promoted' : 'role_demoted',
        title: isPromoting ? 'Promoted to Agency Administrator' : 'Returned to Coordinator role',
        body:  isPromoting
          ? 'You can now set your agency\'s budget, review top-up requests, and manage your team.'
          : 'Your Agency Administrator permissions have been removed.',
      })
      logAudit(user, {
        action:     isPromoting ? 'role_promoted_to_agency_admin' : 'role_demoted_to_agency',
        targetType: 'account',
        targetId:   coord.uid,
        targetName: coord.name,
        details:    `${coord.name} → ${next} (by agency admin)`,
      })
      toast.success(`${coord.name} ${isPromoting ? 'promoted to Agency Administrator' : 'returned to Coordinator'}.`)
      setPromotionTarget(null)
    } catch (err) {
      console.error('[Team] role toggle error:', err)
      toast.error('Failed to update role.')
    } finally {
      setPromoting(false)
    }
  }

  const admins = team.filter(c => c.role === 'agency_admin').length
  const coords = team.filter(c => c.role === 'agency').length

  return (
    <Layout breadcrumb="Team">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div>
            <p className="eyebrow">People</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Team</h1>
            <p className="text-sm text-gray-500 mt-1">Manage coordinators and other administrators at {agency?.name ?? 'your agency'}.</p>
          </div>
          <button className="btn-primary flex items-center gap-1.5" onClick={() => setShowAdd(true)}>
            <MdAdd size={16} /> Add Coordinator
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="card p-4">
            <p className="text-xs text-gray-400 mb-1">Total Members</p>
            <p className="text-3xl font-semibold text-gray-800">{loading ? '—' : team.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-400 mb-1">Agency Administrators</p>
            <p className="text-3xl font-semibold text-purple-600">{loading ? '—' : admins}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-400 mb-1">Coordinators</p>
            <p className="text-3xl font-semibold text-green-600">{loading ? '—' : coords}</p>
          </div>
        </div>

        {/* Member list — a 2-column card grid so the team fills the width */}
        {loading ? (
          <div className="card p-8 text-center text-sm text-gray-400">Loading team…</div>
        ) : team.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-gray-500 mb-3">No team members yet.</p>
            <button onClick={() => setShowAdd(true)}
              className="btn-primary text-sm inline-flex items-center gap-1.5">
              <MdAdd size={15} /> Add First Coordinator
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
              {team.map(coord => {
                const isActive = coord.active !== false
                const isYou    = coord.uid === user.uid
                return (
                  <div key={coord.uid} className={`card p-4 flex items-center gap-3 ${!isActive ? 'opacity-50' : ''}`}>
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
                      coord.role === 'agency_admin' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {coord.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-800">{coord.name} {isYou && <span className="text-xs text-gray-400">(you)</span>}</p>
                        <span className={`badge text-xs ${isActive ? 'badge-green' : 'badge-red'}`}>
                          {isActive ? 'Active' : 'Deactivated'}
                        </span>
                        {coord.role === 'agency_admin' && (
                          <span className="badge text-xs badge-purple flex items-center gap-0.5">
                            <MdStar size={11} /> Agency Admin
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{coord.email}</p>
                      {coord.contact && <p className="text-xs text-gray-400">{coord.contact}</p>}
                      <p className="text-xs text-gray-300 mt-0.5">Added {formatDate(coord.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button title="Edit profile"
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        onClick={() => setEditing(coord)}>
                        <MdEdit size={15} />
                      </button>
                      <button title={coord.role === 'agency_admin' ? 'Demote to Coordinator' : 'Promote to Agency Admin'}
                        className={`p-1.5 rounded-lg transition-colors ${coord.role === 'agency_admin' ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50' : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50'}`}
                        onClick={() => handleTogglePromotion(coord)}>
                        {coord.role === 'agency_admin' ? <MdStar size={15} /> : <MdStarOutline size={15} />}
                      </button>
                      <button title="Reset password"
                        className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                        onClick={() => handleResetPassword(coord)}>
                        <MdKey size={15} />
                      </button>
                      {!isYou && (
                        <button title={isActive ? 'Deactivate' : 'Reactivate'}
                          className={`p-1.5 rounded-lg transition-colors ${isActive ? 'text-gray-400 hover:text-orange-500 hover:bg-orange-50' : 'text-gray-400 hover:text-green-500 hover:bg-green-50'}`}
                          onClick={() => handleToggleActive(coord)}>
                          {isActive ? <MdLock size={15} /> : <MdLockOpen size={15} />}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        )}

        <p className="text-xs text-gray-400 mt-4 leading-relaxed">
          <strong>Note —</strong> Deleting a coordinator account requires CRMC system administration. To permanently remove someone, deactivate them here and contact CRMC. Coordinators you add will receive a password reset email (if checked) and must set their password before logging in.
        </p>

        {showAdd && agency && (
          <AddCoordModal agencyId={agency.id} agencyName={agency.name} onClose={() => setShowAdd(false)} />
        )}
        {editing && (
          <EditCoordModal coord={editing} currentUser={user} onClose={() => setEditing(null)} />
        )}

        <ConfirmModal
          open={!!promotionTarget}
          onClose={() => !promoting && setPromotionTarget(null)}
          onConfirm={performTogglePromotion}
          title={promotionTarget?.role === 'agency_admin'
            ? `Demote ${promotionTarget?.name} back to Coordinator?`
            : `Promote ${promotionTarget?.name} to Agency Administrator?`}
          body={promotionTarget?.role === 'agency_admin'
            ? 'They will lose access to allocation, audit log, and team management.'
            : 'They will gain budget allocation, audit log, and team management access.'}
          tone={promotionTarget?.role === 'agency_admin' ? 'warning' : 'info'}
          confirmLabel={promotionTarget?.role === 'agency_admin' ? 'Demote' : 'Promote'}
          confirmLabelBusy={promotionTarget?.role === 'agency_admin' ? 'Demoting…' : 'Promoting…'}
        />
      </div>
    </Layout>
  )
}
