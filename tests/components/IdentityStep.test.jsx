/**
 * IdentityStep smoke test (ID-verification Phase 3 — PhilSys-first identity).
 *
 * Covers the two things that must hold regardless of device:
 *   1. The choice screen offers an EQUAL "Use another valid ID" path (PhilSys is
 *      preferred, never required — RA 11055) and states the PSN is never asked for.
 *   2. With no camera (jsdom has no navigator.mediaDevices — the low-end /
 *      permission-denied case), the scan view never dead-ends: it still offers a
 *      typed-PCN fallback and a "use another ID" escape.
 *
 * The live camera + QR decode loop runs on a real device; the PCN mask /
 * fingerprint / Ed25519 math is unit-tested in tests/utils/philIdQr.test.js.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
// IdentityStep → utils/everify → src/firebase. Stub it (no real init); a null
// currentUser makes everifyQrCheck no-op, which is the correct fail-safe path.
vi.mock('../../src/firebase', () => ({ auth: { currentUser: null } }))

import IdentityStep from '../../src/components/patient/IdentityStep'

describe('IdentityStep', () => {
  it('offers an equal "use another ID" path and never asks for the PSN', () => {
    const onUseOther = vi.fn()
    render(<IdentityStep accountName="Juan Dela Cruz" onUseOther={onUseOther} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('patient.request.identity.scanTitle')).toBeInTheDocument()
    expect(screen.getByText('patient.request.identity.otherTitle')).toBeInTheDocument()
    // RA 10173 / RA 11055 reassurance: the 12-digit PSN is never collected.
    expect(screen.getByText('patient.request.identity.psnNever')).toBeInTheDocument()

    fireEvent.click(screen.getByText('patient.request.identity.otherTitle'))
    expect(onUseOther).toHaveBeenCalled()
  })

  it('falls back to typed PCN (not a dead end) when no camera is available', () => {
    render(<IdentityStep accountName="Juan Dela Cruz" onUseOther={() => {}} onClose={() => {}} />)
    // Enter the scan view; jsdom has no mediaDevices → no-camera branch.
    fireEvent.click(screen.getByText('patient.request.identity.scanTitle'))
    expect(screen.getByText('patient.request.identity.noCamera')).toBeInTheDocument()
    expect(screen.getByText('patient.request.identity.typePcn')).toBeInTheDocument()
  })
})
