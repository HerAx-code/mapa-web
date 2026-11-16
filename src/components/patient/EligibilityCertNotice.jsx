// The patient's signed Certificate of Eligibility (2026-11-16): shown once the
// hospital uploads the signed, stamped scan. Agencies may still ask for the
// paper original, so the copy says to bring it.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { doc, getDoc } from 'firebase/firestore'
import { MdVerifiedUser, MdOpenInNew } from 'react-icons/md'
import toast from 'react-hot-toast'
import { db } from '../../firebase'
import { openSignedScan } from '../../utils/signedScan'

export default function EligibilityCertNotice({ request }) {
  const { t } = useTranslation()
  const [opening, setOpening] = useState(false)
  const pointer = request?.eligibilityCert
  if (!pointer?.id || pointer.status !== 'signed') return null

  const open = async () => {
    setOpening(true)
    try {
      const snap = await getDoc(doc(db, 'eligibilityCertificates', pointer.id))
      if (!snap.exists() || !openSignedScan(snap.data().signed)) toast.error(t('patient.coe.openFailed'))
    } catch {
      toast.error(t('patient.coe.openFailed'))
    } finally { setOpening(false) }
  }

  return (
    <div className="card p-4 flex items-start gap-3">
      <MdVerifiedUser size={22} className="text-green-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{t('patient.coe.title')}</p>
        <p className="text-xs text-gray-500 mt-0.5">{t('patient.coe.number', { no: pointer.controlNo })}</p>
        <p className="text-xs text-gray-600 mt-1.5">{t('patient.coe.bringOriginal')}</p>
      </div>
      <button className="flex-shrink-0 inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg text-sm font-medium text-brand-700 border border-brand-200 hover:bg-brand-50"
        disabled={opening} onClick={open}>
        <MdOpenInNew size={15} /> {t('patient.coe.view')}
      </button>
    </div>
  )
}
