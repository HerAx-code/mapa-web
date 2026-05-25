import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MdSignalWifiOff } from 'react-icons/md'

/**
 * Shows a thin amber banner whenever navigator.onLine is false.
 *
 * Patients on flaky mobile connections need to know when a submit will
 * fail BEFORE they tap it — otherwise they tap the button, see no
 * feedback, and start tapping again. With the banner up, the user
 * understands the system is in a degraded state.
 *
 * Note: this banner only covers connectivity. Firestore's local cache
 * still serves previously-loaded data, so reads continue to work.
 * Write operations (registration, apply, upload) are the things that
 * actually fail offline — those each show their own toast on failure.
 */
export default function OfflineBanner() {
  const { t } = useTranslation()
  // Start in the current state — avoids a one-frame flash if the page
  // loaded while offline.
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    const goOnline  = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2 flex-shrink-0 print:hidden">
      <MdSignalWifiOff size={16} className="text-amber-600 flex-shrink-0" />
      <p className="text-sm text-amber-700 leading-snug">
        {t('pwa.offlineBanner.message')}
      </p>
    </div>
  )
}