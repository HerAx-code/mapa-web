import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, setDoc, serverTimestamp, getDocs } from 'firebase/firestore'
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut, sendPasswordResetEmail } from 'firebase/auth'
import { initializeApp, getApps } from 'firebase/app'
import { db, auth, firebaseConfig } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import {
  MdSearch, MdAdd, MdEdit, MdDelete, MdLock, MdLockOpen,
  MdKey, MdClose, MdVisibility, MdVisibilityOff, MdWarning,
  MdSupervisedUserCircle,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────

import { ROLE_BADGE, ROLE_LABEL_SHORT as ROLE_LABEL } from '../../utils/constants'

const getSecondaryAuth = () => {
  const existing = getApps().find(a => a.name === 'secondary')
  const app = existing ?? initializeApp(firebaseConfig, 'secondary')
  return getAuth(app)
}

// Account events are Super Admin only — Staff Admin has no access to the Accounts page
const notifySuperAdmins = async (notification) => {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'super_admin')))
    for (const d of snap.docs) await notify(d.id, notification)
  } catch (e) { console.error(e) }
}

const formatDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────

function AccountModal({ account, onClose }) {
  const { user: currentUser } = useAuth()
  const isEdit = !!account

  // This page manages only system administrator roles. Agency staff
  // (agency_admin + agency) are managed under their agency at
  // /admin/agencies/:id, so role options here are limited to two.
  const [form, setForm] = useState({
    name:      account?.name     ?? '',
    contact:   account?.contact  ?? '',
    email:     account?.email    ?? '',
    role:      account?.role     ?? 'staff_admin',
    password:  '',
    sendReset: true,
  })
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving]   = useState(false)

  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim())                        { toast.error('Name is required.'); return }
    if (!isEdit && !form.email.trim())            { toast.error('Email is required.'); return }
    if (!isEdit && form.password.length < 6)      { toast.error('Password must be at least 6 characters.'); return }

    setSaving(true)
    try {
      if (isEdit) {
        const updates = {
          name:    form.name.trim(),
          contact: form.contact.trim(),
        }
        const roleChanged = form.role !== account.role
        if (roleChanged) updates.role = form.role

        await updateDoc(doc(db, 'users', account.uid), updates)

        if (roleChanged) {
          await notify(account.uid, {
            type:  'role_changed',
            title: 'Your role has been changed',
            body:  `Your account role has been updated to ${ROLE_LABEL[form.role]} by the administrator.`,
          })
        }
        logAudit(currentUser, { action: 'account_updated', targetType: 'account', targetId: account.uid, targetName: form.name.trim(), details: `Role: ${ROLE_LABEL[form.role] ?? form.role}` })
        toast.success('Account updated.')

      } else {
        // Create via secondary Firebase app (doesn't affect current session)
        const secondaryAuth = getSecondaryAuth()
        const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email.trim(), form.password)
        const uid  = cred.user.uid
        await fbSignOut(secondaryAuth)

        await setDoc(doc(db, 'users', uid), {
          name:      form.name.trim(),
          email:     form.email.trim(),
          role:      form.role,
          agencyId:  null,
          contact:   form.contact.trim(),
          rank:      form.role === 'super_admin' ? 'high' : 'low',
          active:    true,
          createdAt: serverTimestamp(),
        })

        if (form.sendReset) {
          await sendPasswordResetEmail(auth, form.email.trim())
        }

        await notifySuperAdmins({
          type:  'new_account',
          title: 'New admin account created',
          body:  `${form.name.trim()} (${ROLE_LABEL[form.role]}) was added to the portal by ${currentUser?.name}.`,
        })
        logAudit(currentUser, { action: 'account_created', targetType: 'account', targetId: uid, targetName: form.name.trim(), details: `Role: ${ROLE_LABEL[form.role] ?? form.role}` })
        toast.success('Account created.' + (form.sendReset ? ' Password reset email sent.' : ''))
      }
      onClose()
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') toast.error('This email is already registered.')
      else toast.error(err.message || 'Failed to save account.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Account' : 'Add New Account'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Full Name <span className="text-red-400">*</span></label>
            <input className="input" placeholder="Juan Dela Cruz" value={form.name} onChange={set('name')} />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email Address <span className="text-red-400">*</span></label>
              <input type="email" className="input" placeholder="admin@crmc.gov.ph" value={form.email} onChange={set('email')} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contact Number</label>
            <input className="input" placeholder="09XXXXXXXXX" value={form.contact} onChange={set('contact')} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role <span className="text-red-400">*</span></label>
            <select className="input" value={form.role} onChange={set('role')}>
              <option value="super_admin">Super Admin</option>
              <option value="staff_admin">Staff Admin</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Agency staff are managed under each agency.</p>
          </div>

          {!isEdit && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="Min. 6 characters"
                    value={form.password}
                    onChange={set('password')}
                  />
                  <button type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPw(p => !p)}>
                    {showPw ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-brand-500"
                  checked={form.sendReset}
                  onChange={e => setForm(p => ({ ...p, sendReset: e.target.checked }))} />
                Send password reset email to new user
              </label>
            </>
          )}
        </div>

        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Accounts() {
  const { user: currentUser }           = useAuth()
  const [accounts, setAccounts]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]               = useState('')
  const [roleFilter, setRoleFilter]       = useState('all')
  const [statusFilter, setStatusFilter]   = useState('all')
  const [modal, setModal]                 = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    // Limited to system administrator roles. Agency staff are managed
    // under their agency at /admin/agencies/:id — keeping them off this
    // page prevents accidental deactivation of agency users from a
    // surface intended for CRMC staff only.
    const q = query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin']))
    const unsub = onSnapshot(q, snap => {
      setAccounts(snap.docs.map(d => ({ uid: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  const filtered = accounts
    .filter(a => {
      if (roleFilter !== 'all' && a.role !== roleFilter) return false
      if (statusFilter === 'active'      && a.active === false) return false
      if (statusFilter === 'deactivated' && a.active !== false) return false
      const q = search.toLowerCase()
      return !q || a.name?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q) || a.contact?.includes(q)
    })
    .sort((a, b) => a.name?.localeCompare(b.name))

  // ── Actions ──────────────────────────────────────────────────────────

  const handleToggleActive = async (account) => {
    const nowActive = account.active === false
    await updateDoc(doc(db, 'users', account.uid), { active: nowActive })

    if (nowActive) {
      await notify(account.uid, {
        type: 'account_activated', title: 'Account Reactivated',
        body: 'Your account has been reactivated. You can now log in to the portal.',
      })
      await notifySuperAdmins({
        type: 'account_activated', title: 'Account Reactivated',
        body: `${account.name}'s account has been reactivated by ${currentUser?.name}.`,
      })
      logAudit(currentUser, { action: 'account_activated', targetType: 'account', targetId: account.uid, targetName: account.name, details: 'Account reactivated' })
      toast.success(`${account.name}'s account reactivated.`)
    } else {
      await notify(account.uid, {
        type: 'account_deactivated', title: 'Account Deactivated',
        body: 'Your account has been deactivated by the administrator. Contact your supervisor for assistance.',
      })
      await notifySuperAdmins({
        type: 'account_deactivated', title: 'Account Deactivated',
        body: `${account.name}'s account has been deactivated by ${currentUser?.name}.`,
      })
      logAudit(currentUser, { action: 'account_deactivated', targetType: 'account', targetId: account.uid, targetName: account.name, details: 'Account deactivated' })
      toast.success(`${account.name}'s account deactivated.`)
    }
  }

  const handleResetPassword = async (account) => {
    try {
      await sendPasswordResetEmail(auth, account.email)
      await notify(account.uid, {
        type: 'password_reset_sent', title: 'Password Reset Email Sent',
        body: 'A password reset link has been sent to your email by the administrator.',
      })
      toast.success(`Password reset email sent to ${account.email}.`)
    } catch { toast.error('Failed to send reset email.') }
  }

  const handleDelete = async (account) => {
    await deleteDoc(doc(db, 'users', account.uid))
    await notifySuperAdmins({
      type: 'account_deleted', title: 'Account Deleted',
      body: `${account.name}'s account (${ROLE_LABEL[account.role]}) was permanently deleted by ${currentUser?.name}.`,
    })
    setConfirmDelete(null)
    logAudit(currentUser, { action: 'account_deleted', targetType: 'account', targetId: account.uid, targetName: account.name, details: `Role was: ${ROLE_LABEL[account.role] ?? account.role}` })
    toast.success('Account deleted.')
  }

  return (
    <Layout breadcrumb="Admin Accounts">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="page-title">Admin Accounts</h1>
            <p className="page-sub">Manage CRMC system administrator accounts. Agency staff are managed under each agency.</p>
          </div>
          <button className="btn-primary flex items-center gap-1.5" onClick={() => setModal('add')}>
            <MdAdd size={16} /> Add Account
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Total',       value: accounts.length,                                     color: 'text-gray-800'   },
            { label: 'Super Admin', value: accounts.filter(a => a.role === 'super_admin').length, color: 'text-purple-600' },
            { label: 'Staff Admin', value: accounts.filter(a => a.role === 'staff_admin').length, color: 'text-blue-600'   },
          ].map((m, i) => (
            <div key={i} className="card p-4">
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-3xl font-semibold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Search + Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input className="input pl-9" placeholder="Search by name, email or contact..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-3 mb-5 flex-wrap items-center">
          {/* Role filter */}
          <div className="flex gap-1">
            {[['all','All'], ['super_admin','Super Admin'], ['staff_admin','Staff Admin']].map(([key, label]) => (
              <button key={key} onClick={() => setRoleFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${roleFilter === key ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-gray-200">|</span>
          {/* Status filter */}
          <div className="flex gap-1">
            {[['all','All Status'], ['active','Active'], ['deactivated','Deactivated']].map(([key, label]) => (
              <button key={key} onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === key ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} account{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, i) => (
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
                  <td><div className="h-5 bg-gray-100 rounded-full w-20" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20" /></td>
                  <td><div className="h-6 bg-gray-100 rounded w-20" /></td>
                </tr>
              ))}
              {!loading && filtered.map(a => {
                const isActive     = a.active !== false
                const isSelf       = a.uid === currentUser?.uid
                const isDeleting   = confirmDelete?.uid === a.uid

                return (
                  <>
                    <tr key={a.uid} className={!isActive ? 'opacity-50' : ''}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                            a.role === 'super_admin' ? 'bg-purple-50 text-purple-600'
                            : 'bg-blue-50 text-blue-600'
                          }`}>
                            {a.name?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800 text-sm">
                              {a.name} {isSelf && <span className="text-xs text-gray-400">(you)</span>}
                            </p>
                            <p className="text-xs text-gray-400">{a.email}</p>
                            {a.contact && <p className="text-xs text-gray-400">📞 {a.contact}</p>}
                          </div>
                        </div>
                      </td>
                      <td><span className={`badge text-xs ${ROLE_BADGE[a.role] || 'badge-gray'}`}>{ROLE_LABEL[a.role] || a.role}</span></td>
                      <td>
                        <span className={`badge text-xs ${isActive ? 'badge-green' : 'badge-red'}`}>
                          {isActive ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="text-xs text-gray-400">{formatDate(a.createdAt)}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          {/* Edit */}
                          <button title="Edit account"
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                            onClick={() => setModal(a)}>
                            <MdEdit size={15} />
                          </button>
                          {/* Reset password */}
                          <button title="Send password reset email"
                            className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                            onClick={() => handleResetPassword(a)}>
                            <MdKey size={15} />
                          </button>
                          {/* Deactivate / Activate */}
                          {!isSelf && (
                            <button title={isActive ? 'Deactivate account' : 'Reactivate account'}
                              className={`p-1.5 rounded-lg transition-colors ${isActive ? 'text-gray-400 hover:text-orange-500 hover:bg-orange-50' : 'text-gray-400 hover:text-green-500 hover:bg-green-50'}`}
                              onClick={() => handleToggleActive(a)}>
                              {isActive ? <MdLock size={15} /> : <MdLockOpen size={15} />}
                            </button>
                          )}
                          {/* Delete */}
                          {!isSelf && (
                            <button title="Delete account"
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              onClick={() => setConfirmDelete(a)}>
                              <MdDelete size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Delete confirmation row */}
                    {isDeleting && (
                      <tr key={a.uid + '_del'} className="bg-red-50">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <MdWarning size={16} className="text-red-500 flex-shrink-0" />
                            <p className="text-sm text-red-700 flex-1">
                              Delete <strong>{a.name}</strong>? This removes their portal access permanently.
                            </p>
                            <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50"
                              onClick={() => setConfirmDelete(null)}>Cancel</button>
                            <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600"
                              onClick={() => handleDelete(a)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <MdSupervisedUserCircle size={36} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">
                      {search || roleFilter !== 'all' ? 'No accounts match your filter.' : 'No accounts found.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Modal */}
        {modal && (
          <AccountModal
            account={modal === 'add' ? null : modal}
            onClose={() => setModal(null)}
          />
        )}
      </div>
    </Layout>
  )
}
