# Remove Interview Scheduling → Async Remote Assessment

*Written 2026-09-24. Supersedes `docs/appointment-system-plan.md`.*

## Decision
The booked/scheduled assessment **interview** is removed. The **human assessment
is kept** but becomes **async and remote**: CRMC works a queue, talks to the
patient through the existing in-app messaging (and an on-demand Google Meet link
dropped into the chat only when a live talk is needed), completes the Unified
Intake Sheet, and endorses. No appointments, no slots, no booking, no reminders.

**Why:** a pre-booked appointment reintroduces the exact travel/wait/no-show
friction MAPA exists to remove. Congestion control (the slot system's original
purpose) is unnecessary when the assessment is remote/async — nobody queues at
the office for it. The assessment itself is CRMC's substantive, legally-required
act and stays. See conversation 2026-09-24; reverses the "appointment system is
worth building" note.

**Locked calls:**
- **Endorse gate** = `docsVerified && intakeComplete`. The completed intake sheet
  *is* the human-assessment record; no separate interview step, no extra
  confirmation checkbox.
- **Existing production data**: undeploy the two interview Cloud Functions +
  remove the rules now so nothing new is written; **leave orphaned
  `interviewSlots` docs** (harmless, no reads). Optional purge later.

---

## Core change (the heart of it)
`src/utils/requestStage.js` — stage model goes from **verify → assess →
interview → endorse** to **verify → assess → endorse**:
```js
// before
canEndorse = docsVerified && intakeComplete && interviewDone   // interviewDone = interviewOutcome === 'completed'
// after
canEndorse = docsVerified && intakeComplete
```
Remove `interviewDone`, the `interview` stage key, its blocker/detail/label.
The social worker still cannot endorse without a completed intake sheet, which
they cannot complete without assessing the patient — so the human gate holds.

---

## Keep vs remove (the "slot" trap)
There are **two unrelated "slot" concepts**. Only the first is removed.
- ❌ **Interview slots** (`interviewSlots`, `appointments.js`) — appointment
  booking. REMOVE.
- ✅ **Agency funding capacity** (`agency/SlotManagement.jsx`,
  `resetAgencySlots.js`, `AgencyCapacityOverview.jsx`, `budget`/`capacity`) —
  how many beneficiaries an agency can fund. **KEEP — do not touch.**

Likewise `assessment` (request status) and `assess` (stage) are KEPT — they are
the intake step, not the interview.

---

## File-by-file

### Delete
- `src/pages/patient/Interviews.jsx` (booking picker)
- `src/pages/admin/Interviews.jsx` (slot publisher)
- `src/utils/appointments.js`
- `functions/src/onInterviewSlotWritten.js`
- `functions/src/interviewReminders.js`
- their tests (`tests/**` for the above, if present)

### Modify
| File | Change |
|------|--------|
| `src/utils/requestStage.js` | Drop `interview` stage + `interviewDone` (core change above) |
| `src/utils/queueBuckets.js` | Remove `'interview'` from `QUEUE_BUCKETS` + its label |
| `src/pages/admin/Requests.jsx` | Remove schedule / open-booking / record-outcome actions (~L733–827); stop writing `interviewBookingOpen`, `interviewOutcome`, `interviewDate/Time/Mode/At`, `meetLink`, `interviewQueueNo`. Endorse already reads `stage.canEndorse` |
| `src/App.jsx` | Remove `/patient/interviews` + `/admin/interviews` routes + lazy imports |
| `src/components/Layout.jsx` | Remove interview nav items (patient + admin) + `interview_sched`/`interview_approved` notification type maps |
| `src/utils/constants.js` | Remove the `interview` status label; **keep** `assessment` |
| `src/pages/patient/Dashboard.jsx`, `TrackStatus.jsx`, `src/components/OutcomeModal.jsx` | Remove interview UI; TrackStatus shows "A social worker is reviewing your application and may message you" |
| `src/i18n/locales/{en,fil}.json` | Remove `patient.nav.interviews` + interview strings |
| `src/utils/tours.js`, `src/pages/agency/Guide.jsx`, `src/pages/auth/Landing.jsx`, `src/pages/Seed.jsx` | Remove interview mentions / slot seeding |
| `firestore.rules` | Remove the `match /interviewSlots/{slotId}` block; drop any interview fields from the `requests.update` allowlist |
| `firestore.indexes.json` | Remove any `interviewSlots` composite indexes |
| `functions/*index.js` | Unregister `onInterviewSlotWritten` + `interviewReminders` |
| `CLAUDE.md` | Rewrite Communication Channels (interview = async/remote via chat + on-demand Meet, no booking); update request-lifecycle note; remove `interviewSlots` from collections; retire the appointment references |

> ⚠ The 28-file grep also matched files via the **agency "slot"** meaning and the
> **`assessment` status** — audit each match; do NOT remove those.

### Undeploy (manual, Blaze, `--project mapa-crmc`)
```
firebase deploy --only functions --project mapa-crmc   # after unregistering, redeploys without them
# or explicitly:
firebase functions:delete onInterviewSlotWritten interviewReminders --project mapa-crmc
```
Rules deploy via CI (`deploy-rules.yml`). `firestore.indexes.json` is manual.

---

## Sequencing (each its own commit, feature branch)
1. **Core gate** — `requestStage.js` + `queueBuckets.js` + their tests. This
   alone makes the interview non-blocking; safe, isolated, reversible.
2. **Admin Requests.jsx** — strip scheduling/outcome UI; confirm endorse works
   off the new gate.
3. **Remove patient/admin Interviews pages** — routes, nav, i18n, tours,
   notifications, Dashboard/TrackStatus/OutcomeModal.
4. **Rules** — remove `interviewSlots` block + index; deploy via CI.
5. **Functions** — delete the two + unregister; undeploy manually.
6. **Docs + memory + CLAUDE.md**; mark `appointment-system-plan.md` superseded.
7. `npm run test:all`; live-verify on the Vercel preview before prod.

## Test focus
- `requestStage` unit tests: endorse unlocks on verify+intake alone; no
  regression on terminal states.
- Rules (emulator): patient can no longer write `interviewSlots`; endorse path
  unaffected.
- In-flight requests carrying stale `interviewOutcome`/`interviewDate` still
  endorse (new gate ignores them) — no stuck cases.
