/**
 * Helpers extracted from src/pages/agency/ApplicationDetail.jsx as part
 * of the Phase 2.1 split (recovery plan). Pure functions only -- no
 * React hooks, no Firestore I/O. Importing these into the parent page
 * shaves ~290 lines without changing behavior.
 *
 * What's here:
 *   - peso()           number -> "₱1,234" display string
 *   - daysSince()      timestamp -> integer days, or null
 *   - formatDate()     timestamp -> "Mon DD, YYYY" or "—"
 *   - buildTimelineStages(app) -> array of {key, label, done, active}
 *       for the Timeline & Notes panel. Two flows: co-funding slice
 *       (4 stages) vs legacy direct-to-agency (6 stages).
 *   - SECTION_DEFS     section navigation config
 *
 * (CompactStepper and getPrimaryActions are also extracted but they
 *  consume React icons + a handlers object; they live in stepper.jsx
 *  and actions.jsx respectively.)
 */

import { tsToDate } from '../../../utils/dates'

export const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

export const daysSince = (ts) => {
  const d = tsToDate(ts)
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null
}

export const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

// Timeline stages derived from app status. Two flows:
//   Co-funding slice (has requestId): 4-stage Submit -> For Funding ->
//   Approve -> GL Done.
//   Legacy direct-to-agency (no requestId): original 6-stage view.
export const buildTimelineStages = (app) => {
  const status = app?.status
  if (app?.requestId) {
    const SLICE_DEFS = [
      { key: 'endorsed',    label: 'Endorsed by CRMC' },
      { key: 'reviewing',   label: 'Under Funding Review' },
      { key: 'approved',    label: 'Approved' },
      { key: 'certificate', label: 'Guarantee Letter Issued' },
    ]
    const sliceDoneMap = {
      endorsed:      [],
      reviewing:     ['endorsed'],
      awaiting_info: ['endorsed'],
      approved:      ['endorsed', 'reviewing'],
      certificate:   ['endorsed', 'reviewing', 'approved'],
      rejected:      [],
    }
    const sliceActiveMap = {
      endorsed:      'endorsed',
      reviewing:     'reviewing',
      awaiting_info: 'reviewing',
      approved:      'approved',
      certificate:   'certificate',
      rejected:      null,
    }
    const doneKeys  = sliceDoneMap[status]  ?? []
    const activeKey = sliceActiveMap[status] ?? null
    return SLICE_DEFS.map(s => ({
      key:    s.key,
      label:  s.label,
      done:   doneKeys.includes(s.key),
      active: s.key === activeKey,
    }))
  }
  // Legacy direct-to-agency stepper
  const STAGE_DEFS = [
    { key: 'submitted',   label: 'Application Submitted' },
    { key: 'docs',        label: 'Document Verification' },
    { key: 'reviewing',   label: 'Under Agency Review' },
    { key: 'interview',   label: 'Interview Scheduled' },
    { key: 'approved',    label: 'Application Approved' },
    { key: 'certificate', label: 'Guarantee Letter Issued' },
  ]
  const doneMap = {
    pending:       ['submitted'],
    reviewing:     ['submitted', 'docs'],
    awaiting_info: ['submitted', 'docs'],
    interview:     ['submitted', 'docs', 'reviewing'],
    approved:      ['submitted', 'docs', 'reviewing', 'interview'],
    certificate:   ['submitted', 'docs', 'reviewing', 'interview', 'approved'],
    rejected:      ['submitted'],
  }
  const activeMap = {
    pending:       'docs',
    reviewing:     'reviewing',
    awaiting_info: 'reviewing',
    interview:     'interview',
    approved:      'approved',
    certificate:   'certificate',
    rejected:      null,
  }
  const doneKeys  = doneMap[status]  ?? ['submitted']
  const activeKey = activeMap[status] ?? null
  return STAGE_DEFS.map(s => ({
    key:    s.key,
    label:  s.label,
    done:   doneKeys.includes(s.key),
    active: s.key === activeKey,
  }))
}

// Section definitions (ordered) — drives the in-page navigation.
import { MdInfo, MdAssignment, MdDescription, MdReceipt, MdHistory } from 'react-icons/md'
export const SECTION_DEFS = [
  { id: 'overview',  label: 'Overview',          icon: MdInfo,        always: true },
  { id: 'intake',    label: 'Assessment',        icon: MdAssignment,  forStatus: ['reviewing','awaiting_info','interview','approved','certificate'] },
  { id: 'documents', label: 'Documents',         icon: MdDescription, always: true },
  { id: 'gl',        label: 'Guarantee Letter',  icon: MdReceipt,     forStatus: ['approved','certificate'] },
  { id: 'timeline',  label: 'Timeline & Notes',  icon: MdHistory,     always: true },
]

// Style maps used by getPrimaryActions render.
export const VARIANT_CLS = {
  'primary':         'bg-brand-500 text-white hover:bg-brand-600',
  'primary-green':   'bg-green-600  text-white hover:bg-green-700',
  'primary-orange':  'bg-orange-500 text-white hover:bg-orange-600',
  'secondary':       'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
  'danger':          'bg-white text-red-600  border border-red-200  hover:bg-red-50',
}

export const TONE_CLS = {
  brand:  'bg-brand-50  border-brand-100  text-brand-700',
  amber:  'bg-amber-50  border-amber-100  text-amber-700',
  purple: 'bg-purple-50 border-purple-100 text-purple-700',
  red:    'bg-red-50    border-red-200    text-red-700',
  gray:   'bg-gray-50   border-gray-100   text-gray-600',
  green:  'bg-green-50  border-green-100  text-green-700',
}
