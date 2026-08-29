import { describe, it, expect } from 'vitest'
import {
  QUEUE_BUCKETS, QUEUE_TABS, BUCKET_LABELS,
  bucketOf, docCounts, bucketCounts, requestDocs,
} from '../../src/utils/queueBuckets.js'

// A fully-filled intake sheet (mirrors isIntakeComplete's 6 required fields).
const completeIntake = {
  householdSize: 4, monthlyIncome: 8000, diagnosis: 'CKD',
  recommendation: 'Endorse for dialysis assistance',
  meansTestCategory: 'indigent', completedBy: 'SW Ana',
}

const docs = (...statuses) => statuses.map((status, i) => ({ documentId: `d${i}`, status }))

// Build a request at a given point in the pipeline.
const req = (over = {}) => ({
  status: 'under_review',
  attachedDocuments: docs('pending'),
  intakeSheet: null,
  interviewOutcome: null,
  ...over,
})

describe('bucketOf — pre-endorsement stages', () => {
  it('verify: documents not all verified', () => {
    expect(bucketOf(req({ attachedDocuments: docs('verified', 'pending') }))).toBe('verify')
    expect(bucketOf(req({ attachedDocuments: docs('rejected', 'verified') }))).toBe('verify')
  })
  it('assess: docs verified but intake incomplete', () => {
    expect(bucketOf(req({
      attachedDocuments: docs('verified', 'verified'),
      intakeSheet: null,
    }))).toBe('assess')
  })
  it('interview: docs verified + intake complete, no outcome yet', () => {
    expect(bucketOf(req({
      attachedDocuments: docs('verified'),
      intakeSheet: completeIntake,
      interviewOutcome: null,
    }))).toBe('interview')
  })
  it('endorse: all prerequisites met but not yet endorsed', () => {
    expect(bucketOf(req({
      status: 'assessment',
      attachedDocuments: docs('verified', 'verified'),
      intakeSheet: completeIntake,
      interviewOutcome: 'completed',
    }))).toBe('endorse')
  })
})

describe('bucketOf — post-endorsement + terminal', () => {
  it('endorsed: endorsed / partially_funded / endorsing → endorsed bucket', () => {
    for (const status of ['endorsed', 'partially_funded', 'endorsing']) {
      // Even with everything verified, status takes precedence here.
      expect(bucketOf(req({ status, attachedDocuments: docs('verified') }))).toBe('endorsed')
    }
  })
  it('completed: terminal statuses → completed bucket', () => {
    for (const status of ['fully_funded', 'closed', 'rejected']) {
      expect(bucketOf(req({ status }))).toBe('completed')
    }
  })
})

describe('bucketOf — edge cases', () => {
  it('a brand-new request with no attached docs sits in verify', () => {
    expect(bucketOf({ status: 'submitted', attachedDocuments: [] })).toBe('verify')
  })
  it('attachedDocuments entries missing a status default to pending', () => {
    expect(requestDocs({ attachedDocuments: [{ documentId: 'd0' }] })).toEqual([{ status: 'pending' }])
    expect(bucketOf({ status: 'submitted', attachedDocuments: [{ documentId: 'd0' }] })).toBe('verify')
  })
  it('tolerates a nullish request', () => {
    expect(bucketOf({})).toBe('verify')
  })
})

describe('docCounts', () => {
  it('counts verified / total and flags a rejected doc', () => {
    expect(docCounts(req({ attachedDocuments: docs('verified', 'pending', 'rejected') })))
      .toEqual({ verified: 1, total: 3, blocking: true })
  })
  it('no docs → zeros, not blocking', () => {
    expect(docCounts(req({ attachedDocuments: [] }))).toEqual({ verified: 0, total: 0, blocking: false })
  })
})

describe('bucketCounts', () => {
  it('tallies every bucket plus all, in one pass', () => {
    const list = [
      req({ attachedDocuments: docs('pending') }),                                   // verify
      req({ attachedDocuments: docs('verified'), intakeSheet: null }),               // assess
      req({ attachedDocuments: docs('verified'), intakeSheet: completeIntake }),     // interview
      req({ status: 'endorsed' }),                                                   // endorsed
      req({ status: 'fully_funded' }),                                               // completed
      req({ status: 'closed' }),                                                     // completed
    ]
    const counts = bucketCounts(list)
    expect(counts.all).toBe(6)
    expect(counts.verify).toBe(1)
    expect(counts.assess).toBe(1)
    expect(counts.interview).toBe(1)
    expect(counts.endorse).toBe(0)
    expect(counts.endorsed).toBe(1)
    expect(counts.completed).toBe(2)
    // Every bucket key is represented in the counts.
    for (const key of QUEUE_BUCKETS) expect(counts).toHaveProperty(key)
  })
  it('empty list → all zeros', () => {
    expect(bucketCounts([])).toEqual({ all: 0, verify: 0, assess: 0, interview: 0, endorse: 0, endorsed: 0, completed: 0 })
  })
})

describe('labels + tab order', () => {
  it('every tab has a label and All is last', () => {
    for (const key of QUEUE_TABS) expect(BUCKET_LABELS[key]).toBeTruthy()
    expect(QUEUE_TABS[QUEUE_TABS.length - 1]).toBe('all')
  })
})
