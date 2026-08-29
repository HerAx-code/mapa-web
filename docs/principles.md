# Engineering & Design Principles

*The established web-architecture and UX principles MAPA's plans are grounded in
— each stated, then mapped to **where MAPA stands** and **which plan carries it
forward**. Written so a reviewer can trace every recommendation back to a named
principle, not an opinion.*

References: [NN/g — 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) ·
[Firebase — Best practices for Firestore](https://firebase.google.com/docs/firestore/best-practices) ·
[Firestore — real-time queries at scale](https://cloud.google.com/firestore/native/docs/real-time_queries_at_scale) ·
[Firebase — security with Cloud Functions + Rules](https://medium.com/firebase-developers/patterns-for-security-with-firebase-combine-rules-with-cloud-functions-for-more-flexibility-d03cdc975f50).

---

## Lens 1 — Web system architecture

| Principle | What it means | Where MAPA stands · which plan carries it |
|---|---|---|
| **Separation of concerns** | Distinct layers with clear responsibilities. | ✅ pure `utils/` domain layer, tested. ✗ 1,700-line pages mix everything → *redesign Phase 0 (panel extraction) + architecture Tier 3*. |
| **Server-authoritative for critical logic** | Money/trust logic runs on trusted server code; rules are the client layer. | ✗ 25 client-side transactions → *architecture **Tier 1**: move endorse/approve/GL to Cloud Functions*. |
| **Loose coupling / event-driven** | Components talk through events, not tight calls. | ✅ `syncRequestFinancials` reconciles via a trigger. Broaden the pattern for notifications → *Tier 1/2 fan-out*. |
| **Least privilege · defense-in-depth** | Every layer enforces its own access; no single gate. | ✅ strong Firestore + Storage rules, App Check, authenticated email endpoint. |
| **Design for failure · graceful degradation** | Assume parts fail; degrade, don't break. | ✅ offline-first persistence; `notify()` never breaks the user flow. ✗ single-region + single-Gmail are SPOFs → *Tier 2/4*. |
| **Scale-aware data modeling** | Model to avoid read amplification; aggregate on the server. | ✗ full-collection reads (notify-all, analytics) → *Tier 1: precomputed aggregates + server fan-out*. |
| **Observability** | You learn of failure before users do. | ✗ Sentry gated, no uptime, functions log-only → *Tier 2: activate*. |
| **Idempotency · self-healing** | Operations converge to a correct state. | ✅ the reconciler re-derives the tally from the slices. |
| **Testing & monitoring early** | Quality gates from day one. | ✅ 305 tests + CI (build/unit/component/functions/rules/E2E). Monitoring is the gap. |

---

## Lens 2 — Web system design (UX)

Mapped to Nielsen's 10 usability heuristics plus core web-design practice. The
CRMC request-pipeline redesign is, in effect, a heuristics-driven rework.

| Heuristic / practice | In MAPA · which plan carries it |
|---|---|
| **1 · Visibility of system status** | ✅ the **stage rail** shows verify → assess → interview → endorse progress *(redesign Phase 1, shipped)*. |
| **2 · Match system & real world** | ✅ plain-language, **bilingual** patient UI, civic vocabulary; amounts in ₱. |
| **3 · User control & freedom** | ✅ cancel/undo, patient withdraw-before-endorsement; reversible actions. |
| **4 · Consistency & standards** | ✅ the **Design System** — one set of tokens/components every surface reskins from. |
| **5 · Error prevention** | ✅ **explicit endorse blockers** gate the action until prerequisites are met *(redesign, shipped)*; programmatic form labels. |
| **6 · Recognition over recall** | → the **focused work area** (one stage in view, not a wall of controls) *(redesign Phase 1, next)*. |
| **7 · Flexibility & efficiency** | → **queue triage** buckets + bulk actions *(redesign Phase 2)*; keyboard-reachable controls. |
| **8 · Aesthetic & minimalist** | → replace the long single-scroll detail with progressive disclosure *(redesign Phase 1)*. |
| **9 · Recognise, diagnose, recover** | ✅ actionable error copy + the exact remaining blockers, not a vague warning. |
| **10 · Help & documentation** | ✅ in-app user guides; the Design System as the team reference. |
| **Mobile-first · responsive** | ✅ 44px touch targets, flat-on-mobile cards, no hover-only actions. |
| **Accessibility (WCAG 2.1 AA)** | ✅ AA contrast (gray-500 for text), focus-visible ring, labelled fields. Live screen-reader pass still to do. |
| **Performance budget** | ✅ vendor chunking, lazy OCR; Firebase weight is the remaining cost. |
| **Progressive disclosure · IA** | → the staged workspace + triaged queue are IA moves *(redesign Phases 1–2)*. |

---

## How the plans use this

- **`request-pipeline-redesign-plan.md`** is grounded in Lens 2 — every redesign
  move maps to a heuristic (status → stage rail, error prevention → blockers,
  recognition-over-recall → focused work area, efficiency → queue triage).
- The **architecture review** artifact is grounded in Lens 1 — its four tiers
  advance the principles MAPA hasn't fully met yet (server-authoritative writes,
  scale-aware modeling, observability).
- The **Design System** artifact is Lens 2's "consistency & standards" made
  concrete.

Net: the plans aren't a wish list — each item closes a gap against a named,
sourced principle.
