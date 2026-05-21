import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import { ROLES } from './utils/constants'

// Auth pages
import Landing  from './pages/auth/Landing'
import Login    from './pages/auth/Login'
import Register from './pages/auth/Register'
import Seed          from './pages/Seed'
import Notifications  from './pages/Notifications'

// Patient pages
import PatientDashboard  from './pages/patient/Dashboard'
import NotFound         from './pages/NotFound'
import UserGuide         from './pages/patient/Guide'
import MedicalPrograms   from './pages/patient/MedicalPrograms'
import Screening         from './pages/patient/Screening'
import TrackStatus       from './pages/patient/TrackStatus'
import Documents         from './pages/patient/Documents'
import Interviews        from './pages/patient/Interviews'

// Agency pages
import AgencyDashboard   from './pages/agency/Dashboard'
import SlotManagement    from './pages/agency/SlotManagement'
import Inbox             from './pages/agency/Inbox'
import ApplicationDetail from './pages/agency/ApplicationDetail'
import IntakeSheet       from './pages/agency/IntakeSheet'
import GLViewer          from './pages/agency/GLViewer'
import AgencyInterviews       from './pages/agency/Interviews'
import CertificateGenerator   from './pages/agency/CertificateGenerator'
import AgencyProgram          from './pages/agency/Program'
import UploadCertificates     from './pages/agency/UploadCertificates'
import AgencyLogs            from './pages/agency/Logs'
import AgencyFunds           from './pages/agency/Funds'
import AgencyAllocation      from './pages/agency/Allocation'
import AgencyGuide           from './pages/agency/Guide'

// Admin pages
import AdminDashboard    from './pages/admin/Dashboard'
import Patients          from './pages/admin/Patients'
import HospitalIDs       from './pages/admin/HospitalIDs'
import Agencies          from './pages/admin/Agencies'
import Accounts          from './pages/admin/Accounts'
import DocTypes          from './pages/admin/DocTypes'
import AssistanceTypes   from './pages/admin/AssistanceTypes'
import AppLogs           from './pages/admin/AppLogs'
import DocReview         from './pages/admin/DocReview'
import DocReviewDetail   from './pages/admin/DocReviewDetail'
import AdminMessages     from './pages/admin/Messages'
import Reports          from './pages/admin/Reports'
import ExportPage          from './pages/admin/Export'
import AgencyCoordinators  from './pages/admin/AgencyCoordinators'
import AddAgency           from './pages/admin/AddAgency'
import AgencyDetail        from './pages/admin/AgencyDetail'
import AuditLog         from './pages/admin/AuditLog'
import Announcements    from './pages/admin/Announcements'
import ExportPreview    from './pages/admin/ExportPreview'
// Funds page removed — CRMC has zero fund authority. Each agency manages
// its own budget via /agency/allocation (Agency Administrator role).

