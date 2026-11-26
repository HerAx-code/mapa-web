import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { sendEmailVerification } from 'firebase/auth'
import { MdMarkEmailUnread, MdRefresh } from 'react-icons/md'
import { auth } from '../../firebase'

// Shown on the filing page to a patient whose email isn't confirmed yet
// (registration research 2026-11-24; see src/utils/emailConfirm.js). The rules
// refuse a new request from such an account, so this explains why, resends the
// link and re-checks once the patient has opened it.
const RESEND_WAIT_S = 60

export default function ConfirmEmailCard({ email, onConfirmed }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState('') // '' | 'send' | 'check'
  const [wait, setWait] = useState(0)
  const [note, setNote] = useState(null) // { tone: 'ok' | 'warn', text }
  const onConfirmedRef = useRef(onConfirmed)
  onConfirmedRef.current = onConfirmed

  useEffect(() => {
    if (wait <= 0) return undefined
    const id = setTimeout(() => setWait(w => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  // Auto-detect an already-confirmed email on mount: the patient may have
  // opened the link in another tab, or an admin may have marked it verified.
  // reload() refreshes currentUser without reminting the ID token the rules
  // read, so force a fresh token (getIdToken(true)) before advancing — then the
  // patient never has to click when it's already done. Runs once.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!auth.currentUser) return
      try {
        await auth.currentUser.reload()
        if (!cancelled && auth.currentUser.emailVerified) {
          await auth.currentUser.getIdToken(true)
          if (!cancelled) onConfirmedRef.current?.()
        }
      } catch { /* offline — the manual "I've confirmed" button still works */ }
    })()
    return () => { cancelled = true }
  }, [])

  const resend = async () => {
    if (!auth.currentUser || busy || wait > 0) return
    setBusy('send'); setNote(null)
    try {
      await sendEmailVerification(auth.currentUser)
      setNote({ tone: 'ok', text: t('patient.emailConfirm.sent', { email }) })
      setWait(RESEND_WAIT_S)
    } catch (err) {
      setNote({ tone: 'warn', text: err?.code === 'auth/too-many-requests' ? t('patient.emailConfirm.tooMany') : t('patient.emailConfirm.sendFailed') })
      if (err?.code === 'auth/too-many-requests') setWait(RESEND_WAIT_S)
    } finally {
      setBusy('')
    }
  }

  const check = async () => {
    if (!auth.currentUser || busy) return
    setBusy('check'); setNote(null)
    try {
      await auth.currentUser.reload()
      if (auth.currentUser.emailVerified) {
        // A fresh token carries email_verified, which the rules read.
        await auth.currentUser.getIdToken(true)
        onConfirmed?.()
      } else {
        setNote({ tone: 'warn', text: t('patient.emailConfirm.notYet') })
      }
    } catch {
      setNote({ tone: 'warn', text: t('patient.emailConfirm.checkFailed') })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="card p-6 sm:p-8 space-y-4">
      <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center mx-auto">
        <MdMarkEmailUnread size={30} className="text-brand-600" aria-hidden="true" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-lg font-bold text-gray-900">{t('patient.emailConfirm.title')}</h2>
        <p className="text-sm text-gray-600 leading-relaxed">{t('patient.emailConfirm.body')}</p>
        <p className="text-sm font-semibold text-gray-900 break-all">{email}</p>
      </div>
      <ol className="space-y-1.5 text-sm text-gray-700 list-decimal pl-5">
        <li>{t('patient.emailConfirm.step1')}</li>
        <li>{t('patient.emailConfirm.step2')}</li>
        <li>{t('patient.emailConfirm.step3')}</li>
      </ol>
      {note && (
        <p role="status" className={`rounded-xl px-3.5 py-2.5 text-sm ${note.tone === 'ok' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
          {note.text}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button type="button" className="btn-primary w-full min-h-[44px] text-sm flex items-center justify-center gap-2"
          onClick={check} disabled={!!busy}>
          <MdRefresh size={18} aria-hidden="true" />
          {busy === 'check' ? t('patient.emailConfirm.checking') : t('patient.emailConfirm.check')}
        </button>
        <button type="button" className="btn-secondary w-full min-h-[44px] text-sm"
          onClick={resend} disabled={!!busy || wait > 0}>
          {busy === 'send' ? t('patient.emailConfirm.sending')
            : wait > 0 ? t('patient.emailConfirm.resendIn', { s: wait })
            : t('patient.emailConfirm.resend')}
        </button>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{t('patient.emailConfirm.wrongEmail')}</p>
    </div>
  )
}
