import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { MdClose, MdLockOutline } from 'react-icons/md'
import { auth } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { useEscapeKey } from '../hooks/useEscapeKey'

/**
 * Step-up re-authentication prompt (docs/session-timeout-and-terms-plan.md).
 * Confirms the account owner is present before a high-stakes action (GL-issuing
 * approval, approval reversal) by re-entering the password. Staff-facing →
 * English only. Drive it with useStepUpAuth: <ReauthModal {...reauthProps} />.
 */
export default function ReauthModal({
  open, onSuccess, onClose,
  title = 'Confirm it’s you',
  description = 'For your security, re-enter your password to continue with this action.',
}) {
  const { user } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeKey(onClose, !!open && !busy)

  if (!open) return null

  const close = () => { setPassword(''); setError(''); onClose() }

  const submit = async (e) => {
    e?.preventDefault?.()
    if (busy || !password) return
    setBusy(true); setError('')
    try {
      const cred = EmailAuthProvider.credential(user.email, password)
      await reauthenticateWithCredential(auth.currentUser, cred)
      setPassword('')
      onSuccess()
    } catch (err) {
      setError(
        err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential'
          ? 'Incorrect password. Please try again.'
          : 'Could not verify. Please try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
         role="dialog" aria-modal="true" aria-labelledby="reauth-title">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <MdLockOutline size={18} />
            </span>
            <h2 id="reauth-title" className="text-base font-semibold text-gray-900">{title}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            <MdClose size={18} />
          </button>
        </div>

        <p className="mt-3 text-sm text-gray-600">{description}</p>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => { setPassword(e.target.value); if (error) setError('') }}
          placeholder="Password"
          autoComplete="current-password"
          className="mt-4 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy || !password}
          className="mt-4 h-11 w-full rounded-xl bg-brand-500 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60">
          {busy ? 'Verifying…' : 'Confirm'}
        </button>
      </form>
    </div>
  )
}
