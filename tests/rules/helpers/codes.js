import { doc, writeBatch } from 'firebase/firestore'
import { codeProof } from '../../../src/utils/codeIssue.js'

// Patient-bound access codes (2026-11-15): issue a code the way
// IssueCodeModal does — the code (bound: true) and its staff-only
// privateInfo/issued record in one batch.
export const issuedRecord = ({ firstName = 'Ana', lastName = 'Cruz', birthdate = '1990-05-01', issuedByUid = 'staff' } = {}) => ({
  name: `${firstName} ${lastName}`,
  nameParts: { firstName, middleName: '', lastName, suffix: '' },
  birthdate, proof: codeProof(lastName, birthdate),
  visitDate: '2026-11-15', idType: 'PhilSys National ID', issuedBy: 'Staff', issuedByUid,
})

export function issueCode(db, id, { tenantId, issued = issuedRecord(), extra = {} } = {}) {
  const b = writeBatch(db)
  b.set(doc(db, 'hospitalIds', id), { status: 'available', patId: null, bound: true, tenantId, ...extra })
  b.set(doc(db, 'hospitalIds', id, 'privateInfo', 'issued'), issued)
  return b.commit()
}
