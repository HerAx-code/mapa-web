import { useNavigate } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { MdArrowBack, MdHistory, MdChevronRight } from 'react-icons/md'
import Layout from '../../components/Layout'

/**
 * Patient Privacy notice page (R-mobile-settings).
 *
 * Was a modal (ProfileModals SettingsModal). On a phone the policy is
 * long enough that an end-anchored sheet felt cramped and the patient
 * lost the page they came from; a real page gives natural scroll + a
 * hardware-back that returns to More. Content still comes from the shared
 * profile.privacy.* keys, so the staff modal and this page stay in sync.
 *
 * Data portability (the export) used to live at the bottom of this modal.
 * It's now its own "Download my data" row in More, one tap from the menu,
 * because burying a legal right under a wall of policy text made it
 * effectively invisible. This page keeps a pointer to the access log.
 */
export default function PrivacyNotice() {
  const navigate = useNavigate()
  const { t }    = useTranslation()

  const sections = [
    { title: t('profile.privacy.dataTitle'),      items: [t('profile.privacy.data1'), t('profile.privacy.data2'), t('profile.privacy.data3'), t('profile.privacy.data4'), t('profile.privacy.data5'), t('profile.privacy.data6')] },
    { title: t('profile.privacy.useTitle'),       items: [t('profile.privacy.use1'), t('profile.privacy.use2'), t('profile.privacy.use3'), t('profile.privacy.use4'), t('profile.privacy.use5')] },
    { title: t('profile.privacy.accessTitle'),    items: [t('profile.privacy.access1'), t('profile.privacy.access2'), t('profile.privacy.access3'), t('profile.privacy.access4')] },
    { title: t('profile.privacy.retentionTitle'), items: [t('profile.privacy.retention1'), t('profile.privacy.retention2'), t('profile.privacy.retention3')] },
  ]
  const rights = [
    t('profile.privacy.right1'), t('profile.privacy.right2'), t('profile.privacy.right3'),
    t('profile.privacy.right4'), t('profile.privacy.right5'), t('profile.privacy.right6'),
  ]

  return (
    <Layout breadcrumb={t('profile.privacy.title')}>
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-3xl">

        {/* Header + back to More */}
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={() => navigate('/patient/more')}
            aria-label={t('profile.privacy.title')}
            className="w-9 h-9 -ml-1 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0">
            <MdArrowBack size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-bold tracking-tight text-gray-900 leading-tight">
              {t('profile.privacy.title')}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">{t('profile.privacy.updated')}</p>
          </div>
        </div>

        {/* Intro */}
        <div className="card p-4 mb-5">
          <p className="text-sm text-gray-600 leading-relaxed">
            <Trans i18nKey="profile.privacy.intro" components={{ b: <strong className="text-gray-800" /> }} />
          </p>
        </div>

        {/* Policy sections */}
        <div className="card divide-y divide-gray-100 mb-5">
          {sections.map((section, i) => (
            <div key={i} className="p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
                {section.title}
              </p>
              <ul className="space-y-2">
                {section.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm text-gray-600 leading-relaxed">
                    <span className="text-brand-400 flex-shrink-0 mt-1.5 w-1 h-1 rounded-full bg-brand-400" aria-hidden="true" />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Patient rights — RA 10173 §16 */}
        <div className="card p-4 mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
            {t('profile.privacy.rightsTitle')}
          </p>
          <ul className="space-y-2">
            {rights.map((right, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600 leading-relaxed">
                <span className="text-brand-400 flex-shrink-0 mt-1.5 w-1 h-1 rounded-full bg-brand-400" aria-hidden="true" />
                <span className="min-w-0">{right}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Access log cross-link — the "right to know who accessed my
            record" is easier to exercise as a live list than as policy
            prose, so point at it directly. */}
        <button
          onClick={() => navigate('/patient/access-log')}
          className="w-full card p-4 mb-5 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors">
          <div className="w-9 h-9 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <MdHistory size={18} className="text-brand-500" />
          </div>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-gray-800">{t('patient.more.whoAccessed')}</span>
          </span>
          <MdChevronRight size={18} className="text-gray-300 flex-shrink-0" />
        </button>

        {/* Contact */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-sm text-blue-800 leading-relaxed">
            <Trans i18nKey="profile.privacy.contact" components={{ b: <strong /> }} />
          </p>
        </div>

      </div>
    </Layout>
  )
}
