const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { writeNetworkStats } = require('./networkStats')

/**
 * refreshNetworkStats — multi-hospital Phase 9. Rebuilds networkStats/current
 * (per-hospital counts, no patient data) for the platform admin's Network page.
 * Every 6 hours; the same computation can be run by hand with
 * scripts/compute-network-stats.mjs while Cloud Functions aren't deployed.
 */
exports.refreshNetworkStats = onSchedule(
  {
    schedule: '0 */6 * * *',
    timeZone: 'Asia/Manila',
    region: 'asia-southeast1',
    retryCount: 1,
  },
  async () => {
    try {
      const stats = await writeNetworkStats({
        db: admin.firestore(),
        AggregateField: admin.firestore.AggregateField,
        serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      })
      logger.info('[refreshNetworkStats] updated', { hospitals: Object.keys(stats.hospitals).length })
    } catch (err) {
      logger.error('[refreshNetworkStats] failed', { err: err.message })
      throw err
    }
  },
)
