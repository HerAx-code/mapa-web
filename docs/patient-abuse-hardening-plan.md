# Patient-Side Abuse Hardening — Build Plan

*Written 2026-09-25. Closes the concrete abuse vectors found in the patient
surface review. Verified against `firestore.rules`, `functions/`, and the patient
pages. Everything below is proportionate: it stops the real spam/tamper vectors
without a disproportionate refactor (see §0).*

## 0. Guiding decisions (feasibility-driven)
- **No blanket "all notifications via Cloud Function" rewrite.** `notify()` writes
  cross-user from **54 call sites** (`src/utils/notifications.js` → `addDoc(notifications/{uid}/items)`). Rewriting all of them is out of proportion to the threat, which is specifically a **patient** spamming staff. Fix: forbid patients from
  notifying anyone but themselves, and move the single legit patient→staff ping
  (new-request) to a server trigger. Admin/agency→patient writes stay client-side
  (lower risk; separate hardening if ever needed).
- **Rules can't aggregate/query.** Any "count" or "one active X" limit needs a
  denormalised field (`users/{uid}.activeRequestId`, a counter) maintained by a
  trigger, with the rule doing a single `get()`. Races are acknowledged and
  handled at pilot scale (§3).
- **`request.time` is available in rules** — use it for message cooldowns.

---

## 1. Notification spam → staff  *(highest annoyance, real hole)*
**Flaw:** `notifications/{userId}/items` create only checks `fromUid == uid()`
(rules ~line 603). A patient can drop unlimited notifications into **any** staff
feed. The rule comment already flags the intended fix.

**Design (proportionate):**
1. **Rule:** add to `create` — `(!isPatient() || userId == uid())`. Patients may
   only notify themselves; staff/agency keep cross-user create.
2. **Triggers (Admin SDK):** the build found **three** patient→staff pings, not
   one, so two triggers replace them:
   - `onRequestWritten` (`onDocumentWritten requests/{id}`): **new request** →
     notify admins; **patient withdrawal** (close w/ withdrawal reason) → notify
     admins.
   - `onSliceProceeded` (`onDocumentWritten applications/{id}`): slice
     **endorsed → reviewing** (patient proceeded) → notify that agency's coords.
3. **Client:** remove all three patient→others `notify()` calls in
   `RequestAssistance.jsx` (submit, withdraw, proceed) + the now-unused import.

**Feasibility (as built):** clean, but bigger than first scoped — the "one legit
ping" was actually three. Two triggers + one rule clause + client deletions.
In-app only; the old client path also emailed admins (dropped — they triage the
queue in-app). **BUILT** — see the security PR.
**Tests:** rules — patient create to another uid **denied**, to self allowed,
admin→patient still allowed, spoofed fromUid denied. Functions — onRequestWritten
(create/withdraw) + onSliceProceeded handlers (7 tests).

---

## 2. Messaging: **reply-only** (patient cannot initiate)  *(decided 2026-09-25)*
Rather than harden a patient compose flow, **remove it.** The patient cannot start
a conversation or pick a recipient — they can only **reply** to a thread that CRMC
(or an agency) opened about their case. This eliminates the spam vector, the
"message anyone" picker, and the staff-directory leak *outright*, is **less code**
than the recipient-lockdown, and preserves the async-assessment loop we just
adopted (CRMC asks → patient answers). It supersedes the earlier "lock recipients
/ shared CRMC inbox" idea — no shared-inbox rearchitecture needed.

**Flaw it closes:** `PatientComposeModal` fetches **all** `super_admin/staff_admin/
agency` users to the patient client and lets them DM any of them; `conversations`/
`messages` create have **no rate limit** (rules ~581–630); the picker + per-pair
dedup enables one spam thread per staffer.

**Why reply-only is safe:** CRMC already **initiates** the thread — the admin
"Message patient" action calls `getOrCreateConversation(admin, patient)` on the
request detail. So the patient being a reply-only participant loses nothing in the
assessment flow.

**Design:**
1. **Rules — patients can't create conversations.** `conversations.create`: add
   `&& !isPatient()` (only staff/agency initiate). Patients stay participants and
   keep `read` + `messages.create` (reply). This is the core lock.
2. **Reply cooldown (rules).** `messages.create`: require
   `request.time >= get(conversation).data.lastAt + duration.value(5,'s')` to cap
   reply-flooding within a thread. (`lastAt` is already written on send; the rule
   already does a participant `get()`, so this adds nothing structurally.)
3. **Client — delete initiation.** Remove `PatientComposeModal` from the patient
   Messages page **and its `users`-directory query** (closes the leak), the "New
   Message" FAB/CTA, and any patient-initiate "Message CRMC" buttons elsewhere
   (Help page, hero, etc.). Empty state becomes: *"CRMC will message you here if
   they need anything about your request."* Patient keeps reading threads +
   replying (`ConversationThread` unchanged).

