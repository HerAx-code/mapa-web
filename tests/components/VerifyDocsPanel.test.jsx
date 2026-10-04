/**
 * VerifyDocsPanel smoke tests — pins the advisory ID-verification chips the CRMC
 * verifier reads (docs/id-verification-plan.md §5.2): idTypeDetected on the ID
 * doc, and the face-match + liveness lines on the selfie doc, in the same
 * green/amber/gray pattern as the existing OCR line. Pure component (parent owns
 * data + mutations), so jsdom stands in for a browser screenshot.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

// ID-verification Phase 5 — the social-worker Identity review card. Only renders
// when an identity handler is wired, so the legacy tests above (no handlers)
// never see it.
describe('VerifyDocsPanel — Identity review card', () => {
  const idProps = { ...baseProps, onConfirmIdentity: vi.fn(), onRequestRedo: vi.fn(), accountName: 'Juan Dela Cruz' }

  it('surfaces the PhilSys ID-source + face/liveness checks from stored signals', () => {
    const reqDocs = [
      { id: 'id-1', documentTypeName: 'National ID', status: 'pending',
        idVerifyMethod: 'philid_qr', philIdSigValid: true, ocrMatch: true,
        pcnLast4: '•••• •••• •••• 3456', pcnFingerprint: 'a'.repeat(64) },
      { id: 'sf-1', documentTypeName: 'Live Selfie', status: 'pending', faceMatch: 'pass', liveness: 'pass' },
    ]
    render(<VerifyDocsPanel {...idProps} reqDocs={reqDocs} />)
    expect(screen.getByText(/National ID · PSA signature valid/)).toBeInTheDocument()
    expect(screen.getByText('Matches account')).toBeInTheDocument()
    expect(screen.getByText('Likely same person')).toBeInTheDocument()
    // pcnFingerprint present → the cross-check row appears, honestly "not checked".
    expect(screen.getByText(/No automatic cross-check/)).toBeInTheDocument()
    expect(screen.getByText(/Signals are advisory/)).toBeInTheDocument()
  })

  it('confirms identity and requires a reason before requesting a redo', () => {
    const onConfirmIdentity = vi.fn()
    const onRequestRedo = vi.fn()
    const reqDocs = [
      { id: 'id-1', documentTypeName: 'National ID', status: 'pending', idVerifyMethod: 'pcn_manual' },
      { id: 'sf-1', documentTypeName: 'Live Selfie', status: 'pending', faceMatch: 'unclear', liveness: 'unclear' },
    ]
    render(<VerifyDocsPanel {...idProps} reqDocs={reqDocs} onConfirmIdentity={onConfirmIdentity} onRequestRedo={onRequestRedo} />)

    fireEvent.click(screen.getByText('Confirm identity'))
    expect(onConfirmIdentity).toHaveBeenCalled()

    // Redo is inert until a reason is chosen, then routes a doc + the reason up.
    fireEvent.click(screen.getByText('Request redo'))
    expect(onRequestRedo).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/ask the patient to redo/i), { target: { value: 'Selfie too dark / blurry' } })
    fireEvent.click(screen.getByText('Request redo'))
    expect(onRequestRedo).toHaveBeenCalledWith(expect.objectContaining({ id: 'sf-1' }), 'Selfie too dark / blurry')
  })

  it('shows the authoritative PSA eVerify line when the QR was server-verified', () => {
    const reqDocs = [
      { id: 'id-1', documentTypeName: 'National ID', status: 'pending',
        idVerifyMethod: 'everify_qr', everifyVerified: true, everifyQrType: 'Digital ID',
        pcnLast4: '•••• •••• •••• 3456' },
      { id: 'sf-1', documentTypeName: 'Live Selfie', status: 'pending', faceMatch: 'pass', liveness: 'pass' },
    ]
    render(<VerifyDocsPanel {...idProps} reqDocs={reqDocs} />)
    expect(screen.getByText(/PSA eVerify confirmed \(Digital ID\)/)).toBeInTheDocument()
  })

  it('shows "Identity confirmed" once the ID + selfie docs are verified', () => {
    const reqDocs = [
      { id: 'id-1', documentTypeName: 'National ID', status: 'verified', idVerifyMethod: 'philid_qr', philIdSigValid: true },
      { id: 'sf-1', documentTypeName: 'Live Selfie', status: 'verified', faceMatch: 'pass', liveness: 'pass' },
    ]
    render(<VerifyDocsPanel {...idProps} reqDocs={reqDocs} />)
    expect(screen.getByText('Identity confirmed')).toBeInTheDocument()
    expect(screen.queryByText('Confirm identity')).toBeNull()
  })
})
