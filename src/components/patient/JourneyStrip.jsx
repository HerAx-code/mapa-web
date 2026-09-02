import { useTranslation } from 'react-i18next'
import { MdCheck } from 'react-icons/md'

// The request lifecycle as a compact, at-a-glance horizontal strip — the
// signature element of the patient-mobile redesign: "where am I?" answered
// without reading. Driven by the request's own status rank, so it stays in
// lockstep with the server. Reused on the Dashboard and the Status screen.
//
// Ranks mirror REQ_RANK in Dashboard/TrackStatus (the co-funding lifecycle):
//   submitted 0 · under_review 1 · assessment 2 · endorsed 3 ·
//   partially_funded 4 · fully_funded 5.
const REQ_RANK = {
  submitted: 0, under_review: 1, assessment: 2,
  endorsed: 3, partially_funded: 4, fully_funded: 5,
}

const STAGES = [
  { key: 'submitted', entry: 0 },
  { key: 'verified',  entry: 1 },
  { key: 'interview', entry: 2 },
  { key: 'endorsed',  entry: 3 },
  { key: 'approved',  entry: 4 },
  { key: 'letter',    entry: 5 },
]

export default function JourneyStrip({ status, className = '' }) {
  const { t } = useTranslation()
  const rank = REQ_RANK[status] ?? 0

  return (
    <div className={`flex items-start justify-between ${className}`} role="list" aria-label={t('patient.journey.label')}>
      {STAGES.map((s, i) => {
        const state = rank > s.entry ? 'done' : rank === s.entry ? 'current' : 'upcoming'
        return (
          <div key={s.key} role="listitem" aria-current={state === 'current' ? 'step' : undefined}
            className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
            {/* connector into this node — from the previous node's centre */}
            {i > 0 && (
              <span aria-hidden="true"
                className={`absolute top-[9px] left-[-50%] -z-0 h-0.5 w-full ${state === 'upcoming' ? 'bg-gray-200' : 'bg-brand-400'}`} />
            )}
            <span aria-hidden="true"
              className={`relative z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full ${
                state === 'done'    ? 'bg-brand-500 text-white'
                : state === 'current' ? 'border-2 border-amber-500 bg-amber-50 ring-4 ring-amber-50'
                : 'border-2 border-gray-200 bg-white'
              }`}>
              {state === 'done'    && <MdCheck size={11} />}
              {state === 'current' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </span>
            <span className={`text-[9px] leading-tight ${
              state === 'current' ? 'font-semibold text-amber-700'
              : state === 'done'  ? 'text-gray-600'
              : 'text-gray-400'
            }`}>{t(`patient.journey.${s.key}`)}</span>
          </div>
        )
      })}
    </div>
  )
}
