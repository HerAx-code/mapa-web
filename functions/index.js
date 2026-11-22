/**
 * Cloud Functions entry point. Each function lives in its own file under
 * src/ and is re-exported here. firebase deploy only picks up exports
 * named at the top level of this file.
 */

const { initializeApp } = require('firebase-admin/app')

// Initialise the default Firebase app exactly once. Every src/ module uses the
// modular entry points (getFirestore() / getAuth() from firebase-admin/*),
// which read this default app. firebase-admin 14 removed the namespaced
// admin.firestore() / admin.auth() API.
initializeApp()

const { resetAgencySlots }       = require('./src/resetAgencySlots')
const { glExpirySweep }          = require('./src/glExpirySweep')
const { purgeDeclinedOnboarding } = require('./src/purgeDeclinedOnboarding')
const { verifyAccessCode }       = require('./src/verifyAccessCode')
const { syncRequestFinancials }  = require('./src/syncRequestFinancials')
const { onAgencyWritten, resyncAgenciesPublic } = require('./src/onAgencyWritten')
const { purgeSelfieOnClose }     = require('./src/purgeSelfieOnClose')
const { onRequestWritten }       = require('./src/onRequestWritten')
const { onSliceProceeded }       = require('./src/onSliceProceeded')
const { onDocumentCountChanged } = require('./src/onDocumentCountChanged')
const { onAuditLogCreated }      = require('./src/onAuditLogCreated')
const { refreshNetworkStats }    = require('./src/refreshNetworkStats')
const { onOnboardingRequestCreated } = require('./src/onOnboardingRequestCreated')

exports.resetAgencySlots        = resetAgencySlots
exports.glExpirySweep           = glExpirySweep
exports.purgeDeclinedOnboarding = purgeDeclinedOnboarding
exports.verifyAccessCode        = verifyAccessCode
exports.syncRequestFinancials   = syncRequestFinancials
exports.onAgencyWritten         = onAgencyWritten
exports.resyncAgenciesPublic    = resyncAgenciesPublic
exports.purgeSelfieOnClose      = purgeSelfieOnClose
exports.onRequestWritten        = onRequestWritten
exports.onSliceProceeded        = onSliceProceeded
exports.onDocumentCountChanged  = onDocumentCountChanged
// Phase 3 PR 3.1: the document owns its status; requests' lists follow it.
exports.syncDocumentStatus = require('./src/syncDocumentStatus').syncDocumentStatus
exports.purgeUnattachedDocuments = require('./src/purgeUnattachedDocuments').purgeUnattachedDocuments
// Phase 3 PR 3.2: assessment corrections after endorsement.
exports.amendAssessment = require('./src/assessmentActions').amendAssessment
// Phase 3 PR 3.3: conversations belong to the case; thread fields are server-written.
const { openCaseConversation, onConversationMessage } = require('./src/caseConversations')
exports.openCaseConversation = openCaseConversation
exports.onConversationMessage = onConversationMessage
exports.onAuditLogCreated       = onAuditLogCreated
exports.refreshNetworkStats     = refreshNetworkStats
exports.onOnboardingRequestCreated = onOnboardingRequestCreated

// Phase 1 (T1): email leaves from the server only; announcements fan out here.
const { sendNotificationEmail } = require('./src/sendNotificationEmail')
const { onAnnouncementCreated, announcementReminders } = require('./src/announcements')
// Phase 1 (T2): account lifecycle; replaces deleteAuthUser.
const { eraseAccount, disableAccount, resetStaffMfa } = require('./src/accountAdmin')
// Phase 2 (T3, PR 2.2): the hospital's money actions on a case.
const { endorseRequest, closeRequest } = require('./src/caseActions')
exports.endorseRequest = endorseRequest
exports.closeRequest = closeRequest
// Phase 2 (T3, PR 2.3): the agency's decisions and letters.
const { decideSlice, settleLetter } = require('./src/sliceActions')
exports.decideSlice = decideSlice
exports.settleLetter = settleLetter
exports.eraseAccount = eraseAccount
exports.disableAccount = disableAccount
exports.resetStaffMfa = resetStaffMfa
exports.sendNotificationEmail = sendNotificationEmail
exports.onAnnouncementCreated = onAnnouncementCreated
exports.announcementReminders = announcementReminders

const { onPatientIdentityWritten, onIdDocumentIdentityWritten, clearIdentityFlag } = require('./src/identityIndex')
exports.clearIdentityFlag = clearIdentityFlag
exports.onPatientIdentityWritten    = onPatientIdentityWritten
exports.onIdDocumentIdentityWritten = onIdDocumentIdentityWritten
