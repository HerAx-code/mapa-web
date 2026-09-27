import { useTranslation } from 'react-i18next'
import { MdCheck, MdChevronRight } from 'react-icons/md'
import { journeyState } from '../../utils/journey'

// The DETAIL fidelity of the one canonical journey model (utils/journey.js):
// a vertical six-row stepper for the patient's active request. Same stages,
// same copy source as JourneyStrip (glance) and PatientHero (summary), so the
// three surfaces never disagree. Each row shows the stage label plus a
// one-line note — "what's happening" (now) for done/current rows, "what's next"
// (muted) for upcoming rows. The current `endorsed` stage carries the Proceed
// affordance (accept the coverage plan), matching the prior behaviour.
//
// i18n: patient.journey.stage.<key>.{label,now,next}. Rendered only for an
// active (non-terminal) request — TrackStatus handles rejected/closed in its
// Past tab, so `outcome` is null here.
export default function JourneyStepper({ request, navigate }) {
  const { t } = useTranslation()
  const { stages } = journeyState(request)

  return (
    <div className="space-y-0" role="list" aria-label={t('patient.journey.label')}>
      {stages.map((s, i) => {
        const isLast  = i === stages.length - 1
        const done    = s.state === 'done'
        const current = s.state === 'current'
        const note    = done || current
          ? t(`patient.journey.stage.${s.key}.now`)
          : t(`patient.journey.stage.${s.key}.next`)
        // The endorsed stage, while current, is where the patient accepts the
        // coverage plan. Keep that as an inline tap target.
        const showProceed = current && s.key === 'endorsed'

        const dot = (
          <div className="flex flex-col items-center">
            <span className={`z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              done    ? 'bg-brand-500 text-white'
              : current ? 'border-2 border-amber-500 bg-amber-50 text-amber-700'
              : 'border-2 border-gray-200 bg-white text-gray-400'
            }`}>
              {done ? <MdCheck size={15} /> : i + 1}
            </span>
            {!isLast && <span className={`my-1 w-0.5 flex-1 ${done ? 'bg-brand-300' : 'bg-gray-100'}`} style={{ minHeight: '22px' }} />}
          </div>
        )

        const body = (
          <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-4'}`}>
            <p className={`text-sm ${current ? 'font-semibold text-amber-700' : done ? 'font-medium text-gray-800' : 'text-gray-500'}`}>
              {t(`patient.journey.stage.${s.key}.label`)}
              {current && <span className="ml-2 badge badge-blue text-xs align-middle">{t('patient.track.timeline.current')}</span>}
            </p>
            {note && (
              <p className={`mt-0.5 text-xs leading-snug ${done || current ? 'text-gray-500' : 'text-gray-400'}`}>{note}</p>
            )}
            {showProceed && (
              <p className="mt-1 text-xs font-semibold text-brand-600">{t('patient.track.reqStages.endorsedCta')} →</p>
            )}
          </div>
        )

        if (showProceed) {
          return (
            <button
              key={s.key}
              type="button"
              role="listitem"
              onClick={() => navigate('/patient/request')}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-1 text-left min-h-[44px] hover:bg-brand-50/60 focus:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 transition-colors">
              {dot}
              {body}
              <MdChevronRight size={20} className="flex-shrink-0 self-center text-brand-500" aria-hidden="true" />
            </button>
          )
        }
        return (
          <div key={s.key} role="listitem" className="flex gap-3 px-2">
            {dot}
            {body}
          </div>
        )
      })}
    </div>
  )
}
