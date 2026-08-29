import { MdCheckCircle, MdDescription, MdVisibility, MdBlock, MdRefresh } from 'react-icons/md'
import { isIdType } from '../../utils/idOcr'
import { tsToDate } from '../../utils/dates'
import StatusBadge from '../ui/StatusBadge'

// ① Verify documents — the CRMC document-review panel, extracted verbatim from
// admin/Requests.jsx (redesign Phase 0: decompose the 1,700-line file). Pure
// presentational; the parent owns the data (reqDocs) and the mutations
// (verify / reject / reset / bulk-verify, OCR expand, viewer). Same DOM as
// before — behaviour unchanged.
const fmtDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

export default function VerifyDocsPanel({
  reqDocs, busy, allVerified, ocrExpanded,
  onBulkVerify, onReviewDoc, onView, onReject, onUnverify, onToggleOcr,
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
          Verify documents
        </h3>
        <div className="flex items-center gap-2">
          {(() => {
            const pendingDocs = reqDocs.filter(d => d.status === 'pending' && !d._missing)
            if (pendingDocs.length < 2) return null
            return (
              <button
                type="button"
                disabled={busy}
                onClick={() => onBulkVerify(pendingDocs)}
                className="text-xs font-medium text-green-700 hover:text-green-800 inline-flex items-center gap-1 disabled:opacity-50"
                title="Mark every Pending document on this request as Verified">
                <MdCheckCircle size={14} /> Verify all pending ({pendingDocs.length})
              </button>
            )
          })()}
          {reqDocs.length > 0 && (
            <span className={`badge text-xs ${allVerified ? 'badge-green' : 'badge-amber'}`}>
              {reqDocs.filter(d => d.status === 'verified').length}/{reqDocs.length} verified
            </span>
          )}
        </div>
      </div>
      {reqDocs.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No documents attached.</p>
      ) : (
        <div className="space-y-2">
          {reqDocs.map(d => {
            const showOcr = isIdType(d.documentTypeName ?? d.name) && (d.ocrMatch != null || d.ocrText)
            const reviewed = (d.status === 'verified' || d.status === 'rejected') && d.reviewedAt
            return (
              <div key={d.id} className="p-2.5 rounded-lg border border-gray-100">
                <div className="flex items-center gap-2">
                  <MdDescription size={16} className="text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{d.documentTypeName || d.name}</p>
                    {reviewed && (
                      <p className="text-xs text-gray-400 truncate">
                        {d.status === 'verified' ? 'Verified' : 'Rejected'} by {d.reviewedBy ?? 'CRMC'} · {fmtDate(d.reviewedAt)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={d.status ?? 'pending'} kind="doc" className="flex-shrink-0" />
                  <button title="View" className="text-gray-400 hover:text-brand-600 flex-shrink-0"
                    onClick={() => !d._missing && onView(d)}>
                    <MdVisibility size={16} />
                  </button>
                </div>
                {showOcr && (
                  <div className="mt-1 pl-6">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-xs ${d.ocrMatch === true ? 'text-green-600' : d.ocrMatch === false ? 'text-amber-600' : 'text-gray-400'}`}>
                        {d.ocrMatch === true ? '✓ OCR: ID name matches the account'
                          : d.ocrMatch === false ? '⚠ OCR: name not auto-matched — verify manually'
                          : 'OCR: could not auto-read — verify manually'}
                      </p>
                      {/* Show-text toggle helps the verifier judge a no-match
                          verdict. Without seeing what OCR read, "no match"
                          is opaque -- could be misread, mistyped at
                          registration, or a wrong ID. */}
                      {d.ocrText && (
                        <button type="button"
                          onClick={() => onToggleOcr(d.id)}
                          className="text-xs text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2">
                          {ocrExpanded.has(d.id) ? 'Hide OCR text' : 'See what OCR read'}
                        </button>
                      )}
                    </div>
                    {ocrExpanded.has(d.id) && d.ocrText && (
                      <pre className="mt-1.5 max-h-40 overflow-auto bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs text-gray-600 font-mono whitespace-pre-wrap break-words">
                        {d.ocrText}
                      </pre>
                    )}
                  </div>
                )}
                <div className="flex gap-2 mt-2 pl-6 flex-wrap">
                  {d.status !== 'verified' && (
                    <button className="text-xs font-medium text-green-600 hover:text-green-700 flex items-center gap-1 disabled:opacity-50"
                      disabled={busy} onClick={() => onReviewDoc(d, 'verified')}>
                      <MdCheckCircle size={14} /> Verify
                    </button>
                  )}
                  {d.status !== 'verified' && d.status !== 'rejected' && (
                    <button className="text-xs font-medium text-red-500 hover:text-red-600 flex items-center gap-1 disabled:opacity-50"
                      disabled={busy} onClick={() => onReject(d)}>
                      <MdBlock size={14} /> Reject
                    </button>
                  )}
                  {(d.status === 'verified' || d.status === 'rejected') && (
                    <button className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:opacity-50"
                      disabled={busy} onClick={() => onUnverify(d)}
                      title="Mark this document as Pending review again">
                      <MdRefresh size={14} /> Reset to Pending
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
