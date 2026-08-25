# Malasakit Center — verified nature (research memo, 2026-07-23)

> **Purpose of this memo.** Verifies the user's hypothesis that "Malasakit
> Center is an institution that unifies the government agencies involved
> in medical financial assistance in Philippine hospitals — NOT itself a
> distinct funding source." This is load-bearing for MAPA's data model,
> which currently treats Malasakit Center as one of four co-funding
> partner agencies alongside DSWD, PCSO, PhilHealth.
>
> Method: deep-research workflow (5 search angles, 22 sources fetched,
> 67 candidate claims, 25 verified with 3-vote adversarial checks,
> 24 confirmed 3-0, 1 refuted 1-2 on minor phrasing).

---

## Verdict: user's claim is **CORRECT**

A Malasakit Center is legally a **coordination hub**, not a funding
entity. It is a physically co-located intake point where four
participating agencies (DOH, DSWD, PCSO, PhilHealth) receive and
process patients' requests. The money that reaches a patient comes
from those agencies' own pre-existing program budgets — not from a
Malasakit Center appropriation.

---

## Legal basis

- **Statute:** Republic Act No. 11463, the **Malasakit Centers Act of
  2019**. Approved 3 December 2019.
  Full text: https://lawphil.net/statutes/repacts/ra2019/ra_11463_2019.html
- **Implementing rules:** **Joint Administrative Order (JAO) No.
  2020-0001**, signed jointly by DOH, DSWD, PCSO, and PhilHealth in
  February 2020.
  Full text: https://law.upd.edu.ph/wp-content/uploads/2021/04/DOH-DSWD-PCSO-PHIC-Joint-Administrative-Order-No-2020-0001.pdf

## Stated purpose

The centers are established as a **"one-stop shop"** for medical and
financial assistance in DOH-retained hospitals + PGH. Standardised
availment systems that are *"non-partisan, convenient, free of charge,
accessible"* (RA 11463 §6). JAO 2020-0001 defines a One-Stop Shop as:

> *"a common site or location within the premises of the hospital,
> where the different participating agencies receive and process
> requests for medical and financial assistance for indigent and
> financially-incapacitated patients."*

## Participating agencies

Four, defined by RA 11463 §8 and JAO 2020-0001:

| Agency | Role at the Center |
|---|---|
| **DOH** — Department of Health | Processes + approves MAIP-charged requests |
| **DSWD** — Department of Social Welfare and Development | Processes + approves AICS-charged requests |
| **PCSO** — Philippine Charity Sweepstakes Office | Processes + approves MAP-fund + Endowment-fund requests |
| **PhilHealth** — Philippine Health Insurance Corp | Verifies coverage; NHIF is drawn first per Order of Charging |

The JAO does **not** create a fifth "Malasakit Center" agency.

## Where the money actually comes from

JAO 2020-0001 prescribes a formal **Order of Charging**, drawing down
each agency's *own* program budget in this sequence:

1. National Health Insurance Fund — **PhilHealth**
2. MAP Funds + Endowment Fund (where applicable) — **PCSO**
3. AICS (Assistance to Individuals in Crisis Situations) — **DSWD**
4. MAIP (Medical Assistance for Indigent Patients) — **DOH**
5. Other funding sources — Host Hospital / LGU

Every peso a patient receives is legally attributable to one of these
sources, **not to a Malasakit fund**.

## Malasakit's own budget line

Purely **operational** (personnel + facilities). RA 11463 §8 language:

> *"The DOH and the DSWD shall include in their budgetary submission
> to the DBM the required budget for the personnel services
> requirements."*

There is no dedicated appropriation for direct patient assistance
under the "Malasakit Center" line.

## Colloquial conflation (worth flagging)

Public and political discourse routinely says *"the Malasakit Center
gave the patient ₱X"* when the money is legally traceable to one of
the four participating agencies. Real example: in 2019, Rep. Edcel
Lagman [questioned PCSO funding for the Malasakit Centers][lagman] —
the confusion about "whose money is this?" exists at the *legislative*
level, not just informal speech. Expect this ambiguity in stakeholder
conversations at CRMC too.

[lagman]: https://www.philstar.com/headlines/2019/08/23/1945788/lagman-questions-pcso-funding-bong-go-backed-malasakit-centers

---

## Implications for MAPA's data model

Current state: `agencies` collection includes "Malasakit Center" as
one of four co-funding partners alongside DSWD/PCSO/PhilHealth. **This
is technically wrong** by the letter of RA 11463 and JAO 2020-0001.

Two reconciliation options:

### Option 1 — Rigorous (matches legal reality)
Replace "Malasakit Center" in the `agencies` collection with the four
actual funders and their program lines:
- DOH-MAIP
- DSWD-AICS
- PCSO-MAP
- PhilHealth
(host hospital / LGU as tail options)

Bonus: the JAO's **Order of Charging** could actually inform MAPA's
slice-endorsement default order. This is a defensible design choice
that maps directly onto cited law.

### Option 2 — Pragmatic (matches operational reality at CRMC)
Keep "Malasakit Center" as an entry in `agencies`, treating it as the
*CRMC-integrated intake proxy* for the co-located
DOH+DSWD+PCSO+PhilHealth desks. Simpler for coordinators who think of
the Center as a single queue.

**Defense caveat if you go with Option 2:** you must state explicitly
in the thesis that MAPA models the Center as the *operational unit*,
not the legal funder — and cite RA 11463 to show you know the
distinction.

