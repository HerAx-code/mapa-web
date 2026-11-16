# Outpatient support plan (revised 2026-11-15)

**Status:** planned, **not built**. On 2026-11-16 the owner chose working answers for all 14 questions (§7A), to be confirmed at the CRMC meeting. Building can start from them; anything CRMC answers differently is adjusted then.
**Evidence:** `reports/Outpatient medical assistance rules.md` (research on DSWD AICS, PCSO MAP, DOH MAIFIP / Malasakit and PhilHealth, November 2026). Facts below cite that report; anything marked *(inference)* is our design judgement.
**Replaces:** "option 2" from 2026-11-15, which this revision corrects.

## 1. Why

- Every program MAPA endorses to already funds outpatients: dialysis, chemotherapy, medicines and laboratory tests. DOH AO 2026-0031 (MAIFIP) names outpatients directly, PCSO's 2025 Citizen's Charter lists "Out patients", and DSWD AICS funds them through its Medicine, Laboratory and special-treatment types.
- MAPA is inpatient-only today: every request needs a Hospital Billing Statement. The landing page has said "outpatient care isn't covered yet" since #379.

## 2. Scope

**In:** outpatient services at the hospital's **own units**:
- dialysis;
- chemotherapy;
- the hospital pharmacy;
- the laboratory and imaging;
- outpatient procedures and clinics.

**Out (v1):**
- outside pharmacies, labs and dialysis centres (no guarantee letters to non-hospital providers);
- legislator / party-list guarantee letters, which the 2026 budget's "anti-epal" rule bars from MAIFIP.

**Stated plainly to patients:** if the hospital doesn't stock a prescribed item, MAPA can't help with it yet. This is the most common outpatient gap, so it must be visible, not hidden.

## 3. What the programs require (summary)

| | DSWD AICS | PCSO MAP | DOH MAIFIP / Malasakit |
|---|---|---|---|
| **Doctor's order** (prescription, treatment protocol, lab request, dialysis prescription; printed name, PRC license, signature) | Required | Required | Required |
| **Medical certificate / abstract** | Required, within 3 months | Required | Not required |
| **Price document** | Quotation above ₱10,000 | 3 supplier quotations for medicines/chemo at Main Office and Malasakit desks; 1 facility quotation at branches when stocked | Not required |
| **Social case study** | Above ₱10,000 (MSS may write it) | — | — |
| **Dialysis extra** | — (no national checklist) | PhilHealth certificate of sessions used / exhausted | PhilHealth certificate + hemodialysis prescription |
| **Repeat interval** | Once every 3 months per type, hospital bills once per admission; exceptions by the social worker; checked in DSWD's own system | None published | None |
| **How it is paid** | Cash ≤ ₱10,000, else GL to the provider | GL to the provider; the provider bills **actual charges** net of PhilHealth/discounts | At DOH hospitals, applied to the patient's account (no GL) |

**Also from the research:**
- PhilHealth pays 156 dialysis sessions a year at ₱6,350 each.
- The social worker's patient classification is valid **6 to 12 months** (DOH AO 2021-0044).
- Double payment is policed **per expense**, not per person (AO 2026-0031 bans double charging; COA flagged ₱397M in overlapping DSWD payments).

## 4. Changes to MAPA

### P0: required before outpatients can file

1. **Care setting first.** The request opens with "Admitted" or "Outpatient at this hospital", plus the unit (dialysis, chemotherapy, pharmacy, laboratory/imaging, clinic/procedure).
2. **Doctor's order document** (new type, required for outpatients):
   - fields: date issued, physician name, PRC license number, prescribed quantity or number of sessions;
   - the amount requested can't exceed what the order prices.
3. **Price document from the unit:** a charge slip, quotation or order of payment from the hospital unit, numbered and dated. It replaces the billing statement for outpatients.
4. **Checklist depends on the agencies endorsed:**
   - if DSWD or PCSO is in the plan: a medical certificate issued within 3 months;
   - if DSWD and the amount is above ₱10,000: a quotation and the social case study (the MSS can write it);
   - endorsing shows what is missing per agency instead of a fixed list.
