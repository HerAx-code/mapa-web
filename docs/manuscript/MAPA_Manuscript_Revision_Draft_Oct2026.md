# MAPA Manuscript — Revision Draft (October 2026)

**Purpose.** This is a reviewable change-set for `MAPA_Manuscript_Final_Sept2026.docx`.
It is text only — nothing here has been written into the .docx yet — so there is
**no page-number risk**. Once approved, these edits can be applied to the manuscript
and the TOC / List of Figures / List of Tables regenerated (needs LibreOffice +
Poppler, which the current machine lacks).

Three things changed in the system since the September manuscript was frozen, and all
three must land in the manuscript:

1. **The assessment model was replaced.** The interview-appointment / slot-booking
   system the manuscript describes as a core feature was **removed** (reversed
   2026-09-24). Assessment is now **remote and asynchronous** — no appointments, no
   published slots, no queue numbers. This touches the Abstract, Chapter 1
   (background, objectives, scope, delimitations), Chapter 3 (methodology), and the
   re-defense history. It is the single largest edit, affecting ~130 "interview"
   mentions.
2. **The test count grew** from 286 to **690** across four suites (verified by running each suite 2026-10-18; the earlier 589 was a source-counted estimate).
3. **An identity-verification layer was added** (PhilSys-first, on-device,
   social-worker-confirmed), and the government **eVerify** service was evaluated and
   set aside for the pilot. These need new passages in Scope and Chapter 3/4.

Facts verified against the repository (not older documents), per the capstone skill.

---

## 1. The assessment model — interview-appointment → remote asynchronous

**The new model, stated once (use this as the canonical description):**

> After CRMC verifies a patient's documents, the request enters an assessment queue.
> A CRMC social worker works the queue remotely and asynchronously — there is no
> scheduled interview and no appointment to book. The social worker reaches the
> patient through the in-app conversation and completes the structured Unified Intake
> Sheet, placing an on-demand Google Meet link in the conversation only when a live
> conversation is genuinely needed. The completed Unified Intake Sheet is the
> endorsement gate: a request can be endorsed only once its documents are verified and
> its intake is complete. The human assessment is retained in full; only the
> travel, waiting, and no-show friction of a booked appointment is removed.

**Rationale (for the background / justification):**

> A pre-booked appointment reintroduces the very friction the platform exists to
> remove — the poorest patients, travelling several hours, would still arrive against
> a fixed slot. Congestion control is moot once the assessment is remote, because no
> one queues at the office for it. The project therefore reversed its earlier
> appointment-system decision and adopted a remote, asynchronous assessment worked
> from a queue.

### Passage-level replacements

Search the manuscript for each OLD passage and replace with NEW. (Quotes are the
actual manuscript text.)

**Abstract**
- OLD: "the patient files one request stating the hospital bill, uploads documents once, and attends one assessment interview; CRMC verifies the documents, applies PhilHealth as the statutory first charge…"
- NEW: "the patient files one request stating the hospital bill and uploads documents once; CRMC verifies the documents, conducts one remote, asynchronous assessment recorded on a structured Unified Intake Sheet, applies PhilHealth as the statutory first charge…"

**Ch1 — Background (the "distinguishing characteristic" paragraph)**
- OLD: "CRMC, acting as the single intake gateway, verifies the documents, conducts one assessment interview, and completes a structured Unified Intake Sheet."
- NEW: "CRMC, acting as the single intake gateway, verifies the documents and conducts one remote, asynchronous assessment — worked from a queue through in-app messaging, with an on-demand Google Meet link only where a live conversation is needed — recorded on a structured Unified Intake Sheet."

