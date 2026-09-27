# 04 — Solidified build spec (implementation-grade)

*This turns [03-improvement-plan.md](03-improvement-plan.md) into a build-ready
specification, verified against the actual code on 2026-09-27. Every data shape,
component contract, i18n key, design token, back-compat rule, test, and acceptance
criterion below was checked against the source — not assumed. Depth is weighted toward
Phase 0 + Phase 1 (what gets built next); Phases 2–5 carry firm contracts.*

If a fact here ever disagrees with the code, the code wins — re-verify before building.

---

## A. Verified ground truth (the facts the build rests on)

### A.1 Data model — request lifecycle
`REQ_RANK` (`src/utils/requests.js`) is the single source of the request lifecycle:

| status | rank | terminal? |
|---|---|---|
| `submitted` | 0 | no |
| `under_review` | 1 | no |
| `assessment` | 2 | no |
| `endorsed` | 3 | no |
| `partially_funded` | 4 | no |
| `fully_funded` | 5 | **yes** |
| `closed` | — | **yes** |
| `rejected` | — | **yes** |

- **Assessment caveat (must handle):** per `CLAUDE.md`, the request `status` field may
  **skip** `assessment` — the CRMC stage machine (`utils/requestStage.js`,
  `deriveRequestStage`) drives the *internal* verify→assess→endorse gate off
  docs+intake, **not** the status. **Decision for the patient journey:** the patient
  sees the coarse **status-rank** journey (server-synced, simple). The finer
  verify/assess split stays CRMC-internal. Do **not** try to surface `requestStage` to
  the patient. This is why the journey is driven by `REQ_RANK`, not `deriveRequestStage`.

### A.2 Data model — slice (application) lifecycle
Slice `status`: `endorsed → reviewing → awaiting_info → approved → certificate`, or
`rejected`. Legacy `interview` still appears in `OUTSTANDING_SLICE_STATUSES` and in data.
Funding math (`computeFunding`, `isSliceTerminal`, GL expiry via `isGLExpired` /
`GL_VALIDITY_DAYS`) is authoritative and **must not change** in this work.

> **Back-compat rule #1:** never remove `interview` from the **data** maps
> (`OUTSTANDING_SLICE_STATUSES`, `REQ_RANK` has none anyway). Only remove it from
> **patient-facing display copy**, and only behind a fallback (§C.1).

### A.3 Component contracts (as-built)
- `JourneyStrip({ status, className })` — reads `REQ_RANK`; renders 6 dots from a local
  `STAGES` array whose labels come from `patient.journey.{submitted,verified,interview,
  endorsed,approved,letter}`. **← carries `interview`/`verified`/`approved`/`letter`
  labels that diverge from the request lifecycle. This is finding #1 in miniature.**
- `StatusHero({ request, nextAction, navigate })` — pine card, `Step n of 6`, reads
  `patient.hero.s0..s4.{title,sub}` + `patient.hero.trackCta` (and a dead
  `interviewCta`). Pre-funding hero.
- `BalanceHero({ request, funding, t, navigate })` — dark-teal money hero; already draws
  a stacked committed/outstanding bar (agency-agnostic). Funding-stage hero.
- `StatusBadge({ status, kind })` — `kind` ∈ `request|app`, sources
  `REQUEST_STATUS_CONFIG` / `APP_STATUS_CONFIG` in `utils/constants`.

### A.4 i18n key inventory (what exists today)
- `patient.journey.*` = `label, submitted, verified, interview, endorsed, approved, letter`
- `patient.hero.*` = `step, trackCta, interviewCta(dead), s0..s4.{title,sub}`
- **`patient.track.reqStages.*`** = clean 6-stage request copy:
  `submitted/review/assessment/endorsed/funded/completed` (Label+Note, plus
  `endorsedCta`). **← this is the cleanest canonical set; the single model adopts it.**
- `patient.track.stages.*` = legacy slice/direct copy incl. `interviewLabel/Note`.
- `patient.dashboard.timeline.*` (s1..s5) and `patient.dashboard.steps.*` (s1..s5) = two
  more 5-step sets.
- `patient.status.*` = `pending,endorsed,reviewing,awaiting_info,interview,approved,rejected,certificate`.

