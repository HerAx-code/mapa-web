// The ONE canonical patient journey model.
//
// Before this, the patient met 4–5 different "where am I?" representations
// (JourneyStrip, a Dashboard timeline, a Dashboard steps guide, the TrackStatus
// request stepper, a per-slice stepper). This module is the single source: the
// six-stage request lifecycle, driven by request.status via REQ_RANK, rendered
// at three fidelities from the same data — glance (JourneyStrip), summary
// (PatientHero), detail (JourneyStepper).
//
// Copy lives in i18n at patient.journey.stage.<key>.{label,now,next} (both
// locales). `label` is the short stage name (used everywhere), `now` is the
// one-line "what's happening", `next` the one-line "what's next" (GOV.UK
// "received / decided / next" pattern).

import { REQ_RANK } from './requests'
import {
  MdInventory2, MdSearch, MdAssignment, MdSend, MdVolunteerActivism, MdCheckCircle,
} from 'react-icons/md'

// One entry per request-lifecycle stage. `rank` mirrors REQ_RANK so a status
// change can never diverge the two. Keep this array as the only stage list in
// the patient surface.
export const JOURNEY_STAGES = [
  { key: 'submitted',    rank: 0, icon: MdInventory2 },
  { key: 'under_review', rank: 1, icon: MdSearch },
  { key: 'assessment',   rank: 2, icon: MdAssignment },
  { key: 'endorsed',     rank: 3, icon: MdSend },
  { key: 'funding',      rank: 4, icon: MdVolunteerActivism }, // partially_funded
  { key: 'complete',     rank: 5, icon: MdCheckCircle },       // fully_funded
]

export const JOURNEY_TOTAL = JOURNEY_STAGES.length // 6

// Derive the journey view for a request.
//   - rejected / closed are OUTCOMES, not stages (the caller shows an outcome
//     treatment; closed still resolves a rank so a partial stepper can render).
//   - unknown / missing status falls back to rank 0 (never throws, never blank).
// Returns { outcome, rank, stages } where each stage carries
// state = 'done' | 'current' | 'upcoming'.
export function journeyState(request) {
  const status = request?.status

  if (status === 'rejected') {
    return {
      outcome: 'rejected',
      rank: -1,
      stages: JOURNEY_STAGES.map((s) => ({ ...s, state: 'upcoming' })),
    }
  }

  const outcome = status === 'closed' ? 'closed' : null
  const rank = status === 'closed'
    ? (REQ_RANK.partially_funded ?? 4)   // closed = gave up on the remaining balance
    : (REQ_RANK[status] ?? 0)

  const stages = JOURNEY_STAGES.map((s) => ({
    ...s,
    state: rank > s.rank ? 'done' : rank === s.rank ? 'current' : 'upcoming',
  }))

  return { outcome, rank, stages }
}
