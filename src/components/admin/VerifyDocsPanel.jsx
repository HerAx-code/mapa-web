import { useState } from 'react'
import { MdCheckCircle, MdDescription, MdVisibility, MdBlock, MdRefresh, MdCompareArrows, MdBadge, MdFace, MdOpenInNew } from 'react-icons/md'
import { isIdType, isSelfieType } from '../../utils/idOcr'
import { tsToDate } from '../../utils/dates'
import StatusBadge from '../ui/StatusBadge'

// Advisory verdict → text colour, reusing the OCR line's green/amber/gray
// pattern: pass = green ✓, unclear = amber ⚠, null/absent = gray "verify manually".
const advisoryTone = (v) => v === 'pass' ? 'text-green-600' : v === 'unclear' ? 'text-amber-600' : 'text-gray-500'

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
  reqDocs, busy, allVerified, ocrExpanded, accountName,
  onBulkVerify, onReviewDoc, onView, onReject, onUnverify, onToggleOcr, onCompare,
  onConfirmIdentity, onRequestRedo,
}) {
  // The ID doc a selfie's face-match is compared against (for the side-by-side).
  const idDoc     = reqDocs.find(x => isIdType(x.documentTypeName ?? x.name) && !x._missing) ?? null
  const selfieDoc = reqDocs.find(x => isSelfieType(x.documentTypeName ?? x.name) && !x._missing) ?? null
  // Batch "Verify all" commits every pending doc in one tap, so it confirms
  // first (single-doc Verify stays one-click for a fast review queue).
  const [confirmBulk, setConfirmBulk] = useState(false)
  const pendingDocs = reqDocs.filter(d => d.status === 'pending' && !d._missing)
  return (
    <div className="space-y-4">
    {/* ⓘ Identity review (ID-verification Phase 5) — the social-worker identity
        card the whole PhilSys-first flow feeds into. Every signal is advisory;
        the SW confirms or asks the patient to redo. Only rendered once an ID or
        selfie doc exists. */}
    {(idDoc || selfieDoc) && (onConfirmIdentity || onRequestRedo) && (
      <IdentityReview
        idDoc={idDoc} selfieDoc={selfieDoc} accountName={accountName} busy={busy}
        onView={onView} onCompare={onCompare}
        onConfirmIdentity={onConfirmIdentity} onRequestRedo={onRequestRedo} />
    )}
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
          Verify documents
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {pendingDocs.length >= 2 && (
            confirmBulk ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="text-gray-600">Verify all {pendingDocs.length} pending?</span>
                <button type="button" onClick={() => setConfirmBulk(false)}
                  className="text-gray-500 border border-gray-200 bg-white px-2 py-1 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="button" disabled={busy}
                  onClick={() => { setConfirmBulk(false); onBulkVerify(pendingDocs) }}
                  className="text-white bg-green-600 px-2.5 py-1 rounded-lg hover:bg-green-700 font-semibold disabled:opacity-50">Verify all</button>
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmBulk(true)}
                className="text-xs font-medium text-green-700 hover:text-green-800 inline-flex items-center gap-1 disabled:opacity-50"
                title="Mark every Pending document on this request as Verified">
                <MdCheckCircle size={14} /> Verify all pending ({pendingDocs.length})
              </button>
            )
          )}
          {reqDocs.length > 0 && (
            <span className={`badge text-xs ${allVerified ? 'badge-green' : 'badge-amber'}`}>
              {reqDocs.filter(d => d.status === 'verified').length}/{reqDocs.length} verified
            </span>
          )}
        </div>
      </div>
      {reqDocs.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No documents attached.</p>
      ) : (
        <div className="space-y-2">
          {reqDocs.map(d => {
            const isId     = isIdType(d.documentTypeName ?? d.name)
            const isSelfie = isSelfieType(d.documentTypeName ?? d.name)
            const showOcr  = isId && (d.ocrMatch != null || d.ocrText || d.idTypeDetected)
            // Selfie face-match / liveness block: show once the on-device check
            // has run (idVerifyMethod stamped), even if a verdict came back null.
            const showFace = isSelfie && (d.idVerifyMethod != null || d.faceMatch !== undefined || d.liveness !== undefined)
            const reviewed = (d.status === 'verified' || d.status === 'rejected') && d.reviewedAt
            return (
              <div key={d.id} className="p-2.5 rounded-lg border border-gray-100">
                <div className="flex items-center gap-2">
                  <MdDescription size={16} className="text-gray-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{d.documentTypeName || d.name}</p>
                    {reviewed && (
                      <p className="text-xs text-gray-500 truncate">
                        {d.status === 'verified' ? 'Verified' : 'Rejected'} by {d.reviewedBy ?? 'CRMC'} · {fmtDate(d.reviewedAt)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={d.status ?? 'pending'} kind="doc" className="flex-shrink-0" />
                  <button title="View" className="text-gray-500 hover:text-brand-600 flex-shrink-0"
                    onClick={() => !d._missing && onView(d)}>
                    <MdVisibility size={16} />
                  </button>
                </div>
                {showOcr && (
                  <div className="mt-1 pl-6">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-xs ${d.ocrMatch === true ? 'text-green-600' : d.ocrMatch === false ? 'text-amber-600' : 'text-gray-500'}`}>
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
                    {d.idTypeDetected && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Detected type: <span className="font-medium text-gray-700">{d.idTypeDetected}</span>
                        <span className="text-gray-500"> — confirm</span>
                      </p>
                    )}
                    {typeof d.ocrConfidence === 'number' && (
                      <p className={`text-xs mt-0.5 ${d.ocrConfidence < 55 ? 'text-amber-600' : 'text-gray-500'}`}>
                        OCR read confidence: <span className="font-medium">{d.ocrConfidence}%</span>
                        {d.ocrConfidence < 55 && <span> — low, the photo may be blurry/dark</span>}
                      </p>
                    )}
                    {ocrExpanded.has(d.id) && d.ocrText && (
                      <pre className="mt-1.5 max-h-40 overflow-auto bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs text-gray-600 font-mono whitespace-pre-wrap break-words">
                        {d.ocrText}
                      </pre>
                    )}
                  </div>
                )}
                {showFace && (
                  <div className="mt-1 pl-6 space-y-0.5">
                    <p className={`text-xs ${advisoryTone(d.faceMatch)}`}>
                      {d.faceMatch === 'pass' ? '✓ Face match: likely the same person'
                        : d.faceMatch === 'unclear' ? '⚠ Face match: unclear — compare manually'
                        : 'Face match: could not check — compare manually'}
                      {typeof d.faceMatchScore === 'number' && <span className="text-gray-500"> · {d.faceMatchScore.toFixed(2)}</span>}
                    </p>
                    <p className={`text-xs ${advisoryTone(d.liveness)}`}>
                      {d.liveness === 'pass' ? '✓ Liveness: looks like a live capture'
                        : d.liveness === 'unclear' ? '⚠ Liveness: hard to confirm — compare manually'
                        : 'Liveness: could not check'}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                      {idDoc && !d._missing && (
                        <button type="button"
                          onClick={() => onCompare?.(d, idDoc)}
                          className="text-xs text-brand-500 hover:text-brand-600 font-medium inline-flex items-center gap-1 underline underline-offset-2">
                          <MdCompareArrows size={13} /> Compare with ID side-by-side
                        </button>
                      )}
                      <span className="text-[11px] text-gray-500 italic">Advisory — you make the final call.</span>
                    </div>
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
    </div>
  )
}

// ── Identity review card ────────────────────────────────────────────────────
// Reasons the SW can pick when asking the patient to redo their identity capture.
// Each maps to which doc gets reset to 'pending' (selfie vs ID) so the patient is
// sent to re-capture the right thing.
const REDO_REASONS = [
  { value: 'Selfie too dark / blurry', target: 'selfie' },
  { value: "Face doesn't match ID",    target: 'selfie' },
  { value: 'ID expired or unreadable', target: 'id' },
  { value: 'Other (message patient)',  target: 'selfie' },
]

// ID-source line from the advisory PhilSys metadata on the ID doc (Phase 3).
function idSourceCheck(idDoc) {
  if (!idDoc) return { label: 'No ID uploaded yet', tone: 'text-gray-500' }
  const m = idDoc.idVerifyMethod
  const pcn = idDoc.pcnLast4 ? ` · PCN ${idDoc.pcnLast4}` : ''
  if (m === 'philid_qr') {
    return idDoc.philIdSigValid === true
      ? { label: `National ID · PSA signature valid${pcn}`, tone: 'text-green-600' }
      : { label: `National ID · signature unverified${pcn}`, tone: 'text-amber-600' }
  }
  if (m === 'pcn_manual') return { label: `PCN entered manually · unverified${pcn}`, tone: 'text-amber-600' }
  return { label: 'Other valid ID', tone: 'text-gray-500' }
}

function CheckRow({ label, value, tone = 'text-gray-900', last = false }) {
  return (
    <div className={`flex items-start justify-between gap-3 text-sm ${last ? '' : 'pb-2 border-b border-gray-100'}`}>
      <span className="text-gray-600 flex-shrink-0">{label}</span>
      <span className={`font-semibold text-right ${tone}`}>{value}</span>
    </div>
  )
}

function PhotoTile({ label, doc, icon, onView }) {
  const Icon = icon
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-semibold text-gray-700">{label}</div>
      {doc ? (
        <button type="button" onClick={() => onView?.(doc)}
          className="group relative h-44 rounded-xl bg-gray-100 border border-gray-200 hover:border-brand-300 flex flex-col items-center justify-center gap-1.5 text-gray-400">
          <Icon size={40} />
          <span className="text-xs font-medium text-brand-600 inline-flex items-center gap-1">
            <MdOpenInNew size={13} /> View
          </span>
        </button>
      ) : (
        <div className="h-44 rounded-xl bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center text-xs text-gray-400 text-center px-3">
          Not provided yet
        </div>
      )}
    </div>
  )
}

function IdentityReview({ idDoc, selfieDoc, accountName, busy, onView, onCompare, onConfirmIdentity, onRequestRedo }) {
  const [reason, setReason] = useState('')
  // "Confirm identity" verifies the ID + selfie docs in one tap, so it confirms first.
  const [confirmId, setConfirmId] = useState(false)
  const src = idSourceCheck(idDoc)

  const nameCheck = idDoc?.ocrMatch === true
    ? { value: 'Matches account', tone: 'text-green-600' }
    : idDoc?.ocrMatch === false
      ? { value: 'Not auto-matched — check', tone: 'text-amber-600' }
      : { value: 'Could not auto-read — check', tone: 'text-gray-500' }

  const face = selfieDoc?.faceMatch
  const faceCheck = face === 'pass'
    ? { value: 'Likely same person', tone: 'text-green-600' }
    : face === 'unclear' ? { value: 'Unclear — compare', tone: 'text-amber-600' }
    : { value: 'Could not check — compare', tone: 'text-gray-500' }

  const live = selfieDoc?.liveness
  const liveCheck = live === 'pass'
    ? { value: 'Pass', tone: 'text-green-600' }
    : live === 'unclear' ? { value: 'Unclear', tone: 'text-amber-600' }
    : { value: 'Could not check', tone: 'text-gray-500' }

  const identityVerified = (!idDoc || idDoc.status === 'verified') && (!selfieDoc || selfieDoc.status === 'verified') && (idDoc || selfieDoc)

  const requestRedo = () => {
    if (!reason) return
    const spec = REDO_REASONS.find(r => r.value === reason)
    const target = spec?.target === 'id' ? (idDoc ?? selfieDoc) : (selfieDoc ?? idDoc)
    if (target) onRequestRedo?.(target, reason)
    setReason('')
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <MdBadge size={16} className="text-brand-600" /> Identity
        </h3>
        {idDoc && (
          <span className="text-xs text-gray-500">Signals are advisory. You make the final decision.</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
        <PhotoTile label="Photo from ID" doc={idDoc} icon={MdBadge} onView={onView} />
        <PhotoTile label="Live selfie" doc={selfieDoc} icon={MdFace} onView={onView} />
        <div className="flex flex-col gap-2.5">
          <div className="text-[13px] font-semibold text-gray-700">Checks</div>
          <CheckRow label="ID source" value={src.label} tone={src.tone} />
          <CheckRow label="Name vs account" value={nameCheck.value} tone={nameCheck.tone} />
          <CheckRow label="Face match" value={faceCheck.value} tone={faceCheck.tone} />
          <CheckRow label="Liveness" value={liveCheck.value} tone={liveCheck.tone} />
          {idDoc?.pcnFingerprint && (
            <CheckRow label="Card used by another account" value="No automatic cross-check — verify at counter" tone="text-gray-500" />
          )}
          <CheckRow label="Access code" value="Issued in person · ID seen at counter" last />
        </div>
      </div>

      {/* Manual side-by-side face compare — reuses the existing CompareFacesModal. */}
      {idDoc && selfieDoc && onCompare && (
        <button type="button" onClick={() => onCompare(selfieDoc, idDoc)}
          className="mt-3 text-xs text-brand-500 hover:text-brand-600 font-medium inline-flex items-center gap-1 underline underline-offset-2">
          <MdCompareArrows size={13} /> Compare ID and selfie side-by-side
        </button>
      )}

      <div className="flex gap-2 items-center flex-wrap pt-4 mt-3 border-t border-gray-100">
        {identityVerified ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700">
            <MdCheckCircle size={16} /> Identity confirmed
          </span>
        ) : confirmId ? (
          <span className="inline-flex items-center gap-2 text-sm flex-wrap">
            <span className="text-gray-700">Confirm identity? This verifies the ID and selfie.</span>
            <button type="button" onClick={() => setConfirmId(false)}
              className="min-h-[44px] px-3 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Cancel</button>
            <button type="button" disabled={busy || !onConfirmIdentity}
              onClick={() => { setConfirmId(false); onConfirmIdentity?.(idDoc, selfieDoc) }}
              className="min-h-[44px] px-5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">
              Yes, confirm
            </button>
          </span>
        ) : (
          <button type="button" disabled={busy || !onConfirmIdentity}
            onClick={() => setConfirmId(true)}
            className="min-h-[44px] px-5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">
            Confirm identity
          </button>
        )}
        <label htmlFor="redo-reason" className="text-sm text-gray-600 ml-1">Or ask the patient to redo:</label>
        <select id="redo-reason" value={reason} onChange={e => setReason(e.target.value)}
          className="min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-900 bg-white">
          <option value="">Choose a reason…</option>
          {REDO_REASONS.map(r => <option key={r.value} value={r.value}>{r.value}</option>)}
        </select>
        <button type="button" disabled={busy || !reason || !onRequestRedo} onClick={requestRedo}
          className="min-h-[44px] px-4 rounded-lg border border-amber-700 text-amber-800 text-sm font-semibold bg-white hover:bg-amber-50 disabled:opacity-50">
          Request redo
        </button>
      </div>
    </div>
  )
}
