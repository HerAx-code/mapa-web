// Queue categorization for the admin Requests page (Phase 2 of the request-
// pipeline redesign). Buckets each request by the CRMC processing stage it is
// waiting on, reusing the SAME requestStage model that drives the detail rail
// and the endorse gate — so the tabs, the row's stage chip, and the endorse
// blockers can never disagree.
//
// Read-only by design: the document signal comes from request.attachedDocuments
// (already on the request doc, kept in lockstep by the verify handlers in
// admin/Requests.jsx), so bucketing needs no per-request document reads and no
// denormalized count fields.

import { deriveRequestStage, TERMINAL_REQUEST_STATUSES } from './requestStage'

// verify → assess → interview → endorse (the pre-endorsement stages), then
// endorsed (awaiting agencies) and completed (terminal).
export const QUEUE_BUCKETS = ['verify', 'assess', 'interview', 'endorse', 'endorsed', 'completed']

// Post-endorsement, pre-terminal statuses — the request is out of CRMC's hands
// and waiting on agencies. ('endorsing' is the brief transient at endorse time.)
const ENDORSED_STATUSES = ['endorsed', 'partially_funded', 'endorsing']

export const BUCKET_LABELS = {
  verify:    'Needs verification',
  assess:    'Needs assessment',
  interview: 'Needs interview',
  endorse:   'Ready to endorse',
  endorsed:  'Endorsed',
  completed: 'Completed',
  all:       'All',
}

// Tab order in the UI: the six buckets, then All.
export const QUEUE_TABS = [...QUEUE_BUCKETS, 'all']

// Documents are stored on the request as attachedDocuments[{documentId, status}],
// kept in sync by reviewDoc / bulkVerifyPending. Shape them for the stage model.
export function requestDocs(request) {
  return (request?.attachedDocuments ?? []).map(a => ({ status: a?.status ?? 'pending' }))
}

// Which queue bucket a request belongs to.
export function bucketOf(request) {
  const status = request?.status
  if (TERMINAL_REQUEST_STATUSES.includes(status)) return 'completed'
  if (ENDORSED_STATUSES.includes(status)) return 'endorsed'
  // Pre-endorsement: the stage model's current stage IS the bucket
  // (verify / assess / interview / endorse).
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
