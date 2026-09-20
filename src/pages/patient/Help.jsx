import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MdArrowBack, MdEmail, MdFlag, MdAdd, MdRemove } from 'react-icons/md'
import Layout from '../../components/Layout'
import ProfileModals from '../../components/ProfileModals'
import { useAuth } from '../../contexts/AuthContext'

const SUPPORT_EMAIL = 'support@crmc.gov.ph'

/**
 * Patient Help & support page (R-mobile-settings).
 *
 * Was a modal (ProfileModals HelpModal). The FAQ accordion needs room to
 * expand and the two support actions read better as full-width rows on a
 * page than stacked in a sheet. Patient FAQs come from i18n (bilingual);
 * "Report a problem" still opens the shared, tested ReportModal — the page
 * mounts it locally so the report form isn't duplicated.
 */
export default function PatientHelp() {
  const navigate     = useNavigate()
  const { user }     = useAuth()
  const { t, i18n }  = useTranslation()
  const [open, setOpen]   = useState(null)
  const [modal, setModal] = useState(null)

  // Patient FAQs from i18n (returnObjects → array). This page is a
  // patient-only route, so no staff FAQ branching is needed.
  const faqs = i18n.t('profile.help.patientFaqs', { returnObjects: true }) || []

  const handleEmailSupport = () => {
    window.location.href = [
      `mailto:${SUPPORT_EMAIL}`,
      '?subject=MAPA Support Request',
      '&body=Please describe your issue below:%0A%0A',
    ].join('')
  }

  return (
    <Layout breadcrumb={t('profile.help.title')}>
      <ProfileModals activeModal={modal} onSetModal={setModal} onClose={() => setModal(null)} />

      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-3xl">

        {/* Header + back to More */}
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={() => navigate('/patient/more')}
            aria-label={t('profile.help.title')}
            className="w-9 h-9 -ml-1 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0">
            <MdArrowBack size={20} />
          </button>
          <h1 className="font-display text-[26px] font-bold tracking-tight text-gray-900">
            {t('profile.help.title')}
          </h1>
        </div>

        {/* FAQ accordion */}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest px-1 mb-2">
          {t('profile.help.faqTitle')}
        </p>
        <div className="card divide-y divide-gray-100 mb-6">
          {faqs.map((faq, i) => (
            <div key={i}>
              <button
                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}>
                <span className="text-sm font-medium text-gray-800">{faq.q}</span>
                <span className="text-gray-400 flex-shrink-0">
                  {open === i ? <MdRemove size={18} /> : <MdAdd size={18} />}
                </span>
              </button>
              {open === i && (
                <div className="px-4 pb-4 -mt-1 text-sm text-gray-600 leading-relaxed">{faq.a}</div>
              )}
            </div>
          ))}
        </div>

        {/* Still need help */}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest px-1 mb-2">
          {t('profile.help.stillNeedHelp')}
        </p>
        <div className="card divide-y divide-gray-100">
          {/* Email support */}
          <button
            onClick={handleEmailSupport}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <MdEmail className="text-blue-500" size={18} />
            </div>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-gray-800">{t('profile.help.emailSupport')}</span>
              <span className="block text-xs text-gray-400 truncate">{SUPPORT_EMAIL}</span>
            </span>
            <span className="text-xs text-blue-500 font-medium flex-shrink-0">{t('profile.help.openLink')} →</span>
          </button>

          {/* Report a problem — opens the shared ReportModal */}
          <button
            onClick={() => setModal('report')}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left">
            <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <MdFlag className="text-amber-500" size={18} />
            </div>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-gray-800">{t('profile.help.submitTicket')}</span>
              <span className="block text-xs text-gray-400">{t('profile.help.submitTicketDesc')}</span>
            </span>
            <span className="text-xs text-amber-500 font-medium flex-shrink-0">{t('profile.help.openLink')} →</span>
          </button>
        </div>

      </div>
    </Layout>
  )
}
