import { describe, it, expect } from 'vitest'
import { patientExportFilename } from '../../src/utils/dataExport.js'

// Direct unit coverage of the small pure helpers in dataExport. The
// big aggregation function (buildPatientDataExport) hits Firestore so
// it isn't exercised here -- the live patient-side smoke test is the
// thesis pilot validation. The pure parts ARE testable.

describe('patientExportFilename', () => {
  it('contains the date and a short uid stamp', () => {
    const out = patientExportFilename('aBcDeFgHiJkLmNoP', new Date('2026-06-02T03:14:15.000Z'))
    expect(out).toBe('mapa-data-export-aBcDeFgH-2026-06-02.json')
  })

  it('truncates long uids to 8 chars to keep filenames short', () => {
    const out = patientExportFilename('someverylonguidthatislargerthan8', new Date('2026-01-01T00:00:00.000Z'))
    expect(out).toBe('mapa-data-export-somevery-2026-01-01.json')
    expect(out.length).toBeLessThan(60)
  })

  it('handles short uids without crashing', () => {
    const out = patientExportFilename('abc', new Date('2026-01-01T00:00:00.000Z'))
    expect(out).toBe('mapa-data-export-abc-2026-01-01.json')
  })

  it('defaults to current date when none supplied', () => {
    const out = patientExportFilename('uid12345')
    expect(out).toMatch(/^mapa-data-export-uid12345-\d{4}-\d{2}-\d{2}\.json$/)
  })
})