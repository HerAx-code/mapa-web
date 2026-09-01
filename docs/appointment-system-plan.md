# Appointment System — Execution & Integration Plan

*Scope: add **patient self-service booking** of the CRMC assessment interview.
CRMC publishes availability; the patient books a slot; the system confirms and
reminds. This is an **upgrade to the interview step that already exists**, not a
new parallel subsystem. Grounded in `docs/principles.md` (Lens 1 server-
authoritative writes; Lens 2 status/error-prevention heuristics) and the
CRMC-gateway model in `docs/redesign-plan.md`.*

> Status: **Phase 1 shipped.** The pure `utils/appointments.js` foundation +
> `interviewSlots` rules + tests are merged (#135); the hybrid `SLOT_MODE`
> primitive is merged/under review (#140). UI + Cloud Functions are next.
>
> **Model reconciled — v2 (this supersedes §1's original "online-first" framing).**
> The interview is **in-person at the CRMC office by default** — the appointment
> system exists to control office congestion and spare indigent patients wasted
> travel — with an **online Google Meet fallback** CRMC switches to for emergencies
> (COVID-style restrictions, typhoons, off-site staff) or patients who can't travel.
> Confirmed with the owner alongside the CLAUDE.md production reconciliation (#139).
> MAPA is a **production deployment**, not a thesis pilot.
>
> **Confirmed build decisions:** mode control = **program-wide + per-day**; patient
> in-person **appointment slip** = **full** (date, CRMC office, queue number,
> what-to-bring); **reschedule** = **included in v1**.
>
> **Mockup (redrawn, hybrid):**
> <https://claude.ai/code/artifact/673bb962-0771-4534-ada5-1e57d068b59b>

---

## 1. The decision — what "appointment system" means for MAPA

The assessment interview is a **mandatory, capacity-limited** step conducted by a
CRMC social worker, and it is **in-person at the office by default.** The whole
point of scheduling is **congestion control**: only a fixed number of interviews
are possible per day (social workers × hours ÷ ~30 min, and waiting-room seats),
so without appointments patients — indigent, often travelling far and sick —
arrive unpredictably, crowd the hospital waiting area, wait all day, and some are
turned away *after already spending scarce money to travel*. Appointments cap and
level daily arrivals to match capacity, give a fair queue, and let a patient make
the trip only when they hold a confirmed slot. The patient books from CRMC's
published availability instead of CRMC assigning a time and hoping it fits.

The system is **hybrid**: every slot carries a `mode` (`in_person` | `online`).
**Online (Google Meet) is the fallback** CRMC switches to when in-person isn't
feasible — a health emergency (COVID-style restrictions), a typhoon, an off-site
social worker, or a patient too far or unwell to travel. This makes the appointment
system the one backbone that keeps the mandatory interview running under disruption
(**continuity of service**) instead of halting when the office can't take walk-ins.

Rejected alternatives (and why):
- **Online-only booking** — this doc's original v1 framing, now **reversed**:
  in-person is the real default for this kind of assistance and congestion control
  is the core value. Online stays, as the fallback mode.
- **A generic reusable appointment engine** — over-built for one appointment type.
  Model the one real need well.
- **Building our own video for the online mode** — no; Google Meet is free and
  reliable on weak networks, which is what these patients need most. A *managed*
  embedded provider is a far-future reconsideration only. See CLAUDE.md Out Of Scope.

---

## 2. Why it's worth building

- **Congestion control (the core).** The in-person interview is a fixed-capacity
  bottleneck; appointments ration that capacity fairly instead of by crowding and
  turn-aways, and spare the poorest patients wasted, repeated travel. This is the
  primary operational justification for a real deployment.
- **Continuity of service.** The hybrid mode lets CRMC keep interviewing during a
  lockdown, typhoon, or staff shortage by shifting online — the service degrades
  gracefully instead of stopping.
- **Removes real friction.** Today CRMC guesses a date/time
  (`scheduleInterview` in `src/pages/admin/Requests.jsx`) and the patient just
  *sees* it; any "that time doesn't work" negotiation happens off-system.
  Self-booking collapses that loop and reduces CRMC's manual scheduling load.
- **Delivers a promise CLAUDE.md already made.** Interview reminders (24h / 1h,
  email + in-app) are documented policy but **not implemented** — there is no
  reminder function deployed. This plan finally builds them.
- **Advances a named architecture gap.** `docs/principles.md` (Lens 1) flags
  *server-authoritative writes* as the Tier-1 gap; the booking-sync trigger
  below is exactly that pattern.

---

## 3. What exists today (the seam we build into)

| Piece | Today | After |
|---|---|---|
| Interview time | CRMC types `interviewDate` / `interviewTime` / `meetLink` on the request | Patient books an open slot; the same request fields are populated **server-side** |
| Patient view | `src/pages/patient/Interviews.jsx` renders `request.interviewDate…` | Same page, plus a **"Book your interview"** picker when booking is open |
| Availability | none | new `interviewSlots` collection, published by CRMC |
| Reminders | none (aspirational in CLAUDE.md) | scheduled Cloud Function, email + in-app |

Because we reuse the existing `interviewDate / interviewTime / meetLink` fields,
**everything downstream is unchanged** — the stage rail, the interview outcome
flow, the patient hero card all keep working as-is.

---

## 4. Architecture

### 4.1 Data model — a new `interviewSlots` collection

One document per bookable slot:

```
interviewSlots/{slotId} {
  start:       Timestamp,   // authoritative slot datetime (PH local wall time)
  date:        'YYYY-MM-DD',// denormalized for display + the patient query
  time:        '9:00 AM',   // denormalized display (matches interviewTime format)
  durationMin: 30,
  mode:        'in_person' | 'online', // default in_person; online = Meet fallback
  status:      'open' | 'booked',
  patientId:   null | uid,  // set on book
  requestId:   null | reqId,// set on book
  meetLink:    '',          // ONLINE mode only — CRMC attaches; carried at sync
  queueNo:     null | 'A-014', // IN_PERSON mode — office queue number (set on book)
  createdBy:   adminUid,
  bookedAt, createdAt, updatedAt
}
```

`mode` is set by CRMC at slot creation (`SLOT_MODE`, merged in #140) — the patient
booking update never touches it. In-person mode carries the office queue number and
the fixed CRMC office location (a constant, not per-slot) for the appointment slip;
online mode carries the Meet link. The request-side interview fields gain
`interviewMode` at sync so the patient's Interviews page renders the right surface
(slip vs. Meet card).

Add one field to the **request**: `interviewBookingOpen: boolean` — CRMC's
**explicit per-request gate** ("this patient is ready to interview"). Self-
booking is deliberately CRMC-authorised, never automatic on submission — this
keeps the gateway model intact.

### 4.2 The critical decision — patient never writes the request

The patient booking writes **only** to `interviewSlots` (open → booked). A
**Cloud Function trigger** then syncs the booked slot back onto the request
(`interviewDate / interviewTime / meetLink / interviewAt`, `status:'assessment'`).

Why this shape, not a client-side two-doc write:
- The `requests` update rule is **money-adjacent** and tightly scoped. Widening
  it to let patients write interview fields is exactly the kind of surface the
  existing rules work hard to avoid. Keeping the request write on the **trusted
  server** (Admin SDK, rules-bypassing) means **zero change to the patient's
  request write permissions**.
- It mirrors the proven `syncRequestFinancials` reconciler pattern and closes
  the *server-authoritative* gap in `docs/principles.md`.

### 4.3 Concurrency — optimistic locking, which is the right tool here

The canonical fix for the double-booking race (two patients both see one open
slot and both book it) is a transaction that re-checks availability at write
time. The two families are *pessimistic* locking (lock the row up front — better
under heavy contention, more complex) and *optimistic* locking (write only if
the record hasn't changed — ideal when concurrency is **low**, which a single-
centre pilot is). MAPA gets optimistic concurrency essentially for free: a
patient's book is allowed only when `resource.data.status == 'open'`, so two
concurrent Firestore transactions cannot both pass — the **security rule itself
is the compare-and-set**, no separate lock, no extra function for the claim.

This mirrors the standard Firestore booking pattern (a transaction that reserves
a slot only if still free); MAPA simply expresses the "still free" precondition
in the rule rather than in a Cloud Function, keeping the claim a pure client
write and reserving the function for the server-side request sync.

### 4.4 Security rules (`interviewSlots`)

- **read** — admins: all; a patient: any `open` slot (browse availability) +
  their own booked slot. (Split into independent `allow read` statements so the
  query analyzer matches the patient's `where('status','==','open')` list query,
  the same technique the `documents` rules use.)
- **create / delete** — CRMC admins only (publish/manage availability).
- **update** —
  - admins: anything (attach a Meet link, block, release, reassign);
  - patient **book**: `open → booked`, may set **only** the booking fields,
    must stamp their **own** uid, and the `requestId` must be a request they
    own (a `get()` ownership cross-check);
  - patient **cancel**: their own `booked → open`, clearing the booking fields
    (this also powers *reschedule* = cancel + re-book).

### 4.5 Reminders (scheduled Cloud Function)

A `pubsub.schedule` function (e.g. every 15 min) queries requests with an
upcoming `interviewAt` and an unrecorded outcome, and sends **email + in-app**
(via the existing `notify()`), tracking per-request `reminderSent*` flags to
fire each reminder exactly once. Storing `interviewAt` as a real Timestamp (the
instant; PH-local strings are for display only — "store the instant, show
local") keeps the window math exact and avoids parsing `'9:00 AM'`.

**A plain scheduled function, not an extension.** Firebase's
`firestore-schedule-writes` extension exists for delayed writes, but for a low-
volume pilot a direct scheduled function querying by `interviewAt` is the
simpler, dependency-free equivalent — and MAPA already runs scheduled functions
(`glExpirySweep`, `resetAgencySlots`) in `asia-southeast1`, so this is an
established pattern here, not new infrastructure.

**Cadence — evidence-based, adapted to "no SMS".** The literature favours a
layered *primary + final* cadence (≈48h then 24h) and shows SMS is the strongest
channel — which MAPA cannot use (CLAUDE.md). So MAPA leans on the two channels it
has, matched to their strengths:

| When | Channel | Job |
|---|---|---|
| ~48h before | **email** | the "prep" touch — what to bring, how Google Meet works, the reschedule link |
| ~24h before | **email + in-app** | confirm/attend nudge |
| ~1–2h before | **in-app** | final "join now" prompt |

When the mobile app ships, **push** (free via FCM) takes the 24h/2h urgency role
that SMS would otherwise own.

### 4.6 Reminder copy — the highest-leverage, lowest-cost lever

A 14-hospital RCT (161,587 patients) found that **reminder *wording* alone** cut
did-not-attend from **21.1% to 14.2%** — pro-social/"your slot is scarce"
framing beat a generic reminder by roughly a third, at zero added cost. MAPA's
indigent-assistance context makes an honest pro-social frame both effective and
ethical (the slots genuinely are scarce):

> *"Your CRMC assessment interview is tomorrow at 9:00 AM. If you can't make it,
> please cancel or reschedule now so another patient waiting for assistance can
> use the time."*

This pairs the nudge with a **one-tap cancel/reschedule** — and easy cancellation
is itself shown to raise *advance* cancellations, which recycles slots back into
the open pool. Avoid shaming language; keep it civic and warm (per CLAUDE.md tone).

---

## 5. Fit with MAPA's constraints (CLAUDE.md)

- **No SMS.** Reminders are email + in-app only; push arrives with the mobile app.
- **No new dependencies.** Slots + bookings are plain Firestore; the picker is
  hand-rolled Tailwind. No calendar library, no Google Calendar API (Meet links
  stay manual, per the model).
- **Bilingual patient UI.** The patient picker + all new patient strings go
  through `t()` and must pass `npm run lint:i18n`. Admin availability manager is
  English-only (staff surface).
- **Mobile-first.** ≥44px tap targets on slot buttons; the picker degrades to a
  single-column day list on phones.
- **Money-path untouched.** No endorse/coverage/slice logic is modified.

---

## 6. Phased delivery

Each phase is independently CI-green and shippable. Phases 1–2 are fully
verifiable without a browser; 3–4 add UI and want live screenshot verification.

- **Phase 1 — Foundation (no UI). ✅ shipped.**
  `utils/appointments.js` (slot generation, PH-local date maths, the
  `canBookInterview` gate) + `interviewSlots` rules + unit + emulator rules
  tests + this doc (#135), and the hybrid `SLOT_MODE` primitive (#140).
- **Phase 2 — Cloud Functions.** The `onInterviewSlotBooked` sync trigger
  (carries `mode`/`meetLink`/`queueNo` → request `interviewMode` etc.) and the
  `interviewReminders` scheduled function, with `tests/functions` coverage.
  Deploy needs the owner's approval (Blaze, `asia-southeast1`).
- **Phase 3 — Admin: publish & manage availability.** The CRMC availability
  publisher: preset weekly windows → generate → review → publish; open/booked at
  a glance (day-grouped); the **program-wide + per-day mode** control (in-person
  default, flip to online for emergencies); attach a Meet link on online slots;
  the per-request "Open self-booking" toggle in the Interview panel. Build +
  component test.
- **Phase 4 — Patient: booking + appointment.** A bilingual, mobile-first
  day/time picker on `Interviews.jsx`, shown only when `canBookInterview` is
  true. The result renders by mode: a **full in-person appointment slip** (date,
  CRMC office, queue number, what-to-bring) or the **online Meet** card. Includes
  **reschedule** (cancel + re-book). Build + component + i18n; screenshot-
  verified. **Accessibility acceptance (WCAG 2.1 AA, from the research):**
  explicit labels ("Choose an interview time"), full keyboard operation
  (Tab / arrows / Enter / Esc) with visible focus, a live region announcing
  "slot booked / released", a stated timezone ("all times Philippine time"),
  ≥44px slot targets, and slots grouped by day as plain buttons (not a
  free-entry field) so there is nothing to mistype. Prefer real `<button>`s +
  the app's existing focus-ring over a custom calendar widget.

---

## 7. Research foundation

Every decision above traces to evidence, not taste:

- **Self-scheduling reduces no-shows and staff load.** Patients keep
  appointments they booked themselves; reported outcomes include large drops in
  inbound scheduling requests and cancellation messages, and automation
  absorbing "the work of two full-time schedulers." → justifies the whole
  feature and the *patient-books* direction.
  ([Dialog Health](https://www.dialoghealth.com/post/benefits-of-patient-self-scheduling),
  [Experian Health](https://www.experian.com/blogs/healthcare/8-reasons-to-use-patient-scheduling-software/))
- **Guided, not open, self-scheduling.** Healthcare self-scheduling is usually
  gated to eligible/appropriate cases rather than fully open — which is exactly
  the `interviewBookingOpen` per-request gate that keeps the CRMC gateway model
  intact. ([Valant](https://www.valant.io/resources/blog/the-great-patient-scheduling-debate-should-patients-be-able-to-self-schedule/))
- **Reminder cadence & channel.** A layered primary(~48h)+final(~24h) sequence
  is the norm; SMS is strongest but unavailable to MAPA, so email carries prep
  and in-app carries urgency (push later). ([DoctorConnect](https://doctorconnect.net/automated-appointment-reminders-reduce-no-shows/),
  [Zocdoc](https://www.zocdoc.com/resources/blog/article/appointment-reminder-templates-that-reduce-no-shows-text-email/))
- **Reminder *wording* is a first-class lever.** RCT, 14 hospitals / 161,587
  patients: pro-social framing cut did-not-attend 21.1% → 14.2% vs a generic
  reminder — a ~one-third reduction at no cost. → §4.6 copy.
  ([NCBI PMC7310733](https://pmc.ncbi.nlm.nih.gov/articles/PMC7310733/))
- **Concurrency.** Optimistic locking suits low-transaction booking; the
  standard Firestore pattern is a transaction that reserves only if still free —
  MAPA encodes "still free" in the rule. ([HackerNoon](https://hackernoon.com/how-to-solve-race-conditions-in-a-booking-system),
  [FlutterFlow/Firestore booking pattern](https://www.rapidevelopers.com/flutterflow-tutorials/how-to-build-an-appointment-scheduling-system-in-flutterflow))
- **Reminder infra.** For low volume, a plain scheduled function beats the
  `firestore-schedule-writes` extension. ([FirebaseExtended](https://github.com/FirebaseExtended/experimental-extensions/blob/next/firestore-schedule-writes/README.md))
- **Picker accessibility & timezone.** Explicit labels, full keyboard support,
  live-region validation, local-timezone assumption, format/affordance clarity.
  → Phase 4 acceptance. ([MUI X a11y](https://mui.com/x/react-date-pickers/accessibility/),
  [Webeyez date/time UI](https://webeyez.com/insights/guides/date-and-time-ui-design))
- **Civic queue-reduction framing.** Government/hospital self-booking cuts
  walk-ins and congestion and pairs booking with automatic reminders — the
  public-service case MAPA sits in. ([QLess](https://qless.com/blog/online-hospital-appointment-systems),
  [Q-nomy](https://www.qnomy.com/modernizing-government-operations-leveraging-appointment-scheduling-software-and-queue-management-systems-9/))

### Future enhancements (post-v1, evidence-backed)

- **Earlier-slot waitlist.** >65% of patients take an earlier slot when offered,
  most responding within the hour. A "notify me if an earlier time opens" flag,
  fired from the same cancel→open transition, is a natural follow-up — not v1.
- **Message A/B testing.** Once volume exists, A/B the reminder copy (the RCT
  above shows the payoff) via a simple variant field on the reminder send.

## 8. Risks & mitigations

- **Booking before documents are verified.** Mitigated by the explicit
  `interviewBookingOpen` gate — CRMC opens booking when the patient is ready;
  CRMC can always cancel/re-book.
- **Timezone correctness.** All slot dates/times are anchored to PH local
  (Asia/Manila, no DST), the same discipline already in `Interviews.jsx`.
- **Function deploy access.** Phases 1, 3, 4 work without new functions; the
  end-to-end sync + reminders (Phase 2) require an owner deploy — sequence it
  when that window is available.
- **Orphaned slots.** Past unbooked slots accumulate; a lightweight sweep (or a
  bounded publish window) keeps the collection small.

---

## 9. Success criteria

1. CRMC publishes availability in a few clicks and sees open vs. booked at a glance.
2. A patient whose booking is open picks a time themselves; the interview appears
   on their dashboard with a Meet link and a calendar add — no back-and-forth.
3. Email + in-app reminders fire once each at 24h and 1h.
4. A booked slot can never be double-booked, and a booking can never be pinned to
   another patient's request.
5. Zero change to the money-path and zero widening of the patient's `requests`
   write permissions.
```
