/**
 * VerifyDocsPanel smoke tests — pins the advisory ID-verification chips the CRMC
 * verifier reads (docs/id-verification-plan.md §5.2): idTypeDetected on the ID
 * doc, and the face-match + liveness lines on the selfie doc, in the same
 * green/amber/gray pattern as the existing OCR line. Pure component (parent owns
 * data + mutations), so jsdom stands in for a browser screenshot.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import VerifyDocsPanel from '../../src/components/admin/VerifyDocsPanel'

const noop = () => {}
const baseProps = {
  busy: false, allVerified: false, ocrExpanded: new Set(),
  onBulkVerify: noop, onReviewDoc: noop, onView: noop,
  onReject: noop, onUnverify: noop, onToggleOcr: noop, onCompare: noop,
}

describe('VerifyDocsPanel — advisory verification chips', () => {
  it('shows the detected ID type on the ID doc', () => {
    const reqDocs = [
      { id: 'id-1', documentTypeName: 'Valid ID', status: 'pending', ocrMatch: true, idTypeDetected: "Driver's License" },
    ]
    render(<VerifyDocsPanel {...baseProps} reqDocs={reqDocs} />)
    expect(screen.getByText(/Detected type:/)).toBeInTheDocument()
    expect(screen.getByText("Driver's License")).toBeInTheDocument()
  })

  it('shows face-match + liveness advisory lines + compare on the selfie doc', () => {
    const onCompare = vi.fn()
    const reqDocs = [
      { id: 'id-1', documentTypeName: 'Valid ID', status: 'verified', reviewedAt: null },
      { id: 'sf-1', documentTypeName: 'Live Selfie', status: 'pending',
        idVerifyMethod: 'ocr', faceMatch: 'pass', faceMatchScore: 0.83, liveness: 'unclear', livenessScore: 0.4 },
    ]
    render(<VerifyDocsPanel {...baseProps} reqDocs={reqDocs} onCompare={onCompare} />)
    expect(screen.getByText(/Face match: likely the same person/)).toBeInTheDocument()
    expect(screen.getByText(/0\.83/)).toBeInTheDocument()
    expect(screen.getByText(/Liveness: hard to confirm/i)).toBeInTheDocument()
    expect(screen.getByText(/Compare with ID side-by-side/)).toBeInTheDocument()
    expect(screen.getByText(/you make the final call/i)).toBeInTheDocument()
  })

  it('renders a null face-match as a neutral "could not check", never a fail', () => {
    const reqDocs = [
      { id: 'sf-1', documentTypeName: 'Live Selfie', status: 'pending',
        idVerifyMethod: 'ocr', faceMatch: null, faceMatchScore: null, liveness: null, livenessScore: null },
    ]
    render(<VerifyDocsPanel {...baseProps} reqDocs={reqDocs} />)
    expect(screen.getByText(/Face match: could not check/)).toBeInTheDocument()
    // No hard-fail language anywhere.
    expect(screen.queryByText(/does not match|fraud|rejected face/i)).toBeNull()
  })

  it('shows nothing verification-related on a plain non-ID/non-selfie doc', () => {
    const reqDocs = [
      { id: 'd-1', documentTypeName: 'Billing Statement', status: 'pending' },
    ]
    render(<VerifyDocsPanel {...baseProps} reqDocs={reqDocs} />)
    expect(screen.queryByText(/Face match|Liveness|Detected type/)).toBeNull()
  })
})