**Feasibility:** clean and *smaller* than the lockdown — one rule clause
(`!isPatient()`), one cooldown clause, and client deletions. No shared-inbox, no
read-rule widening, no staff-side view work. Admin/agency→patient initiation is
unchanged (both are `!isPatient()`).
**Caveat (accepted):** a patient can't *proactively* ask a question. Covered by
the Track page (status), doc-reject/`awaiting_info` ("fix this"), and the Help
page's contact info. If proactive questions later prove necessary, add a single
"Ask CRMC about this request" that opens **one** case-scoped thread — but default
to reply-only.
**Tests:** rules — patient `conversations.create` **denied**, staff create
allowed, patient reply within 5s **denied** / after cooldown allowed, staff
uncapped. Component — the deleted PatientComposeModal test is removed.
**✅ BUILT** — in the security PR alongside #1/#4.

---

## 3. One active request + request-scoped documents
**Flaw:** `requests.create` (rules ~220) has **no count limit** — a patient can
file unlimited requests. And `RequestAssistance.jsx:507` builds
`attachedDocuments` from **all** the patient's documents, not this request's.

**Design:**
1. **`users/{uid}.activeRequestId`** guard:
   - Rule `requests.create`: add `get(/users/$(uid())).data.get('activeRequestId', null) == null`.
   - Trigger (extend #1's `onRequestCreated`): set `activeRequestId = requestId`.
   - On request → terminal (`fully_funded/closed/rejected`), a trigger clears it
     (extend `syncRequestFinancials` or a small `onRequestWritten`).
   - **UI:** hide/disable "new request" when one is active (immediate guard).
2. **Scope `attachedDocuments`** to the doc IDs created in *this* submission
   (collect the `documentId`s returned by `uploadPatientDocument`, don't re-query
   all patient docs).

**Feasibility / race:** two rapid creates could both read `activeRequestId==null`
before the trigger sets it. At pilot volume this is negligible, and the UI guard +
a nightly "duplicate active request" cleanup (or the CF closing extras) cover it.
Documented as an accepted residual, not silently ignored.
**Tests:** rules — create denied when `activeRequestId` set; utils — attach set
equals only this submission's docs.

**✅ BUILT (as designed, plus one hole found and closed):**
- **Rule** `requests.create`: added `get(/users/$(uid())).data.get('activeRequestId', null) == null`.
- **Trigger** `onRequestWritten` (extended, not a new function): `syncActiveRequest`
  keeps `users/{patientId}.activeRequestId` in step — **set** while the request is
  active (self-healing: reads first to avoid churn on ordinary status advances,
  but backfills a pre-existing active request whose pointer was never set),
  **cleared** on active→terminal / withdrawal / delete, but only when the pointer
  still names *this* request (never clobbers another). Runs alongside the #1
  notifications in the same handler.
- **Hole found:** the #4 self-update clause pinned `hospitalId/patientId/name`
  but **not** `activeRequestId` — a patient could null their own pointer and file
  a second request, defeating the guard. **Fixed:** pinned `activeRequestId` on
  self-update too (server-owned; only the Admin SDK trigger writes it).
- **`attachedDocuments` scoped:** [RequestAssistance.jsx](../src/pages/patient/RequestAssistance.jsx)
  now builds the snapshot from *this request's* checklist (uploaded/replaced +
  reused-verified) plus rep docs, instead of re-querying every historical doc a
  patient ever uploaded (which leaked prior/rejected/unrelated docs onto the new
  request).
- **UI guard:** already present (the `activeRequest` live query blocks the form
  and `handleSubmit`), so no client change was needed for the immediate guard.
- **Tests:** rules — `requests.create` denied when `activeRequestId` set, allowed
  when absent; self-update nulling/re-pointing `activeRequestId` denied,
  unchanged allowed. Functions — `syncActiveRequest` set/backfill/no-churn/
  clear/clear-skipped/no-patient + handleRequestWritten runs both concerns (8).
- **Deploy:** needs a manual Blaze redeploy of `onRequestWritten` (the trigger
  body changed) after merge.

---

## 4. Lock identity-linking fields on self-update  *(confirmed hole)*
**Flaw:** `users.update` self clause (rules ~439) pins only `role/agencyId/active/
rank` by equality. **`hospitalId`, `patientId`, and `name` are NOT pinned**, so a
patient can edit their `hospitalId`/`patientId` — a linkage-tampering / record-
confusion vector.

