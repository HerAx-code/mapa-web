# MAPA threat model

Last updated: 2026-06-01.

This document records what threats MAPA addresses, what threats it
deliberately accepts (and why), and the mitigations in place for each.
It is meant to be reviewed by the thesis panel and operators, and updated
whenever the security posture changes.

## Scope

- **System:** MAPA web portal (this repo) + Firebase (Firestore, Auth,
  Hosting) + the planned mobile app sharing the same backend.
- **Pilot:** Cotabato Regional Medical Center (CRMC) Malasakit Center.
- **Users:** patients, agency coordinators / admins, CRMC staff / super
  admins.
- **Data class:** patient medical and financial assistance applications,
  including PII (full name, address, contact, hospital ID, family /
  income detail) and documents (IDs, billing statements, medical
  abstracts).

## Trust boundaries

```
[ Unauthenticated browser ] ----HTTP----> [ Firebase Hosting (static SPA) ]
[ Authenticated browser   ] ----WS-------> [ Firestore (rules-enforced)    ]
[ Authenticated browser   ] ----HTTPS----> [ Vercel /api/send-email        ]
[ Operator workstation    ] ----admin SDK> [ Firebase project (rules bypassed) ]
[ CRMC paper / IHOMIS     ] -- out of band ->  off-system
```

The rule layer (`firestore.rules`) is the only server-side
authorisation gate. There are no Cloud Functions and no API server.
This is acknowledged in `docs/runbook.md` and §Operational limits below.

## Roles

| Role | Created by | Trust level |
|------|-----------|-------------|
| `patient` | Self-registers with a CRMC-issued access code | Lowest. Can only access own data. |
| `agency` | Created by `agency_admin` or `super_admin` | Coordinator. Funding decisions on own-agency slices. |
| `agency_admin` | Created by `super_admin` (or admin SDK seed) | Allocation authority for own agency. |
| `staff_admin` | Created by `super_admin` (or seed) | CRMC operational staff. |
| `super_admin` | Bootstrap via admin SDK (`scripts/bootstrap-users.js`) | Full Firestore + Auth control. |

## Threats addressed

### T1. Privilege escalation via self-created user docs

**Threat.** An authenticated user (or one with a freshly created Firebase
Auth account via the public web API) writes `/users/{theirUid}` with
`role: 'super_admin'`, gaining platform-wide admin access.

**Mitigation.** `users/create` rule (commit `489bb2e`):
- Self-create requires `role == 'patient'`.
- Only `isAdmin()` can create elevated roles.
- Only `isAgencyAdmin()` can create coordinators, and only in their own
  agency.

**Verification.** `tests/rules/users.rules.test.js` exercises every
allowed path and every forbidden path.

### T2. Audit log injection (the 2026-06-01 incident)

**Threat.** An authenticated user writes `/auditLog` entries with
fabricated `actorId` / `actorName` carrying shell commands aimed at
human admins or AI agents reviewing the dashboard. Discovered live on
2026-06-01: 18 planted entries with actors `system / Migration Daemon
/ Recovery Engine` and payloads including `claude -p "..."` and
`firebase deploy --only firestore:rules`.

**Mitigation, layered.**
1. **Rule layer** (`f14ea17`): `actorId == request.auth.uid` enforced
   on create; `details` capped at 2000 chars.
2. **Display layer** (`f14ea17`, `9a596d4`): admin/AuditLog +
   agency/AuditLog clamp `details` to 240 chars with "Show more"
   toggle so a long payload can't dominate the viewport.
3. **Registration layer** (`f14ea17` L14): patient registration
   rejects role-impersonating display names (`admin`, `system`,
   `crmc`, `cascade`, `claude`, etc.) to prevent the companion
   attack of fake-looking "system" accounts in `admin/Patients`.
4. **Cleanup**: `scripts/cleanup-injection-audit.js` purges entries
   matching the signature set. 18 entries deleted 2026-06-01.

**Verification.** `tests/rules/auditLog.rules.test.js`.

### T3. Cross-patient data write

**Threat.** A patient writes a `documents` or `documentContents` entry
attributed to another patient, polluting their record or pre-stamping
agencyIds / storagePath to grant unintended access.

**Mitigation.** `documents.create` rule (`9a596d4` + Tier-2 item 8):
- `patientId == uid()` required.
- `status == 'pending'` required (no pre-stamping verified).
- `agencyIds` cannot appear at create time (admins stamp at endorse).
- `storagePath` cannot appear at create time (uploader stamps via
  update AFTER the Storage write succeeds). Without this, a malicious
  patient could pre-stamp a path under another patient's tree and
  have DocViewerModal load the wrong object.

`documentContents.create`: `patientId == uid()` (legacy path; will
be removed after the migration script has been run in prod).

Storage path `documents/{patientId}/{docId}/{file}`: read gated by
patient/admin/agency-on-agencyIds; write gated by `patientId ==
auth.uid` with 10 MB cap and content-type whitelist.

**Verification.** `tests/rules/documents.rules.test.js`.

### T4. Cross-agency certificate write

**Threat.** An agency coordinator uploads a Guarantee Letter attributed
to a different agency, surfacing it in the wrong inbox.

**Mitigation.** `certificates.create + update` rule (`9a596d4`): when
`isAgency()`, `agencyId == userAgencyId()` is required. Admins retain
override (cross-agency remediation).

**Verification.** `tests/rules/certificates.rules.test.js`.

### T5. Cross-agency budget mutation by coordinators

