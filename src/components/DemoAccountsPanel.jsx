import { useEffect, useState } from 'react'
import { MdWarning } from 'react-icons/md'
import { ROLE_LABEL_SHORT } from '../utils/constants'

// DEV ONLY — one-click sign-in for local development.
//
// Where the accounts come from, in order:
//   1. demo-accounts.local.json at the repo root — YOUR private list of real
//      test logins (gitignored, never committed; shape in
//      demo-accounts.local.example.json). Use this when your local app points
//      at a real project such as production.
//   2. scripts/demo-accounts.js — the published demo list that
//      scripts/bootstrap-users.js seeds. Only works on a database seeded by it
//      (an emulator / dev project), never on production.
//
// Render this only behind a build-time flag (see Login.jsx): both sources are
// loaded lazily inside that guard, so a production build (flag off) drops them
// and no password ships to users.

// Vite resolves this at build time; {} when the private file doesn't exist.
const LOCAL_FILES = import.meta.glob('/demo-accounts.local.json', { import: 'default' })

export async function loadDemoAccounts() {
  const local = Object.values(LOCAL_FILES)[0]
  if (local) {
    const data = await local()
    return { source: 'local', accounts: Array.isArray(data?.accounts) ? data.accounts : [] }
  }
  const { USERS } = await import('../../scripts/demo-accounts.js')
  return {
    source: 'seeded',
    accounts: USERS.map((u) => ({
      email: u.email, password: u.password, role: u.profile.role,
      agencyId: u.profile.agencyId, active: u.profile.active, loginPanel: u.loginPanel,
    })),
  }
}

// Display order: the network first, then a hospital, then agencies, then the patient.
const GROUPS = [
  { key: 'network',  label: 'Network',  roles: ['platform_admin'] },
  { key: 'hospital', label: 'Hospital', roles: ['super_admin', 'staff_admin'] },
  { key: 'agency',   label: 'Agencies', roles: ['agency_admin', 'agency'] },
  { key: 'patient',  label: 'Patient',  roles: ['patient'] },
]

const AGENCY_NAMES = { doh: 'DOH', ambag: 'AMBaG', pcso: 'PCSO', dswd: 'DSWD', philhealth: 'PhilHealth', malasakit: 'Malasakit' }

const titleFor = (a) => {
  if (a.agencyId) {
    const agency = a.agencyName || AGENCY_NAMES[a.agencyId] || a.agencyId
    return `${agency} · ${a.role === 'agency_admin' ? 'Admin' : 'Coordinator'}`
  }
  return ROLE_LABEL_SHORT[a.role] ?? a.role
}

export default function DemoAccountsPanel({ onPick, busy = false, load = loadDemoAccounts }) {
  const [state, setState] = useState(null)

  useEffect(() => {
    let alive = true
    load()
      .then((res) => {
        if (!alive) return
        // Hide accounts that can't sign in (active:false) or are switched off
        // (loginPanel:false), and anything without a role or email.
        setState({ ...res, accounts: res.accounts.filter((a) => a.email && a.role && a.active !== false && a.loginPanel !== false) })
      })
      .catch((err) => { console.warn('[DemoAccountsPanel] could not load accounts:', err); if (alive) setState({ source: 'none', accounts: [] }) })
    return () => { alive = false }
  }, [load])

  if (!state) return null
  return (
    <div className="mt-8 card p-4 border border-amber-200 bg-amber-50">
      <p className="text-xs font-medium text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
        <MdWarning size={13} aria-hidden="true" /> Demo accounts — dev only
      </p>
      <p className="text-xs text-amber-800/80 mt-1 mb-3">
        {state.source === 'local'
          ? 'Your private list (demo-accounts.local.json). Accounts without a saved password just fill in the email.'
          : 'Seeded demo list — works only on a database seeded by scripts/bootstrap-users.js. For a real project, create demo-accounts.local.json.'}
      </p>
      {state.accounts.length === 0 && <p className="text-xs text-amber-900">No accounts to show.</p>}
      <div className="space-y-3">
        {GROUPS.map((g) => {
          const list = state.accounts.filter((a) => g.roles.includes(a.role))
          if (!list.length) return null
          return (
            <div key={g.key}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/70 mb-1.5">{g.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {list.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    disabled={busy}
                    className="text-left px-3 py-2 min-h-[44px] rounded-lg bg-white hover:bg-brand-50 hover:text-brand-700 transition-colors text-xs border border-amber-100 disabled:opacity-60"
                    onClick={() => onPick(a.email, a.password || '')}>
                    <p className="font-medium truncate">
                      {titleFor(a)}{a.label ? <span className="font-normal text-gray-500"> · {a.label}</span> : null}
                    </p>
                    <p className="text-gray-500 truncate">{a.email}{a.password ? '' : ' · enter password'}</p>
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