**Design (decided 2026-09-25 — lock the name):** extend the self-update equality
checks. Use `.get(field, null)` so roles lacking a field aren't broken:
`hospitalId` and `patientId` are pinned for **all** self-updates (a no-op for
staff, who don't have them); `name` is pinned **for patients** (`!isPatient() ||
name unchanged`) so staff can still self-rename. Contact/address stay editable.

**Feasibility:** one-line-per-field addition to the existing equality clause;
matches the pattern already there. No client change (the profile editor only
sends contact/address today — verify).
**Tests:** rules — self-update changing `hospitalId`/`patientId` **denied**;
changing `contact`/`address` allowed.

---

## 5. Document count / byte cap  *(quota abuse, Spark plan)*
**Flaw:** file size is capped (~650 KB) but there's **no cap on the number** of
documents; content is base64 in Firestore.

**Design (pragmatic):**
- **UI:** you only ever need the required-checklist docs; block extra uploads
  beyond the checklist + a small slack.
- **Server:** maintain `users/{uid}.documentCount` via a trigger on `documents`
  create/delete; rule `documents.create` requires `get(...).documentCount < CAP`.
- Longer term: Cloud Storage on Blaze (removes the Firestore-doc pressure).

**Feasibility:** the counter+trigger is the only way to cap in rules (no
aggregation). Same race caveat as §3, same mitigation. Lower priority than 1–4.
**Tests:** rule — create denied past CAP (with a seeded counter).

**✅ BUILT:**
- **Trigger** `onDocumentCountChanged` (NEW, `onDocumentWritten documents/{docId}`):
  `handleDocumentCountChanged` maintains `users/{patientId}.documentCount` — +1 on
  create, -1 on delete; an update (e.g. `replacePatientDocument`, same doc id)
  does not change it.
- **Rule** `documents.create`: added
  `get(/users/$(uid())).data.get('documentCount', 0) < 60`. 60 is a generous
  lifetime ceiling (~8–10 requests of checklist docs) — an abuse cap, not a tight
  quota; a comment flags it as raisable.
- **Same self-update hole as #3, closed:** pinned `documentCount` on the users
  self-update clause (alongside `activeRequestId`) so a patient can't reset their
  own counter to keep uploading past the cap.
- **UI:** no client change — the only patient upload surfaces (the submission
  checklist + rep docs, and agency-required compliance docs) are already bounded
  by the checklist / agency requirement lists; there is no unbounded upload path,
  so the server cap is the enforcement.
- **Tests:** rules — `documents.create` denied at `documentCount == 60`, allowed
  at 59; self-update resetting `documentCount` denied, unchanged allowed.
  Functions — increment/absent-start/decrement/no-change-on-update/no-patient (5).
- **Deploy:** needs a manual Blaze deploy of the NEW `onDocumentCountChanged`
  function after merge.

> **Backfill note (both #3 and #5):** existing patients created before these
> triggers shipped have no `activeRequestId` / `documentCount` on their user doc.
> `.get(field, default)` makes that permissive (a patient with none passes), and
> the triggers self-heal on the next relevant write (`activeRequestId` backfills
> whenever their active request is next written; `documentCount` starts counting
> from their next upload/delete — so it under-counts historical docs, which only
> ever gives a legit patient *more* headroom, never less). No migration script is
> required for correctness of the guards; a one-time count backfill is optional.

---

## 6. Accepted risks (documented, not "fixed")
Means-test gaming, forged/wrong documents, chair-as-ID, selfie spoofing, and
off-system GL reuse remain **human-judgment / accepted** risks (social worker is
the gate; no fraud engine, per CLAUDE.md). The advisory OCR/face + "doesn't look
like an ID" nudge assist but never block. **Recorded** in
[docs/threat-model.md](threat-model.md) — the 2026-09-27 addendum (T11–T15 for
the hardening sweep) plus accepted risks A4/A6/A7 (docs, selfie, GL reuse), A9
(means-test gaming) and A10 (counter race).

## 7. Already solid (no work)
Access-code enumeration (`verifyAccessCode` per-uid + per-IP throttle),
self-verifying docs / self-endorsing requests (rules pin state), cross-patient
reads (scoped by `patientId`), App Check (bots).

---

## 8. Sequencing (smallest, highest-value first)
1. **#1 Notification lockdown** — rule + trigger + remove client ping. Kills the
   staff-spam vector. (small)
2. **#4 Identity-field lock** — one rule edit. (tiny, confirmed hole)
3. **#2 Reply-only messaging + cooldown** — `!isPatient()` on conversation create,
   message cooldown, delete the patient compose + directory fetch. (small–medium)
4. **#3 One-active-request + attachedDocuments scope** — rule + trigger + UI +
   submit fix. (medium)
5. **#5 Document cap** — counter trigger + rule. (medium, lower priority)

## 9. Testing & rollout
- Each rule change gets emulator tests in `tests/rules/`; each trigger a pure-
  handler unit test in `tests/functions/`.
- Rules deploy via CI (`deploy-rules.yml`); the new/changed functions need a
  manual Blaze deploy (`firebase deploy --only functions:<name> --project mapa-crmc`).
- Ship in the order above; #1, #2, #4 are the ones that stop the "annoying spam".

## 10. Out of scope
- Full CF-mediated notifications for **all** roles (disproportionate — §0).
- Patient-initiated messaging / a shared "CRMC inbox" / per-social-worker routing.
  #2 is **reply-only** — CRMC initiates, the patient replies. A "reply-only" model
  needs none of that; proactive patient questions are a possible follow-up, not v1.
- Automated fraud/forgery detection (accepted risk — §6).
