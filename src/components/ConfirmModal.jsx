import { useState, useEffect } from 'react'
import {
  MdClose, MdInfo, MdWarning, MdCheckCircle, MdBlock,
} from 'react-icons/md'

// Tone presets so call sites only pass `tone='danger'` etc. instead of
// re-specifying icon + colors at every dialog.
const TONE_CONFIG = {
  primary: {
    icon:    MdInfo,
    iconBg:  'bg-brand-50',
    iconCls: 'text-brand-500',
    btnCls:  'bg-brand-500 hover:bg-brand-600 text-white',
  },
  info: {
    icon:    MdInfo,
    iconBg:  'bg-blue-50',
    iconCls: 'text-blue-500',
    btnCls:  'bg-blue-500 hover:bg-blue-600 text-white',
  },
  warning: {
    icon:    MdWarning,
    iconBg:  'bg-amber-50',
    iconCls: 'text-amber-500',
    btnCls:  'bg-amber-500 hover:bg-amber-600 text-white',
  },
  danger: {
    icon:    MdBlock,
    iconBg:  'bg-red-50',
    iconCls: 'text-red-500',
    btnCls:  'bg-red-500 hover:bg-red-600 text-white',
  },
  success: {
    icon:    MdCheckCircle,
    iconBg:  'bg-green-50',
    iconCls: 'text-green-500',
    btnCls:  'bg-green-500 hover:bg-green-600 text-white',
  },
}

/**
 * Generic in-app confirmation modal. Replaces native window.confirm and
 * window.prompt so the app's theming + mobile behavior stay consistent.
 *
 * Props:
 * - open:              boolean — render only when true
 * - onClose:           fn() — fires on Cancel / backdrop click / Escape
 * - onConfirm:         async fn(reason?: string) — called on confirm. May
 *                      throw; the modal tracks in-flight state and stays
 *                      open if it throws so the user can retry.
 * - title:             string
 * - body:              string | ReactNode
 * - confirmLabel:      string (default 'Confirm')
 * - confirmLabelBusy:  string (default 'Working…')
 * - cancelLabel:       string (default 'Cancel')
 * - tone:              'primary' | 'info' | 'warning' | 'danger' | 'success'
 * - Icon:              optional override icon
 * - withReason:        boolean — show a textarea; reason is passed to onConfirm
 * - reasonPlaceholder: string
 * - reasonRequired:    boolean — confirm button stays disabled until non-empty
 * - reasonMaxLength:   number (default 500)
 */
export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  confirmLabelBusy = 'Working…',
  cancelLabel = 'Cancel',
  tone = 'primary',
  Icon: CustomIcon,
  withReason = false,
  reasonPlaceholder = 'Reason…',
  reasonRequired = false,
  reasonMaxLength = 500,
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy]     = useState(false)

  // Reset transient state whenever the modal opens fresh.
  useEffect(() => {
    if (open) { setReason(''); setBusy(false) }
  }, [open])

  // Escape closes (matches native dialog behavior). Disabled while in flight.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const cfg  = TONE_CONFIG[tone] ?? TONE_CONFIG.primary
  const Icon = CustomIcon ?? cfg.icon

  const canConfirm = !busy && (!reasonRequired || reason.trim().length > 0)

  const handleConfirm = async () => {
    if (!canConfirm) return
    setBusy(true)
    try {
      await onConfirm(withReason ? reason.trim() : undefined)
      // Caller is expected to close the modal on success (via onClose) so
      // it can decide based on outcome. We just release the busy gate.
    } catch (err) {
      // Errors bubble back here so the modal stays open for retry. The
      // caller's own toast / logging handles the user-facing message.
      console.error('[ConfirmModal] action threw:', err)
    } finally {
      setBusy(false)
    }
  }

  const handleClose = () => {
    if (busy) return
    onClose?.()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4 print:hidden"
      onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
          <div className={`w-9 h-9 ${cfg.iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
            <Icon size={18} className={cfg.iconCls} />
          </div>
          <h2 className="text-base font-semibold text-gray-900 flex-1 pt-1">{title}</h2>
          <button onClick={handleClose} disabled={busy}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 flex-shrink-0">
            <MdClose size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {typeof body === 'string'
            ? <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{body}</p>
            : body}

          {withReason && (
            <div>
              <textarea
                className="input resize-none text-sm"
                rows={3}
                placeholder={reasonPlaceholder}
                value={reason}
                maxLength={reasonMaxLength}
                onChange={e => setReason(e.target.value)}
                disabled={busy}
              />
              <div className="flex justify-between mt-1 text-xs">
                <span className={`${reasonRequired && reason.trim().length === 0 ? 'text-red-400' : 'text-transparent'}`}>
                  Reason required
                </span>
                <span className="text-gray-400">{reason.length} / {reasonMaxLength}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-50 bg-gray-50/60 flex gap-2 justify-end">
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={handleClose}>
            {cancelLabel}
          </button>
          <button type="button"
            className={`text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg ${cfg.btnCls} disabled:opacity-60 disabled:cursor-not-allowed`}
            disabled={!canConfirm} onClick={handleConfirm}>
            {busy ? confirmLabelBusy : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}