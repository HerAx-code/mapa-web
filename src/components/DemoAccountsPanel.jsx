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

// One dropdown option's text: "Hospital Admin · CRMC Hospital Admin — admin@crmc.gov.ph".
const optionText = (a) =>
  `${titleFor(a)}${a.label ? ` · ${a.label}` : ''} — ${a.email}${a.password ? '' : ' (no saved password)'}`

export default function DemoAccountsPanel({ onPick, busy = false, load = loadDemoAccounts }) {
  const [state, setState] = useState(null)
  const [email, setEmail] = useState('')

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
  // One compact dropdown (grouped by role) + one button, so a long account list
  // doesn't stretch the sign-in page.
  const picked = state.accounts.find((a) => a.email === email) ?? null
  return (
    <div className="mt-8 card p-3 border border-amber-200 bg-amber-50">
      <label htmlFor="demo-account" className="text-xs font-medium text-amber-800 uppercase tracking-wide flex items-center gap-1.5"
        title={state.source === 'local'
          ? 'Your private list (demo-accounts.local.json). Accounts without a saved password just fill in the email.'
          : 'Seeded demo list — works only on a database seeded by scripts/bootstrap-users.js. For a real project, create demo-accounts.local.json.'}>
        <MdWarning size={13} aria-hidden="true" /> Demo accounts — dev only
        <span className="normal-case font-normal text-amber-800/70">({state.source === 'local' ? 'your private list' : 'seeded list'})</span>
      </label>
      {state.accounts.length === 0 ? (
        <p className="text-xs text-amber-900 mt-2">No accounts to show.</p>
      ) : (
        <>
        <div className="mt-2 flex gap-2">
          <select id="demo-account" className="input text-sm min-h-[44px] flex-1 min-w-0" value={email}
            onChange={(e) => {
              const value = e.target.value
              setEmail(value)
              // Picking an account copies its email + password into the login
              // fields above (no auto sign-in — press Sign in yourself).
              const a = state.accounts.find((x) => x.email === value)
              if (a) onPick(a.email, a.password || '')
            }} disabled={busy}>
            <option value="">Choose an account…</option>
            {GROUPS.map((g) => {
              const list = state.accounts.filter((a) => g.roles.includes(a.role))
              if (!list.length) return null
              return (
                <optgroup key={g.key} label={g.label}>
                  {list.map((a) => <option key={a.email} value={a.email}>{optionText(a)}</option>)}
                </optgroup>
              )
            })}
          </select>
          {/* Re-fill the login fields from the current pick (handy after editing
              them, or re-selecting the same account). Never signs in. */}
          <button type="button" disabled={busy || !picked}
            className="btn-secondary text-sm min-h-[44px] px-4 flex-shrink-0 disabled:opacity-60"
            onClick={() => picked && onPick(picked.email, picked.password || '')}>
            Fill
          </button>
        </div>
        <p className="mt-2 text-xs text-amber-800/80">Choosing an account fills the email and password above — then press <strong>Sign in</strong>.</p>
        </>
      )}
    </div>
  )
}
