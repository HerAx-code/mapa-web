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
const { deleteAuthUser }         = require('./src/deleteAuthUser')
const { onAgencyWritten }        = require('./src/onAgencyWritten')
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
exports.deleteAuthUser          = deleteAuthUser
exports.onAgencyWritten         = onAgencyWritten
exports.purgeSelfieOnClose      = purgeSelfieOnClose
exports.onRequestWritten        = onRequestWritten
exports.onSliceProceeded        = onSliceProceeded
exports.onDocumentCountChanged  = onDocumentCountChanged
exports.onAuditLogCreated       = onAuditLogCreated
exports.refreshNetworkStats     = refreshNetworkStats
exports.onOnboardingRequestCreated = onOnboardingRequestCreated

const { onPatientIdentityWritten, onIdDocumentIdentityWritten } = require('./src/identityIndex')
exports.onPatientIdentityWritten    = onPatientIdentityWritten
exports.onIdDocumentIdentityWritten = onIdDocumentIdentityWritten