**Threat.** A coordinator (`role == 'agency'`, NOT `agency_admin`)
calls the Firestore SDK directly to inflate `budget.allocated` past
the UI gate.

**Mitigation.** `agencies/update` rule (`608738b`): for coordinators,
`request.resource.data.budget == resource.data.budget` (byte-identical
round-trip) is required.

**Verification.** `tests/rules/certificates.rules.test.js` (the
agencies.update block).

### T6. Conversation index pollution

**Threat.** An attacker creates conversations that exclude themselves
(no read access) to spam other users' message lists or surface
adversarial titles in any non-participant-filtered view.

**Mitigation.** `conversations/create` rule (`242c175`): caller must
be in `participants`.

**Verification.** `tests/rules/messages.rules.test.js`.

### T7. Message-attribution forgery

**Threat.** A participant sends a message attributed to another user
within the same conversation.

**Mitigation.** `messages/create` rule (`9a596d4`): `from == uid()`;
also caps `text` at 5000 chars.

**Verification.** `tests/rules/messages.rules.test.js`.

### T8. Notification spam / phishing payload

**Threat.** Authenticated user pushes a large or adversarial
notification body into another user's bell.

**Mitigation.** `notifications/create` rule (`242c175`):
`title <= 200`, `body <= 2000`.

### T9. Hospital ID enumeration

**Threat.** Attacker iterates `CRMC-YYYY-NNNNN` codes to learn which
have been claimed (and by side effect, leak names of registered
patients via the `usedBy` field).

**Mitigation, partial.**
- Per-session soft rate limit at registration: 10 verify attempts per
  hour per session (bypassable by clearing storage).
- Hospital ID `get` is public, but `list` requires auth.
- `usedBy` is the registered name, not the email or other identifier;
  the most an attacker learns is a name<->code mapping.

**Not closed.** A determined attacker can clear sessionStorage or open
many tabs. A proper fix would be a Cloud Function with per-IP throttle
+ reCAPTCHA v3. Deferred until pilot abuse signals appear. See
`Register.jsx` for the soft layer.

### T10. Role-impersonating patient names

**Threat.** Patient registers as "CRMC Admin" or "System Diagnostics"
and is mistaken for an internal user when an admin scans
`/admin/patients`. Discovered alongside T2.

**Mitigation.** `hasReservedToken()` in `src/utils/names.js` blocks
~20 reserved tokens at registration. Whole-token match (case-insensitive)
so legitimate names like "Admiral" pass.

**Verification.** `tests/utils/names.test.js`.

## Threats accepted (with rationale)

### A1. Insider threat by a CRMC super_admin

A compromised or malicious `super_admin` has full Firestore + Auth
control via admin SDK. The audit log records actions but can be
deleted by anyone with the service account key. Mitigation: limit who
holds the service account key; rotate it on personnel change (see
`docs/runbook.md`).

### A2. Stolen agency_admin or super_admin password

No 2FA, no session timeout. Firebase Auth defaults give indefinite
session persistence. Mitigation: training + reset password on suspected
compromise. Future work: enable 2FA for non-patient roles.

### A3. Hospital ID forgery

The access code system trusts CRMC to issue codes responsibly. A
compromised CRMC staff member could mint codes for ineligible patients.
Out of scope; CRMC accountability via paper trail at intake.

### A4. Off-system money movement

MAPA records commitments. Actual settlement (agency → provider) is
off-system. A coordinator could mark a GL "Redeemed" without the
provider being paid; MAPA cannot detect this. The audit log records
the marking but not the underlying truth.

### A5. Real-time IHOMIS divergence

The patient self-types or pastes their hospital case number; MAPA does
not cross-check with the hospital billing system. Stale or fabricated
case numbers are caught at intake by the social worker.

### A6. Document forgery

Patients upload images of IDs / billing statements / certificates. OCR
is advisory; visual verification is by social worker. Sophisticated
forgeries that pass eye review will pass MAPA review.

### A7. Live selfie spoofing

The "live selfie" capture is camera-only (no replay protection beyond
the browser's getUserMedia API). A patient could hold up a photo of
someone else. Caught by social worker compare-to-ID step at intake;
not by automated biometrics.

### A8. AI-agent compromise via planted UI content

T2 was discovered as one instance; the broader class is "any
user-controlled string that an AI assistant might be asked to
summarise or act on." Mitigated by display-layer truncation in
admin/AuditLog and limited by size caps across writable surfaces, but
not eliminated. Future work: provenance tagging for client-written
vs server-written entries.

## Operational limits

| Aspect | Status |
|--------|--------|
| Cloud Functions ready, Blaze required for prod deploy | `resetAgencySlots` (daily) + `glExpirySweep` (hourly) live in `functions/`; web-side lazy fallbacks remain as safety nets for the day the scheduler misfires |
| No tamper-evident audit log | Admin SDK deletes are unrecorded; service-account key holders are trusted |
| No staging environment | Dev work hits the same Firestore as the pilot |
| No automated CI / no rule-deploy gate | Manual `firebase deploy --only firestore:rules`; tests must be run locally |
| No 2FA, no session timeout | Firebase Auth defaults |
| No SMS, no offline mode | Out of scope per CLAUDE.md |
| Client-side rate limiting only | Bypassable; production needs server-side throttle |

## How this document evolves

- Update T-table when adding a rule or rejecting a new attack class.
- Update A-table when accepting a new residual risk (with the why).
- Cross-link rule tests in `tests/rules/` so the verification claim is
  not a comment but a runnable assertion.
- Re-review at every milestone with the pilot stakeholders.