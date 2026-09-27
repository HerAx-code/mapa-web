import { useTranslation } from 'react-i18next'
import { MdCheck, MdArrowForward } from 'react-icons/md'

// A GOV.UK-style task list for the patient's active request: one clear next
// action on top, then the ordered tasks with a state pill each. The rows are
// the orientation layer over the detailed sections below (intake, coverage,
// documents) — tapping a row runs its onClick (navigate or scroll-to-section),
// so "what do I do now" is unambiguous and the flow stays resumable.
//
// Presentational: the caller derives `tasks` (each { key, label, state, onClick? })
// and the single `nextAction` ({ label, onClick }) from live data. State ∈
// done | in_progress | not_started | action_needed. i18n: patient.request.tasks.*
const PILL = {
  done:          'badge-green',
  in_progress:   'badge-amber',
  action_needed: 'badge-red',
  not_started:   'badge-gray',
}

export default function TaskList({ tasks = [], nextAction = null }) {
  const { t } = useTranslation()

  return (
    <div className="card p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold text-gray-900">{t('patient.request.tasks.title')}</h2>

      {nextAction && (
        <button
          type="button"
          onClick={nextAction.onClick}
          className="mt-3 w-full flex items-center gap-3 rounded-xl bg-brand-600 px-4 py-3 text-left text-white transition-colors hover:bg-brand-700 min-h-[44px]">
          <MdArrowForward size={18} className="flex-shrink-0" />
          <span className="flex-1 text-sm font-semibold">{nextAction.label}</span>
        </button>
      )}

      <ol className="mt-4 divide-y divide-gray-50 border-t border-gray-100">
        {tasks.map((task, i) => {
          const done = task.state === 'done'
          const Row = task.onClick ? 'button' : 'div'
          return (
            <Row
              key={task.key}
              onClick={task.onClick}
              className={`w-full flex items-center gap-3 py-3.5 text-left min-h-[44px] ${task.onClick ? 'hover:bg-gray-50 cursor-pointer' : ''}`}>
              <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done ? 'bg-brand-500 text-white' : 'border-2 border-gray-200 text-gray-500'
              }`}>
                {done ? <MdCheck size={15} /> : i + 1}
              </span>
              <span className="flex-1 min-w-0 text-sm text-gray-700">{task.label}</span>
              <span className={`badge ${PILL[task.state] ?? 'badge-gray'} text-xs flex-shrink-0`}>
                {t(`patient.request.tasks.state.${task.state}`)}
              </span>
            </Row>
          )
        })}
      </ol>
    </div>
  )
}
