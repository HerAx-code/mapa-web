# MAPA Redesign Plan — "Single CRMC Intake Gateway"

**Status:** FROZEN (planning complete, contradiction-checked)
**Date frozen:** 2026-05-29
**Owner:** Capstone Project Group

> This is the canonical reference for the in-progress redesign. Build phases
> follow Section 11. Decisions here supersede earlier informal notes (see
> Section 10 for how this reconciles with the changelog from the prior day).

---

## 1. The model (one line)
A patient submits **one** request with the full requirements → **CRMC verifies the documents (OCR-assisted) + fills the intake sheet + runs one assessment interview** → **CRMC endorses** the vetted case to one or more agencies (co-funding toward zero balance) → patient **Proceeds** (consent, once) → each **agency only approves funding; the Guarantee Letter issues at approval** → patient claims. Each piece of work happens **once**.

## 2. Why this shape (design rationale)
- **Co-funding is kept** because it matches real Malasakit zero-balance billing: one bill is often covered by several sources (PhilHealth + DSWD + PCSO + DOH), each with its own ceiling.
- Co-funding's only downside is **repeated verification/interviews** across agencies. The CRMC gateway removes exactly that by verifying **once**. So the two reinforce each other:
  - co-funding **+ per-agency verify** = redundant (old model),
  - co-funding **+ CRMC-gateway verify** = realistic **and** non-redundant (this plan).

## 3. Roles — unchanged (5); responsibilities rebalanced
| Role | Responsibility after redesign |
| --- | --- |
| super_admin / staff_admin (CRMC) | Verify documents, fill intake + run the assessment interview, endorse. The single intake/assessment authority. |
| agency | Funding decision only — approve (+ GL) within allocation. No doc review, no interview. |
| agency_admin | Unchanged (budget allocation, team, audit). |
| patient | Submit once with full checklist + selfie; one interview; track. |

The MSW (medical social worker) who runs the assessment is a CRMC `staff_admin`/`super_admin` (the `conductedBy` name field) — **not** a new role.

## 4. Lifecycle
**Request (parent):** `submitted → under_review → assessment → endorsed → partially_funded → fully_funded` (+ `closed` / `rejected`).
- Pre-endorsement (`under_review`, `assessment`) = CRMC-set; post-endorsement (`endorsed`/`partially_funded`/`fully_funded`) = derived from slices.
- Document-correction loops stay in `under_review` (CRMC rejects a doc → patient re-uploads).

**Slice (child application):** `endorsed → for_funding → approved` (+ `needs_info`, `rejected`).
- Patient **Proceed** does `endorsed → for_funding` (once; later endorsements auto-advance).
- **GL issues at `approved`** (`glStatus:'issued'` — already how the approve transaction works today).

## 5. Data model changes
- **`requests`** gains: `attachedDocuments[]`, `docsVerifiedBy/At`, intake-sheet fields, interview fields (`interviewDate/Time/meetLink/conductedBy/outcome/notes`), and a **`filedBy` block** (reserved from P1 for representatives — see §8).
- **`documents`** gains: `ocrName`, `ocrMatch` (advisory). Reusable docs (Valid ID) carry across requests; **Billing/SOA always required fresh**. New sensitive type **"Selfie / Live Photo"** (`reusable:false`).
- **`documentTypes`** gains: `required` (in checklist) + `reusable` (carries across requests) flags.
- **`applications`** (slice): trimmed to the funding decision (no per-slice docs/interview).

## 6. Identity verification (OCR + selfie)
- **OCR:** `tesseract.js`, lazy-loaded, **on-device**, **advisory only**. Reads the ID name, **fuzzy/normalized** match vs. account name, flags match/mismatch but **never blocks**. Keep an **ID-type picker** for OCR hints. Result pre-fills the intake sheet. ID image never leaves the device.
- **Selfie:** **manual side-by-side** comparison by the CRMC social worker (no automated face match). **Camera-only** capture (no gallery). If no camera (desktop/broken/denied) → **in-person capture at CRMC**. Stored as a consented sensitive document.
- Privacy: sensitive personal data under RA 10173 — explicit consent line, on-device processing, no third-party biometric calls.

