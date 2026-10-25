/**
 * GuidedIdCapture smoke test (ID-verification Phase 2).
 * jsdom has no navigator.mediaDevices, so the component takes its no-camera
 * branch — which is the important fallback for low-end / permission-denied
 * devices: it must still offer an Upload path and never dead-end. (The live
 * camera + canvas quality loop is exercised on a real device; the pure quality
 * math is unit-tested in tests/utils/imageQuality.test.js.)
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

  describe('with a (mocked) camera', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      delete navigator.mediaDevices
    })

    // Regression: the <video> only exists in the live-camera branch, so it
    // unmounts while reviewing the front shot and remounts (fresh, no
    // srcObject) on the front→back step change. If the running stream isn't
    // re-attached, the back step is a dead/black camera. See the
    // "back-of-ID camera" bug.
    it('re-attaches the live stream when advancing to the back step', async () => {
      const stream = { getTracks: () => [{ stop: vi.fn() }] }
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        configurable: true,
      })
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

      const { container } = render(
        <GuidedIdCapture wantBack onCapture={() => {}} onClose={() => {}} />
      )

      // Front live preview: the stream is wired to the <video>.
      await waitFor(() => expect(container.querySelector('video')?.srcObject).toBe(stream))

      // Upload a front photo (skips the canvas capture path) → review step unmounts the video.
      fireEvent.change(container.querySelector('input[type="file"]'), {
        target: { files: [new File(['x'], 'front.jpg', { type: 'image/jpeg' })] },
      })
      await waitFor(() => expect(container.querySelector('video')).toBeNull())

      // Advance to the back step → the remounted <video> must get the stream back.
      fireEvent.click(screen.getByText(/guidedId\.addBack/))
      await waitFor(() => expect(container.querySelector('video')?.srcObject).toBe(stream))
    })
  })
})
