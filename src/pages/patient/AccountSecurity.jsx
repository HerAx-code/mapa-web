import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MdArrowBack, MdEdit, MdLock, MdChevronRight } from 'react-icons/md'
import Layout from '../../components/Layout'
import ProfileModals from '../../components/ProfileModals'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Patient Account & security page (R-mobile-settings).
 *
 * Merges what used to be two separate More-menu rows — "Account settings" and
 * "Change password" — into one surface with a Profile section and a Security
 * section, the way most apps group them. Editing reuses the existing, tested
 * ProfileModals (account + password) rather than duplicating that logic here:
 * the page is the hub, the modals do the writes.
 */
export default function AccountSecurity() {
  const navigate = useNavigate()
  const { t }    = useTranslation()
  const { user } = useAuth()
  const [modal, setModal] = useState(null)

  const fields = [
    { key: 'name',    value: user?.name },
    { key: 'contact', value: user?.contact },
    { key: 'email',   value: user?.email },
    { key: 'address', value: user?.address },
  ]

  return (
    <Layout breadcrumb={t('patient.account.title')}>
      <ProfileModals activeModal={modal} onSetModal={setModal} onClose={() => setModal(null)} />

      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-3xl">

        {/* Header + back to More */}
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={() => navigate('/patient/more')}
            aria-label={t('patient.account.title')}
            className="w-9 h-9 -ml-1 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0">
            <MdArrowBack size={20} />
          </button>
          <h1 className="font-display text-[26px] font-bold tracking-tight text-gray-900">
            {t('patient.account.title')}
          </h1>
        </div>

        {/* Profile — read-only summary, edit opens the account modal */}
        <div className="mb-5">
          <div className="flex items-center justify-between px-1 mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              {t('patient.account.profile')}
            </p>
            <button
              onClick={() => setModal('account')}
              className="flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors">
              <MdEdit size={13} /> {t('patient.account.edit')}
            </button>
          </div>
          <div className="card divide-y divide-gray-50">
            {fields.map(f => (
              <div key={f.key} className="px-4 py-3">
                <p className="text-xs text-gray-400">{t(`patient.account.${f.key}`)}</p>
                <p className="text-sm font-medium text-gray-800 mt-0.5 break-words">
                  {f.value || <span className="text-gray-400 font-normal">{t('patient.account.notSet')}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Security — password lives here, not as a separate menu item */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest px-1 mb-2">
            {t('patient.account.security')}
          </p>
          <div className="card overflow-hidden">
            <button
              onClick={() => setModal('password')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left">
              <div className="w-9 h-9 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <MdLock size={18} className="text-brand-500" />
              </div>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-800">{t('patient.account.changePassword')}</span>
                <span className="block text-xs text-gray-500">{t('patient.account.changePasswordDesc')}</span>
              </span>
              <MdChevronRight size={18} className="text-gray-300 flex-shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}