## 7. Page-by-page impact
**Core rebuild:**
- Patient **Request Assistance** — full required-checklist uploader + on-device OCR on the ID + live selfie capture; keep lightweight **Proceed**; drop per-agency compliance UI.
- CRMC **Requests** — guided **one-screen stepper**: ① verify docs (OCR shown) → ② **intake sheet + interview** → ③ **gated, re-openable** endorse (shows each agency's **budget + slots**).
- Agency **Inbox + ApplicationDetail** — funding-only; read-only verified packet + interview; **Approve + GL** / Request-more-info / Reject.
- Patient **My Application** — the **single status hub** (Proceed + coverage plan live here); **Request Assistance** keeps only submission + a compact "active request → view it" card.

**Moves / repurposes:**
- **Intake Sheet → CRMC** (folded into ② assessment; OCR pre-fills it).
- **Agency Profile** requirements/procedure → kept as **informational** (read-only on the coverage plan).
- **GL Letters page** → kept as **GL print/manage** (+ signed-scan upload); no separate "generate" (approval issues it).
- **Admin Document Types** — add `required`/`reusable` toggles.

**Copy / light-touch:** Landing (align wording), Agency + Patient Guide rewrite, Agency & Admin Dashboards (new workload cards), Export (status columns), Seed/Notifications (new types + flag seeding).

**Retired:** agency Interviews page + nav; agency doc-review UI; patient per-agency compliance UI.

**Unchanged:** Login, Register, Install, Patients, Access Codes, Agencies/AddAgency/AgencyDetail, Accounts, Assistance Types, App/Audit Logs, Reports, Messages, Slot Management, Funds, Allocation, Team, Announcements (logic), GLViewer.

## 8. Representatives (filed-by path) — phased as P8
The **patient stays the subject** of the request. The request's `filedBy` block captures `{ name, relationship, repIdDocId, repSelfieDocId, authorization }`. A relative registers with the patient's Access Code, enters the patient's details, and supplies **their own** ID + selfie + relationship + a simple authorization. CRMC verifies the representative's identity the same way. The `filedBy` block is reserved in the schema from **P1** so no migration is needed when P8 lands.

## 9. Cross-cutting
- **Notifications** (`notify()`): doc rejected, interview scheduled (+ 24h/1h reminders — see infra flag), endorsed, slice approved/rejected, request rejected/closed.
- **Audit** (`logAudit()`): add `doc_verified`, `doc_rejected`, `interview_scheduled`, `interview_completed`; `request_endorsed`/`request_rejected` exist.
- **Rules:** `documents.update` → CRMC-only (agencies keep read); intake/interview/verify writes via `requests.update: isAdmin`; relabel the patient slice transition to `endorsed → for_funding`; keep the sibling-read clause.
- **Slots:** decrement at endorsement; **return on agency rejection**.
- **Partial-funding:** clear patient messaging when the bill isn't fully covered.
- **Clean-slate check** before cutover (transactional collections were wiped earlier).
- **CLAUDE.md update:** OCR-assisted + selfie visual ID verification (on-device, no PhilSys, no automated biometrics); agencies fund-only; doc review at CRMC.
- **Infra flags to confirm:** interview reminders + email delivery may need Firebase Blaze + an email extension, or a Vercel cron (free tier has no scheduled functions / native email).

## 10. Reconciliation with the prior-day changelog
The prior-day revision list is a changelog, **not** a panel-mandated model.
- **Done & compatible (stay):** remove Available Codes; autogenerated temp password; agency asc/desc sort; agency_admin adds members; BARMM location dropdowns; documents uploaded at apply.
- **Deliberately superseded by this plan:** "under agency review" process flow; "endorse > verify > approve" ordering; "agency reviews documents." The CRMC-gateway model replaces these by design.
- **Folded in:** agency ↔ CRMC coordination (CRMC hub + co-funding breakdown).
- **Phase 0 (reframed):** announcements are actually functional — the real issue was *purpose*. **CRMC announcements stay system alerts** (banner, everyone). **Agency announcements become branded program promotions** (informational, not an "apply to us" CTA), surfaced on the **Find Programs catalog** instead of the alert banner.

## 11. Build order
- **Phase 0** — Reframe agency announcements → branded **program promotions** on the Find Programs catalog; keep CRMC announcements as system alerts in the banner (standalone, independent of the redesign).
- **P1** — constants/lifecycle + `requests` model (reserve `filedBy`).
- **P2** — Document Types `required`/`reusable` flags.
- **P3** — patient submission: checklist + OCR + selfie capture.
- **P4** — CRMC hub: guided stepper (verify → intake + interview → endorse with budget/slots).
- **P5** — agency funding-only + GL-at-approval.
- **P6** — tracking / dashboards / interviews + new status labels.
- **P7** — rules deploy + i18n / Guide / Landing + CLAUDE.md.
- **P8** — representatives (filed-by path).

**Discipline:** build green after every phase; **no commit/push until reviewed locally**.

## 12. Out of scope / explicitly unchanged
No PhilSys; no embedded calling (Google Meet links only); no real money movement; agency budget/allocation/Funds ledger and cooldown logic untouched; `assistanceType` is informational/endorsement-hint only (it does **not** drive the global document checklist).