**Ch1 — Statement of the Problem (the "further challenge" paragraph about the interview).**
This paragraph argues the *old* interview was a capacity-limited, travel-burdening
step. Keep it as the *problem*, but make clear MAPA's answer is remote assessment,
not better booking:
- OLD: "A further challenge concerns the assessment interview itself. The interview is a mandatory, capacity-limited step conducted by a CRMC social worker, and under the present arrangement patients travel to the hospital without any assurance that an interview slot will be available on the day they arrive. Patients who travel several hours from distant provinces are frequently turned away and asked to return, converting a scheduling problem into a transportation cost borne entirely by the poorest patients."
- NEW: "A further challenge concerns the mandatory assessment. In the agencies' present arrangement it is an in-person, capacity-limited step, and patients travel to the hospital without any assurance of being accommodated on the day they arrive; those who travel several hours from distant provinces are frequently turned away and asked to return, converting a scheduling problem into a transportation cost borne entirely by the poorest patients. MAPA removes this friction at its source by conducting the assessment remotely and asynchronously rather than by scheduling it more efficiently."

**Ch1 — "Through MAPA, patients can…" capabilities sentence**
- OLD: "…complete a guided household intake questionnaire, reserve an assessment interview from published slots, review and confirm the coverage plan…"
- NEW: "…complete a guided household intake questionnaire, respond to the CRMC social worker's assessment through in-app messaging (joining an on-demand Google Meet only if asked), review and confirm the coverage plan…"

**Ch1 — Objective (the appointment objective). This whole objective should be rewritten,
since self-service booking no longer exists:**
- OLD: "To allow patients to reserve the mandatory CRMC assessment interview from published, capacity-limited slots — in person by default with an online fallback — and to receive automated reminders 24 hours and 1 hour before the appointment."
- NEW: "To conduct the mandatory CRMC assessment remotely and asynchronously — the social worker works a queue and reaches the patient through in-app messaging, using an on-demand Google Meet link only when a live conversation is needed — so that no patient must travel or wait for a scheduled interview."

**Ch1 — Objective (staff operations)**
- OLD: "To enable CRMC staff administrators to verify documents, schedule and conduct a single assessment interview, complete a structured Unified Intake Sheet, endorse each verified request…"
- NEW: "To enable CRMC staff administrators to verify documents, conduct a single remote asynchronous assessment, complete a structured Unified Intake Sheet, endorse each verified request…"

**Ch1 — Single-intake objective**
- OLD: "one request, one document upload, and one assessment interview"
- NEW: "one request, one document upload, and one remote assessment"

**Ch1 — Scope (roles: Staff Admin)**
- OLD: "Staff Admin, who performs the CRMC-gateway operations of document verification, interview scheduling and conduct, assessment, endorsement, and messaging"
- NEW: "Staff Admin, who performs the CRMC-gateway operations of document verification, remote asynchronous assessment, Unified Intake Sheet completion, endorsement, and messaging"

**Ch1 — Scope (workflow)**
- OLD: "CRMC document verification; the booking and conduct of a single assessment interview and a structured Unified Intake Sheet; the recording of PhilHealth first-charge coverage…"
- NEW: "CRMC document verification; a single remote, asynchronous assessment recorded on a structured Unified Intake Sheet; the recording of PhilHealth first-charge coverage…"

**Ch1 — Scope (supporting functions) — remove the appointment system entirely:**
- OLD: "…a personal document library with reusable verified documents, an appointment system with published interview slots and in-person queue numbering, daily slot management decremented at endorsement, the Guarantee Letter lifecycle…"
- NEW: "…a personal document library with reusable verified documents, a remote asynchronous assessment queue, the Guarantee Letter lifecycle…"

**Ch1 — Delimitations / "does not host video calls"**
- OLD: "The application does not host video calls. Online assessment interviews, used as a fallback to the default in-person mode, are conducted through Google Meet, with MAPA handling only the scheduling and link delivery."
- NEW: "The application does not host video calls. Where a live conversation is needed during the remote assessment, it is held on Google Meet through an on-demand link the social worker places in the in-app conversation; MAPA handles only link delivery, not scheduling or video infrastructure."

