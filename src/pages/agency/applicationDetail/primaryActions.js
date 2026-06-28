/**
 * Status-driven CTA generator for the agency application detail hero.
 * Extracted from ApplicationDetail.jsx as part of the Phase 2.1 split.
 *
 * Given the current app + context, returns { hint, tone, actions[] }
 * describing what the agency operator should see at the top of the
 * page. Pure function -- the caller wires action.onClick to actual
 * state-changing handlers.
 *
 * The handlers object expected by the actions is the agency-detail
 * page's bag of setShow* state setters + thunks (handleStartReview,
 * handleRequestInfo, handlePrintGL, etc.). Keeps the rendering layer
 * thin and lets the hook-extracted handlers stay testable.
 */

import {
  MdCheckCircle, MdCancel, MdHourglassEmpty, MdPlayArrow,
  MdPrint, MdUpload, MdWarning,
} from 'react-icons/md'
import { GL_VALIDITY_DAYS, glDaysRemaining } from '../../../utils/constants'

export function getPrimaryActions(ctx) {
  const { app, expired, expiringSoon, handlers, signedScan } = ctx

  if (app.status === 'pending') {
    return {
      hint: 'Start the review to move this case forward.',
      tone: 'brand',
      actions: [
        { label: 'Start Review', icon: MdCheckCircle, variant: 'primary', onClick: handlers.handleStartReview },
        { label: 'Reject',       icon: MdCancel,      variant: 'danger',  onClick: () => handlers.setShowReject(true) },
      ],
    }
  }

  if (app.status === 'reviewing') {
    return {
      hint: 'CRMC verified the documents and completed the assessment. Approve your share and issue the GL, request more info, or reject.',
      tone: 'brand',
      actions: [
        { label: 'Approve & Issue GL', icon: MdCheckCircle,     variant: 'primary-green', onClick: () => handlers.setShowApprove(true) },
        { label: 'Request More Info',  icon: MdHourglassEmpty,  variant: 'secondary',     onClick: () => handlers.setShowRequestInfo(true) },
        { label: 'Reject',             icon: MdCancel,          variant: 'danger',        onClick: () => handlers.setShowReject(true) },
      ],
    }
  }

  if (app.status === 'awaiting_info') {
    return {
      hint: `Waiting on the patient. Requested: "${app.awaitingInfoMessage ?? '—'}"`,
      tone: 'amber',
      actions: [
        { label: 'Resume Review',  icon: MdPlayArrow,      variant: 'primary',   onClick: handlers.handleResumeFromAwaiting },
        { label: 'Update Request', icon: MdHourglassEmpty, variant: 'secondary', onClick: () => handlers.setShowRequestInfo(true) },
        { label: 'Reject',         icon: MdCancel,         variant: 'danger',    onClick: () => handlers.setShowReject(true) },
      ],
    }
  }

  // Note: under the co-funding redesign, slices never reach status
  // 'interview' -- the single assessment interview is on the parent
  // request (CRMC-conducted), not per-slice. Legacy interview branches
  // removed.

  if (app.status === 'approved') {
    return {
      hint: 'Print the Guarantee Letter to issue it.',
      tone: 'brand',
      actions: [
        { label: 'Print Guarantee Letter', icon: MdPrint,  variant: 'primary',   onClick: handlers.handlePrintGL },
        { label: 'Reverse Approval',       icon: MdCancel, variant: 'secondary', onClick: handlers.handleReverseApproval },
      ],
    }
  }

  if (app.status === 'certificate' && app.glStatus === 'issued' && expired) {
    return {
      hint: `GL passed its ${GL_VALIDITY_DAYS}-day validity window — release the committed budget.`,
      tone: 'red',
      actions: [
        { label: 'Mark GL Expired',  icon: MdWarning, variant: 'primary-orange', onClick: handlers.handleExpireGL },
        { label: 'Reverse Approval', icon: MdCancel,  variant: 'secondary',      onClick: handlers.handleReverseApproval },
      ],
    }
  }

  if (app.status === 'certificate' && app.glStatus === 'issued' && !signedScan) {
    const days = glDaysRemaining(app)
    return {
      hint: expiringSoon
        ? `⚠ GL expires in ${days} day${days === 1 ? '' : 's'} — wet-sign the printed copy and upload the scan now so the patient can still redeem it.`
        : 'Wet-sign the printed copy, then upload the scan so the patient can download it.',
      tone: 'amber',
      actions: [
        { label: 'Upload Signed Scan', icon: MdUpload, variant: 'primary',   onClick: () => handlers.setShowUpload(true) },
        { label: 'Re-print',           icon: MdPrint,  variant: 'secondary', onClick: handlers.handlePrintGL },
      ],
    }
  }

  if (app.status === 'certificate' && app.glStatus === 'issued' && signedScan) {
    const days = glDaysRemaining(app)
    return {
      hint: expiringSoon
        ? `⚠ GL expires in ${days} day${days === 1 ? '' : 's'} — message the patient now so they redeem it before the committed budget is released.`
        : 'When the provider bills back, mark the GL as redeemed.',
      tone: expiringSoon ? 'amber' : 'brand',
      actions: [
        { label: 'Mark GL Redeemed', icon: MdCheckCircle, variant: 'primary-green', onClick: handlers.handleRedeemGL },
        { label: 'Reverse Approval', icon: MdCancel,      variant: 'secondary',     onClick: handlers.handleReverseApproval },
      ],
    }
  }

  if (app.glStatus === 'redeemed') {
    return { hint: '✓ Case complete — GL redeemed.', tone: 'green', actions: [] }
  }
  if (app.glStatus === 'expired') {
    return {
      hint: '⚠ GL expired — committed budget released.',
      tone: 'gray',
      actions: [
        { label: 'Reverse Approval', icon: MdCancel, variant: 'secondary', onClick: handlers.handleReverseApproval },
      ],
    }
  }
  if (app.status === 'rejected') {
    return { hint: 'Application rejected. No further action required.', tone: 'red', actions: [] }
  }

  return { hint: null, tone: 'gray', actions: [] }
}
