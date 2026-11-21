# Phase 1 plan — messages and accounts (T1, T2)

Status: **PR 1 merged and deployed (HerAx-code/mapa-web#407, #408). PR 2A merged and deployed (#410, 2026-11-21). PR 2B (sections 4–5) built on `feat/mfa-and-agency-listing`, 2026-11-22. Two-factor stage 2 (rules + functions) is a later PR, about two weeks after 2B is live.**

Phase 1 closes the gaps that are exposed today and don't depend on the money work in Phase 2:

| Gap | Summary | Fixed by |
|---|---|---|
| I4 | Any Hospital Admin can delete any sign-in account (`deleteAuthUser`) | PR 2 |
| I5 | `/api/send-email` and `/api/send-sms` send anything to anyone | PR 1 |
| M1 | Patient erasure stops halfway (conversations can't be deleted) | PR 2 |
| M5 | Events created by Cloud Functions send no email | PR 1 |
| M9 | Deleting a staff account leaves the sign-in | PR 2 |
| M18 | Staff two-factor is optional (`MFA_MODE` is defined but never read) | PR 2 |
| M19 | Announcement reminders are sent by whichever staff browser is open | PR 1 |
| **M20 (new)** | A new announcement notifies and emails **every** user in reach, ignoring the audience picked on the form (`Announcements.jsx:417`, `getUsersInScope(db)` with no roles), from a browser loop | PR 1 |
| N10 | Patients can read every agency's full record (budget, allocation) | PR 2 |
| R5 | Two Proceed implementations; Track Status also notifies agencies from the browser (refused by the rules) | PR 1 |

Rules every change follows (from the map): the server decides; one implementation per process; email and SMS leave from the server only.

---

## Decisions to settle before coding

These are specific to Phase 1. **All four recommendations were accepted (2026-11-21)** and are now the design.

### P1-A. Email between staff — accepted
The rule agreed earlier: hospital staff email only their own hospital's patients and staff, agencies email only patients endorsed to them, and patients email only themselves.

Applied literally, it **drops the email** (the in-app notification stays) for these existing notifications:
- agency → the hospital social worker who endorsed (info requested, approved, rejected, reversed): `ApplicationDetail.jsx:335, 518, 655, 920`
- agency → watchers on other agencies (`ApplicationDetail.jsx:536, 669`)
- agency → own team (low balance `agency/Dashboard.jsx:245`, Team changes `Team.jsx:334–397`)
- hospital → agency staff ("Endorsement closed", `Requests.jsx:1079`)
- Super Admin → hospital and agency staff (`AgencyDetail.jsx`, `AddAgency.jsx`, `Agencies.jsx`)

**Recommendation:** keep the patient side exactly as agreed, and let staff email the staff they actually work with:
- same hospital;
- an agency and the staff of a hospital it partners with;
- an agency and its own team;
- the Super Admin and any hospital or agency staff.

Why: the protection that matters (no email to arbitrary addresses or to patients outside the case) is unchanged. The dropped emails are the ones that start someone's work, and losing them would recreate M5.

### P1-B. Removing agency and Super Admin sign-ins — accepted
The decision was "Hospital Admin only" for deleting sign-ins. That leaves no way to remove a departed agency coordinator's sign-in (M9 for agencies).

**Recommendation:** keep deletion for Hospital Admins only, and add a separate **disable** action: the Agency Admin for their own team, and the Super Admin for hospital and agency staff. Disabling blocks sign-in at once and can be undone; it never removes data.

Why: it covers the security need (a removed person can't sign in) without widening who can destroy accounts.

### P1-C. Two-factor rollout — accepted
**Recommendation:**
1. The release asks every staff member to enrol on next sign-in and blocks the app until they do.
2. Two weeks later, the rules and functions start refusing staff sessions without a second factor.
3. A Hospital Admin can reset two-factor for their own staff, and the Super Admin for Hospital Admins and agency staff, for lost phones.

Why: enforcing in the rules on day one would lock out everyone not yet enrolled. A reset path is required before enforcement, or a lost phone locks a social worker out for good.

### P1-D. Email rate limits — accepted
**Recommendation:** per sender per hour: patients 10, staff 120, server events unlimited. Over the limit, the email is skipped, the in-app notification still arrives, and the skip is logged.

Why: announcements now fan out on the server (unlimited), so the only legitimate burst from a person is a bulk action like "Request documents" on a few dozen cases.

---

## PR 1 — Email from the server (T1)

### 1. `sendNotificationEmail` (new Cloud Function)
Trigger: `onDocumentCreated('notifications/{uid}/items/{id}')`.

1. **Once only.** In a transaction, skip if the notification already has `email`; otherwise stamp `email: { state: 'sending' }`. Triggers can fire more than once.
2. **Sender.** `fromUid` → users doc. `fromUid == null` means a server event, which is always allowed.
3. **Recipient.** `users/{uid}`: needs an email, `active !== false` and no `deletion`.
4. **Scope.** A pure function `mayEmail(sender, recipient)` implements P1-A:
   - patient sender → only themselves;
   - hospital staff → patients whose `tenantIds` include the sender's hospital, plus staff per P1-A;
   - agency staff → patients whose `agencyIds` include the sender's agency, plus staff per P1-A;
   - Super Admin → staff only.
5. **Rate limit.** Per sender (P1-D), reusing `checkAndBumpThrottle`, moved out of `verifyAccessCode.js` into `functions/src/rateLimit.js` so both use one copy.
6. **Render.** Subject from `title`; text and HTML built here from `title` and `body`, escaped. The footer is the recipient's current hospital (from `hospitals/{tenantId}`, via `orgConfig`), or the network name for agency and Super Admin users. No HTML comes from the client.
7. **Send.** Gmail SMTP through nodemailer, then stamp `email: { state: 'sent', at }` or `{ state: 'skipped', reason }`.

Setup:
- Secrets: `SMTP_USER`, `SMTP_PASS` via `defineSecret`; `SMTP_FROM` is an optional plain parameter (`defineString`, default `MAPA <SMTP_USER>`), since a display address isn't secret.
- New dependency: `nodemailer` in `functions/package.json` (agreed in this session).

### 2. `notify()` writes in-app only
- `src/utils/notifications.js`: remove the `/api/send-email` and `/api/send-sms` calls, the user lookup and the HTML builder. Keep the Firestore write and the `notificationErrors` fallback.
- Remove the `sms` and `smsText` options. One caller used them (the agency approval, `ApplicationDetail.jsx:513`); per the earlier decision to turn SMS off, that approval is now in-app and email only.
- Every existing caller keeps working unchanged, and server-side notifications now get email too (M5).

### 3. Retire the Vercel endpoints
- Delete `api/send-email.js`, `api/send-sms.js` and `tests/utils/sendSms.test.js`.
- Remove `nodemailer` and `jose` from the root `package.json` (only those two files use them).
- After deploying, remove `SMTP_*` and `SEMAPHORE_*` from Vercel.
- Update CLAUDE.md: SMS is retired for now; email comes from Functions.

### 4. Announcements on the server (M19, M20)
- **`onAnnouncementCreated`** notifies the announcement's real audience, **in-app only** (`channel: 'inapp'`), so a broadcast to a whole hospital can't use up the Gmail sending quota the case emails depend on (today's browser fan-out also emailed every recipient):
  - hospital announcements: that hospital's users in `targetRoles` (patients through `tenantIds`);
  - agency announcements: no fan-out, matching today.
- **`announcementReminders`** runs every 15 minutes (Asia/Manila). For announcements starting within 24 hours with `reminderSent == false`, it flips `reminderSent` in a transaction and sends to the same audience.
- Remove the browser fan-out in `admin/Announcements.jsx:417` and the reminder block in `components/Layout.jsx:1029–1045`.

### 5. One Proceed action (R5)
- Add `proceedSlices(slices)` in `src/utils/requests.js`. It moves `endorsed` slices to `reviewing` in one batch, with one audit entry per slice. `RequestAssistance.handleProceed` and `TrackStatus.handleSliceProceed` both call it.
- Delete the browser agency notify in `TrackStatus.jsx:218–233`; `onSliceProceeded` already does it.

### Tests
- `tests/functions/sendNotificationEmail.test.js`:
  - the `mayEmail` matrix (every sender role × recipient type);
  - once-only behaviour;
  - rate-limit skip;
  - escaping (a `<script>` in `body` arrives as text);
  - footer branding;
  - server events.
- `tests/functions/announcements.test.js`: audience by `targetRoles` and hospital; reminder fires once.
- `tests/utils/notifications.test.js`: `notify()` makes no network call.
- Run: `npm test`, `npm run test:functions`, `npm run test:components`, `npm run build`, `npm run budget` (the bundle shrinks).

---

## PR 2 — Accounts (T2)

### 1. `eraseAccount` (new callable, replaces `deleteAuthUser`) — PR 2A
**Caller:** a `super_admin` with a `tenantId`. Once P1-C is enforced, a two-factor session is also required.

**Target**, read with the Admin SDK (the target's profile must exist):

| Target | Allowed when | What happens |
|---|---|---|
| Hospital staff (`super_admin`, `staff_admin`) | Same hospital, not the caller, and not the hospital's **last** Hospital Admin (new guard) | Sign-in deleted, profile deleted, audit entries kept |
| Patient, never endorsed | `tenantIds` contain only the caller's hospital; no request with agencies or committed money; no slices; no Certificate of Eligibility | **Full erasure (D7):** documents, file contents, requests, notifications, conversations and messages, identity index entries and flags, bill keys for its requests, the code's `privateInfo` (the code is marked `erased`); then the profile and the sign-in |
| Patient, endorsed or funded, or with a certificate | Same hospital condition | **Restricted (D7):** sign-in deleted; email, phone and address removed from the profile; selfies purged; `erasedAt` set, `active: false`. The case record is kept for the retention period |
| Patient who also filed at another hospital | — | Refused: "This patient also has a case at another hospital." |

- **Idempotent:** a re-run continues where a failed one stopped.
- Built in 2A with two additions: full erasure also takes the patient's name off their audit entries (`targetName` → "Erased patient"; free-text `details` are not rewritten), and a restricted profile keeps `city` and `province` because the DOH monthly report needs them.
- Writes one audit entry itself, with no personal details.
- **Confirm before go-live:** the retention period for restricted records (D7), from the records officer or Data Protection Officer.

### 2. `disableAccount` and `resetStaffMfa` (new callables)
- **`disableAccount`** (P1-B): Agency Admin → own team; Super Admin → hospital and agency staff; also Hospital Admin → own staff (their Accounts page Deactivate button is the same action). Refuses to disable a hospital's or agency's last active admin. Sets the Auth user to `disabled: true` and `active: false` on the profile. Undo with `enable: true`.
- **`resetStaffMfa`** (P1-C): Hospital Admin → own staff; Super Admin → Hospital Admins and agency staff. Removes the enrolled factors with the Admin SDK and notifies the person.

### 3. Pages call the functions
- `admin/Patients.jsx` `handleDeleteAccount` → `eraseAccount`. The modal explains the two outcomes (full erasure vs restricted). The browser cascade is removed.
- `admin/Accounts.jsx` `handleDelete` → `eraseAccount`.
- `admin/AgencyDetail.jsx`: the coordinator Delete button is replaced by **Reset two-factor** (nobody deletes agency accounts, P1-B); the active toggle (`handleDeleteCoord`, `handleToggleCoord`), and `agency/Team.jsx` `handleToggleActive` → `disableAccount`. Today these only flip `active` on the profile, which AuthContext checks after sign-in; the sign-in itself stays usable.
- Delete `functions/src/deleteAuthUser.js` and its tests; remove its export from `functions/index.js`.

### 4. Two-factor required for staff (M18, P1-C) — stage 1 in PR 2B
- **Client (2B):** `MFA_MODE = 'required'`. `components/MfaGate.jsx` (rendered by `Layout`) shows `MfaEnrollModal required` to a staff member without a factor: no close button, Escape ignored, removal not offered, **Sign out** as the exit. If the project itself doesn't offer TOTP (`auth/operation-not-allowed`), it offers **Continue for now** so a config gap never locks staff out. The email-verification step gains "I've verified my email".
- **Rules, at stage 2:** a `staffMfaOk()` helper checks `request.auth.token.firebase.sign_in_second_factor != null` and is added to `isAdmin()`, `isAgency()` and `isPlatformAdmin()`.
- **Functions, at stage 2:** callables check the same token claim.

### 5. Patients read the public agency listing (N10) — PR 2B
- **Extend `projectPublicAgency`** (`functions/src/onAgencyWritten.js`) with the fields patient screens use: `description`, `procedure`, `processingTime`, `requirements`, `assistanceTypes`, `partnerHospitalIds`, `hospitalSlots` (total and remaining only). Budget, allocation, caps, slot history and repeat limits stay out.
- **Point patient screens at `agenciesPublic`:** `MedicalPrograms.jsx`, `RequestAssistance.jsx` (agency map), `useMarketplace.js`, and the patient branch of `LiveDataContext.jsx`.
- **Remove the browser `syncAgencyPublic` calls** (16 places); the function is the only writer (part of R10). The rules' `agenciesPublic` write branch becomes `if false`.
- Built in 2B: the projection keeps `slots` as the sum of all daily capacity (the Landing teaser) and adds `agencySlots` + `lastResetDate` + `hospitalSlots` for `effectiveSlots()`; `agencyFromPublic()` (src/utils/agenciesPublic.js) maps a listing doc back to the agency shape. The listing is written with a full set, not a merge. The Super Admin's **Resync public** button calls a new `resyncAgenciesPublic` function; `scripts/backfill-agencies-public.js` imports the function's projection. Staff keep reading full `agencies` records (the Training Hospital's practice agency is never published).
- **Rules:** `agencies` read becomes `isAuth() && !isPatient()`.

### Tests
- `tests/functions/eraseAccount.test.js`: every row of the table above, including the last-Hospital-Admin guard, the other-hospital refusal, and a re-run after a partial failure.
- `tests/functions/disableAccount.test.js`, `tests/functions/resetStaffMfa.test.js`: who may act on whom.
- `tests/functions/onAgencyWritten.test.js`: the new fields are projected; budget isn't.
- Rules:
  - a patient can't read `agencies` and can read `agenciesPublic`;
  - nobody writes `agenciesPublic` from a browser;
  - at stage 2, staff without a second factor are refused (`authenticatedContext(uid, { firebase: { sign_in_second_factor: 'totp' } })`).
- Run: all of `npm run test:all`, plus `npm run build` and `npm run budget`.

---

## Deploy order

1. Set the Functions secrets `SMTP_USER`, `SMTP_PASS` (project `mapa-crmc`; both already exist). `SMTP_FROM` is optional.
2. Deploy the functions: `sendNotificationEmail`, `onAnnouncementCreated`, `announcementReminders`, `eraseAccount`, `disableAccount`, `resetStaffMfa`, and the updated `onAgencyWritten`.
3. Backfill `agenciesPublic` once: touch each agency, or run a one-off script.
4. Merge the web change; Vercel deploys it. Check on the preview URL first.
5. Deploy the rules change that restricts `agencies` reads. It must come **after** step 4, or patients on the old web build lose the agency list.
6. Remove `SMTP_*` and `SEMAPHORE_*` from Vercel; delete the old function with `firebase functions:delete deleteAuthUser`.
7. Two-factor: announce the date, ship `MFA_MODE = 'required'`, and two weeks later deploy the stage-2 rules and function checks.

## Not in Phase 1
- The money functions, slots and status changes (Phase 2: T8, then T3).
- Document versions and case-owned conversations (Phase 3: T4). Case-owned conversations will change who `mayEmail` lets reply, so `mayEmail` is written to take the case into account later.
- Turning SMS back on. If it returns, it is another branch of `sendNotificationEmail` limited to staff senders and specific events, never an open endpoint.
