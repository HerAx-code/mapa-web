import { useEffect, useState } from 'react'
import { MdWarning } from 'react-icons/md'
import { ROLE_LABEL_SHORT } from '../utils/constants'

// DEV ONLY — one-click sign-in as any demo account. The list is the SAME one
// scripts/bootstrap-users.js seeds (scripts/demo-accounts.js), so the buttons
// can never drift from the accounts that exist again.
//
// Render this only behind a build-time flag (see Login.jsx): the list is
// loaded with a dynamic import inside that guard, so a production build
// (flag off) drops it entirely and no demo password ships to users.

// Display order: the network first, then a hospital, then agencies, then the patient.
const GROUPS = [
  { key: 'network',  label: 'Network',  roles: ['platform_admin'] },
  { key: 'hospital', label: 'Hospital', roles: ['super_admin', 'staff_admin'] },
  { key: 'agency',   label: 'Agencies', roles: ['agency_admin', 'agency'] },
  { key: 'patient',  label: 'Patient',  roles: ['patient'] },
]

const AGENCY_NAMES = { doh: 'DOH', ambag: 'AMBaG', pcso: 'PCSO', dswd: 'DSWD', philhealth: 'PhilHealth', malasakit: 'Malasakit' }

const labelFor = (u) => {
  const role = ROLE_LABEL_SHORT[u.profile.role] ?? u.profile.role
  if (u.profile.agencyId) return `${AGENCY_NAMES[u.profile.agencyId] ?? u.profile.agencyId} · ${u.profile.role === 'agency_admin' ? 'Admin' : 'Coordinator'}`
  return role
}

export default function DemoAccountsPanel({ onPick, busy = false }) {
  const [users, setUsers] = useState(null)

  useEffect(() => {
    let alive = true
    import('../../scripts/demo-accounts.js')
      .then(({ USERS }) => {
        if (!alive) return
        // Hide accounts that can't sign in (active:false) or whose agency is
        // switched off as a funder (loginPanel:false).
        setUsers(USERS.filter((u) => u.profile.active !== false && u.loginPanel !== false))
      })
      .catch((err) => { console.warn('[DemoAccountsPanel] could not load demo accounts:', err); if (alive) setUsers([]) })
    return () => { alive = false }
  }, [])

  if (!users) return null
  return (
    <div className="mt-8 card p-4 border border-amber-200 bg-amber-50">
      <p className="text-xs font-medium text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
        <MdWarning size={13} aria-hidden="true" /> Demo accounts — dev only
      </p>
      <p className="text-xs text-amber-800/80 mt-1 mb-3">Click one to sign in. Seeded by scripts/bootstrap-users.js.</p>
      <div className="space-y-3">
        {GROUPS.map((g) => {
          const list = users.filter((u) => g.roles.includes(u.profile.role))
          if (!list.length) return null
          return (
            <div key={g.key}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/70 mb-1.5">{g.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {list.map((u) => (
                  <button
                    key={u.email}
                    type="button"
                    disabled={busy}
                    className="text-left px-3 py-2 min-h-[44px] rounded-lg bg-white hover:bg-brand-50 hover:text-brand-700 transition-colors text-xs border border-amber-100 disabled:opacity-60"
                    onClick={() => onPick(u.email, u.password)}>
                    <p className="font-medium truncate">{labelFor(u)}</p>
                    <p className="text-gray-500 truncate">{u.email}</p>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
