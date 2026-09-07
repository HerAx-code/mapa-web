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

// (b) interviewSlots — compare-and-set booking: the open→booked transition
//     requires the CURRENT status to be 'open', so a lost race surfaces as
//     permission-denied rather than a double-book. Only the four booking
//     fields may change, and the request must belong to the booking patient.
function isBooking() {
  return isPatient() &&
         resource.data.status == 'open' &&
         request.resource.data.status == 'booked' &&
         request.resource.data.patientId == uid() &&
         ownsRequest(request.resource.data.requestId) &&
         request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['status', 'patientId', 'requestId', 'bookedAt']);
}

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
