import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import { LiveDataProvider } from './contexts/LiveDataContext'
import PrivateRoute from './components/PrivateRoute'
import { ROLES } from './utils/constants'

// Eager imports: auth + landing entry points and the patient dashboard.
// These are the routes a fresh visitor (especially a patient on mobile)
// hits first, so we don't want a Suspense flash for them. Everything
// else is split into per-role chunks below — patients on mobile no
// longer download ~1.5 MB of admin + agency JavaScript they will never
// run.
import Landing            from './pages/auth/Landing'
import Login              from './pages/auth/Login'
import Register           from './pages/auth/Register'
import InstallApp         from './pages/auth/InstallApp'
import PatientDashboard   from './pages/patient/Dashboard'
import NotFound           from './pages/NotFound'

// Lazy imports — separated by surface (patient / agency / admin /
// shared) so Webpack/Vite emits one chunk per group. Vite's
// chunkSplitting then keeps the patient chunk small.
const Seed             = lazy(() => import('./pages/Seed'))
const Notifications    = lazy(() => import('./pages/Notifications'))

// Patient (non-dashboard)
const UserGuide        = lazy(() => import('./pages/patient/Guide'))
const MedicalPrograms  = lazy(() => import('./pages/patient/MedicalPrograms'))
const RequestAssistance = lazy(() => import('./pages/patient/RequestAssistance'))
const IntakeWizard      = lazy(() => import('./pages/patient/IntakeWizard'))
const TrackStatus      = lazy(() => import('./pages/patient/TrackStatus'))
const Interviews       = lazy(() => import('./pages/patient/Interviews'))
const PatientMore      = lazy(() => import('./pages/patient/More'))
const PatientAccessLogPage = lazy(() => import('./pages/patient/AccessLog'))

// Agency
const AgencyDashboard       = lazy(() => import('./pages/agency/Dashboard'))
const SlotManagement        = lazy(() => import('./pages/agency/SlotManagement'))
const Inbox                 = lazy(() => import('./pages/agency/Inbox'))
const ApplicationDetail     = lazy(() => import('./pages/agency/ApplicationDetail'))
const IntakeSheet           = lazy(() => import('./pages/agency/IntakeSheet'))
const GLViewer              = lazy(() => import('./pages/agency/GLViewer'))
const CertificateGenerator  = lazy(() => import('./pages/agency/CertificateGenerator'))
const AgencyProgram         = lazy(() => import('./pages/agency/Program'))
const UploadCertificates    = lazy(() => import('./pages/agency/UploadCertificates'))
const AgencyLogs            = lazy(() => import('./pages/agency/Logs'))
const AgencyFunds           = lazy(() => import('./pages/agency/Funds'))
const AgencyImpact          = lazy(() => import('./pages/agency/Impact'))
const AgencyAllocation      = lazy(() => import('./pages/agency/Allocation'))
const AgencyAuditLog        = lazy(() => import('./pages/agency/AuditLog'))
const AgencyTeam            = lazy(() => import('./pages/agency/Team'))
const AgencyAnnouncements   = lazy(() => import('./pages/agency/Announcements'))
const AgencyGuide           = lazy(() => import('./pages/agency/Guide'))

// Admin
const AdminDashboard   = lazy(() => import('./pages/admin/Dashboard'))
const AdminAnalytics   = lazy(() => import('./pages/admin/Analytics'))
const Requests         = lazy(() => import('./pages/admin/Requests'))
const AdminInterviews  = lazy(() => import('./pages/admin/Interviews'))
const Patients         = lazy(() => import('./pages/admin/Patients'))
const HospitalIDs      = lazy(() => import('./pages/admin/HospitalIDs'))
const Agencies         = lazy(() => import('./pages/admin/Agencies'))
const Accounts         = lazy(() => import('./pages/admin/Accounts'))
const DocTypes         = lazy(() => import('./pages/admin/DocTypes'))
const AssistanceTypes  = lazy(() => import('./pages/admin/AssistanceTypes'))
const AppLogs          = lazy(() => import('./pages/admin/AppLogs'))
const AdminMessages    = lazy(() => import('./pages/admin/Messages'))
const Reports          = lazy(() => import('./pages/admin/Reports'))
const ExportPage       = lazy(() => import('./pages/admin/Export'))
const AddAgency        = lazy(() => import('./pages/admin/AddAgency'))
const AgencyDetail     = lazy(() => import('./pages/admin/AgencyDetail'))
const AuditLog         = lazy(() => import('./pages/admin/AuditLog'))
const Announcements    = lazy(() => import('./pages/admin/Announcements'))
const ExportPreview    = lazy(() => import('./pages/admin/ExportPreview'))
// Funds page removed — CRMC has zero fund authority. Each agency manages
// its own budget via /agency/allocation (Agency Administrator role).

