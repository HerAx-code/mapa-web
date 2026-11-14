#!/usr/bin/env node
/**
 * seed-default-hospital.mjs  (multi-hospital Phase 1)
 *
 * Creates hospitals/{DEFAULT_HOSPITAL_ID} — "hospital #1", the current host —
 * from this deployment's VITE_ORG_* / VITE_ACCESS_CODE_PREFIX values, so the
 * live app shows exactly what it showed before tenancy. Every user resolves to
 * this hospital until the Phase 3 backfill stamps tenantId on records. Also
 * claims its access-code prefix (accessCodePrefixes, Phase 8).
 * See docs/multi-hospital-network-plan.md.
 *
 * SAFETY: never overwrites an existing hospital doc (use --force to merge the
 * env values over it). Dry run by default prints what it would write.
 *
 * Usage (PowerShell), from the repo root:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "mapa-crmc"
 *   node --env-file=.env scripts/seed-default-hospital.mjs --dry-run
 *   node --env-file=.env scripts/seed-default-hospital.mjs
 *
 * Flags: --dry-run · --force · --id <hospitalId>
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const FORCE   = argv.includes('--force')
const val = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i+1] ? argv[i+1] : dflt }

const env = process.env
const ID = val('--id', env.VITE_DEFAULT_HOSPITAL_ID || 'hospital-1')

// Same defaults as src/config/org.js so an unconfigured deployment seeds the
// neutral MAPA identity it already shows.
const hospital = {
  shortName:        env.VITE_ORG_SHORT_NAME        || '',
  gatewayName:      env.VITE_ORG_GATEWAY_NAME      || 'Medical Social Services',
  gatewayInitials:  env.VITE_ORG_GATEWAY_INITIALS  || 'MSS',
  facilityName:     env.VITE_ORG_FACILITY_NAME     || 'the hospital',
  contactEmail:     env.VITE_ORG_CONTACT_EMAIL     || 'support@example.org',
  accessCodePrefix: env.VITE_ACCESS_CODE_PREFIX    || 'MAPA',
  enabled:          true,
}

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function main() {
  console.log(`[seed-hospital] ${DRY_RUN ? 'DRY RUN -- no writes' : 'APPLYING'}: hospitals/${ID}\n`)
  console.log(hospital)

  const ref = db.doc(`hospitals/${ID}`)
  const snap = await ref.get()

  // Phase 8: the access-code prefix is claimed network-wide
  // (accessCodePrefixes/{PREFIX} = { tenantId }); the rules let a hospital
  // carry only a prefix it holds. Make sure hospital #1 holds its own — even
  // when the hospital doc already exists.
  const prefix = (snap.exists && !FORCE && snap.data().accessCodePrefix) || hospital.accessCodePrefix
  const claimRef = db.doc(`accessCodePrefixes/${prefix}`)
  const claim = await claimRef.get()
  if (claim.exists && claim.data().tenantId !== ID) {
    console.error(`\n[seed-hospital] REFUSED: prefix ${prefix} is already claimed by hospitals/${claim.data().tenantId}.`)
    process.exit(1)
  }
  if (!claim.exists) {
    if (DRY_RUN) console.log(`[seed-hospital] WOULD claim access-code prefix ${prefix} for ${ID}.`)
    else {
      await claimRef.set({ tenantId: ID, createdAt: FieldValue.serverTimestamp() })
      console.log(`[seed-hospital] ✅ claimed access-code prefix ${prefix} for ${ID}.`)
    }
  }

  if (snap.exists && !FORCE) {
    console.log(`\n[seed-hospital] hospitals/${ID} already exists — left untouched. Pass --force to merge the values above over it.`)
    return
  }
  if (DRY_RUN) {
    console.log(`\n[seed-hospital] WOULD ${snap.exists ? 'merge into' : 'create'} hospitals/${ID}. Re-run without --dry-run to apply.`)
    return
  }

  await ref.set({
    ...hospital,
    ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  console.log(`\n[seed-hospital] ✅ hospitals/${ID} ${snap.exists ? 'updated' : 'created'}.`)
}

main().catch((err) => { console.error('[seed-hospital] FATAL:', err); process.exit(1) })
