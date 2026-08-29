# Admin Requests Queue — table + categorization adoption

*Adopt the Magic Patterns queue's **table** (scannable, sortable row) and
**categorization** (tabs with counts) into MAPA's admin Requests page — remapped
to MAPA's design system and driven by MAPA's real stage model. This executes
Phase 2 of [`request-pipeline-redesign-plan.md`](request-pipeline-redesign-plan.md).
Reference export: `Downloads/admin request page` (keep/adapt/reject already done).*

> **Not adopted:** Export CSV (dedicated page exists); the export's generic
> buckets, and its **Officer / SLA / priority** columns + **bulk-select**
> (no `assignee`/`slaDueAt`/`priority` fields, and bulk "Endorse" is money-path).
> Tokens/icons: remap to MAPA (`#0F6E56`, `.card`/`.badge`/`.data-table`),
> `react-icons/md`, JSX — no lucide / framer-motion / date-fns.

---

## Decisions (locked)

- **Categorization = full stage buckets** (below), driven by the existing
  `deriveRequestStage` (#69) — the same source of truth as the detail rail and
  the endorse gate, so tabs / row chip / blockers never disagree.
- **Docs signal = denormalized count.** Write `docsVerifiedCount` /
  `docsRequiredCount` onto the request whenever CRMC verifies/rejects a doc, so
  the queue reads the stage + "docs X/N" cheaply (no per-row fan-out).

## The category tabs (from `stage.current`)

| Tab | Rule |
|---|---|
| **Needs verification** | `stage.current === 'verify'` |
| **Needs assessment** | `stage.current === 'assess'` |
| **Needs interview** | `stage.current === 'interview'` |
| **Ready to endorse** | `stage.current === 'endorse'` (`canEndorse`) |
| **Endorsed** (awaiting agencies) | status `endorsed` / `partially_funded` |
| **Completed** | status `fully_funded` / `closed` / `rejected` |
| **All** | — |

Counts render on each tab (from the same bucketing pass).

## The table row (MAPA data, MAPA tokens)

| Column | Source |
|---|---|
| **Patient** | avatar + name + `requestId · assistanceType`; keep the left-border accent for action rows |
| **Category** | `assistanceType` |
| **Balance** | `computeFunding(amountNeeded, slices).balance` of `totalBill` |
| **Coverage** | two-tone bar — committed (secured) + endorsed-pending — with % |
| **Docs** | `docsVerifiedCount` / `docsRequiredCount` + blocking flag |
| **Stage** | chip from the stage model; keep MAPA's richer `coverageWarning` |
| **Waiting** | from `submittedAt` |

- **Sortable headers:** balance, coverage, waiting.
- **Mobile:** card list on `< sm`, table on `sm+` (staff surface is desktop-first).
- **Row click** → open detail (existing `setSelected`).

---

## Build phases (each CI-green; money-path untouched)

- **Phase A — categorization + docs count.**
  - Pure, tested `src/utils/queueBuckets.js`: `bucketOf(request)` +
    `bucketCounts(requests)` on top of `deriveRequestStage`. Unit tests.
  - Add `docsVerifiedCount` / `docsRequiredCount` writes in the existing verify
    handlers (`reviewDoc` / `bulkVerifyPending` in `RequestDetail`) + a one-time
    backfill script. Not money-path.
- **Phase B — `QueueTabs`** (`src/components/admin/requests/QueueTabs.jsx`):
  the seven buckets + counts, replacing the coarse `FILTERS` in `Requests.jsx`.
- **Phase C — `RequestsTable` / `RequestRow`**
  (`src/components/admin/requests/`): the richer sortable row, extracted from the
  1,700-line file (also advances Phase-0 decomposition). Mobile card variant.
- **Phase D — sort wiring + polish + Playwright screenshot** against a seeded
  request in each bucket (`scripts/demo-data.mjs`).

## Verification
- Unit tests: `queueBuckets` (each stage → bucket, counts).
- Component test: tabs + table render.
- Screenshot verify (Playwright) each bucket + the sortable row.
- Read-only surface — **no endorse/coverage/slice logic changes**.

## Success criteria
1. An operator sees, per tab, exactly **what's waiting on them at each stage**.
2. The row is scannable at a glance — balance, coverage, docs, stage, age.
3. Tabs, row chip, and the detail's blockers all agree (one stage model).
4. Zero money-path change; no Export CSV; no invented fields.
