import { useState, useEffect, Fragment } from 'react'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, deleteDoc, setDoc, serverTimestamp,
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
import {
  MdAdd, MdEdit, MdDelete, MdLock, MdLockOpen,
  MdKey, MdClose, MdWarning, MdVisibility, MdVisibilityOff,
  MdStar, MdStarOutline,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────

const getSecondaryAuth = () => {
  const existing = getApps().find(a => a.name === 'secondary')
  const app = existing ?? initializeApp(firebaseConfig, 'secondary')
  return getAuth(app)
}

const formatDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Add Coordinator Modal ─────────────────────────────────────────────────

function AddCoordinatorModal({ agency, onClose }) {
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
        name:      form.name.trim(),
        email:     form.email.trim(),
        role:      'agency',
        agencyId:  agency.id,
        contact:   null,
        rank:      null,
        active:    true,
        cooldown:  0,
        deletion:  false,
        createdAt: serverTimestamp(),
      })

      if (sendReset) await sendPasswordResetEmail(auth, form.email.trim())

      logAudit(currentUser, {
        action:     'account_created',
        targetType: 'account',
        targetId:   uid,
        targetName: form.name.trim(),
        details:    `Agency coordinator for ${agency.name}`,
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
            <p className="text-xs text-gray-400 mt-0.5">{agency.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Full Name <span className="text-red-400">*</span></label>
            <input className="input" placeholder="Juan Dela Cruz"
              value={form.name} onChange={set('name')} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email Address <span className="text-red-400">*</span></label>
            <input type="email" className="input" placeholder="coordinator@agency.gov.ph"
              value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password <span className="text-red-400">*</span></label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} className="input pr-10"
                placeholder="Min. 6 characters" value={form.password} onChange={set('password')} />
              <button type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
  const [form, setForm]       = useState({
    name:    coordinator.name    ?? '',
    contact: coordinator.contact ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required.'); return }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', coordinator.uid), {
        name:    form.name.trim(),
        contact: form.contact.trim() || null,
      })
      logAudit(currentUser, {
        action:     'account_updated',
        targetType: 'account',
        targetId:   coordinator.uid,
        targetName: form.name.trim(),
        details:    'Coordinator profile updated',
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
            <input className="input" placeholder="09XXXXXXXXX"
              value={form.contact} onChange={set('contact')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email Address</label>
            <input className="input bg-gray-50 text-gray-400 cursor-not-allowed"
              value={coordinator.email} disabled />
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

export default function AgencyCoordinators() {
  const { user }                              = useAuth()
  const [agencies,       setAgencies]         = useState([])
  const [coordinators,   setCoordinators]     = useState([])
  const [loading,        setLoading]          = useState(true)
  const [createFor,      setCreateFor]        = useState(null)
  const [editCoord,      setEditCoord]        = useState(null)
  const [confirmDelete,  setConfirmDelete]    = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'agencies'), snap => {
      setAgencies(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.name?.localeCompare(b.name))
      )
      setLoading(false)
    }, () => { setLoading(false); toast.error('Failed to load agencies.') })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'agency')),
      snap => setCoordinators(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      () => {}
    )
    return unsub
  }, [])

  const coordMap = coordinators.reduce((acc, c) => {
    if (!c.agencyId) return acc
    if (!acc[c.agencyId]) acc[c.agencyId] = []
    acc[c.agencyId].push(c)
    return acc
  }, {})

  const withCoordinator    = agencies.filter(a => (coordMap[a.id]?.length ?? 0) > 0).length
  const withoutCoordinator = agencies.length - withCoordinator

  // Agencies without an Agency Administrator can't set their own allocation
  // or receive top-up requests. Surface them so super_admin can promote
  // someone. Migration target: existing agencies created before the role
  // refactor will all show up here until promotion.
  const agenciesMissingAdmin = agencies.filter(a => {
    const team = coordMap[a.id] ?? []
    return team.length > 0 && !team.some(c => c.role === 'agency_admin')
  })

  // ── Actions ──────────────────────────────────────────────────────────

  const handleToggleActive = async (coord) => {
    try {
      const nowActive = coord.active === false
      await updateDoc(doc(db, 'users', coord.uid), { active: nowActive })
      await notify(coord.uid, {
        type:  nowActive ? 'account_activated' : 'account_deactivated',
        title: nowActive ? 'Account Reactivated' : 'Account Deactivated',
        body:  nowActive
          ? 'Your coordinator account has been reactivated. You can now log in to the portal.'
          : 'Your coordinator account has been deactivated. Contact your administrator.',
      })
      logAudit(user, {
        action:     nowActive ? 'account_activated' : 'account_deactivated',
        targetType: 'account',
        targetId:   coord.uid,
        targetName: coord.name,
        details:    `Agency coordinator ${nowActive ? 'reactivated' : 'deactivated'}`,
      })
      toast.success(`${coord.name} ${nowActive ? 'reactivated' : 'deactivated'}.`)
    } catch { toast.error('Failed to update account. Please try again.') }
  }

  const handleResetPassword = async (coord) => {
    try {
      await sendPasswordResetEmail(auth, coord.email)
      await notify(coord.uid, {
        type:  'password_reset_sent',
        title: 'Password Reset Email Sent',
        body:  'A password reset link has been sent to your email by the administrator.',
      })
      toast.success(`Password reset email sent to ${coord.email}.`)
    } catch { toast.error('Failed to send reset email.') }
  }

  // Promote a coordinator to agency_admin, or demote an agency_admin back
  // to coordinator. Each agency typically has one agency_admin (the senior
  // officer with allocation authority). The UI doesn't enforce one-per-
  // agency — a senior officer can designate a deputy if needed.
  const handleTogglePromotion = async (coord) => {
    const promoting = coord.role !== 'agency_admin'
    const next = promoting ? 'agency_admin' : 'agency'

    // Guard: don't let CRMC demote the last agency_admin at an agency.
    // Doing so would leave the agency unable to set its own allocation,
    // approve top-up requests, or read its own audit slice.
    if (!promoting) {
      const adminPeers = coordinators.filter(c =>
        c.agencyId === coord.agencyId && c.role === 'agency_admin' && c.uid !== coord.uid
      )
      if (adminPeers.length === 0) {
        toast.error(
          `${coord.name} is the only Agency Administrator at this agency. Promote another coordinator first, then demote.`,
          { duration: 8000 }
        )
        return
      }
    }

    if (!window.confirm(
      promoting
        ? `Promote ${coord.name} to Agency Administrator?\n\nAgency Administrators can set their agency's budget allocation, manage the budget period, and approve top-up requests. They will see additional pages on their next login.`
        : `Demote ${coord.name} back to Coordinator?\n\nThey will lose access to the Budget Allocation page and the agency's audit log.`
    )) return
    try {
      await updateDoc(doc(db, 'users', coord.uid), { role: next })
      await notify(coord.uid, {
        type:  promoting ? 'role_promoted' : 'role_demoted',
        title: promoting ? 'Promoted to Agency Administrator' : 'Returned to Coordinator role',
        body:  promoting
          ? 'You can now set your agency\'s budget allocation, reset the period, and review top-up requests from coordinators.'
          : 'Your Agency Administrator permissions have been removed. You can still process applications as a coordinator.',
      })
      logAudit(user, {
        action:     promoting ? 'role_promoted_to_agency_admin' : 'role_demoted_to_agency',
        targetType: 'account',
        targetId:   coord.uid,
        targetName: coord.name,
        details:    `${coord.name} → ${next}`,
      })
      toast.success(`${coord.name} ${promoting ? 'promoted to Agency Administrator' : 'returned to Coordinator role'}.`)
    } catch (err) {
      console.error('[AgencyCoordinators] role toggle error:', err)
      toast.error('Failed to update role. Please try again.')
    }
  }

  const handleDelete = async (coord) => {
    try {
      await deleteDoc(doc(db, 'users', coord.uid))
      logAudit(user, {
        action:     'account_deleted',
        targetType: 'account',
        targetId:   coord.uid,
        targetName: coord.name,
        details:    'Agency coordinator account deleted',
      })
      setConfirmDelete(null)
      toast.success(`${coord.name}'s account deleted.`)
    } catch { toast.error('Failed to delete account. Please try again.') }
  }

  return (
    <Layout breadcrumb="Agency Coordinators">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="mb-5">
          <h1 className="page-title">Agency Coordinators</h1>
          <p className="page-sub">Manage coordinator accounts for each medical assistance agency.</p>
        </div>

        {/* Migration banner — agencies missing an Agency Administrator */}
        {!loading && agenciesMissingAdmin.length > 0 && (
          <div className="card p-4 mb-5 bg-amber-50 border-amber-200">
            <div className="flex items-start gap-3">
              <MdWarning size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800 mb-1">
                  {agenciesMissingAdmin.length} {agenciesMissingAdmin.length === 1 ? 'agency has' : 'agencies have'} no Agency Administrator
                </p>
                <p className="text-xs text-amber-700 leading-relaxed mb-2">
                  These agencies can't set their own budget allocation or receive top-up requests. Promote one coordinator at each agency to <strong>Agency Administrator</strong> using the star icon below.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {agenciesMissingAdmin.map(a => (
                    <span key={a.id} className="badge badge-amber text-xs">{a.name}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Agencies',     value: agencies.length,             color: 'text-gray-800'  },
            { label: 'With Coordinator',   value: withCoordinator,             color: 'text-green-600' },
            { label: 'No Coordinator',     value: withoutCoordinator,          color: withoutCoordinator > 0 ? 'text-amber-600' : 'text-gray-400' },
            { label: 'Needs Agency Admin', value: agenciesMissingAdmin.length, color: agenciesMissingAdmin.length > 0 ? 'text-amber-600' : 'text-gray-400' },
          ].map((m, i) => (
            <div key={i} className="card p-4">
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-3xl font-semibold ${m.color}`}>{loading ? '—' : m.value}</p>
            </div>
          ))}
        </div>

        {/* Agency coordinator cards */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-100 rounded w-40" />
                    <div className="h-2.5 bg-gray-100 rounded w-24" />
                  </div>
                </div>
                <div className="h-12 bg-gray-50 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {agencies.map(agency => {
              const coords = coordMap[agency.id] ?? []
              return (
                <div key={agency.id} className="card overflow-hidden">

                  {/* Agency header */}
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-50">
                    <div className={`w-10 h-10 ${agency.color ?? 'bg-gray-400'} rounded-xl text-white font-bold text-sm flex items-center justify-center flex-shrink-0`}>
                      {agency.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{agency.name}</p>
                      <p className="text-xs text-gray-400">{agency.location}</p>
                    </div>
                    <span className={`badge text-xs ${agency.enabled ? 'badge-green' : 'badge-red'} flex-shrink-0`}>
                      {agency.enabled ? 'Active' : 'Disabled'}
                    </span>
                    <button className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0"
                      onClick={() => setCreateFor(agency)}>
                      <MdAdd size={14} /> Add Coordinator
                    </button>
                  </div>

                  {/* No coordinator state */}
                  {coords.length === 0 && (
                    <div className="px-5 py-4 flex items-center gap-2 bg-amber-50">
                      <MdWarning size={14} className="text-amber-500 flex-shrink-0" />
                      <p className="text-xs text-amber-700 font-medium">
                        No coordinator assigned — nobody can log in to process applications for this agency.
                      </p>
                    </div>
                  )}

                  {/* Coordinator rows */}
                  {coords.length > 0 && (
                    <div className="divide-y divide-gray-50">
                      {coords.map(coord => {
                        const isActive   = coord.active !== false
                        const isDeleting = confirmDelete?.uid === coord.uid
                        return (
                          <Fragment key={coord.uid}>
                            <div className={`flex items-center gap-3 px-5 py-3.5 ${!isActive ? 'opacity-50' : ''}`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {coord.name?.[0]?.toUpperCase() ?? '?'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-gray-800">{coord.name}</p>
                                  <span className={`badge text-xs ${isActive ? 'badge-green' : 'badge-red'}`}>
                                    {isActive ? 'Active' : 'Deactivated'}
                                  </span>
                                  {coord.role === 'agency_admin' && (
                                    <span className="badge text-xs badge-amber flex items-center gap-0.5">
                                      <MdStar size={11} /> Agency Admin
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-400">{coord.email}</p>
                                {coord.contact && <p className="text-xs text-gray-400">📞 {coord.contact}</p>}
                                <p className="text-xs text-gray-300 mt-0.5">Added {formatDate(coord.createdAt)}</p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button title="Edit"
                                  className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                                  onClick={() => setEditCoord(coord)}>
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
                                <button title={isActive ? 'Deactivate' : 'Reactivate'}
                                  className={`p-1.5 rounded-lg transition-colors ${isActive ? 'text-gray-400 hover:text-orange-500 hover:bg-orange-50' : 'text-gray-400 hover:text-green-500 hover:bg-green-50'}`}
                                  onClick={() => handleToggleActive(coord)}>
                                  {isActive ? <MdLock size={15} /> : <MdLockOpen size={15} />}
                                </button>
                                <button title="Delete"
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  onClick={() => setConfirmDelete(coord)}>
                                  <MdDelete size={15} />
                                </button>
                              </div>
                            </div>

                            {isDeleting && (
                              <div className="bg-red-50 border-t border-red-100 px-5 py-3 flex items-center gap-3">
                                <MdWarning size={16} className="text-red-500 flex-shrink-0" />
                                <p className="text-sm text-red-700 flex-1">
                                  Delete <strong>{coord.name}</strong>? They will lose portal access immediately.
                                </p>
                                <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0"
                                  onClick={() => setConfirmDelete(null)}>Cancel</button>
                                <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 flex-shrink-0"
                                  onClick={() => handleDelete(coord)}>Delete</button>
                              </div>
                            )}
                          </Fragment>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {createFor && (
        <AddCoordinatorModal agency={createFor} onClose={() => setCreateFor(null)} />
      )}
      {editCoord && (
        <EditCoordinatorModal coordinator={editCoord} onClose={() => setEditCoord(null)} />
      )}
    </Layout>
  )
}
