# Appendix C — Acceptance Test Script (Scenario-Based UAT)

A single end-to-end walkthrough of the co-funding workflow, from patient
registration through Guarantee Letter download. The steps are derived from the
Appendix E role guides so the two documents agree. Run it against a demo-seeded
environment (`node scripts/seed-demo-scenario.js`) with the demo accounts.

**How to use this form:** perform each step in order, confirm the *Expected
result*, then have the named role sign the *Sign-off* column (initials + date).
A step that fails is recorded in *Notes* with a defect reference; the script is
re-run after the fix.

- Patient surface tested on a phone-sized viewport (390×844); staff surfaces on
  desktop (1440×900).
- Demo accounts: patient `patient@gmail.com`; medical center staff admin
  `admin@example.gov.ph`; agency coordinator `coordinator@example.gov.ph`.

| Environment | |
|---|---|
| Build / commit under test | ________________________ |
| Date of walkthrough | ________________________ |
| Facilitator | ________________________ |

---

## Part 1 — Patient: register and submit a request

| # | Step | Expected result | Role | Sign-off | Notes |
|---|---|---|---|---|---|
| 1.1 | Open the portal and choose **Register**. Enter the Patient Access Code (`MAPA-YYYY-NNNNN`) issued in person by Medical Social Services. | Code is accepted; registration form opens. An invalid/used code is rejected. | Patient | | |
| 1.2 | Complete registration (name, email, password) and sign in. | Account is created; patient lands on **Dashboard**. | Patient | | |
| 1.3 | Start a new **Request** — enter the bill amount, PhilHealth deduction, and any other payments. | The amount-needed is computed as *bill − PhilHealth − other* (Order of Charging). | Patient | | |
| 1.4 | Complete the **Household Intake** wizard and upload the required documents + a live selfie. | Each required document type shows as attached; selfie is camera-only (no gallery upload). | Patient | | |
| 1.5 | Submit the request. | Request status becomes **Submitted / Under Review**; it appears under **Status**. | Patient | | |
| 1.6 | During the **remote assessment**, respond to Medical Social Services through the in-app conversation (and join the on-demand Google Meet link only if one is sent). | Messages reach the social worker; no appointment is booked — the assessment is asynchronous. | Patient | | |

## Part 2 — Medical center: verify, assess, endorse

| # | Step | Expected result | Role | Sign-off | Notes |
|---|---|---|---|---|---|
| 2.1 | Sign in as medical center staff and open **Requests**. Locate the submitted request. | Request is listed with its documents and status. | Medical Center Staff | | |
| 2.2 | Open the request and run **document verification** (OCR-assisted). Compare the live selfie to the ID. | OCR name shows as an advisory cross-check; social worker confirms/rejects each document. | Medical Center Staff | | |
| 2.3 | Conduct the **remote assessment** — reach the patient through the in-app conversation (drop an on-demand Google Meet link only if a live talk is needed) — and complete the **Unified Intake Sheet**. | Intake sheet saves; once documents are verified AND intake is complete the request is ready to endorse. | Medical Center Staff | | |
| 2.4 | **Endorse** the request to one or more funding agencies (pure selection — no per-agency amounts). | Child application "slices" are created, each endorsed for the full amount needed; a single agency cannot approve past the need, though the medical center may intentionally over-endorse across agencies for a buffer. The patient is notified. | Medical Center Staff | | |
| 2.5 | Confirm the request status reflects the endorsement. | Status becomes **Endorsed**; each slice appears for its agency. | Medical Center Staff | | |

## Part 3 — Agency: fund and issue the Guarantee Letter

| # | Step | Expected result | Role | Sign-off | Notes |
|---|---|---|---|---|---|
| 3.1 | Sign in as the agency coordinator and open the **Application Inbox**. | The endorsed slice appears (patient having proceeded), marked **For Funding**. | Agency Coord. | | |
| 3.2 | Open the application detail and review the endorsed amount against the agency budget. | Detail + timeline render; remaining budget is shown. | Agency Coord. | | |
| 3.3 | **Approve** the slice. | Approval is capped at the endorsed slice amount; over-commitment beyond remaining budget is blocked; the agency budget is decremented and the request advances (partially/fully funded). | Agency Coord. | | |
| 3.4 | Confirm the **Guarantee Letter** is issued at approval. | A GL (digital certificate) is generated for the approved slice. | Agency Coord. | | |

## Part 4 — Patient: receive and download the Guarantee Letter

| # | Step | Expected result | Role | Sign-off | Notes |
|---|---|---|---|---|---|
| 4.1 | As the patient, open **Status** and view the coverage plan. | Coverage shows the approved slice(s) and any remaining balance. | Patient | | |
| 4.2 | Download the **Guarantee Letter**. | The GL downloads successfully and shows the correct patient, agency, and amount. | Patient | | |
| 4.3 | Open **Access Log / Data export** (RA 10173 §16(f)). | The patient can see who accessed their data and export their own record. | Patient | | |

---

## Overall acceptance

| | Name | Signature | Date |
|---|---|---|---|
| Medical center representative | | | |
| Agency representative | | | |
| Facilitator / proponent | | | |

**Result:** ☐ Accepted   ☐ Accepted with noted defects   ☐ Rejected
