import { useTranslation } from 'react-i18next'
import {
  MdCancel, MdMenuBook, MdArrowForward, MdClose, MdLocalHospital,
  MdReceipt, MdPending, MdHourglassEmpty, MdAssignment, MdSchedule, MdCheckCircle,
} from 'react-icons/md'
import StatusHero from './StatusHero'
import BalanceHero from './BalanceHero'
import { REQ_RANK } from '../../utils/requests'
import { tsToDate } from '../../utils/dates'

// The SUMMARY fidelity of the one canonical journey model, and the single
// decision point for "which hero does this patient see". Collapses the six
// conditional branches that used to live inline in the Dashboard into one
// component — same visuals, one place. The three fidelities (glance
// JourneyStrip, this summary, detail JourneyStepper) stay in lockstep.
//
// Branches, in priority order:
//   1. loading                         → skeleton
//   2. active request, pre-funding      → pine StatusHero (Step X of 6 + one action)
//   3. active request, funding onward    → money BalanceHero
//   4. legacy slice with a live status   → per-status card
//   5. only rejected/closed apps         → "try another program" card
//   6. some progress / dismissed welcome → compact link
//   7. brand-new patient                 → welcome hero
// Every visual is unchanged from the prior inline tree; only the location moved.

const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : '—'
}

// Icon + palette per legacy-slice status (branch 4). Translatable strings live
// in patient.dashboard.statusCard.<status>.
const STATUS_VISUAL = {
  pending:       { icon: MdHourglassEmpty, iconBg: 'bg-blue-100 text-blue-600',     path: '/patient/status', border: 'border-blue-300',   bg: 'bg-blue-50',   text: 'text-blue-800',   subtext: 'text-blue-600',   btnClass: 'bg-blue-500 hover:bg-blue-600 text-white' },
  endorsed:      { icon: MdReceipt,        iconBg: 'bg-purple-100 text-purple-600', path: '/patient/status', border: 'border-purple-300', bg: 'bg-purple-50', text: 'text-purple-800', subtext: 'text-purple-600', btnClass: 'bg-purple-500 hover:bg-purple-600 text-white' },
  reviewing:     { icon: MdAssignment,     iconBg: 'bg-amber-100 text-amber-600',   path: '/patient/status', border: 'border-amber-300',  bg: 'bg-amber-50',  text: 'text-amber-800',  subtext: 'text-amber-600',  btnClass: 'bg-amber-500 hover:bg-amber-600 text-white' },
  awaiting_info: { icon: MdSchedule,       iconBg: 'bg-orange-100 text-orange-600', path: '/patient/status', border: 'border-orange-300', bg: 'bg-orange-50', text: 'text-orange-800', subtext: 'text-orange-700', btnClass: 'bg-orange-500 hover:bg-orange-600 text-white' },
  approved:      { icon: MdCheckCircle,    iconBg: 'bg-green-100 text-green-600',    path: '/patient/status', border: 'border-green-300',  bg: 'bg-green-50',  text: 'text-green-800',  subtext: 'text-green-600',  btnClass: 'bg-green-500 hover:bg-green-600 text-white' },
  certificate:   { icon: MdReceipt,        iconBg: 'bg-green-100 text-green-600',    path: '/patient/status', border: 'border-green-300',  bg: 'bg-green-50',  text: 'text-green-800',  subtext: 'text-green-600',  btnClass: 'bg-green-500 hover:bg-green-600 text-white' },
}

