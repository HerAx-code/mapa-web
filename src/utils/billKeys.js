// Input verification Phase 1: one record per confirmed bill number at a
// hospital (billKeys/{tenantId}__{BILLNO}), so the same bill confirmed on
// another request is caught. See firestore.rules (billKeys).

// Bill / Statement of Account numbers are printed in many styles
// ("SOA No. 2026-001 234", "soa-2026001234"); compare letters and digits only.
export const normalizeBillNumber = (s) =>
  String(s ?? '').toUpperCase().replace(/^\s*(SOA|BILL)\s*(NO\.?|NUMBER|#)?\s*/, '').replace(/[^A-Z0-9]/g, '').slice(0, 40)

export const billKeyId = (tenantId, billNumber) => `${tenantId}__${normalizeBillNumber(billNumber)}`

// Where staff checked the bill.
export const BILL_CHECK_SOURCES = [
  { value: 'billing_system', label: 'Hospital billing system (checked with the billing office)' },
  { value: 'signed_soa',     label: 'Printed bill signed by the billing clerk' },
  // Phase 2A: outpatient charge slips are confirmed with the unit that issued them.
  { value: 'unit_confirmed', label: 'Charge slip confirmed with the hospital unit that issued it' },
]
export const billCheckSourceLabel = (v) => BILL_CHECK_SOURCES.find(s => s.value === v)?.label ?? ''
