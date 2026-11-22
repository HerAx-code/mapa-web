# Phase 4 plan — case endings (T5)

Status: **plan accepted 2026-11-22 (P4-A to P4-E); PR 4.1 merged and deployed (#424); PR 4.2 merged and deployed (#425); PR 4.3 built on `feat/partnership-endings`.** Phases 1–3 are shipped (docs/phase1-messages-accounts-plan.md, docs/phase2-money-plan.md, docs/phase3-evidence-codes-plan.md). Source: the MAPA process-logic gap map, theme T5 (endings), and its proposed decisions D2, D3 and D8. Each gap below was re-checked against `main` at f713150.

## What Phase 4 fixes

| Gap | Summary | Today |
|---|---|---|
| M6 | Cases that never finish on their own | A partially funded case, or one every agency declined, stays active until the hospital closes it by hand, and the patient can't file again until then. A slice the patient never proceeds on never ends: it counts as outstanding funding and its slot is spent. |
| M2 | Disabling an agency leaves its open cases running | Since Phase 2 PR 2.4 the Super Admin's disable *holds* in-flight slices ("Application paused" for the patient), and `decideSlice` refuses an approval from a disabled agency. But nothing ends a held slice, so a long disable blocks those cases indefinitely. |
| M13 | Removing a partner hospital leaves its cases open | `decideSlice` refuses an approval once the partnership ended (Phase 2 PR 2.3), but the slices stay open, counted as outstanding, and nobody is told. |

**First run changes nothing.** A read-only count on production (2026-11-22) found 0 partially funded cases with every agency decided, 0 slices waiting on Proceed, 0 waiting on the patient's reply to "Needs info", 0 open slices at a disabled agency and 0 at an ended partnership. The timers start from an empty queue.

## Rules every change follows
1. **The hospital decides first; a timer only stops a case being forgotten.** Every automatic ending is announced in advance (to the hospital, or to the patient for their own step) and can be pre-empted by acting.
2. **Automatic endings use the same code as the manual ones** (`closeRequest`, `decideSlice`'s reject), so the money, the slots, the audit entry and the notifications come out the same. The actor is recorded as `system` with the timer's name.
3. **Nothing reverses money.** Letters already issued stay valid when their case closes; they settle or expire on their own (D4).
4. **The timers are the hospital's settings**, with safe defaults and bounds, set by the Hospital Admin.

---

## Decisions (all five accepted, 2026-11-22)

### P4-A. Who closes a case nothing is pending on? (D2, M6)
**Recommendation: adopt D2.**
- When a case was endorsed and **nothing is waiting at any agency**, it moves to a new hospital queue, **"Endorse more or close"**. That covers a partially funded case once every agency has decided, and a case every agency declined.
- The hospital acts first: it endorses to another agency or closes the case.
- If nobody acts within the time limit (P4-C), the case closes itself:
  - as **"Closed — partially funded"** when some money was approved;
  - as **"Closed — no agency could fund"** when none was.
- The patient is told, and can file again.
- The hospital gets a warning one day before.

Why: an open case with nothing pending blocks the patient from filing again, and it sits in "Awaiting agency" forever.

### P4-B. Does a slice the patient never proceeds on end? (D3, M6)
**Recommendation: adopt D3.**
- A slice the patient hasn't accepted ("Proceed") closes after **3 days** as **"Not accepted by the patient"**.
- The patient gets reminders at 24 and 48 hours.
- The slot goes back only if it is still the day the slice was endorsed, the same rule `closeRequest` and reject already use. Slots are daily capacity, so returning one days later would inflate that day.

Why: Proceed is the patient's consent and stays, but it needs an end. An unanswered slice counts as outstanding funding and keeps the case out of the "Endorse more or close" queue.

### P4-C. The time limits (D8)
**Recommendation: adopt D8, as Hospital Settings with these defaults and bounds:**

| Timer | Default | Bounds | Why |
|---|---|---|---|
| Slice not proceeded | 3 days | 1–14 | The patient is discharged with an unpaid bill; delay hurts them |
| Nothing pending (P4-A) | 7 days | 2–30 | About a week of daily slots to try more agencies, within the 10-day life of letters already issued |
| Fully funded | none | — | Finishes on its own when its letters settle (D4) |

### P4-D. Disabled agencies and ended partnerships (M2, M13)
**Recommendation:**
- **Removing a partner hospital** closes that hospital's open slices at that agency at once, as "Agency no longer partners with this hospital". The hospital and the patients are told. The partnership is over, so holding them has no purpose, and the hospital can endorse elsewhere straight away.
- **Disabling an agency** keeps today's hold (the Super Admin's dialog promises it, for short outages). A slice held longer than the **nothing-pending limit** (P4-C, 7 days by default) closes as "Agency unavailable", so a long outage can't block cases.

Why: a partnership change is deliberate and final; a disable is often temporary.

### P4-E. "Needs info" the patient never answers
This is not in the gap map; it's a neighbour of M6 found while checking.

**Recommendation:**
- Remind the patient after 3 days.
- Tell the agency after 7 days that there was no reply.
- **Never close it automatically.** Whether to wait or reject stays the agency's decision, made with `decideSlice`.

Why: unlike Proceed, the agency asked for something specific and is best placed to judge.

---

## PR 4.1 — Shared endings and the hospital queue
1. **One closing path, callable by the server.** `closeRequest`'s body and `decideSlice`'s reject become core helpers that take an actor (`{ uid, name }` or `system:<timer>`):
   - `closeCaseCore` in functions/src/caseActions.js;
   - `closeSliceCore` in functions/src/sliceActions.js.

   The callables keep their checks and call the cores.
2. **`requests.nothingPendingSince`**, stamped by `syncRequestFinancials` when an endorsed case is left with no outstanding slice and isn't fully funded, and cleared when something is pending again. The timer counts from it.
3. **Queue:** a new bucket, **"Endorse more or close"**, inside "Needs action" (`queueBuckets.js`). The case page says how many days are left before it closes itself.
4. **Hospital Settings:** two new fields, `sliceProceedDays` and `nothingPendingDays`, with the P4-C bounds (rules allowlist and range checks).
5. **New server-only audit actions:** `request_auto_closed`, `slice_not_accepted`, `slice_partner_ended`, `slice_agency_unavailable`.
6. **Tests:** functions tests that the cores give the same result for a person and the system; utils tests for the bucket; rules tests for the settings.
7. **As built:**
   - **The cores.** `closeCaseCore` takes a guard re-checked inside the transaction, so a timer leaves a case someone acted on. `closeSliceCore` takes the statuses it may close from. Both send as the server when the actor is `systemActor(timer, tenantId)`. The slot return is one helper, `giveSlotBackTx`.
   - **The limits** live in `src/shared/caseTimers.js` (`CASE_TIMERS`, `caseTimerDays`), shared by the web and, through the bundle, the timers.
   - **The queue.** "Endorse more or close" is the `decide` bucket inside "Needs action". The case page shows "closes itself in N days".
   - **Hospital Settings** has a "Case time limits" card.

## PR 4.2 — The daily case timers
1. **`caseTimers`**, a scheduled function that runs every day at 06:00 Manila. Each step is idempotent and uses its own marker:
   - **Slices not proceeded (P4-B):**
     - remind the patient at 24 h and 48 h (`proceedReminders` on the slice);
     - close at the limit through `closeSliceCore`, as "Not accepted by the patient".
   - **Needs info (P4-E):** remind the patient at 3 days and tell the agency at 7 (`infoReminders`). It never closes.
   - **Nothing pending (P4-A):**
     - warn the hospital one day before (`closingWarnedAt`);
     - close at the limit through `closeCaseCore`, recording `closedAs: 'partially_funded' | 'no_funding'`;
     - tell the patient they can file again.
   - **Held at a disabled agency (P4-D):** close after the limit, as "Agency unavailable" (needs `agencies.disabledAt`, PR 4.3).
2. **Re-checks before closing.** Each close re-reads inside its transaction. A patient who proceeded, or a hospital that endorsed, a minute before the run is not closed.
3. **Tests:** handler tests per step, including idempotence (two runs, one reminder) and the last-minute race.
4. **As built:**
   - **The function.** `functions/src/caseTimers.js` (`handleCaseTimers`, scheduled daily at 06:00 Asia/Manila).
   - **Which cases it reads.** Endorsed and awaiting-info slices by status; requests whose status is endorsed, partially funded or under review that carry `nothingPendingSince`.
   - **A new cycle gets a new warning.** `syncRequestFinancials` clears `closingWarnedAt` with `nothingPendingSince`, and a new "Needs info" resets `infoReminders`.
   - **Disabled agencies.** Step 4 acts only on agencies that carry `disabledAt`, which PR 4.3 stamps; until then it does nothing.
   - **Notifications.** All are written by the server (`fromUid` null), so `sendNotificationEmail` emails them as server events.

## PR 4.3 — Partnerships and disabled agencies
1. **`onAgencyWritten`** (it already projects `agenciesPublic`) also:
   - closes the open slices of a hospital removed from `partnerHospitalIds`, through `closeSliceCore`, as "Agency no longer partners with this hospital", and tells the hospital and the patients (P4-D);
   - stamps `disabledAt` when `enabled` turns false, and clears it when it turns back on.
2. **The Super Admin's dialogs** say what will happen:
   - removing a partner: "N open applications will close";
   - disabling: "held up to 7 days, then closed".

   The count comes from a small `countAgencyOpenSlices` callable, since the Super Admin can't read slices.
3. **Tests:** trigger tests for partner removal (only that hospital's open slices close) and for `disabledAt`.
4. **As built:**
   - **`handleAgencyEndings`** (functions/src/onAgencyWritten.js) runs in the same trigger as the public projection, in its own try block. It closes slices with `closedAs: 'partner_ended'` and audit action `slice_partner_ended`.
   - **`countAgencyOpenSlices`** is Super Admin only and returns counts per hospital, never patient data.
   - **Partner hospitals card:** removing a partner with open applications asks first ("Remove and close them").
   - **Disable dialog:** shows how many open applications are held.

## Deploy order (each PR)
1. Regenerate the bundle; deploy the functions.
2. Merge; Vercel deploys the pages.
3. Deploy the rules after the web change is live (PR 4.1 only: the Hospital Settings fields).
4. PR 4.2's schedule starts with its deploy. The first run acts on nothing (counted above).

## Not in Phase 4
- Cleanup of what Phases 2–4 leave unused (T7, Phase 5).
- Two-factor stage 2, due about two weeks after staff enrolled; it can ride along with any PR here.
