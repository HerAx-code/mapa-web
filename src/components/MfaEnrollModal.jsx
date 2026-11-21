import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { MdClose, MdShield, MdCheckCircle, MdContentCopy, MdCheck, MdMailOutline } from 'react-icons/md'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useFocusTrap } from '../hooks/useFocusTrap'
import toast from 'react-hot-toast'
import { sendEmailVerification } from 'firebase/auth'
import { auth } from '../firebase'
import {
  isMfaEnrolled, reauthWithPassword, startTotpEnrollment,
  completeTotpEnrollment, unenrollTotp, MFA_UNAVAILABLE_CODES, MFA_MODE,
} from '../utils/mfa'

// Two-step verification (TOTP) setup for staff. Staff surface → English only.
// Flow: re-authenticate with the password → scan the QR / enter the key in an
// authenticator app → confirm a 6-digit code → enrolled. Also supports removal.
//
// `required` (Phase 1, P1-C stage 1 — components/MfaGate.jsx): staff must set
// it up to continue, so the dialog can't be closed and removal isn't offered.
// Two exits remain: sign out, or — only when the project itself doesn't offer
// two-factor — `onUnavailable`, so staff are never locked out by a config gap.
export default function MfaEnrollModal({ onClose, required = false, onUnavailable, onSignOut }) {
  const fbUser = auth.currentUser
  const alreadyEnrolled = isMfaEnrolled(fbUser)
  // While two-factor is required for staff, nobody removes it themselves.
  const removable = !required && MFA_MODE !== 'required'
  const panelRef = useRef(null)
  useEscapeKey(required ? () => {} : onClose)
  useFocusTrap(panelRef, true)

  // steps: 'reauth' → 'setup' → 'done'; or 'manage' when already enrolled.
  const [step, setStep]       = useState(alreadyEnrolled ? 'manage' : 'reauth')
  const [password, setPassword] = useState('')
  const [code, setCode]       = useState('')
  const [secret, setSecret]   = useState(null)
  const [qrUrl, setQrUrl]     = useState('')
  const [qrImg, setQrImg]     = useState('')
  const [sharedKey, setSharedKey] = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)
  const [verifySent, setVerifySent] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  // Render the otpauth URL to a QR image once we have one.
  useEffect(() => {
    if (!qrUrl) return
    let live = true
    QRCode.toDataURL(qrUrl, { margin: 1, width: 200 })
      .then((url) => { if (live) setQrImg(url) })
      .catch(() => {})
    return () => { live = false }
  }, [qrUrl])

  const fail = (err, fallback) => {
    console.warn('[mfa]', err?.code || err?.message)
    const code = err?.code || ''
    if (required && MFA_UNAVAILABLE_CODES.includes(code)) setUnavailable(true)
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential')
      setError('Incorrect password.')
    else if (code === 'auth/invalid-verification-code' || code === 'auth/invalid-payload')
      setError('That code did not match. Check your authenticator app and try again.')
    else if (code === 'auth/unsupported-first-factor' || code === 'auth/operation-not-allowed')
      setError('Two-step verification is not enabled on this project yet. Ask the administrator to turn on TOTP in Firebase.')
    else if (code === 'auth/unverified-email' || code === 'auth/email-not-verified')
      // Firebase requires a verified email before MFA enrolment.
      setStep('verify-email')
    else
      // Surface the actual code so an unexpected failure is diagnosable.
      setError(`${fallback}${code ? ` (${code})` : ''}`)
  }

  const doSendVerification = async () => {
    setError(''); setBusy(true)
    try {
      await sendEmailVerification(fbUser)
      setVerifySent(true)
      toast.success('Verification email sent.')
    } catch (err) {
      fail(err, 'Could not send the verification email.')
    } finally { setBusy(false) }
  }

  // After clicking the link in the verification email.
  const doRecheckEmail = async () => {
    setError(''); setBusy(true)
    try {
      await fbUser.reload()
      if (auth.currentUser?.emailVerified) setStep('reauth')
      else setError('Your email is not verified yet. Open the link in the email, then try again.')
    } catch (err) {
      fail(err, 'Could not check your email.')
    } finally { setBusy(false) }
  }

  const doReauth = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await reauthWithPassword(fbUser, password)
      const { secret: s, qrUrl: url, sharedKey: key } = await startTotpEnrollment(fbUser)
      setSecret(s); setQrUrl(url); setSharedKey(key); setPassword(''); setStep('setup')
    } catch (err) {
      fail(err, 'Could not start setup. Please try again.')
    } finally { setBusy(false) }
  }

  const doEnroll = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await completeTotpEnrollment(fbUser, secret, code)
      setStep('done')
      toast.success('Two-step verification is on.')
    } catch (err) {
      fail(err, 'Could not complete setup. Please try again.')
    } finally { setBusy(false) }
  }

  const doRemove = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await reauthWithPassword(fbUser, password)
      await unenrollTotp(fbUser)
      toast.success('Two-step verification removed.')
      onClose()
    } catch (err) {
      fail(err, 'Could not remove two-step verification.')
    } finally { setBusy(false) }
  }

  const copyKey = () => {
    navigator.clipboard?.writeText(sharedKey)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => {})
  }

  const field = 'h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-[15px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => !required && e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mfa-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MdShield size={18} className="text-brand-500" />
            <h2 id="mfa-modal-title" className="text-base font-semibold text-gray-900">Two-step verification</h2>
          </div>
          {!required && <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-600"><MdClose size={20} /></button>}
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {required && step !== 'done' && (
            <p className="mb-4 text-sm text-gray-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 leading-relaxed">
              Staff accounts need two-step verification before you can continue. It protects the patient records you can open.
            </p>
          )}
          {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          {required && unavailable && (
            <button type="button" onClick={onUnavailable} className="btn-secondary mb-4 w-full">Continue for now</button>
          )}

          {step === 'reauth' && (
            <form onSubmit={doReauth} className="space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                Add a second step to sign-in using an authenticator app (Google Authenticator, Authy, etc.). First, confirm your password.
              </p>
              <input type="password" className={field} placeholder="Your password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              <button type="submit" disabled={busy || !password} className="btn-primary w-full">
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
          )}

          {step === 'verify-email' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-amber-700">
                <MdMailOutline size={18} />
                <p className="text-sm font-semibold">Verify your email first</p>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                Two-step verification requires a verified email address. We'll send a
                verification link to <span className="font-medium text-gray-900">{fbUser?.email}</span>.
                Open it, then reopen this to finish setup.
              </p>
              {verifySent ? (
                <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  Sent. Check your inbox (and spam), click the link, then reopen Two-step verification.
                </p>
              ) : (
                <button type="button" onClick={doSendVerification} disabled={busy} className="btn-primary w-full">
                  {busy ? 'Sending…' : 'Send verification email'}
                </button>
              )}
              {verifySent && (
                <button type="button" onClick={doRecheckEmail} disabled={busy} className="btn-primary w-full">
                  {busy ? 'Checking…' : "I've verified my email"}
                </button>
              )}
              <button type="button" onClick={() => { setStep('reauth'); setError('') }}
                className="w-full text-sm text-gray-500 hover:text-gray-700">Back</button>
            </div>
          )}

          {step === 'setup' && (
            <form onSubmit={doEnroll} className="space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                Scan this QR code in your authenticator app — or enter the key manually — then type the 6-digit code it shows.
              </p>
              <div className="flex justify-center">
                {qrImg
                  ? <img src={qrImg} alt="Authenticator QR code" className="h-48 w-48 rounded-lg border border-gray-100" />
                  : <div className="h-48 w-48 rounded-lg bg-gray-50 animate-pulse" />}
              </div>
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Manual entry key</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 break-all font-mono text-sm text-gray-800">{sharedKey}</code>
                  <button type="button" onClick={copyKey} className="text-gray-500 hover:text-brand-600">
                    {copied ? <MdCheck size={16} className="text-brand-500" /> : <MdContentCopy size={16} />}
                  </button>
                </div>
              </div>
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} className={`${field} tracking-[0.4em] text-center font-mono`}
                placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full">
                {busy ? 'Verifying…' : 'Turn on two-step verification'}
              </button>
            </form>
          )}

          {step === 'done' && (
            <div className="text-center py-4">
              <MdCheckCircle size={44} className="text-green-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-gray-900">You're protected</p>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                Next time you sign in, you'll enter a code from your authenticator app after your password.
              </p>
              <button onClick={onClose} className="btn-primary mt-5 w-full">Done</button>
            </div>
          )}

          {step === 'manage' && !removable && (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm font-medium text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                <MdCheckCircle size={16} /> Two-step verification is on for your account.
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                It's required for staff, so it can't be removed here. If you lost your phone, ask your administrator to reset it.
              </p>
              <button type="button" onClick={onClose} className="btn-primary w-full">Done</button>
            </div>
          )}

          {step === 'manage' && removable && (
            <form onSubmit={doRemove} className="space-y-4">
              <p className="flex items-center gap-2 text-sm font-medium text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                <MdCheckCircle size={16} /> Two-step verification is on for your account.
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                To remove it, confirm your password. (Not recommended — it protects the patient records you can access.)
              </p>
              <input type="password" className={field} placeholder="Your password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="submit" disabled={busy || !password} className="btn-danger w-full">
                {busy ? 'Removing…' : 'Remove two-step verification'}
              </button>
            </form>
          )}

          {required && onSignOut && step !== 'done' && (
            <button type="button" onClick={onSignOut} className="mt-4 w-full text-sm text-gray-500 hover:text-gray-700">Sign out</button>
          )}
        </div>
      </div>
    </div>
  )
}
