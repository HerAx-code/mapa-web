/**
 * DocChecklist smoke tests (ID-verification Phase 1 — documents card list).
 * Pins the status each card shows per its inputs: todo → attach, attached →
 * ready, reusable+verified → reused, OCR "not an ID" → needs-retake with reason.
 * Presentational component; t is injected so we assert on the i18n keys.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DocChecklist from '../../src/components/patient/DocChecklist'

const t = (k, o) => (o && o.total != null ? `${o.done}/${o.total} ready` : k)
const isIdType     = (n) => /id/i.test(n)
const isSelfieType = (n) => /selfie/i.test(n)

const baseProps = {
  docForType: () => ({ date: '12 Aug 2026', status: 'verified' }),
  verifiedTypeNames: new Set(),
  ocrResults: {},
  ocrRunning: {},
  uploadState: {},
  isIdType, isSelfieType,
  onAttach: () => () => {}, onSelfie: vi.fn(), onRemove: vi.fn(), onRetryOcr: vi.fn(),
  t,
}

describe('DocChecklist', () => {
  it('shows an attach action for a not-yet-attached document', () => {
    render(<DocChecklist {...baseProps} docTypes={[{ id: '1', name: 'Hospital Billing Statement' }]} pendingFiles={{}} />)
    expect(screen.getByText('Hospital Billing Statement')).toBeInTheDocument()
    expect(screen.getByText('patient.request.docAttach')).toBeInTheDocument()
  })

  it('shows a camera action for a selfie type', () => {
    render(<DocChecklist {...baseProps} docTypes={[{ id: '1', name: 'Live Selfie' }]} pendingFiles={{}} />)
    expect(screen.getByText('patient.request.takeSelfie')).toBeInTheDocument()
  })

  it('shows "ready" once a file is attached', () => {
    render(<DocChecklist {...baseProps} docTypes={[{ id: '1', name: 'Medical Abstract' }]} pendingFiles={{ 'Medical Abstract': new File(['x'], 'a.jpg') }} />)
    expect(screen.getByText('patient.request.docCard.ready')).toBeInTheDocument()
  })

  it('shows a reused chip + Replace for a reusable verified doc on file', () => {
    render(<DocChecklist {...baseProps}
      docTypes={[{ id: '1', name: 'Valid ID', reusable: true }]}
      verifiedTypeNames={new Set(['valid id'])}
      pendingFiles={{}} />)
    expect(screen.getByText('patient.request.docCard.reused')).toBeInTheDocument()
    expect(screen.getByText('patient.request.replace')).toBeInTheDocument()
  })

  it('flags needs-retake with a reason when OCR says it is not an ID', () => {
    render(<DocChecklist {...baseProps}
      docTypes={[{ id: '1', name: 'Valid ID' }]}
      pendingFiles={{ 'Valid ID': new File(['x'], 'id.jpg') }}
      ocrResults={{ 'Valid ID': { hasFace: false, idType: null, match: false, text: 'blah' } }} />)
    expect(screen.getByText('patient.request.ocrNotAnId')).toBeInTheDocument()
    expect(screen.getByText('patient.request.docCard.retakePhoto')).toBeInTheDocument()
  })

  it('shows a saving state during upload', () => {
    render(<DocChecklist {...baseProps}
      docTypes={[{ id: '1', name: 'Medical Abstract' }]}
      pendingFiles={{ 'Medical Abstract': new File(['x'], 'a.jpg') }}
      uploadState={{ 'Medical Abstract': 'saving' }} />)
    expect(screen.getByText('patient.request.docCard.saving')).toBeInTheDocument()
  })

  it('renders the N-of-M ready header', () => {
    render(<DocChecklist {...baseProps}
      docTypes={[{ id: '1', name: 'A' }, { id: '2', name: 'B' }]}
      pendingFiles={{ A: new File(['x'], 'a.jpg') }} />)
    expect(screen.getByText('1/2 ready')).toBeInTheDocument()
  })
})
