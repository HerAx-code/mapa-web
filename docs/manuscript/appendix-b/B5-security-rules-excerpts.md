### B.5 Security-rules excerpts

Four representative rules from `firestore.rules`. The principle throughout is
that authorization lives in the rules, not the interface, and every write a
rule grants is paired with a test attempting the write it forbids.

**Source:** `firestore.rules` (excerpts).

```javascript
// (a) auditLog — actor-binding: an entry can only be created under the
//     caller's own uid, and details are length-capped (closes the June-2026
//     prompt-injection incident where forged "system" actors were planted).
match /auditLog/{logId} {
  allow create: if isAuth() &&
                   request.resource.data.actorId == uid() &&
                   request.resource.data.details is string &&
                   request.resource.data.details.size() <= 2000;
  // … allow read (request-scoped for agencies, self-scoped for patients)
}

// (b) requests — bounded agency write: an agency holding a slice on a request
//     may touch ONLY the three funding-sync fields, and only to a well-formed
//     value in the derived-status set, so it can advance the money tally it is
//     responsible for without being able to set a CRMC-only state or a bad
//     amount. (A sum over sibling slices can't be re-derived in rules, so the
//     authoritative figure is corrected by the syncRequestFinancials trigger —
//     see B.6.)
allow update: if isAgency() &&
                 userAgencyId() in resource.data.agencyIds &&
                 request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['amountCommitted', 'status', 'updatedAt']) &&
                 request.resource.data.amountCommitted is number &&
                 request.resource.data.amountCommitted >= 0 &&
                 request.resource.data.status in
                   ['submitted', 'endorsed', 'partially_funded', 'fully_funded'];

// (c) certificates — cross-agency guard: an agency may create a Guarantee
//     Letter only under its own agencyId AND only when the linked application
//     also belongs to it (a get()-chain check, not just a claimed field).
match /certificates/{certId} {
  allow create: if isAdmin() ||
                   (isAgency() &&
                    request.resource.data.agencyId == userAgencyId() &&
                    get(/databases/$(database)/documents/applications/$(certId)).data.agencyId == userAgencyId());
}

// (d) users — role-escalation guard: a self-update must keep role, agencyId,
//     active and rank byte-identical, so a user cannot promote themselves.
allow update: if isAuth() && (
  (uid() == userId &&
    request.resource.data.role     == resource.data.role &&
    request.resource.data.agencyId == resource.data.agencyId &&
    request.resource.data.active   == resource.data.active &&
    request.resource.data.rank     == resource.data.rank) ||
  isAdmin() || /* … agency_admin bounded branch omitted */ );
```
