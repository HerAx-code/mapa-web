import { useTranslation } from 'react-i18next'
import { MdCheck } from 'react-icons/md'
import { journeyState } from '../../utils/journey'

// The GLANCE fidelity of the one canonical journey model (utils/journey.js) —
// a compact horizontal strip that answers "where am I?" without reading. The
// summary hero (PatientHero) and the detail stepper (JourneyStepper) render the
// SAME six stages from the same source, so the patient sees one model
// everywhere. Driven by request.status via journeyState, in lockstep with the
// server. i18n labels: patient.journey.stage.<key>.label.

export default function JourneyStrip({ status, className = '' }) {
  const { t } = useTranslation()
  const { stages } = journeyState({ status })

  return (
    <div className={`flex items-start justify-between ${className}`} role="list" aria-label={t('patient.journey.label')}>
      {stages.map((s, i) => {
        const state = s.state
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
            }`}>{t(`patient.journey.stage.${s.key}.label`)}</span>
          </div>
        )
      })}
    </div>
  )
}