5. **Dialysis:**
   - a PhilHealth certificate of sessions used;
   - a count of sessions used this year against 156;
   - the PhilHealth-covered portion shown, so agencies fund only the remainder.
6. **Replace the uniform 30-day cooldown** with two controls (see §5).

### P1: needed for recurring patients to be workable

7. **Each document type has its own validity** (a hospital setting). Expired documents are asked for again; valid ones carry over.

   | Document | Validity |
   |---|---|
   | ID | until its printed expiry |
   | Classification / certificate of eligibility | set by the social worker, 6–12 months |
   | Medical certificate, prescription, protocol, social case study | 3 months from issue |
   | Quotation / charge slip, PhilHealth session certificate | this request only |

8. **Repeat request reuses the classification.** While the social worker's classification is valid, a repeat request carries it over (category, date, expiry) with a "Reassess" button. It doesn't redo the full assessment.
9. **More than one need at once:**
   - one request may hold several priced items from different units (pharmacy + laboratory + chemotherapy);
   - "one active request" stays, but a request is no longer one bill;
   - the expense record (§5) is the guard against paying twice.
10. **Settle on actual charges.** When a guarantee letter is redeemed, record the actual amount net of PhilHealth and discounts and attach the acknowledged charge slips or invoice. The remainder is marked lapsed and returns to the agency's budget. GL expiry is a setting, not a fixed 30 days.
11. **MAIFIP at a DOH hospital = "assistance applied to account"** (amount + fund source), not a guarantee letter. PCSO and DSWD keep guarantee letters.
12. **"Not available in hospital" flag** on a prescribed item, set by the pharmacy or MSS. In v1 it records the gap and stops; it doesn't route to an outside provider.

### P2: polish and reporting

13. **Declaration:**
    - the patient lists PhilHealth and other help received or pending **for these items** and declares no one else paid them;
    - no promise of a time limit;
    - bump `DECLARATION_VERSION`.
14. **Wording:** "Total bill or price", "Date of admission or visit"; the landing page's "not covered yet" note becomes the scope statement in §2.
15. **Reporting:** export the fields DOH's monthly report needs (age, sex, city/municipality, diagnosis, amount per patient, fund source).
16. **Program rules by year:** MAIFIP is re-issued with each budget law (AO 2024-0006 → 2025-0011 → 2026-0031), so program rules should carry the year they apply to.

## 5. Replacing the 30-day cooldown (affects inpatients too)

Since #381 the rules enforce "each agency approves a patient once every 30 days". That matches no program:
- looser than DSWD's 3 months;
- stricter than MAIFIP, which has no limit;
- unsupported for PCSO;
- it doesn't stop two agencies paying the same charge.

**Proposed** *(inference, to confirm with CRMC)*:

**a. Expense record (hard block, rules-enforced).**
- Each priced item (billing statement line, charge slip, quotation) can be funded only up to its amount across **all** agencies.
- A quotation is linked to the charge slip that later realises it, so the same service can't be funded twice under two numbers.
- This replaces the bill-number check (`billKeys`) with a ledger.

**b. Repeat interval per program and assistance type (a warning, not a block).**
- Defaults:
  - DSWD: 90 days for medicines, laboratory and special treatment; once per admission for hospital bills;
  - MAIFIP: none;
  - PCSO: unset until CRMC confirms.
- The social worker can override with a recorded reason, as DSWD itself allows exceptions.
- The agency sees the warning on the approval screen.

**Migration:**
- Keep `approvalMarks` until (a) and (b) are live.
- Then relax `approvalCooldownOk` to the expense check.
- The marks remain as history for the warning.

**Caveat on the over-commitment buffer:** cumulative over-commitment across agencies is allowed today as a buffer. The expense record would end that for priced items. **Decide at the meeting.**

## 6. Unchanged

- Patient-bound access codes, identity checks, the remote assessment and endorsement, verification calls, duplicate-account flags.
- Inpatient requests, apart from §5.

## 7. Questions for the CRMC meeting

