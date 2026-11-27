// Queue categorization for the admin Requests page (Phase 2 of the request-
// pipeline redesign). Buckets each request by the gateway processing stage it is
// waiting on, reusing the SAME requestStage model that drives the detail rail
// and the endorse gate — so the tabs, the row's stage chip, and the endorse
// blockers can never disagree.
//
// Read-only by design: the document signal comes from request.attachedDocuments
// (already on the request doc, kept in lockstep by the verify handlers in
// admin/Requests.jsx), so bucketing needs no per-request document reads and no
// denormalized count fields.

import { deriveRequestStage, TERMINAL_REQUEST_STATUSES } from './requestStage'
import { caseTimerDays } from '../shared/caseTimers'
import { isRequestFinished } from '../shared/caseState'

// verify → assess → endorse (the pre-endorsement stages), then decide
// (endorsed, but nothing waiting at any agency: "Endorse more or close",
// Phase 4 PR 4.1, P4-A), endorsed (awaiting agencies) and completed (terminal).
export const QUEUE_BUCKETS = ['verify', 'assess', 'endorse', 'decide', 'endorsed', 'completed']

// Post-endorsement, pre-terminal statuses — the request is out of the gateway's hands
// and waiting on agencies. ('endorsing' is the brief transient at endorse time.)
const ENDORSED_STATUSES = ['endorsed', 'partially_funded', 'endorsing']

export const BUCKET_LABELS = {
  verify:    'Needs verification',
  assess:    'Needs assessment',
  endorse:   'Ready to endorse',
  decide:    'Endorse more or close',
  endorsed:  'Endorsed',
  completed: 'Completed',
  all:       'All',
}

// Tab order in the UI: the six buckets, then All.
export const QUEUE_TABS = [...QUEUE_BUCKETS, 'all']

// Documents are stored on the request as attachedDocuments[{documentId, status}],
// kept in step with the documents by the syncDocumentStatus function (Phase 3
// PR 3.1). Shape them for the stage model.
export function requestDocs(request) {
  return (request?.attachedDocuments ?? []).map(a => ({ status: a?.status ?? 'pending' }))
}

// Phase 4 PR 4.1 (P4-A): endorsed, and nothing waiting at any agency — the
// hospital endorses to another agency or closes it, else the case timers close
// it after the hospital's limit (hospitalSettings.nothingPendingDays, default 7).
// `nothingPendingSince` is stamped on the server (syncRequestFinancials).
export const isEndorseMoreOrClose = (request) =>
  !!request?.nothingPendingSince && !TERMINAL_REQUEST_STATUSES.includes(request?.status)
export function autoCloseInDays(request, settings = {}, now = Date.now()) {
  const since = request?.nothingPendingSince
  const ms = since?.toMillis ? since.toMillis() : since?.seconds != null ? since.seconds * 1000 : null
  if (!isEndorseMoreOrClose(request) || ms == null) return null
  const days = caseTimerDays(settings, 'nothingPendingDays')
  return Math.max(0, Math.ceil((ms + days * 86400000 - now) / 86400000))
}

// Fully funded but a guarantee letter is still open (not redeemed, expired or
// reversed): the case isn't finished (D4, src/shared/caseState.js), so the
// queue keeps it with the agencies until every letter is settled.
const lettersStillOpen = (request) => request?.status === 'fully_funded' && !isRequestFinished(request)

// Which queue bucket a request belongs to.
export function bucketOf(request) {
  const status = request?.status
  if (lettersStillOpen(request)) return 'endorsed'
  if (TERMINAL_REQUEST_STATUSES.includes(status)) return 'completed'
  if (isEndorseMoreOrClose(request)) return 'decide'
  if (ENDORSED_STATUSES.includes(status)) return 'endorsed'
  // Pre-endorsement: the stage model's current stage IS the bucket
  // (verify / assess / endorse).
  const stage = deriveRequestStage(request, requestDocs(request))
  return stage.current ?? 'verify'
}

// Verified / total document counts (+ a blocking flag) for the "docs X/N" column.
export function docCounts(request) {
  const docs = request?.attachedDocuments ?? []
  return {
    verified: docs.filter(a => a?.status === 'verified').length,
    total:    docs.length,
    blocking: docs.some(a => a?.status === 'rejected'),
  }
}

// Count requests per bucket (+ all) in a single pass.
export function bucketCounts(requests = []) {
  const counts = { all: requests.length }
  for (const key of QUEUE_BUCKETS) counts[key] = 0
  for (const r of requests) counts[bucketOf(r)] += 1
  return counts
}

// ── Coarse queue tabs (Magic Patterns adoption) ─────────────────────────────
// The queue's top-level categorization is the coarser action-oriented set the
// MP reference uses; the fine stage (verify/assess/endorse above)
// still drives each ROW's stage chip. Default landing tab is 'needs_action' —
// the work actually blocked on the gateway.

export const COARSE_TABS = ['needs_action', 'under_review', 'awaiting_agency', 'resolved', 'all']

export const COARSE_LABELS = {
  needs_action:   'Needs action',
  under_review:   'Under review',
  awaiting_agency:'Awaiting agency',
  resolved:       'Resolved',
  all:            'All requests',
}

export function coarseBucketOf(request) {
  const status = request?.status
  if (lettersStillOpen(request)) return 'awaiting_agency'
  if (TERMINAL_REQUEST_STATUSES.includes(status)) return 'resolved'
  // Endorsed, nothing waiting at any agency: the hospital's move (P4-A).
  if (isEndorseMoreOrClose(request)) return 'needs_action'
  if (ENDORSED_STATUSES.includes(status)) return 'awaiting_agency'
  // Pre-endorsement: a freshly-submitted request, or one with a blocking
  // (rejected) document, needs the gateway to act; anything else is under active review.
  const blocking = (request?.attachedDocuments ?? []).some(a => a?.status === 'rejected')
  if (status === 'submitted' || blocking) return 'needs_action'
  return 'under_review'
}

export function coarseCounts(requests = []) {
  const counts = { all: requests.length }
  for (const key of COARSE_TABS) counts[key] = 0
  counts.all = requests.length
  for (const r of requests) counts[coarseBucketOf(r)] += 1
  return counts
}

// ── Lifecycle stage labels + counts (shared by the dashboard + analytics
// pipeline panels, so the status→label mapping lives in one place). ──────────
export const LIFECYCLE_STAGE_LABELS = {
  submitted:        'Submitted',
  under_review:     'Under review',
  assessment:       'Assessment',
  endorsed:         'Endorsed',
  partially_funded: 'Partially funded',
  fully_funded:     'Fully funded',
}

// Count requests per lifecycle status, in the given order, as
// [{ key, label, count }] — the shape PipelineFunnel expects.
// Nothing writes 'assessment' any more (the assessment step is derived from
// the documents and intake sheet), so the pipeline has no "Assessment" bar;
// the few older requests still stored with it count as "Under review" (N15).
const stageKeyOf = (status) => (status === 'assessment' ? 'under_review' : status)
export function stageCounts(requests = [], keys = []) {
  return keys.map(key => ({
    key,
    label: LIFECYCLE_STAGE_LABELS[key] ?? key,
    count: requests.filter(r => stageKeyOf(r?.status) === key).length,
  }))
}
