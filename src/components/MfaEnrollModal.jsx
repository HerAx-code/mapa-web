import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { MdClose, MdShield, MdCheckCircle, MdContentCopy, MdCheck } from 'react-icons/md'
import toast from 'react-hot-toast'
import { auth } from '../firebase'
import {
  isMfaEnrolled, reauthWithPassword, startTotpEnrollment,
  completeTotpEnrollment, unenrollTotp,
} from '../utils/mfa'

// Two-step verification (TOTP) setup for staff. Staff surface → English only.
// Flow: re-authenticate with the password → scan the QR / enter the key in an
// authenticator app → confirm a 6-digit code → enrolled. Also supports removal.
export default function MfaEnrollModal({ onClose }) {
  const fbUser = auth.currentUser
  const alreadyEnrolled = isMfaEnrolled(fbUser)

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
    if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential')
      setError('Incorrect password.')
    else if (err?.code === 'auth/invalid-verification-code' || err?.code === 'auth/invalid-payload')
      setError('That code did not match. Check your authenticator app and try again.')
    else if (err?.code === 'auth/unsupported-first-factor' || err?.code === 'auth/operation-not-allowed')
      setError('Two-step verification is not enabled on this project yet. Ask the administrator to turn on TOTP in Firebase.')
    else setError(fallback)
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
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MdShield size={18} className="text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">Two-step verification</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

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
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Manual entry key</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 break-all font-mono text-sm text-gray-800">{sharedKey}</code>
                  <button type="button" onClick={copyKey} className="text-gray-400 hover:text-brand-600">
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

          {step === 'manage' && (
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
        </div>
      </div>
    </div>
  )
}
