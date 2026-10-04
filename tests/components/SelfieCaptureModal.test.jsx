/**
 * SelfieCaptureModal smoke test (ID-verification Phase 4 reskin).
 * jsdom has no navigator.mediaDevices, so the component takes its no-camera
 * branch — the important fallback for low-end / permission-denied devices: it
 * must still surface the in-person CRMC path and never let the patient upload an
 * arbitrary gallery photo. (The live camera, exposure loop, and on-device
 * liveness run on a real device; the pure math is unit-tested in
 * tests/utils/faceCheck.test.js + imageQuality.test.js.)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

import SelfieCaptureModal from '../../src/components/SelfieCaptureModal'

describe('SelfieCaptureModal', () => {
  it('shows the in-person CRMC fallback when no camera is available', () => {
    render(<SelfieCaptureModal onCapture={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('patient.request.selfieTitle')).toBeInTheDocument()
    // No-camera notice — never offers a gallery upload path here.
    expect(screen.getByText('patient.request.selfieNoCamera')).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})
