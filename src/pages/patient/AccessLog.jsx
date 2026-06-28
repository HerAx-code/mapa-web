import { useTranslation } from 'react-i18next'
import Layout from '../../components/Layout'
import PatientAccessLog from '../../components/patient/PatientAccessLog'

/**
 * Patient access-log page (R37).
 *
 * Surfaces the auditLog entries scoped to the current patient. Hosted as
 * its own route (rather than embedded in More) so the dedicated breadcrumb
 * "Who has accessed your record" reinforces the data-privacy framing.
 */
export default function PatientAccessLogPage() {
  const { t } = useTranslation()
  return (
    <Layout breadcrumb={t('shell.accessLog.title')}>
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-3xl">
        <div className="mb-5">
          <h1 className="page-title">{t('shell.accessLog.title')}</h1>
          <p className="page-sub">
            {t('shell.accessLog.subtitle')}
          </p>
        </div>

        <PatientAccessLog />
      </div>
    </Layout>
  )
}