1. Does MSS help outpatients at the dialysis, chemotherapy, pharmacy, laboratory and clinic units today, and from which funds (MAIFIP, PCSO desk, DSWD desk, PhilHealth, Cancer Assistance Fund, hospital free service)?
2. For MAIFIP outpatients, is the money applied directly to the patient's account? Does zero balance billing cover indigent outpatients and dialysis patients?
3. What does each unit issue to price a service (charge slip, quotation, order of payment)? Who signs it, and for how long is it honoured?
4. Does CRMC's PCSO desk accept one hospital-pharmacy quotation for medicines and chemotherapy, or three supplier quotations? Is it staffed by PCSO or handled by MSS endorsement?
5. In BARMM, who issues AICS medical help for CRMC patients (a DSWD desk, the field office, or the regional social-services ministry), and does the 3-month rule apply?
6. How do recurring patients get repeat help today: per session, per month, per protocol cycle? Any internal limit?
7. Can one protocol or dialysis prescription support several requests while valid? How long are the medical certificate, prescription and protocol treated as valid?
8. How long is the MSS classification valid at CRMC, and what triggers reassessment?
9. Should the medical certificate be required, and only when DSWD or PCSO is endorsed?
10. When the actual charge is below the approved amount, what happens to the remainder? Do guarantee letters expire?
11. How does MSS check that a charge wasn't already paid by another fund or PhilHealth? Would MAPA's expense record help, or duplicate the DOH Medical Assistance Information System?
12. For dialysis, who issues the PhilHealth sessions certificate, and how often must it be refreshed?
13. Is a new in-person access code per request acceptable for patients on site two or three times a week, or should one code cover a course of treatment?
14. Should the 30-day per-agency rule be replaced by the expense record + per-program intervals (§5)? Is over-commitment across agencies still wanted?

## 7A. Working answers (owner, 2026-11-16: "go with the defaults")

To confirm at the CRMC meeting. Each is a setting or a small change if CRMC differs.

| # | Working answer |
|---|---|
| 1 | MSS helps outpatients at all five units (dialysis, chemotherapy, pharmacy, laboratory/imaging, clinic/procedures) from MAIFIP, the PCSO desk, the DSWD desk, PhilHealth, the Cancer Assistance Fund and the hospital's free service. |
| 2 | MAIFIP is applied directly to the patient's account (no guarantee letter); zero balance billing covers indigent outpatients and dialysis patients. |
| 3 | Price document: a **charge slip** signed by the unit, valid for this request only. |
| 4 | CRMC's PCSO desk accepts **one hospital quotation**; the case is endorsed by MSS. |
| 5 | AICS medical help comes from a **DSWD desk at the hospital**, with DSWD's **3-month** repeat rule. |
| 6 | Recurring patients get help **monthly**; no hospital-internal limit. |
| 7 | One protocol or dialysis prescription can support **several requests** while valid; medical certificate, prescription and protocol are valid **3 months** from issue. |
| 8 | MSS classification is valid **6 months**; reassessed when income or household changes. |
| 9 | Medical certificate required **only when DSWD or PCSO is endorsed**. |
| 10 | Unused GL amounts **lapse** back to the agency; GLs expire after **30 days**. |
| 11 | MSS checks double payment by hand today, so MAPA's **expense record helps**. |
| 12 | The **dialysis unit** issues the PhilHealth sessions certificate, fresh for each request. |
| 13 | **One access code per course of treatment** (e.g. a month of dialysis), not per request. |
| 14 | **Replace** the 30-day per-agency rule with the expense record + per-program repeat intervals (warn, override with reason). Over-endorsing beyond the bill as a buffer stays for **inpatient bills only**. |
## 8. Still unconfirmed (do not build on these)

- The text of the current DSWD AICS circular and its 2025 amendments; the ₱150,000 AICS ceiling (news only).
- Any official PCSO repeat limit, GL validity, amount cap or partial-use rule.
- Validity periods for quotations, barangay certificates and PhilHealth session certificates outside DSWD's 3-month rule.
- AO 2026-0031-A (April 2026) and the 2026 budget-law provisions.
- What happens to unused guarantee-letter balances.
- CRMC's own Citizen's Charter.
