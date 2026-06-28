/**
 * Compact 4-step progress indicator for the agency application detail
 * page hero. Extracted from ApplicationDetail.jsx as part of the Phase
 * 2.1 split. Pure presentational; takes an `app` and renders dots.
 *
 * Funding-only agency view: CRMC owns document review + assessment,
 * so the agency's track is just Submit -> For Funding -> Approve ->
 * GL Done.
 */
export default function CompactStepper({ app }) {
  if (app.status === 'rejected') return null

  const glRedeemed = app.glStatus === 'redeemed'

  const steps = [
    { key: 'submitted', label: 'Submit',      done: true,                                              active: false },
    { key: 'reviewing', label: 'For Funding', done: ['approved','certificate'].includes(app.status),  active: ['reviewing','awaiting_info','interview'].includes(app.status) },
    { key: 'approved',  label: 'Approve',     done: ['approved','certificate'].includes(app.status),  active: false },
    { key: 'gl',        label: 'GL Done',     done: glRedeemed,                                        active: app.status === 'certificate' && !glRedeemed },
  ]

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center flex-shrink-0">
          <div className="flex flex-col items-center min-w-14">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              s.done ? 'bg-brand-500 text-white'
              : s.active ? 'border-2 border-amber-400 bg-amber-50 text-amber-500'
              : 'bg-gray-100 text-gray-300'
            }`}>
              {s.done ? '✓' : i + 1}
            </div>
            <p className={`text-xs mt-1 font-medium whitespace-nowrap ${
              s.done ? 'text-gray-700'
              : s.active ? 'text-amber-700'
              : 'text-gray-400'
            }`}>{s.label}</p>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-8 sm:w-12 mt-3 ${
              s.done && steps[i+1].done ? 'bg-brand-300'
              : s.done ? 'bg-amber-200'
              : 'bg-gray-100'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}
