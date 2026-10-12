import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_TYPES,
  ASSISTANCE_TYPES,
  CORE_REQUIREMENTS,
  CORE_DOC_IDS,
  CONDITIONAL_REQUIREMENTS,
  THRESHOLDS,
  WHEN_ORDER,
  requiredDocsFor,
  resolveRequirements,
  assistanceTypeByName,
  documentTypeById,
  slugify,
} from '../../src/data/referenceData'

describe('referenceData: integrity', () => {
  it('document type ids are unique and match their slugified name', () => {
    const ids = DOCUMENT_TYPES.map(d => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of DOCUMENT_TYPES) expect(d.id).toBe(slugify(d.name))
  })

  it('assistance type names are unique', () => {
    const names = ASSISTANCE_TYPES.map(t => t.name.toLowerCase().trim())
    expect(new Set(names).size).toBe(names.length)
  })

  it('every referenced doc id (core, per-type, conditional, overrides) exists', () => {
    const known = new Set(DOCUMENT_TYPES.map(d => d.id))
    const check = (reqs, where) => reqs.forEach(r => expect(known.has(r.docId), `${where}: ${r.docId}`).toBe(true))
    check(CORE_REQUIREMENTS, 'core')
    check(CONDITIONAL_REQUIREMENTS, 'conditional')
    for (const t of ASSISTANCE_TYPES) {
      check(t.requirements ?? [], t.name)
      for (const id of (t.coreOverride ?? [])) expect(known.has(id), `${t.name} override ${id}`).toBe(true)
    }
  })

  it('every requirement uses a known `when` tier', () => {
    const all = [...CORE_REQUIREMENTS, ...CONDITIONAL_REQUIREMENTS, ...ASSISTANCE_TYPES.flatMap(t => t.requirements ?? [])]
    for (const r of all) expect(WHEN_ORDER).toContain(r.when ?? 'assess')
  })

  it('conditional requirements are gated by a predicate', () => {
    for (const r of CONDITIONAL_REQUIREMENTS) expect(typeof r.appliesIf).toBe('function')
  })
})

describe('referenceData: requiredDocsFor', () => {
  it('returns the DocChecklist shape {id,name,reusable,order} with contiguous order', () => {
    const list = requiredDocsFor('Hospital Bills / Hospitalization')
    expect(list.length).toBeGreaterThan(0)
    list.forEach((d, i) => {
      expect(d).toHaveProperty('id')
      expect(typeof d.name).toBe('string')
      expect(typeof d.reusable).toBe('boolean')
      expect(d.order).toBe(i)
    })
  })

  it('every standard type includes all core docs plus its extras', () => {
    for (const t of ASSISTANCE_TYPES.filter(t => !t.coreOverride)) {
      const ids = requiredDocsFor(t.name).map(d => d.id)
      for (const c of CORE_DOC_IDS) expect(ids, t.name).toContain(c)
      for (const r of t.requirements) expect(ids, t.name).toContain(r.docId)
    }
  })

  it('chemotherapy adds protocol + quotations, and carries quantity', () => {
    const list = requiredDocsFor('Chemotherapy')
    const ids = list.map(d => d.id)
    expect(ids).toContain('hospital_billing_statement')
    expect(ids).toContain('treatment_protocol')
    expect(list.find(d => d.id === 'price_quotations')?.quantity).toBe(3)
  })

  it('burial overrides core (no hospital bill) and requires a death certificate', () => {
    const ids = requiredDocsFor('Burial Assistance').map(d => d.id)
    expect(ids).toContain('death_certificate')
    expect(ids).not.toContain('hospital_billing_statement')
  })

  it('matches type names case/space-insensitively', () => {
    expect(assistanceTypeByName('  chemotherapy ')?.id).toBe('chemotherapy')
  })

  it('falls back to the core checklist for an unknown or blank type', () => {
    expect(requiredDocsFor('Some Unlisted Type').map(d => d.id)).toEqual(CORE_DOC_IDS)
    expect(requiredDocsFor('').map(d => d.id)).toEqual(CORE_DOC_IDS)
    expect(requiredDocsFor(undefined).map(d => d.id)).toEqual(CORE_DOC_IDS)
  })

  it('Valid ID is reusable; the hospital bill is per-request', () => {
    expect(documentTypeById('valid_id').reusable).toBe(true)
    expect(documentTypeById('hospital_billing_statement').reusable).toBe(false)
  })
})

describe('referenceData: attribute-driven conditions', () => {
  it('requires a Social Case Study Report only above the threshold', () => {
    const below = requiredDocsFor('Hospital Bills / Hospitalization', { amountNeeded: THRESHOLDS.socialCaseStudyPhp - 1 })
    const atOrAbove = requiredDocsFor('Hospital Bills / Hospitalization', { amountNeeded: THRESHOLDS.socialCaseStudyPhp })
    expect(below.map(d => d.id)).not.toContain('social_case_study_report')
    expect(atOrAbove.map(d => d.id)).toContain('social_case_study_report')
  })

  it('threshold uses totalBill when amountNeeded is absent', () => {
    const ids = requiredDocsFor('Chemotherapy', { totalBill: THRESHOLDS.socialCaseStudyPhp + 5000 }).map(d => d.id)
    expect(ids).toContain('social_case_study_report')
  })

  it('no request attributes → no attribute-gated requirements (safe default)', () => {
    expect(requiredDocsFor('Hospital Bills / Hospitalization').map(d => d.id)).not.toContain('social_case_study_report')
  })
})

describe('referenceData: resolveRequirements tiers', () => {
  it('upTo "submit" excludes assess-tier (e.g. a Social Case Study Report)', () => {
    const req = { assistanceType: 'Hospital Bills / Hospitalization', amountNeeded: THRESHOLDS.socialCaseStudyPhp + 1 }
    const submit = resolveRequirements(req, { upTo: 'submit' }).map(r => r.docId)
    const assess = resolveRequirements(req, { upTo: 'assess' }).map(r => r.docId)
    expect(submit).not.toContain('social_case_study_report')
    expect(assess).toContain('social_case_study_report')
    // core docs are 'submit' tier and present in both
    expect(submit).toContain('hospital_billing_statement')
  })

  it('de-duplicates a doc id shared across type + conditional', () => {
    const ids = resolveRequirements({ assistanceType: 'Chemotherapy' }).map(r => r.docId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