**Ch3 — Methodology (the hybrid-interview paragraph). Replace the entire paragraph:**
- OLD: "The assessment interview is conducted as a hybrid, in-person by default. The patient books a capacity-limited slot through the platform and, for in-person appointments, is assigned a queue number for the CRMC Medical Social Service office; the purpose of scheduling is congestion control — staggering arrivals to match interview capacity so that patients who have travelled a long distance are not turned away. An online mode using Google Meet is retained as a fallback… Automated reminders are delivered 24 hours and 1 hour before the appointment."
- NEW: "The assessment is conducted remotely and asynchronously. Once a request's documents are verified, it enters an assessment queue; a CRMC social worker picks it up and reaches the patient through the in-app conversation, completing the structured Unified Intake Sheet without a scheduled appointment. Where a live conversation is genuinely needed, the social worker places an on-demand Google Meet link in the conversation. No slots are published, no queue numbers are issued, and no appointment reminders are sent, because there is no appointment to keep; the completed Unified Intake Sheet — not an attended interview — is the endorsement gate."

**Re-defense history (Ch3 or Ch1)**
- OLD: "…migrated the backend to a paid service tier… built the self-service interview appointment system, implemented staff multi-factor authentication…"
- NEW: "…migrated the backend to a paid service tier… and, after further review, replaced the self-service interview appointment system with a remote asynchronous assessment worked from a queue; implemented staff multi-factor authentication…"

> **Also do a global sweep** for the terms *interview, appointment, slot, booking,
> queue number, reserve, 24 hours and 1 hour reminder* and reconcile each remaining
> hit to the model above. The strings above are the substantive ones; a few incidental
> mentions (e.g. the respondents' "interview-questionnaire" used for data gathering —
> that is a research instrument and is **correct**, leave it) must be left alone.

---

## 2. Automated test count — 286 → 690

Current counts, **verified 2026-10-18 by running each suite** (supersedes the
earlier 589 source-counted estimate):

| Suite | Tests |
|---|---|
| Pure utilities (`tests/utils`) | 256 |
| UI components (`tests/components`) | 131 |
| Server-side functions (`tests/functions`) | 94 |
| Security rules (`tests/rules`) | 209 |
| **Total** | **690** |

Plus a Playwright end-to-end smoke suite run in CI. (See
`appendix-c/test-run.txt` for the captured run.)

- Replace every "286" test figure (Abstract if present, Chapter 4 narrative, and
  **Table 9 — Automated Test Suites and Results**) with the breakdown above.
- The firestore ruleset is now **1,008 lines** across **19 collections** — update any
  cited ruleset size/collection count against `firestore.rules`.

---

## 3. New content — Identity Verification (add to Scope + Chapter 3; note in Chapter 4)

### 3a. Scope sentence (append to the supporting-functions scope list)
> On-device identity verification: a guided ID-capture camera with live quality
> feedback, an on-device live-selfie face comparison against the ID photo, optional
> scanning of a Philippine National ID QR code with on-device signature verification,
> and a social-worker identity-review panel — all advisory, with the social worker
> making the final determination.

### 3b. Chapter 3 — new methodology subsection
**Identity Verification.** (new heading)

