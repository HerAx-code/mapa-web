// The public, sign-in-free projection of a hospital (hospitalsPublic/{id}),
// for the Landing page, Register and the patient marketplace. Pure, so the
// onHospitalWritten trigger (through the shared bundle) and any script use the
// same fields. Phase 5 PR 5.2 (P5-B): the trigger is the only writer.
export function projectPublicHospital(h = {}) {
  return {
    facilityName:     h.facilityName ?? '',
    shortName:        h.shortName ?? '',
    accessCodePrefix: h.accessCodePrefix ?? '',
    enabled:          h.enabled !== false,
    gatewayName:      h.gatewayName ?? '',
    address:          h.address ?? '',
    region:           h.region ?? '',
    contactEmail:     h.contactEmail ?? '',
  }
}

// The Training Hospital (onboarding practice, sample patients only) is never
// published: it must not appear on Landing, Register or the marketplace.
export const isPublishedHospital = (h) => !!h && h.onboarding?.training !== true
