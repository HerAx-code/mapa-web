import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { auth } from '../../firebase'
import { needsEmailConfirm } from '../../utils/emailConfirm'
import ConfirmEmailCard from '../../components/patient/ConfirmEmailCard'

/**
 * Hard email-confirmation gate (owner decision 2026-11-26). A patient whose
 * email isn't confirmed is held here and blocked from every other patient page
 * by PrivateRoute; this is the only screen they can reach until they confirm.
 * Scoped to post-cutoff accounts (needsEmailConfirm), so existing patients never
 * land here. The card itself is shared with the filing-page gate and auto-checks
 * on mount, so a patient who opened the link elsewhere advances without a tap.
 */
export default function VerifyEmail() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()

  if (!user) return <Navigate to="/login" replace />

  // Already confirmed (or not a gated patient): nothing to do here.
  if (!needsEmailConfirm(user, auth.currentUser)) {
    const home = user.role === 'patient'
      ? (user.tenantId ? '/patient/request' : '/patient/hospitals')
      : '/'
    return <Navigate to={home} replace />
  }

  const onConfirmed = () =>
    navigate(user.tenantId ? '/patient/request' : '/patient/hospitals', { replace: true })

  // Escape hatch for a typo'd or unreachable address: sign out so the patient
  // can register again with a working email. logout() reloads the app, which
  // lands on /login (no session) — the hard block's release valve.
  const startOver = async () => { await logout() }

  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <ConfirmEmailCard email={user?.email || auth.currentUser?.email || ''} onConfirmed={onConfirmed} />
        <button
          type="button"
          onClick={startOver}
          className="mt-4 w-full min-h-[44px] text-sm text-gray-500 underline underline-offset-2"
        >
          {t('patient.emailConfirm.startOver')}
        </button>
      </div>
    </div>
  )
}
