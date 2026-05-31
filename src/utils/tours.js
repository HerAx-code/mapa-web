// Clears the per-user tour-seen flag so the next mount of <Tour>
// re-fires. Used by the "Show tour again" affordances. Caller is
// expected to navigate to (or already be on) the page that owns the
// tour after clearing.
export function resetTourFlag(storageKey, uid) {
  if (!uid) return
  try { localStorage.removeItem(`mapa_tour_${storageKey}_${uid}`) } catch { /* private mode / quota */ }
}

// First-time guided tour step definitions per dashboard.
//
// Patient tour uses i18n keys via t() so the tour speaks Filipino when
// the patient's language toggle is set to Filipino (CLAUDE.md: patient-
// facing strings must be bilingual). Agency and admin tours are
// English-only (those audiences work in English per the rest of the
// agency/admin UI).
//
// targetId values must match `data-tour-id="..."` attributes the page
// puts on the elements it wants spotlighted. Missing targets fall back
// to a centered, fully-dimmed step (the Tour component handles it).

export const patientTrackStatusTour = (t) => [
  {
    targetId: 'track-tabs',
    title:    t('tour.patient.track.s1.title'),
    body:     t('tour.patient.track.s1.body'),
    position: 'bottom',
  },
  {
    targetId: 'track-request',
    title:    t('tour.patient.track.s2.title'),
    body:     t('tour.patient.track.s2.body'),
    position: 'bottom',
  },
  // The slices list only exists once CRMC has endorsed to at least one
  // agency. For a freshly-submitted request, no slice cards render yet
  // and the Tour component falls back to centered + full-page dim,
  // which keeps the explainer copy meaningful ("when endorsed, each
  // agency will show here").
  {
    targetId: 'track-slices',
    title:    t('tour.patient.track.s3.title'),
    body:     t('tour.patient.track.s3.body'),
    position: 'top',
  },
]

export const patientDashboardTour = (t) => [
  {
    targetId: 'patient-greeting',
    title:    t('tour.patient.s1.title'),
    body:     t('tour.patient.s1.body'),
    position: 'bottom',
  },
  {
    targetId: 'patient-hero',
    title:    t('tour.patient.s2.title'),
    body:     t('tour.patient.s2.body'),
    position: 'bottom',
  },
  {
    targetId: 'patient-steps',
    title:    t('tour.patient.s3.title'),
    body:     t('tour.patient.s3.body'),
    position: 'top',
  },
  {
    targetId: 'patient-docs',
    title:    t('tour.patient.s4.title'),
    body:     t('tour.patient.s4.body'),
    position: 'top',
  },
]

export const agencyDashboardTour = [
  {
    targetId: 'agency-metrics',
    title:    'Daily snapshot',
    body:     "Pending decisions, today's slots, and total approvals at a glance. Click any tile to drill in.",
    position: 'bottom',
  },
  {
    targetId: 'agency-slots',
    title:    'Slot capacity',
    body:     "Today's intake counter. Slots are consumed when CRMC endorses a case to you and reset at PH midnight. Manage daily capacity on Slot Management.",
    position: 'bottom',
  },
  {
    targetId: 'agency-budget',
    title:    'Budget for this period',
    body:     'Committed and disbursed against your allocation. When the amber warning shows, request a top-up from your Agency Administrator.',
    position: 'top',
  },
  {
    targetId: 'agency-actions',
    title:    'Your daily work',
    body:     'Inbox is the funding queue. GL Letters lets you print/upload signed guarantees. App Logs is the historical archive. Messages reaches patients and CRMC.',
    position: 'top',
  },
]

export const adminDashboardTour = [
  {
    targetId: 'admin-metrics',
    title:    'System counts',
    body:     'Live counts of patients, agencies, open requests, and pending documents. Click any tile to jump to that workspace.',
    position: 'bottom',
  },
  {
    targetId: 'admin-alerts',
    title:    'Needs attention',
    body:     'Daily triage list — stale applications, low-slot agencies, open reports. Tackle these before anything else.',
    position: 'bottom',
  },
  {
    targetId: 'admin-activity',
    title:    'Recent activity',
    body:     'Real-time feed of registrations, doc uploads, submissions, approvals, and rejections across the platform.',
    position: 'top',
  },
  {
    targetId: 'admin-actions',
    title:    'Manage + Review shortcuts',
    body:     'Quick links to the workspaces you use most: Requests for case work, Agencies and Accounts for system setup, Audit Log for oversight.',
    position: 'top',
  },
]