/**
 * Cloud Functions entry point. Each function lives in its own file under
 * src/ and is re-exported here. firebase deploy only picks up exports
 * named at the top level of this file.
 */

const admin = require('firebase-admin')

// Initialise the default Firebase app exactly once. Every src/ module
// imports admin and reads admin.firestore() / .auth() off the singleton.
admin.initializeApp()

const { resetAgencySlots } = require('./src/resetAgencySlots')
const { glExpirySweep }    = require('./src/glExpirySweep')

exports.resetAgencySlots = resetAgencySlots
exports.glExpirySweep    = glExpirySweep
