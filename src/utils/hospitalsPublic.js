// hospitalsPublic — the public projection of each hospital. Since Phase 5
// PR 5.2 (decision P5-B) it is written ONLY by the onHospitalWritten Cloud
// Function (functions/src/onHospitalWritten.js), like agenciesPublic; the
// rules refuse browser writes. The projection itself is the shared definition.
export { projectPublicHospital, isPublishedHospital } from '../shared/hospitalPublic'
