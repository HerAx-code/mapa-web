import { useState, useEffect } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import Layout from '../../components/Layout'
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, setDoc, serverTimestamp, getDocs } from 'firebase/firestore'
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut, sendPasswordResetEmail, deleteUser } from 'firebase/auth'
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
import { tsToDate } from '../../utils/dates'

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
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
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
  useEscapeKey(onClose, !saving)

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
        // Create the Firestore user doc BEFORE signing out -- if setDoc
        // fails (rules denial, network blip), we still have the Auth
        // session and can deleteUser to avoid orphaning a ghost account
        // (logged-in but invisible to the app). Without this rollback,
        // failed creates leave the email permanently registered with no
        // way to retry from this page (auth/email-already-in-use).
        try {
          await setDoc(doc(db, 'users', uid), {
            name:      form.name.trim(),
            email:     form.email.trim(),
            role:      form.role,
            agencyId:  null,
            contact:   form.contact.trim(),
            rank:      form.role === 'super_admin' ? 'high' : 'low',
            active:    true,
            // R24: agency/Team.jsx and patient Register.jsx both stamp
            // these fields on creation; this admin path was the only one
            // omitting them. Without explicit defaults, future queries
            // like where('deletion', '==', false) miss the doc because
            // Firestore can't match a missing field via equality.
            deletion:  false,
            cooldown:  0,
            createdAt: serverTimestamp(),
          })
        } catch (setDocErr) {
          try { await deleteUser(cred.user) } catch (cleanupErr) {
            console.error('[Accounts] orphaned Auth user cleanup failed for', form.email.trim(), cleanupErr)
          }
          await fbSignOut(secondaryAuth).catch(() => {})
          throw setDocErr
        }
        await fbSignOut(secondaryAuth)

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
    }, (err) => {
      setLoading(false)
      console.error('[Accounts] users snapshot error:', err)
      toast.error('Failed to load accounts.')
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

  // Access-governance readouts + the roster grouped by role.
  const superCount = accounts.filter(a => a.role === 'super_admin').length
  const staffCount = accounts.filter(a => a.role === 'staff_admin').length
  const offCount   = accounts.filter(a => a.active === false).length
  const isFiltered = search || roleFilter !== 'all' || statusFilter !== 'all'
  const clearAll   = () => { setSearch(''); setRoleFilter('all'); setStatusFilter('all') }
  const roleGroups = [
    { role: 'super_admin', label: 'Super Admins' },
    { role: 'staff_admin', label: 'Staff Admins' },
  ].map(g => ({ ...g, members: filtered.filter(a => a.role === g.role) })).filter(g => g.members.length > 0)
  const otherMembers = filtered.filter(a => a.role !== 'super_admin' && a.role !== 'staff_admin')
  if (otherMembers.length) roleGroups.push({ role: 'other', label: 'Other roles', members: otherMembers })

  // ── Actions ──────────────────────────────────────────────────────────

  const handleToggleActive = async (account) => {
    const nowActive = account.active === false
    try {
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
    } catch (err) {
      console.error(err)
      toast.error(`Failed to ${nowActive ? 'reactivate' : 'deactivate'} account.`)
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
    } catch (err) { console.error(err); toast.error('Failed to send reset email.') }
  }

  const handleDelete = async (account) => {
    try {
      await deleteDoc(doc(db, 'users', account.uid))
      await notifySuperAdmins({
        type: 'account_deleted', title: 'Account Deleted',
        body: `${account.name}'s account (${ROLE_LABEL[account.role]}) was permanently deleted by ${currentUser?.name}.`,
      })
      setConfirmDelete(null)
      logAudit(currentUser, { action: 'account_deleted', targetType: 'account', targetId: account.uid, targetName: account.name, details: `Role was: ${ROLE_LABEL[account.role] ?? account.role}` })
      toast.success('Account deleted.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete account.')
    }
  }

  return (
    <Layout breadcrumb="Admin Accounts">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="eyebrow">Access</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Admin Accounts</h1>
            <p className="text-sm text-gray-500 mt-1">Manage CRMC system administrator accounts. Agency staff are managed under each agency.</p>
          </div>
          <button className="btn-primary flex items-center gap-1.5" onClick={() => setModal('add')}>
            <MdAdd size={16} /> Add Account
          </button>
        </div>

        {/* Two-pane: facet sidebar + roster grouped by role. */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">

          {/* ── Filter sidebar — doubles as the access-governance readout ── */}
          <aside className="lg:sticky lg:top-[68px] space-y-4">
            <div className="card grid grid-cols-3 divide-x divide-gray-100 overflow-hidden text-center">
              {[
                { label: 'Super', value: superCount, color: 'text-purple-600' },
                { label: 'Staff', value: staffCount, color: 'text-blue-600'   },
                { label: 'Off',   value: offCount,   color: offCount ? 'text-red-500' : 'text-gray-400' },
              ].map((m, i) => (
                <div key={i} className="px-2 py-2.5">
                  <p className={`text-lg font-semibold tabular-nums ${m.color}`}>{m.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input className="input pl-9 text-sm" placeholder="Name or email"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Role</p>
              <ul className="-mx-1.5 space-y-px">
                {[
                  ['all', 'All roles', accounts.length],
                  ['super_admin', 'Super Admin', superCount],
                  ['staff_admin', 'Staff Admin', staffCount],
                ].map(([key, label, n]) => {
                  const active = roleFilter === key
                  return (
                    <li key={key}>
                      <button onClick={() => setRoleFilter(key)} aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors ${active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                        <span>{label}</span>
                        <span className={`tabular-nums text-xs ${active ? 'text-brand-600' : 'text-gray-400'}`}>{n}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Status</p>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
                {[['all', 'All'], ['active', 'Active'], ['deactivated', 'Off']].map(([k, l]) => (
                  <button key={k} onClick={() => setStatusFilter(k)}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${statusFilter === k ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={clearAll} disabled={!isFiltered}
              className={`text-xs font-medium underline underline-offset-2 ${isFiltered ? 'text-gray-500 hover:text-brand-600' : 'text-gray-300 cursor-default'}`}>
              Clear filters
            </button>
          </aside>

          {/* ── Roster, grouped by role ── */}
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400">{filtered.length} account{filtered.length !== 1 ? 's' : ''}{isFiltered ? ` of ${accounts.length}` : ''}</p>
            </div>

            <div className="card overflow-hidden">
              {loading && (
                <div className="divide-y divide-gray-50">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3.5 animate-pulse">
                      <div className="w-9 h-9 rounded-full bg-gray-100 flex-shrink-0" />
                      <div className="flex-1 space-y-2 min-w-0"><div className="h-3 bg-gray-100 rounded w-32" /><div className="h-2.5 bg-gray-100 rounded w-44" /></div>
                      <div className="h-5 bg-gray-100 rounded-full w-16" />
                    </div>
                  ))}
                </div>
              )}

              {!loading && roleGroups.map(group => (
                <section key={group.role}>
                  <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-gray-100 bg-gray-50/95 px-4 py-2 backdrop-blur">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">{group.label}</h3>
                    <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{group.members.length} {group.members.length === 1 ? 'account' : 'accounts'}</span>
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {group.members.map(a => {
                      const isActive   = a.active !== false
                      const isSelf     = a.uid === currentUser?.uid
                      const isDeleting = confirmDelete?.uid === a.uid
                      return (
                        <li key={a.uid} className={!isActive ? 'opacity-60' : ''}>
                          <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${a.role === 'super_admin' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                              {a.name?.[0]?.toUpperCase() ?? '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">
                                {a.name} {isSelf && <span className="text-xs font-normal text-gray-400">· you</span>}
                              </p>
                              <p className="text-xs text-gray-400 truncate">{a.email}{a.contact ? ` · ${a.contact}` : ''}</p>
                            </div>
                            <span className={`badge text-xs flex-shrink-0 ${isActive ? 'badge-green' : 'badge-red'}`}>{isActive ? 'Active' : 'Off'}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0 w-20 text-right hidden sm:block">{formatDate(a.createdAt)}</span>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button title="Edit account" className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" onClick={() => setModal(a)}><MdEdit size={15} /></button>
                              <button title="Send password reset email" className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors" onClick={() => handleResetPassword(a)}><MdKey size={15} /></button>
                              {!isSelf && (
                                <button title={isActive ? 'Deactivate account' : 'Reactivate account'}
                                  className={`p-1.5 rounded-lg transition-colors ${isActive ? 'text-gray-400 hover:text-orange-500 hover:bg-orange-50' : 'text-gray-400 hover:text-green-500 hover:bg-green-50'}`}
                                  onClick={() => handleToggleActive(a)}>
                                  {isActive ? <MdLock size={15} /> : <MdLockOpen size={15} />}
                                </button>
                              )}
                              {!isSelf && (
                                <button title="Delete account" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" onClick={() => setConfirmDelete(a)}><MdDelete size={15} /></button>
                              )}
                            </div>
                          </div>
                          {isDeleting && (
                            <div className="flex items-start gap-3 border-t border-red-100 bg-red-50 px-4 py-3">
                              <MdWarning size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <p className="text-sm text-red-700">Delete <strong>{a.name}</strong>? This removes their portal access permanently.</p>
                                <p className="text-xs text-red-600/80 mt-1 leading-relaxed">Note: The Firebase Auth account can't be deleted from the browser — the email stays registered until you also remove it from Firebase Console → Authentication.</p>
                              </div>
                              <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0" onClick={() => setConfirmDelete(null)}>Cancel</button>
                              <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 flex-shrink-0" onClick={() => handleDelete(a)}>Delete</button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}

              {!loading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <MdSupervisedUserCircle size={36} className="text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">{isFiltered ? 'No accounts match your filter.' : 'No accounts found.'}</p>
                  {isFiltered ? (
                    <button onClick={clearAll} className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">Clear filters</button>
                  ) : (
                    <button onClick={() => setModal('add')} className="mt-3 btn-primary text-sm inline-flex items-center gap-1.5"><MdAdd size={15} /> Add First Account</button>
                  )}
                </div>
              )}
            </div>
          </div>{/* /roster */}
        </div>{/* /two-pane grid */}

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