> Identity verification in MAPA is OCR-assisted and social-worker-confirmed, and runs
> entirely on the patient's own device; no biometric template or raw identifier leaves
> the phone, and no automated check can approve, reject, or block a patient. The patient
> captures a government ID through a guided camera that reads sharpness, brightness, and
> glare from the live preview and captures a clean frame; optical character recognition
> then reads the ID text on-device and performs a fuzzy cross-check against the
> registered name. The patient also takes a live selfie, which is compared on the device
> against the photograph on the ID, together with a passive liveness estimate. Each
> result — the name cross-check, the face-match score, the liveness estimate — is
> advisory and is presented to a CRMC social worker on an identity-review panel, where
> the worker either confirms the identity or asks the patient to retake a photograph.
>
> A patient who holds a Philippine Identification System (PhilSys) National ID may, in
> addition, scan the QR code printed on the card. The card's digital signature is
> verified on the device, offline, against the issuing authority's public key, giving
> the social worker an authenticity signal without transmitting the identifier. In keeping
> with Republic Act No. 11055 the National ID is preferred but never required — any other
> valid government ID remains an equal path — and in keeping with Republic Act No. 10173
> the twelve-digit PhilSys Number is never collected; where the sixteen-digit card number
> is read, it is stored only as a masked value and a one-way keyed fingerprint, never in
> full. The National ID path is kept behind a feature switch, disabled until the hospital
> confirms the terms of use, so the remainder of the verification flow operates unchanged
> in the interim.
>
> To keep the captured evidence legible for the social worker, an on-device quality check
> evaluates exposure, sharpness, and resolution on both camera captures and uploaded
> photographs. When a photograph is likely unreadable, the patient is shown a
> plain-language reason and asked to retake it; a single confirmation nevertheless lets
> them proceed, so a patient on a low-end camera is guided without being excluded. The
> thresholds governing these judgments are configurable per deployment so that CRMC can
> tune them against real photographs without a code change.

### 3c. Chapter 3 — eVerify evaluation paragraph (design-decision narrative)
> The project also evaluated the government's National ID authentication service,
> eVerify, operated by the Department of Information and Communications Technology against
> the Philippine Statistics Authority's records. A working integration was built and
> validated against the service's sandbox, confirming that a scanned QR code could be
> authenticated by the hospital itself as a relying party. The route was nonetheless
> deferred for the pilot: production access requires a vulnerability-assessment and
> penetration-testing certificate, a subscription contract signed by both organisations'
> data-protection officers, and a fixed public network address for the hospital's
> servers — requirements disproportionate to a pilot deployment. The on-device
> verification described above already furnishes the social worker with a strong,
> dependency-free basis for the identity decision, and the eVerify integration remains
> documented and dormant behind configuration so that CRMC may adopt it later.

### 3d. Chapter 4 — results note (add to the features-delivered narrative)
> The identity-verification layer was delivered as a set of advisory, on-device checks
> confirmed by a CRMC social worker, accompanied by a capture-quality safeguard tuned for
> low-end devices. The government eVerify service was evaluated and found technically
> viable but operationally premature for the pilot; its integration is retained in a
> dormant, configuration-gated state.

### 3e. Out-of-scope / delimitations
- **Remove** any statement that MAPA integrates with PhilSys at the identifier level or
  performs automated biometric identity decisions. State instead: identity verification
  is OCR-assisted and social-worker-confirmed; National ID QR authenticity is checked
  on-device; no automated biometric decision is made and no raw national identifier is
  collected or stored.

---

## 4. List of Notations / acronyms to add

Add to the List of Notations if not already present: **OCR** (Optical Character
Recognition), **PhilSys** (Philippine Identification System), **PSN** (PhilSys Number),
**QR** (Quick Response code), **DICT** (Department of Information and Communications
Technology), **VAPT** (Vulnerability Assessment and Penetration Testing).

---

## 5. Application checklist (when the tooling is available)

1. Apply §1 passage replacements + the interview/appointment sweep.
2. Apply §2 test-count + ruleset-size updates (incl. Table 9).
3. Insert §3 Scope sentence, Chapter 3 Identity Verification subsection + eVerify
   paragraph, Chapter 4 note; fix delimitations.
4. Add §4 acronyms to the List of Notations.
5. Rebuild and run the two-pass page resolution (`soffice --convert-to pdf` →
   `resolve_pages.py` → rebuild) until `pages.json` is stable and `unresolved: []`.
6. Render to PDF and read the changed pages; confirm no new near-empty pages and that
   the List of Figures / List of Tables still match the body captions.
