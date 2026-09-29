import { useTranslation } from 'react-i18next'
import Layout from '../../components/Layout'
import PatientPage from '../../components/patient/PatientPage'
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
      <PatientPage width="narrow">
        <div className="mb-5">
          <h1 className="page-title">{t('shell.accessLog.title')}</h1>
          <p className="page-sub">
            {t('shell.accessLog.subtitle')}
          </p>
        </div>

        <PatientAccessLog />
      </PatientPage>
    </Layout>
  )
}