const PATIENT_ROLES = [ROLES.PATIENT]
const AGENCY_ROLES  = [ROLES.AGENCY, ROLES.AGENCY_ADMIN]
const ADMIN_ROLES   = [ROLES.SUPER_ADMIN, ROLES.STAFF_ADMIN]

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/"         element={<Landing />} />
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />
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
        <Route path="/patient/screening"  element={<PrivateRoute allowedRoles={PATIENT_ROLES}><Screening /></PrivateRoute>} />
        <Route path="/patient/status"     element={<PrivateRoute allowedRoles={PATIENT_ROLES}><TrackStatus /></PrivateRoute>} />
        <Route path="/patient/documents"  element={<PrivateRoute allowedRoles={PATIENT_ROLES}><Documents /></PrivateRoute>} />
        <Route path="/patient/interviews" element={<PrivateRoute allowedRoles={PATIENT_ROLES}><Interviews /></PrivateRoute>} />
        <Route path="/patient/messages"   element={<PrivateRoute allowedRoles={PATIENT_ROLES}><AdminMessages /></PrivateRoute>} />
        <Route path="/patient/guide"      element={<PrivateRoute allowedRoles={PATIENT_ROLES}><UserGuide /></PrivateRoute>} />

        {/* Agency */}
        <Route path="/agency/dashboard"   element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyDashboard /></PrivateRoute>} />
        <Route path="/agency/slots"       element={<PrivateRoute allowedRoles={AGENCY_ROLES}><SlotManagement /></PrivateRoute>} />
        <Route path="/agency/inbox"               element={<PrivateRoute allowedRoles={AGENCY_ROLES}><Inbox /></PrivateRoute>} />
        <Route path="/agency/applications/:id"        element={<PrivateRoute allowedRoles={AGENCY_ROLES}><ApplicationDetail /></PrivateRoute>} />
        <Route path="/agency/applications/:id/intake" element={<PrivateRoute allowedRoles={AGENCY_ROLES}><IntakeSheet /></PrivateRoute>} />
        <Route path="/agency/applications/:id/gl"     element={<PrivateRoute allowedRoles={AGENCY_ROLES}><GLViewer /></PrivateRoute>} />
        <Route path="/agency/interviews"  element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyInterviews /></PrivateRoute>} />
        <Route path="/agency/messages"    element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AdminMessages /></PrivateRoute>} />
        <Route path="/agency/generator"   element={<PrivateRoute allowedRoles={AGENCY_ROLES}><CertificateGenerator /></PrivateRoute>} />
        <Route path="/agency/program"        element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyProgram /></PrivateRoute>} />
        <Route path="/agency/certificates"   element={<PrivateRoute allowedRoles={AGENCY_ROLES}><UploadCertificates /></PrivateRoute>} />
        <Route path="/agency/logs"            element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyLogs /></PrivateRoute>} />
        <Route path="/agency/funds"           element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyFunds /></PrivateRoute>} />
        <Route path="/agency/allocation"      element={<PrivateRoute allowedRoles={[ROLES.AGENCY_ADMIN]}><AgencyAllocation /></PrivateRoute>} />
        <Route path="/agency/guide"           element={<PrivateRoute allowedRoles={AGENCY_ROLES}><AgencyGuide /></PrivateRoute>} />

        {/* Admin */}
        <Route path="/admin/dashboard"  element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AdminDashboard /></PrivateRoute>} />
        <Route path="/admin/patients"   element={<PrivateRoute allowedRoles={ADMIN_ROLES}><Patients /></PrivateRoute>} />
        <Route path="/admin/hospitalids"element={<PrivateRoute allowedRoles={ADMIN_ROLES}><HospitalIDs /></PrivateRoute>} />
        <Route path="/admin/agencies"      element={<PrivateRoute allowedRoles={ADMIN_ROLES}><Agencies /></PrivateRoute>} />
        <Route path="/admin/agencies/new"  element={<PrivateRoute allowedRoles={[ROLES.SUPER_ADMIN]}><AddAgency /></PrivateRoute>} />
        <Route path="/admin/agencies/:id"  element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AgencyDetail /></PrivateRoute>} />
        <Route path="/admin/coordinators" element={<PrivateRoute allowedRoles={[ROLES.SUPER_ADMIN]}><AgencyCoordinators /></PrivateRoute>} />
        <Route path="/admin/accounts"   element={<PrivateRoute allowedRoles={[ROLES.SUPER_ADMIN]}><Accounts /></PrivateRoute>} />
        <Route path="/admin/doctypes"   element={<PrivateRoute allowedRoles={ADMIN_ROLES}><DocTypes /></PrivateRoute>} />
        <Route path="/admin/assistance" element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AssistanceTypes /></PrivateRoute>} />
        <Route path="/admin/logs"       element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AppLogs /></PrivateRoute>} />
        <Route path="/admin/export"             element={<PrivateRoute allowedRoles={ADMIN_ROLES}><ExportPage /></PrivateRoute>} />
        <Route path="/admin/export/:type"       element={<PrivateRoute allowedRoles={ADMIN_ROLES}><ExportPreview /></PrivateRoute>} />
        <Route path="/admin/docreview"        element={<PrivateRoute allowedRoles={ADMIN_ROLES}><DocReview /></PrivateRoute>} />
        <Route path="/admin/docreview/:docId" element={<PrivateRoute allowedRoles={ADMIN_ROLES}><DocReviewDetail /></PrivateRoute>} />
        <Route path="/admin/messages"   element={<PrivateRoute allowedRoles={ADMIN_ROLES}><AdminMessages /></PrivateRoute>} />
        <Route path="/admin/reports"    element={<PrivateRoute allowedRoles={ADMIN_ROLES}><Reports /></PrivateRoute>} />
        {/* /admin/funds removed — see import note above */}
        <Route path="/admin/auditlog"        element={<PrivateRoute allowedRoles={[ROLES.SUPER_ADMIN]}><AuditLog /></PrivateRoute>} />
        <Route path="/admin/announcements"  element={<PrivateRoute allowedRoles={[ROLES.SUPER_ADMIN]}><Announcements /></PrivateRoute>} />

        {/* Fallback */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  )
}
