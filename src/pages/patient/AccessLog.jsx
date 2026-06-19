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
  return (
    <Layout breadcrumb="Who has accessed your record">
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-3xl">
        <div className="mb-5">
          <h1 className="page-title">Who has accessed your record</h1>
          <p className="page-sub">
            Your rights under RA 10173 — the Data Privacy Act. Every action
            CRMC or a partner agency takes on your case appears here.
          </p>
        </div>

        <PatientAccessLog />
      </div>
    </Layout>
  )
}