const PATIENT_ROLES = [ROLES.PATIENT]
const AGENCY_ROLES  = [ROLES.AGENCY, ROLES.AGENCY_ADMIN]
const ADMIN_ROLES   = [ROLES.SUPER_ADMIN, ROLES.STAFF_ADMIN]

// Suspense fallback during chunk download. Light placeholder rather
// than a spinner so the transition between routes feels seamless —
// most chunks are <100 KB and load in under 500 ms on 4G.
function RouteLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-10 h-10 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <LiveDataProvider>
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/"         element={<Landing />} />
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/install"  element={<InstallApp />} />
          {import.meta.env.VITE_ENABLE_SEED === 'true' && (
            <Route path="/seed" element={<Seed />} />
          )}
          <Route path="/notifications" element={
            <PrivateRoute allowedRoles={[ROLES.PATIENT, ROLES.AGENCY, ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN, ROLES.STAFF_ADMIN]}>
              <Notifications />
            </PrivateRoute>
          } />

          {/* Patient */}
          <Route path="/patient/dashboard"  element={<PrivateRoute allowedRoles={PATIENT_ROLES}><PatientDashboard /></PrivateRoute>} />
          <Route path="/patient/programs"   element={<PrivateRoute allowedRoles={PATIENT_ROLES}><MedicalPrograms /></PrivateRoute>} />
          <Route path="/patient/request"    element={<PrivateRoute allowedRoles={PATIENT_ROLES}><RequestAssistance /></PrivateRoute>} />
          <Route path="/patient/request/:id/intake" element={<PrivateRoute allowedRoles={PATIENT_ROLES}><IntakeWizard /></PrivateRoute>} />
          <Route path="/patient/status"     element={<PrivateRoute allowedRoles={PATIENT_ROLES}><TrackStatus /></PrivateRoute>} />
          <Route path="/patient/interviews" element={<PrivateRoute allowedRoles={PATIENT_ROLES}><Interviews /></PrivateRoute>} />
          <Route path="/patient/messages"   element={<PrivateRoute allowedRoles={PATIENT_ROLES}><AdminMessages /></PrivateRoute>} />
          <Route path="/patient/guide"      element={<PrivateRoute allowedRoles={PATIENT_ROLES}><UserGuide /></PrivateRoute>} />
          <Route path="/patient/more"       element={<PrivateRoute allowedRoles={PATIENT_ROLES}><PatientMore /></PrivateRoute>} />
          <Route path="/patient/access-log" element={<PrivateRoute allowedRoles={PATIENT_ROLES}><PatientAccessLogPage /></PrivateRoute>} />

          {/* Agency */}
          <Route path="/agency/dashboard"   element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyDashboard /></PrivateRoute>} />
          <Route path="/agency/slots"       element={<PrivateRoute allowedRoles={AGENCY_ROLES}><SlotManagement /></PrivateRoute>} />
          <Route path="/agency/inbox"               element={<PrivateRoute allowedRoles={AGENCY_ROLES}><Inbox /></PrivateRoute>} />
          <Route path="/agency/applications/:id"        element={<PrivateRoute allowedRoles={AGENCY_ROLES}><ApplicationDetail /></PrivateRoute>} />
          <Route path="/agency/applications/:id/intake" element={<PrivateRoute allowedRoles={AGENCY_ROLES}><IntakeSheet /></PrivateRoute>} />
          <Route path="/agency/applications/:id/gl"     element={<PrivateRoute allowedRoles={AGENCY_ROLES}><GLViewer /></PrivateRoute>} />
          <Route path="/agency/messages"    element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AdminMessages /></PrivateRoute>} />
          <Route path="/agency/generator"   element={<PrivateRoute allowedRoles={AGENCY_ROLES}><CertificateGenerator /></PrivateRoute>} />
          <Route path="/agency/program"        element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyProgram /></PrivateRoute>} />
          <Route path="/agency/certificates"   element={<PrivateRoute allowedRoles={AGENCY_ROLES}><UploadCertificates /></PrivateRoute>} />
          <Route path="/agency/logs"            element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyLogs /></PrivateRoute>} />
          <Route path="/agency/funds"           element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyFunds /></PrivateRoute>} />
          <Route path="/agency/impact"          element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyImpact /></PrivateRoute>} />
          <Route path="/agency/allocation"      element={<PrivateRoute allowedRoles={[ROLES.AGENCY_ADMIN]}><AgencyAllocation /></PrivateRoute>} />
          <Route path="/agency/audit"           element={<PrivateRoute allowedRoles={[ROLES.AGENCY_ADMIN]}><AgencyAuditLog /></PrivateRoute>} />
          <Route path="/agency/team"            element={<PrivateRoute allowedRoles={[ROLES.AGENCY_ADMIN]}><AgencyTeam /></PrivateRoute>} />
          <Route path="/agency/announcements"   element={<PrivateRoute allowedRoles={[ROLES.AGENCY_ADMIN]}><AgencyAnnouncements /></PrivateRoute>} />
          <Route path="/agency/guide"           element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyGuide /></PrivateRoute>} />

          {/* Admin */}
          <Route path="/admin/dashboard"  element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AdminDashboard /></PrivateRoute>} />
          <Route path="/admin/analytics"  element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AdminAnalytics /></PrivateRoute>} />
          <Route path="/admin/requests"   element={<PrivateRoute allowedRoles={ADMIN_ROLES}><Requests /></PrivateRoute>} />
          <Route path="/admin/interviews" element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AdminInterviews /></PrivateRoute>} />
          <Route path="/admin/requests/:id/intake" element={<PrivateRoute allowedRoles={ADMIN_ROLES}><IntakeSheet collectionName="requests" /></PrivateRoute>} />
          <Route path="/admin/patients"   element={<PrivateRoute allowedRoles={ADMIN_ROLES}><Patients /></PrivateRoute>} />
          <Route path="/admin/hospitalids"element={<PrivateRoute allowedRoles={ADMIN_ROLES}><HospitalIDs /></PrivateRoute>} />
          <Route path="/admin/agencies"      element={<PrivateRoute allowedRoles={ADMIN_ROLES}><Agencies /></PrivateRoute>} />
          <Route path="/admin/agencies/new"  element={<PrivateRoute allowedRoles={[ROLES.SUPER_ADMIN]}><AddAgency /></PrivateRoute>} />
          <Route path="/admin/agencies/:id"  element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AgencyDetail /></PrivateRoute>} />
          {/* /admin/coordinators removed — agency team management now lives
              under /admin/agencies/:id. Redirect handles any stale bookmarks. */}
          <Route path="/admin/coordinators" element={<Navigate to="/admin/agencies" replace />} />
          <Route path="/admin/accounts"   element={<PrivateRoute allowedRoles={[ROLES.SUPER_ADMIN]}><Accounts /></PrivateRoute>} />
          <Route path="/admin/doctypes"   element={<PrivateRoute allowedRoles={ADMIN_ROLES}><DocTypes /></PrivateRoute>} />
          <Route path="/admin/assistance" element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AssistanceTypes /></PrivateRoute>} />
          <Route path="/admin/logs"       element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AppLogs /></PrivateRoute>} />
          <Route path="/admin/export"             element={<PrivateRoute allowedRoles={ADMIN_ROLES}><ExportPage /></PrivateRoute>} />
          <Route path="/admin/export/:type"       element={<PrivateRoute allowedRoles={ADMIN_ROLES}><ExportPreview /></PrivateRoute>} />
          <Route path="/admin/messages"   element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AdminMessages /></PrivateRoute>} />
          <Route path="/admin/reports"    element={<PrivateRoute allowedRoles={ADMIN_ROLES}><Reports /></PrivateRoute>} />
          {/* /admin/funds removed — see import note above */}
          <Route path="/admin/auditlog"        element={<PrivateRoute allowedRoles={[ROLES.SUPER_ADMIN]}><AuditLog /></PrivateRoute>} />
          <Route path="/admin/announcements"  element={<PrivateRoute allowedRoles={ADMIN_ROLES}><Announcements /></PrivateRoute>} />

          {/* Fallback */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </LiveDataProvider>
    </AuthProvider>
  )
}
