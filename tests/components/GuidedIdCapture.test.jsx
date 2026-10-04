/**
 * GuidedIdCapture smoke test (ID-verification Phase 2).
 * jsdom has no navigator.mediaDevices, so the component takes its no-camera
 * branch — which is the important fallback for low-end / permission-denied
 * devices: it must still offer an Upload path and never dead-end. (The live
 * camera + canvas quality loop is exercised on a real device; the pure quality
 * math is unit-tested in tests/utils/imageQuality.test.js.)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

import GuidedIdCapture from '../../src/components/patient/GuidedIdCapture'

describe('GuidedIdCapture', () => {
  it('shows a dialog and an upload fallback when no camera is available', () => {
    render(<GuidedIdCapture onCapture={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // No-camera notice + an upload file input (never dead-ends without a camera).
    expect(screen.getByText('patient.request.guidedId.noCamera')).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeTruthy()
  })
})
