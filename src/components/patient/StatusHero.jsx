import { useTranslation } from 'react-i18next'
import { MdArrowForward } from 'react-icons/md'

// The redesign's status hero: one calm pine card that answers "which stage am
// I on, and what's my one next step" — replacing the per-status coloured cards
// with a single cohesive treatment. Driven by the request's lifecycle rank
// (same ranks as JourneyStrip), so hero + strip always agree. Used for the
// pre-funding stages (submitted → assessment); once money is committed the
// Dashboard shows BalanceHero instead.
const REQ_RANK = {
  submitted: 0, under_review: 1, assessment: 2,
  endorsed: 3, partially_funded: 4, fully_funded: 5,
}
const TOTAL = 6

export default function StatusHero({ request, nextAction, navigate }) {
  const { t } = useTranslation()
  const rank = REQ_RANK[request.status] ?? 0
  const step = Math.min(rank + 1, TOTAL)
  const key  = `s${Math.min(rank, 4)}`
  const pct  = Math.round((step / TOTAL) * 100)

  // The single next action: the Dashboard's derived one (fix a doc / respond /
  // join interview) wins; otherwise a stage-appropriate default.
  const cta = nextAction
    ? { label: nextAction.cta, onClick: nextAction.onClick }
    : rank === 2
      ? { label: t('patient.hero.interviewCta'), onClick: () => navigate('/patient/interviews') }
      : { label: t('patient.hero.trackCta'),     onClick: () => navigate('/patient/status') }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-brand-600 p-5 text-white shadow-lg shadow-brand-900/20">
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/5" />
      <p className="relative text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-100/80">
        {t('patient.hero.step', { n: step, total: TOTAL })}
      </p>
      <h2 className="font-display relative mt-1.5 text-[22px] font-bold leading-tight tracking-tight">
        {t(`patient.hero.${key}.title`)}
      </h2>
      <p className="relative mt-1 text-sm leading-relaxed text-brand-50/90">
        {t(`patient.hero.${key}.sub`)}
      </p>
      <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
        <div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} />
      </div>
      <button onClick={cta.onClick}
        className="relative mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-brand-700 transition-colors hover:bg-brand-50">
        {cta.label} <MdArrowForward size={16} />
      </button>
    </div>
  )
}
