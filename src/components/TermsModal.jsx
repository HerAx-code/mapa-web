import { useTranslation } from 'react-i18next'
import { MdClose } from 'react-icons/md'
import { useEscapeKey } from '../hooks/useEscapeKey'

// Terms of Use — a readable, bilingual document (docs/session-timeout-and-terms-plan.md).
// Used in two modes:
//   - view: from registration (onClose only) so the patient can read what they
//     agree to via the checkbox.
//   - accept gate: from TermsGate (onAccept + updated), a blocking re-accept
//     prompt for existing patients and on a TERMS_VERSION bump.
// Content lives in the `terms.*` i18n namespace; {{gateway}} is injected.

const POINTS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']

export default function TermsModal({ open, onClose, onAccept, accepting = false, onPrivacy, updated = false }) {
  const { t } = useTranslation()
  useEscapeKey(onClose, !!open && !!onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
         role="dialog" aria-modal="true" aria-labelledby="terms-title">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 id="terms-title" className="text-base font-semibold text-gray-900">{t('terms.title')}</h2>
          {onClose && (
            <button type="button" onClick={onClose} aria-label={t('terms.close')}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
              <MdClose size={20} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {updated && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">{t('terms.updatedTitle')}</p>
              <p className="mt-1 text-sm text-amber-800">{t('terms.updatedBody')}</p>
            </div>
          )}
          <p className="text-sm leading-relaxed text-gray-600">{t('terms.intro')}</p>
          <ol className="mt-4 space-y-3">
            {POINTS.map((p, i) => (
              <li key={p} className="flex gap-3 text-sm leading-relaxed text-gray-700">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                  {i + 1}
                </span>
                <span>{t(`terms.${p}`)}</span>
              </li>
            ))}
          </ol>
          {onPrivacy && (
            <button type="button" onClick={onPrivacy}
              className="mt-4 text-sm font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
              {t('terms.privacyLink')}
            </button>
          )}
        </div>

        <div className="border-t border-gray-100 px-5 py-4">
          {onAccept ? (
            <button type="button" onClick={onAccept} disabled={accepting}
              className="h-11 w-full rounded-xl bg-brand-500 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60">
              {t('terms.acceptBtn')}
            </button>
          ) : (
            <button type="button" onClick={onClose}
              className="h-11 w-full rounded-xl bg-brand-500 text-sm font-semibold text-white transition-colors hover:bg-brand-600">
              {t('terms.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
