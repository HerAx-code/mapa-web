# Phase 3 plan — evidence and codes (T4, T6)

Status: **plan accepted 2026-11-22 (P3-A to P3-G); PR 3.1 in progress on `feat/documents-are-evidence`.** Phase 2 is shipped (docs/phase2-money-plan.md, #413–#418). Source: the MAPA process-logic gap map, themes T4 (evidence) and T6 (codes), and its proposed decisions D1, D6, D9 and D11. Each gap below was re-checked against `main` at 902eea7+ and is still present.

## What Phase 3 fixes

| Gap | Summary | Where (today) |
|---|---|---|
| I7 | A patient can swap the file behind a verified document, even after it was endorsed to an agency | `firestore.rules` documentContents update / delete |
| I8, N8 | Filing a new request replaces the patient's earlier documents of the same type in place (status back to pending). The uploads happen one by one before the request is saved, so a refused save still leaves them changed | `RequestAssistance.jsx` filing loop → `replacePatientDocument` |
| M4 | A document's status lives in three places (the document, the request's `attachedDocuments`, each slice's copy) and the copies drift | `admin/Requests.jsx` review, patient steps, agency view |
| M7, N7 | The assessment stays editable after agencies rely on it. A Certificate of Eligibility isn't voided when its class changes, and signing / voiding are two separate writes | `agency/IntakeSheet.jsx`, `EligibilityCertCard.jsx` |
| M11 | Any signed-in user can write an audit entry with any action, name and patient | `firestore.rules` auditLog create, `utils/auditLog.js` (83 browser calls) |
| M12 | ID checks (face match, liveness, OCR name, PhilSys signature) are computed and stored by the patient's own browser, but shown to staff as results | `utils/uploadDocument.js`, documents rules |
| M16, N13 | The assessment conversation belongs to one staff member. A patient can rewrite a thread's `lastAt` (beating the 5-second throttle), the names staff see and the preview | `utils/messages.js`, conversations rules |
| N11 | The patient's intake autosave rewrites the whole sheet; a staff edit in between makes it fail silently | `IntakeWizard.jsx` |
| N12 | Bill numbers are checked within one hospital only | `agency/IntakeSheet.jsx` bill check |
| N17 | A blank monthly income can count as ₱0, completing the sheet with the poorest class | `utils/intakeSheet.js` |
| N18 | A duplicate-account flag disappears when the patient changes their phone | `functions/src/identityIndex.js` |
| I1 | Claiming a patient-bound code compares the typed last name and birthdate with the desk's record, never the account's own. Juan's account could claim Ana's code | `HospitalGate.jsx`, rules `codeClaimProofOk` |
| M10 | Two desks issuing at once pick the same number; a deleted code's number can be reissued; nothing warns that the person already holds an open code; claims fail if verifyAccessCode is unreachable | `IssueCodeModal.jsx` `freeCodeId`, `accessCodes.js` |
| R4 | Claiming is written twice: Register's transaction and `claimAccessCode` | `Register.jsx`, `utils/accessCodes.js` |

## Rules every change follows
1. **Evidence is never rewritten.** A document a social worker verified, or one sent to an agency, keeps its file forever. A correction is a new document.
2. **One owner per fact.** A document's status lives on the document; everything else shows it.
3. **The record is written by whoever did the action, on the server, when it matters.** Money and identity already are (Phases 1–2); Phase 3 adds codes, amendments and conversation access.
4. **Order stays data → queries → rules**, and every rules change ships with emulator tests proving the old write is refused.

---

## Decisions (all seven accepted, 2026-11-22)

### P3-A. How a document is replaced (I7, I8, N8)
**Recommendation:**
- A patient may replace a document's file in place **only while it is pending or rejected and has not been sent to an agency** (`agencyIds` empty). This is today's "Redo" for a document staff asked to fix.
- Anything verified or endorsed is locked: the rules refuse an update or delete of its content.
- Filing a new request **always uploads new documents**, apart from the reusable ones already verified (Valid ID and the others in `reuseMonths`). It never replaces an earlier case's file.

Why: the only legitimate in-place replace is a fix before anyone relied on the file. Uploading new documents at filing also fixes N8: a refused save leaves unattached new files behind, not altered old ones (a cleanup sweep can remove unattached files older than a week; see PR 3.1).

### P3-B. Can the assessment change after endorsement? (D6, M7)
**Recommendation: adopt D6.**
- The intake sheet's assessment locks at endorsement, like coverage.
- Corrections go through **"Amend assessment"**, a function that requires a written reason. It writes the audit entry and notifies the endorsed agencies.
- If the class changed, it voids the Certificate of Eligibility. Every already-approved slice is marked "assessment changed after approval" for its agency to look at.
- Nothing is reversed automatically.

### P3-C. Who reads a patient's conversation? (D11, M16)
**Recommendation: adopt D11, implemented by joining.**
- A conversation started by hospital staff belongs to the case: it carries `tenantId` and `requestId`.
- Another staff member of that hospital opens it through a function, `joinCaseConversation`. The function adds them as a participant and writes an audit entry the patient sees in their access log ("Ana Reyes, Medical Social Service, opened your case conversation").
- Reading stays "participants only" in the rules, so no list query can leak threads. Other hospitals can't join, and each agency keeps its own thread for its slice.

### P3-D. Audit entries written by browsers (M11)
Moving all 83 browser `logAudit` calls into functions would be most of a phase on its own.

**Recommendation: tighten what a browser may write.**
- `actorName` and `actorRole` must equal the writer's own profile.
- Patients write no entries.
- A list of **server-only actions** (approvals, letters, endorse, close, accounts, codes, amendments) is refused from browsers.
- A staff entry's `patientId` / `requestId` must be a case in the writer's own hospital (agencies: a request they hold a slice in).

What remains in the browser is staff recording their own non-money work, where a forged entry gains nothing.

### P3-E. Does a withdrawal use up the access code? (D1)
**Recommendation: adopt D1.** If the patient withdraws before any staff action (status `submitted`, no document reviewed), the code comes back to them for one new filing. After any review, withdrawing uses it up. `onRequestWritten` does this on the server when it sees the withdrawal.

### P3-F. Where claiming and issuing run (I1, M10, R4)
**Recommendation: on the server.**
- **`claimAccessCode`** (a callable) does every claim, at sign-up and at filing. This replaces both browser paths (R4). It compares the code's recorded last name and birthdate with **the account's own profile** (I1; at sign-up the account takes them from the code, as today), moves the patient's current hospital, and records the claim.
- **`issueAccessCode`** takes the next number from a per-prefix counter in a transaction (no collisions, no reuse of a deleted number). It warns the desk when that person (same last name + birthdate) already holds an open code, as a confirmation, not a block.
- `verifyAccessCode` stays as the read-only preview.
- After this the rules refuse browser writes to `hospitalIds` claim fields.

Why: the rules can't normalize names the way `codeProof()` does (accents, spaces), so the honest check against the profile has to run in code. One path also removes the "fails if verifyAccessCode is unreachable" split.

### P3-G. Bill numbers across hospitals (D9, N12)
**Recommendation: adopt D9.** Keep the duplicate check per hospital. The bill check adds a required confirmation that the bill is **this hospital's own**, checked against its billing system or the signed bill. MAPA covers only the filing hospital's charges, and bill numbers aren't shared between hospitals, so a network-wide check would flag unrelated patients.

---

## PR 3.1 — Documents are evidence (I7, I8, N8, M4, M12)
1. **Rules:** `documentContents` update / delete only while the parent document is `pending` or `rejected` and its `agencyIds` is empty (P3-A); staff keep their own rights. `documents` delete by a patient under the same condition.
2. **Filing:** `RequestAssistance` uploads a new document for every type it needs (except reusable verified ones) instead of replacing. `replacePatientDocument` is used only by Redo on a rejected or pending document of the current request.
3. **One status (M4):**
   - The document is the truth. The hospital's review writes only the document.
   - The request's `attachedDocuments` and the slice copies keep id, name and type for the record.
   - Every screen that shows a status (patient steps, Requests, the agency view) reads the live documents, as the endorse gate already does on the server.
   - The review no longer rewrites the request's list from the page's copy.
4. **ID checks (M12):** the hospital's screen labels face match, liveness, OCR and the PhilSys signature as **"reported by the patient's phone — check it yourself"**, never as a pass. The selfie comparison by the social worker stays the decision.
5. **Leftovers:** a monthly sweep deletes unattached documents (no request references them) older than 30 days, with their content.
6. **Tests:** rules tests for each document state; a utils test that filing never targets an earlier request's document; a component test of the status shown from the live document.
7. **As built:**
   - **Request document list (M4):** kept by the `syncDocumentStatus` trigger, so queues still count from the request without reading every document. It updates the entry on each change (one transaction per request); attaches a verified late upload, in place of the document it `supersedes`, which is recorded in `replacedDocuments`; and lets the endorsed agencies read it. Staff pages no longer write `attachedDocuments` (rules refuse it); the open case page already merges the live documents.
   - **Filing:** a retry replaces only what that attempt created. A rejected document that was already endorsed is fixed with a new document on the active request.
   - **ID checks:** a "pass" is grey and labelled "(patient's phone)"; warnings stay amber.
   - **Cleanup:** `purgeUnattachedDocuments` runs monthly at 03:30 on the 1st. It skips documents added to a request.

## PR 3.2 — Assessment and intake (M7, N7, N11, N17, N18, N12)
1. **`amendAssessment({ requestId, changes, reason })`** (P3-B) — gateway staff of the case's hospital. In one transaction it:
   - applies the change to the assessment fields;
   - stamps `amendments[]` with who, when, the reason and the before / after;
   - voids the active Certificate of Eligibility if the class changed;
   - marks approved slices `assessmentChangedAt`.

   Then it writes the audit entry and notifies the endorsed agencies.
2. **Rules:** once a request has `agencyIds`, hospital staff can no longer write the intake sheet's assessment fields from the browser.
3. **Certificate of Eligibility (N7):**
   - Generate re-reads the request inside its transaction and refuses when an active certificate exists.
   - Signing and voiding write the certificate and the request in one batch.
4. **Patient autosave (N11):** writes only the changed fields (dotted paths), and tells the patient when a save fails instead of failing silently.
5. **Income (N17):** a blank monthly income is stored as `null` and keeps the sheet incomplete; ₱0 must be entered as 0.
6. **Duplicate flags (N18):** `identityFlags` keep a match until a social worker clears it with a reason (audited); a profile change adds matches but never removes one.
7. **Bill check (N12, P3-G):** add the "this hospital's own bill" confirmation.
8. **Tests:** function tests for each amendment outcome; rules tests for the lock; utils tests for income and flags.

## PR 3.3 — Case conversations (M16, N13)
1. **Data:** a conversation started by hospital staff carries `tenantId`, `requestId` (when it is about a case) and `kind: 'case'`. A report-first backfill fills these on existing threads where the patient's request is clear.
2. **`joinCaseConversation({ conversationId })`** (P3-C): the caller must be gateway staff of the conversation's hospital. It adds them as a participant and writes the access-log entry the patient sees.
3. **Hospital view:** the case page lists the case's conversations, with "Open" for staff who aren't in them yet.
4. **Thread fields (N13):**
   - A trigger on each new message writes `lastAt` and the preview.
   - Participants may change only their own read marker on the conversation.
   - Names and roles are set when the thread starts and never by a patient.
5. **Email scope:** `mayEmail` already lets a hospital's staff reach its patients; no change, but tests confirm a joined staff member's reply is emailed.
6. **Tests:** rules tests that a patient can no longer move `lastAt` or names; function tests for join (same hospital only, audited).

## PR 3.4 — Codes on the server (I1, M10, R4, D1)
1. **`issueAccessCode`** and **`claimAccessCode`** (P3-F), with tests for: the account-profile check (Juan can't claim Ana's code), two desks at once, a deleted number not reissued, the open-code warning, and a hospital that takes no claims.
2. **Pages:** IssueCodeModal, Register, HospitalGate and filing call them. `utils/accessCodes.js` keeps only the read helpers.
3. **Withdrawal (P3-E):** `onRequestWritten` gives the code back when a withdrawal comes before any staff action.
4. **Rules:** browsers no longer write `hospitalIds` claim fields or `privateInfo`.
5. **Existing data:** none to migrate. Codes keep their ids; the counter starts above each prefix's highest number (a one-off script, report first).

## PR 3.5 — Audit entries (M11)
1. **Rules (P3-D):**
   - The actor's name and role must match their profile.
   - No patient entries.
   - The server-only action list is refused from browsers.
   - Case ids must be in the writer's scope.
2. **Pages:** drop the browser `logAudit` calls that duplicate a function's own entry (any left after Phases 1–2). Keep the rest.
3. **Tests:** rules tests reproducing the M11 forgery (a patient writing "approved" as "Hospital Admin") now refused, and each kept staff entry still allowed.

## Deploy order (each PR)
1. Regenerate the bundle; deploy the functions.
2. Merge; Vercel deploys the pages.
3. Deploy the rules after the web change is live.
4. PR 3.3 and PR 3.4 each have a report-first script (conversation backfill, code counters); run them between steps 1 and 3, on your OK.

## Not in Phase 3
- Timers for cases that never finish and slices never proceeded on (T5, Phase 4).
- Cleanup of what Phases 2–3 leave unused (T7, Phase 5).
- Two-factor stage 2, due about two weeks after staff enrolled; it can ride along with any PR here.