export default function PatientHero({
  loading, activeRequest, funding, nextAction,
  activeApp, appCount = 0, docStats = { verified: 0, pending: 0 },
  welcomeDismissed, dismissWelcome, navigate,
}) {
  const { t } = useTranslation()

  // 1. loading
  if (loading) {
    return (
      <div className="card p-6 animate-pulse">
        <div className="h-6 bg-gray-100 rounded w-48 mb-3" />
        <div className="h-4 bg-gray-100 rounded w-full mb-2" />
        <div className="h-4 bg-gray-100 rounded w-3/4 mb-5" />
        <div className="h-12 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  // 2 + 3. active co-funding request — pine stage hero pre-funding, money hero once funding
  if (activeRequest && funding) {
    return (REQ_RANK[activeRequest.status] ?? 0) < 3
      ? <StatusHero request={activeRequest} nextAction={nextAction} navigate={navigate} />
      : <BalanceHero request={activeRequest} funding={funding} t={t} navigate={navigate} />
  }

  // 4. legacy slice with a live status
  if (activeApp && STATUS_VISUAL[activeApp.status]) {
    const vis = STATUS_VISUAL[activeApp.status]
    const txt = `patient.dashboard.statusCard.${activeApp.status}`
    const isAwaiting = activeApp.status === 'awaiting_info'
    const Icon = vis.icon
    return (
      <div className={`card p-5 border-2 ${vis.border} ${vis.bg}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${vis.iconBg}`}>
            <Icon size={22} />
          </div>
          <h2 className={`text-lg font-bold ${vis.text}`}>{t(`${txt}.label`)}</h2>
        </div>
        <p className={`text-sm leading-relaxed mb-4 ${vis.subtext}`}>{t(`${txt}.desc`)}</p>
        {isAwaiting && activeApp.awaitingInfoMessage && (
          <div className="bg-white border border-orange-200 rounded-xl p-3 mb-4">
            <p className="text-xs font-semibold text-orange-700 mb-1">
              {t('patient.dashboard.statusCard.awaiting_info.messageFrom', { agency: activeApp.agencyName })}
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">{activeApp.awaitingInfoMessage}</p>
          </div>
        )}
        <button
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors ${vis.btnClass}`}
          onClick={() => navigate(vis.path)}>
          {t(`${txt}.btn`)} →
        </button>
        <p className="text-xs text-center mt-2 text-gray-500">
          {activeApp.appId} · {activeApp.agencyName} · {t('patient.dashboard.metadata.submittedOn', { date: formatDate(activeApp.submittedAt) })}
        </p>
      </div>
    )
  }

  // 5. only rejected/closed apps
  if (appCount > 0) {
    return (
      <div className="card p-5 border-2 border-red-200 bg-red-50">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-red-100 text-red-600">
            <MdCancel size={22} />
          </div>
          <h2 className="text-lg font-bold text-red-800">{t('patient.dashboard.rejectedCard.title')}</h2>
        </div>
        <p className="text-sm text-red-700 leading-relaxed mb-4">
          {appCount === 1
            ? t('patient.dashboard.rejectedCard.descOne')
            : t('patient.dashboard.rejectedCard.descMany', { count: appCount })}
        </p>
        <button
          className="w-full py-3 rounded-xl font-semibold text-sm bg-brand-500 hover:bg-brand-600 text-white transition-colors"
          onClick={() => navigate('/patient/programs')}>
          {t('patient.dashboard.rejectedCard.btn')} →
        </button>
      </div>
    )
  }

  // 6. some progress or dismissed welcome → compact link
  if (welcomeDismissed || docStats.verified > 0 || docStats.pending > 0) {
    return (
      <button
        className="w-full card p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors border border-brand-100"
        onClick={() => navigate('/patient/guide')}>
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
          <MdMenuBook size={20} className="text-brand-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800">{t('patient.dashboard.welcomeCard.newToMapa')}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('patient.dashboard.welcomeCard.compactSub')}</p>
        </div>
        <MdArrowForward size={16} className="text-gray-300 flex-shrink-0" />
      </button>
    )
  }

  // 7. brand-new patient → welcome hero
  return (
    <div className="card p-5 border-2 border-brand-200 bg-brand-50 relative">
      <button
        onClick={dismissWelcome}
        aria-label={t('common.close')}
        className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center text-brand-400 hover:text-brand-700 hover:bg-brand-100 rounded-lg transition-colors">
        <MdClose size={16} />
      </button>
      <div className="flex items-center gap-3 mb-3 pr-8">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-brand-100 text-brand-600">
          <MdLocalHospital size={22} />
        </div>
        <h2 className="text-lg font-bold text-brand-800">{t('patient.dashboard.welcomeCard.title')}</h2>
      </div>
      <p className="text-sm text-brand-700 leading-relaxed mb-3">{t('patient.dashboard.welcomeCard.intro')}</p>
      <div className="bg-white border border-brand-100 rounded-xl p-3 mb-4">
        <p className="text-xs font-semibold text-brand-700 mb-2 uppercase tracking-wide">{t('patient.dashboard.welcomeCard.whatYouCanApplyFor')}</p>
        <ul className="text-xs text-gray-700 space-y-1">
          <li className="flex items-start gap-2"><span className="text-brand-500 flex-shrink-0">•</span>{t('patient.dashboard.welcomeCard.hospitalBills')}</li>
          <li className="flex items-start gap-2"><span className="text-brand-500 flex-shrink-0">•</span>{t('patient.dashboard.welcomeCard.medicines')}</li>
          <li className="flex items-start gap-2"><span className="text-brand-500 flex-shrink-0">•</span>{t('patient.dashboard.welcomeCard.labTests')}</li>
          <li className="flex items-start gap-2"><span className="text-brand-500 flex-shrink-0">•</span>{t('patient.dashboard.welcomeCard.chemotherapy')}</li>
        </ul>
        <p className="text-xs text-gray-500 mt-2">{t('patient.dashboard.welcomeCard.fromAgencies')}</p>
      </div>
      <button
        className="w-full py-3 rounded-xl font-semibold text-sm bg-brand-500 hover:bg-brand-600 text-white transition-colors"
        onClick={() => navigate('/patient/request')}>
        {t('patient.dashboard.welcomeCard.getStarted')} →
      </button>
      <button
        className="w-full mt-2 min-h-[44px] inline-flex items-center justify-center text-sm text-brand-600 hover:text-brand-800 transition-colors"
        onClick={() => navigate('/patient/guide')}>
        {t('patient.dashboard.welcomeCard.newToMapa')} →
      </button>
    </div>
  )
}