### A.5 Design tokens (must match)
- Color: **`brand`** teal scale `50 #E1F5EE … 500 #0F6E56 (primary) … 900`. Semantic
  convention (confirmed in code + memory): **pine (`brand`) = stage progress · amber =
  current/attention · green = money/success · red = rejected/error · purple = endorsed
  (existing slice color)**. Keep it.
- Type: body **Inter**; patient headlines **`font-display`** (Bricolage Grotesque).
- Components (in `src/index.css`, use these — don't invent): `.card`, `.card-hero`,
  `.stat-tile`/`.stat-num`/`.stat-label`, `.badge` + `.badge-{green,amber,red,blue,purple,gray}`,
  `.btn-{primary,secondary,danger}`, `.input`, `.eyebrow`, `.nav-item`, `.page-title`.
- Layout constants (confirmed): patient content wrappers use
  `max-w-[100vw] sm:max-w-3xl` (TrackStatus) / `lg:max-w-6xl` (Dashboard 2-col),
  `overflow-x-clip`, `px-3 py-4 sm:p-6`. Touch targets **≥44px** (`min-h-[44px]`).
  Keep these — do not widen patient columns (see `feedback_patient_layout` memory).

---

## B. Global build rules (apply to every change)
1. **Verify on preview, not prod** (`reference_deploy_and_verify`): branch → Vercel
   preview URL → screenshots at **~400px** width for patient work → suites green → merge.
2. **`npm run lint:i18n` must stay green** — every new patient string uses `t('key')`;
   add the key to **both** `en.json` and `fil.json`.
3. **No new npm deps** without asking (compression in 2.3 uses canvas, no dep).
4. **Tests:** utils change → `tests/utils`; component change → `tests/components`
   (jsdom+RTL smoke). Run `npm run test:all` before merge.
5. **Back-compat:** legacy statuses (`interview`, pre-`totalBill` requests, slices with
   no `requestId`) must still render without throwing. Every status→display lookup uses
   a fallback (`?? defaultStage`, `defaultValue`).
6. **One PR per phase item** where possible; Phase-0 items can share one PR.

---

## C. Phase 0 — prune residue (build first; 1 PR)

### C.0 Definition of done for the phase
No `interview` token in any patient-facing render path; one `peso()`; one status→display
source; the shell `ComposeModal` has no patient branch. All suites + `lint:i18n` green.
Zero visual change to a *current-data* patient (only legacy/dead paths change).

### C.1 Kill interview residue — files & exact edits
- **`src/components/patient/JourneyStrip.jsx`** — replace the local `STAGES` with the
  canonical 6 from `utils/journey.js` (§D). Labels become
  `submitted/under_review/assessment/endorsed/funding/complete`. Remove the `interview`
  and `verified/approved/letter` label keys.
- **`src/pages/patient/TrackStatus.jsx`** — in `buildStages` (the legacy per-app path),
  drop the `interview` stage from `STAGE_DEFS` and remove `interview` from `doneMap`/
  `activeMap`. **Fallback:** a slice/app whose status is `interview` maps to the
  `reviewing` display row (`activeMap.interview = 'reviewing'`) so legacy data still
  renders a sensible "in review" state, never a crash or blank.
- **`src/pages/patient/Dashboard.jsx`** — `STEPS[2].done` currently includes
  `'interview'`; change to `['approved','certificate'].includes(activeStatus)` (drop
  interview). (This card is removed entirely in Phase 1.2 anyway; do the safe edit now.)
- **i18n:** leave `patient.status.interview` and `patient.track.stages.interview*` in the
  JSON **as fallback aliases** (deleting them risks a missing-key on legacy data). Remove
  only their *usages*. Delete the truly-dead `patient.hero.interviewCta` and
  `patient.journey.interview/verified/approved/letter` **after** JourneyStrip stops
  referencing them.
- **Acceptance:** grep `interview` in `src/pages/patient` + `src/components/patient`
  returns only comments / the data-map fallback — no rendered label.

### C.2 Remove the patient branch of the shell `ComposeModal`
- **`src/components/Layout.jsx`** — in `ComposeModal`, guard the whole component behind
  `user?.role !== 'patient'`; for patients, the `MsgPanel` "+ New Message" already
  routes to `/patient/messages` (reply-only). Remove the `getDocs(collection(db,'users'))`
  directory fetch from any path a patient can reach, and delete the patient-only
  `patientGuidance` / `searchPatient` branch code.
- **Acceptance:** no patient code path calls `collection(db, 'users')` for a picker;
  matches the reply-only firestore rules; `tests/rules/messages` unaffected.

### C.3 Consolidate shared formatters + status display config
- **New `src/utils/format.js`:** `export const peso = (n) => `₱${(Number(n)||0).toLocaleString('en-PH')}``.
  Replace the per-file `peso` in `Dashboard`, `TrackStatus`, `RequestAssistance`,
  `admin/Requests`, `ApplicationModals`, `BalanceHero` with this import.
- **Fold `STATUS_VISUAL`** (Dashboard) into `utils/constants` next to `APP_STATUS_CONFIG`
  so status→{icon,color,label} has one home. `JourneyStrip`/stepper stage→visual comes
  from `utils/journey.js` (§D).
- **Test:** `tests/utils/format.test.js` pins `peso(25000) === '₱25,000'` and the
  status-map returns a value for every known + one unknown status (fallback).

---

## D. Phase 1 — one patient journey (the core initiative)

### D.1 New module `src/utils/journey.js` (the single source)
```js
// The ONE canonical patient journey. Driven by request.status via REQ_RANK.
// Copy lives in i18n at patient.journey.stage.<key>.{label,now,next}; migrate
// the existing patient.track.reqStages.* strings into that namespace.
import { REQ_RANK } from './requests'
import { MdInventory, MdSearch, MdAssignment, MdSend, MdVolunteerActivism, MdCheckCircle } from 'react-icons/md'

export const JOURNEY_STAGES = [
  { key: 'submitted',    rank: 0, icon: MdInventory },
  { key: 'under_review', rank: 1, icon: MdSearch },
  { key: 'assessment',   rank: 2, icon: MdAssignment },
  { key: 'endorsed',     rank: 3, icon: MdSend },
  { key: 'funding',      rank: 4, icon: MdVolunteerActivism }, // partially_funded
  { key: 'complete',     rank: 5, icon: MdCheckCircle },       // fully_funded
]
export const JOURNEY_TOTAL = JOURNEY_STAGES.length // 6

// terminal handling: rejected / closed are NOT stages — they are outcomes.
export function journeyState(request) {
  const status = request?.status
  if (status === 'rejected') return { outcome: 'rejected', rank: -1, stages: markAll('upcoming') }
  if (status === 'closed')   return { outcome: 'closed',   rank: REQ_RANK.partially_funded, stages: rankStages(REQ_RANK.partially_funded) }
  const rank = REQ_RANK[status] ?? 0            // fallback: unknown status → rank 0
  return { outcome: null, rank, stages: rankStages(rank) }
}
// stages[i].state = 'done' (rank>i) | 'current' (rank===i) | 'upcoming' (rank<i)
```
- **i18n migration:** copy `patient.track.reqStages.*` (already clean, 6 stages) into
  `patient.journey.stage.<key>.{label,now,next}` in `en.json` + `fil.json`. `now` =
  "what's happening" (one line), `next` = "what's next" (one line) — GDS "received /
  decided / next" pattern (benchmark A). Keep `endorsed.cta` = "Review your coverage plan".
- **Unit test** `tests/utils/journey.test.js`: every request status → correct rank +
  done/current/upcoming distribution; `rejected`→outcome; unknown status→rank 0 (no throw).

### D.2 Three fidelities, one source
| Fidelity | Component | Where | Renders |
|---|---|---|---|
| **Glance** | `JourneyStrip` (rewritten) | Dashboard + TrackStatus top | 6 dots + short labels from `JOURNEY_STAGES` |
| **Summary** | `PatientHero` (§D.3) | Dashboard | current stage `label` + `now` line + `Step n of 6` + one CTA |
| **Detail** | `JourneyStepper` (new) | TrackStatus | vertical 6-row stepper: label + `now`/`next` notes + per-stage CTA (e.g. endorsed→Proceed) |

- **Retire as *progress* surfaces:** Dashboard `TimelineCard` (delete) and Dashboard
  "Application Steps" guide (move a static "how MAPA works" version to the **Guide**;
  on the Dashboard show it **only when the patient has no request yet**, as onboarding).
  The TrackStatus request stepper is **replaced** by `JourneyStepper` reading
  `utils/journey.js` (same copy it already uses, now shared).
- **The per-slice 4-stage stepper stays** — it is the *coverage detail inside the
  `funding` stage*, not a competing journey. Rename its copy usage away from `interview`
  (already legacy-only). Frame it in the UI as "Your agencies" under the funding stage.

### D.3 `PatientHero` — collapse the six branches into one
- **New `src/components/patient/PatientHero.jsx`**, contract:
  `PatientHero({ request, funding, nextAction, navigate, t })`. Internal state machine:
  1. `!request` → **welcome/compact** (dismissible strip; not a hero branch).
  2. `journeyState.outcome === 'rejected'|'closed'` → **outcome card** (plain-language
     result + "try another program" / "view details").
  3. `rank < 3` (pre-funding) → **pine stage card** (the current `StatusHero` look):
     `Step n of 6` + stage `label` + `now` line + one CTA (`nextAction` wins, else Track).
  4. `rank >= 3` (funding) → **money card** (the current `BalanceHero` look) + the
     §D.4 per-agency stacked bar.
- Keep `StatusHero`/`BalanceHero` as the internal presentational pieces (import them) so
  the visual language is unchanged; `PatientHero` is the **selector**. Dashboard's
  hero conditional tree collapses to `<PatientHero .../>`.
- **Acceptance:** `Dashboard.jsx` hero block is one component call; every prior branch
  still reachable (welcome, pre-funding, funding, rejected, closed) — verified by a
  component test that renders each state.

### D.4 Co-funding legibility — per-agency path-to-zero (finding, benchmark F)
- **New `src/components/patient/CoverageBar.jsx`:** a single horizontal bar to
  `amountNeeded`, segmented per slice (`agencyColor`, committed solid / pending hatched),
  with a plain caption "₱X of ₱Y covered by N agencies". Reuses `computeFunding` +
  `reqSlices` already loaded on both surfaces. Mirrors admin `PathToZeroBalance`.
- Place under the funding-stage `PatientHero` and on TrackStatus. Replaces the
  agency-agnostic bar inside `BalanceHero` only if it reads cleaner; otherwise sits below.

### D.5 Phase 1 acceptance criteria (the "100% works" bar)
- Exactly **one** stage list in the codebase (`JOURNEY_STAGES`); `grep` finds no other
  6-step or 5-step patient progress array.
- Dashboard + TrackStatus render the **same** stage `label`s for the same request
  (screenshot diff at 400px).
- Legacy request (no `totalBill`), a `rejected` request, a `closed` request, and a
  request stuck at `under_review` during assessment all render without error.
- All patient strings resolve in **both** locales (`lint:i18n` + a manual FIL toggle).
- `npm run test:all` green; component test covers each `PatientHero` state + `journeyState`.

---

## E. Phase 2 — density & linearity (contracts)
- **2.1** Icon-led one-line status: each `JOURNEY_STAGES` stage already carries an
  `icon`; hero/stepper lead with it + the `label`, move `now`/`next` to a subline/expander.
- **2.2** Active-request task list: refactor the `RequestAssistance` active view into a
  `TaskList` (`components/patient/TaskList.jsx`) of rows `{ label, state, cta }` where
  state ∈ `done|in_progress|not_started|action_needed`, driven by existing data (intake
  complete? docs verified? coverage plan present? proceed pending?). No data-model change.
- **2.3** Upload compression: in `utils/uploadDocument.js`, before the base64 write,
  downscale via `<canvas>` to max ~1600px long edge / target ≤~500 KB (canvas
  `toBlob('image/jpeg', q)`); keep the ~650 KB hard cap as backstop. Add
  `tests/utils` for the resize math (pure part). **Risk: medium** — verify a real photo
  round-trips readable for OCR; land behind preview verification.

## F. Phase 3 — shared staff queue spine (contracts)
- **3.1** New `utils/aging.js`: `aging(sinceTs, { warnAt, overAt, unit })` → `ok|warn|over`
  + label; CRMC calls it with hours `{warnAt: 36, overAt: 48, unit:'h'}` (wrapping
  `sla.js`), agency with days `{warnAt: 3, overAt: 7, unit:'d'}`. **Same color/label
  semantics, different thresholds** (they are genuinely different clocks — do not force
  one number). Shared `<AgingChip state=/>`.
- **3.2** Extract `components/queue/QueueTable.jsx` + `QueueFilters.jsx` (columns/filters
  by config) powering both `admin/Requests` list and `agency/Inbox`. Optional CRMC
  **board view** by `deriveRequestStage` stage with urgency color. Read-only; rules
  untouched. **Effort L, medium risk** — behind a view toggle, land table-parity first.
- **3.3** Claim action: `requests.assignee` write + "mine/unassigned/all" filter on the
  CRMC queue. Needs a firestore-rules check that an admin may set `assignee` (verify the
  `requests.update` admin branch already allows it — it does: `isAdmin()` full update).

## G. Phase 4 — verification capture & console (contracts)
- **4.1** ID capture assist: extend the ID `attachReq` path with a canvas-based
  glare/blur/edge heuristic (reuse the `hasFace`/OCR advisory pattern; on-device,
  advisory, **never blocks** — same posture as `SelfieCaptureModal` liveness). Add a
  framing rectangle overlay for camera capture. No biometric decision.
- **4.2** Reviewer console: fold `CompareFacesModal` + the OCR cross-check + advisory
  scores + verify/reject-with-reason into one modal opened from `VerifyDocsPanel`. All
  signals advisory; the social worker still decides (RA-10173 human-in-the-loop).

## H. Phase 5 — vocabulary, notifications, a11y (contracts)
- **5.1** Glossary in `CLAUDE.md`; copy pass: patient sees **"request"** + **"coverage
  from agencies"** (never "slice"/"application"); staff share a **"case"** lens.
- **5.2** Group the bell + `/notifications` by the existing `NOTIF_CATEGORY`
  (Applications/Documents/Messages/System); collapse repeats. Server model unchanged.
- **5.3** A11y pass: WCAG AA contrast on amber/gray small text, visible focus on
  clickable rows, `aria-label` on icon-only buttons, keyboard operability of queues +
  modals. Track against `references/pro-rules.md` checklist.

---

## I. Risk register & mitigations (why this will work)
| Risk | Mitigation |
|---|---|
| Rewriting the two most-used patient pages (Phase 1) regresses a state | One `journeyState` unit-tested for every status incl. legacy/terminal; `PatientHero` component test renders every branch; screenshot diff at 400px on preview before merge |
| Removing `interview` breaks legacy data | Only display copy removed; data maps keep `interview`; every lookup has a fallback (§B.5, §C.1) |
| i18n key drift → blank labels | Add keys to both locales; `lint:i18n` gate; migrate (not delete) `reqStages` copy; manual FIL toggle in acceptance |
| Image compression corrupts OCR input (2.3) | Verify OCR still reads a compressed real photo on preview; keep original-cap backstop; medium-risk item isolated in its own PR |
| Shared queue extraction (3.2) regresses triage | Land table-parity first behind a toggle; board view additive; rules unchanged (read-only) |
| Staff queue "unify SLA" over-claims one number | `aging.js` keeps per-role thresholds; only color/label semantics shared |

## J. Suggested delivery order (each a PR, verified on preview)
1. **Phase 0** (C.1–C.3) — prune + shared format/config. *Safe, no visual change.*
2. **Phase 1a** — `utils/journey.js` + rewritten `JourneyStrip` + `JourneyStepper` on
   TrackStatus (replace the request stepper). *Screenshot-verify.*
3. **Phase 1b** — `PatientHero` collapses Dashboard branches; delete `TimelineCard`;
   move steps-guide to Guide; add `CoverageBar`.
4. **Phase 2** (density, task list, then compression on its own PR).
5. **Phase 3** (aging util + claim first; shared QueueTable + board after).
6. **Phase 4**, then **Phase 5**.

Each PR: branch → preview URL → 400px screenshots (patient) → `npm run test:all` →
`lint:i18n` → merge → CI deploys. Cloud Functions are untouched by this plan (no Blaze
redeploy needed).