### Recommendation
Option 1 is more defensible for a thesis panel because the JAO's Order
of Charging is a real, citable policy that MAPA can implement. Option
2 is simpler code but requires a defense-time asterisk.

Decide before touching the model. Either way, this memo is the
citation trail.

---

## ADDENDUM — decision taken and executed, 2026-07-23

**Option 1 was chosen**, with one modification, and applied via
`scripts/migrate-agencies-ra11463.js` (dry-run first, full Firestore
backup taken at `backups/2026-07-23T08-23-21/`).

### Corrections to this memo's "Current state"

The claim above that `agencies` held "Malasakit Center as one of four
co-funding partners alongside DSWD, PCSO, PhilHealth" was **wrong on two
counts**. Verified against production before migrating:

- Production held **three** agencies: `malasakit`, `ambag`, `pcso`.
  **PhilHealth was never present.** The fourth partner is **AMBaG** — a
  *BARMM* endorsement programme (see `docs/intake-sheet-fields.md`), not
  an RA 11463 participating agency at all.
- `dswd` was defined in `scripts/bootstrap-reference-data.js` but
  **absent from production**, while 2 user accounts
  (`admin@`/`coordinator@dswd.gov.ph`) and 2 requests already referenced
  it — a pre-existing referential break, unrelated to this decision.

### What was actually done

| Agency | Action |
|---|---|
| `doh` (DOH MAIP) | **Created** — RA 11463 funder with no prior representation |
| `dswd` (DSWD AICS) | **Restored** — repairs the referential break above |
| `malasakit` | **Reframed**: `enabled: false` + description stating it is a coordination hub. **Not deleted** |
| `pcso`, `ambag` | Untouched |

`malasakit` was deliberately **kept**: 2 agency users, 2 requests, and
the system's only completed application (`status: certificate`, ₱50,000
approved, GL issued) reference it. Deleting it would orphan all of them.
Disabling removes it from endorsement pickers while preserving history.

### Two deviations from Option 1 as written above

1. **AMBaG kept as a peer funder.** Option 1 says "replace Malasakit with
   the four actual funders", which has no slot for AMBaG. AMBaG is a
   legitimate BARMM funder that sits outside the Malasakit frame, so it
   stays.
2. **PhilHealth — decision taken 2026-07-24: ADD as an agency.** The
   caveat still stands and is recorded in code
   (`migrate-agencies-ra11463.js`, `bootstrap-reference-data.js`):
   operationally NHIF is drawn *first and reduces the bill*, so its
   "slice" is a coverage figure, not a Guarantee Letter for off-system
   settlement like the other agencies'. Stakeholders chose to surface
   PhilHealth as an agency anyway, for completeness and Order-of-Charging
   visibility. **The thesis must state that PhilHealth's slice represents
   coverage applied to reduce the bill, not a GL.** Reverting is a
   one-liner: disable the `philhealth` agency, same mechanism as
   malasakit.

   Result: **five active funders** — PhilHealth, DOH, PCSO, DSWD (the
   RA 11463 participating agencies) plus AMBaG (BARMM peer). Malasakit
   remains the disabled coordination hub.

### Still open

- **₱5,000,000 remains allocated to the now-disabled `malasakit`**, while
  every real funder holds ₱0. The migration deliberately does not move
  money — the split is an operational call with no basis in the statute.
  Redistribute via the agency Allocation screen.
- **The defence narrative now has a strong line available:** MAPA
  implements the Malasakit Center as the *CRMC gateway role itself*
  rather than as a funding agency, which matches RA 11463 exactly.
- **Thesis docs still describe Malasakit as a funding partner** and need
  updating to match: `docs/thesis-documentation.md` (lines ~13, ~27) and
  `docs/thesis-summary.md` (line ~25). Left for the author — that is
  thesis prose, not code.
- The only completed demo GL is Malasakit-funded, which now contradicts
  the model. Consider re-seeding the demo scenario against a real funder
  before the defence.

---

## Sources verified (top primary/secondary only)

| # | Quality | Source |
|---|---|---|
| 1 | Primary | RA 11463 full text — lawphil.net |
| 2 | Primary | RA 11463 alt text — thecorpusjuris.com |
| 3 | Primary | JAO No. 2020-0001 — law.upd.edu.ph |
| 4 | Primary | DSWD AICS on Malasakit — aics.dswd.gov.ph |
| 5 | Primary | DSWD AICS policy revision news — dswd.gov.ph |
| 6 | Secondary | Malasakit Centers Act summary — digest.ph |
| 7 | Secondary | IRR signing coverage — mb.com.ph |
| 8 | Secondary | Explainer — philstarlife.com |
| 9 | Secondary | Wikipedia — en.wikipedia.org/wiki/Malasakit_Center |
| 10 | Secondary | Explainer — financialassistance.ph, assistance.ph |

Full source list (22 URLs) is in the workflow output at
`.claude/projects/.../tasks/w4j8801xp.output`.

## Workflow stats

- 5 search angles fanned out in parallel
- 22 sources fetched + quality-graded
- 67 candidate claims extracted
- 25 top claims 3-vote adversarially verified
- **24 confirmed** (3-0 unanimous)
- 1 refuted (minor phrasing quibble on Section 3(f), does not affect verdict)
- Synthesis step aborted mid-run (spend cap), but evidence was complete;
  this memo is the manual synthesis from the verified-claims list.
