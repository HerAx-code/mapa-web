# MAPA Project Context

## What This Is
MAPA (Medical Assistance Portal Access) is a platform for Cotabato Regional Medical Center (CRMC). It digitizes the medical financial assistance application process — patients apply online, CRMC reviews the documents and conducts one assessment interview (**in person at the office by default, online as a fallback**), then endorses the request to one or more funding agencies; approved patients receive a Guarantee Letter (digital certificate) to claim at the agency office.

This is a **production system** deployed for real use at CRMC Malasakit Center in Cotabato City, Philippines. It began as a solo ~9-month build, but it is **not a throwaway pilot** — apply a production quality and robustness bar, and weigh features by real operational value at scale (coordinator workload, interview no-shows, concurrency safety, indigent-patient phone UX), not demo-readiness. Pilot-era shortcuts in this file are being reconciled against that reality.

The system has two patient-facing surfaces:
- A web portal (this codebase) — used by agencies, admins, and patients who prefer browser access
- A mobile app (planned, separate project) — the primary patient experience, more user-friendly than the web for indigent users on phones

Agencies and admins use the web only. Patients can use either, but mobile is the intended primary channel.

## Tech Stack (do not change without discussion)
- Frontend (web): React 18 + Vite + Tailwind CSS
- Backend: Firebase (Firestore, Auth, Hosting)
- Auth: Firebase Authentication (email + password) + **TOTP MFA for staff roles** (Identity Platform; patients exempt) and **Firebase App Check** (reCAPTCHA Enterprise, monitor mode). See `docs/security-improvement-plan.md` + `security-research.md`.
- Database: Cloud Firestore (NoSQL)
- Mobile app: planned, framework TBD (likely React Native or Flutter — share Firebase backend with web)
- i18n: react-i18next for Filipino/English support — not yet integrated

## Communication Channels (current decisions)
- Assessment interview — **hybrid, in-person by default.** It is a mandatory, capacity-limited step conducted by a CRMC social worker; the appointment/slot system books it and CRMC sets the mode.
  - **In person (default):** the patient receives a scheduled office appointment. The point of scheduling is congestion control at the office — stagger arrivals to match interview capacity, give a fair queue, and spare indigent patients wasted travel / turn-aways.
  - **Online (fallback):** a Google Meet link, for when in-person isn't feasible — a health emergency (COVID-style restrictions), typhoon/flooding, or a patient too far or too unwell to travel. Same booking system; only the "where" changes. CRMC can shift the mix (per slot/day, or a program-wide switch) so the service keeps running under disruption.
  - Google Meet is deliberate for the online mode — free, reliable on weak networks, no infra to run. Building our own video is NOT planned (see Out Of Scope).
- Notifications: in-app notifications (Firestore) + email (Firebase)
  - **SMS via Semaphore** (semaphore.co, PH-local) — built as a third channel through `api/send-sms.js` + `notify({ sms: true, smsText })`. It's **opt-in per call and paid per segment**, so reserved for high-value, time-critical messages (interview scheduled, approval) with minimal, PII-free copy (RA-10173) — never every notification. Provisioned by setting `SEMAPHORE_API_KEY` in Vercel; unset = the channel no-ops (in-app + email unaffected). Push is planned via Firebase Cloud Messaging when the mobile app ships. Reminders-by-SMS (the `interviewReminders` function) is a deliberate follow-up.
  - When mobile app ships, add push notifications (free via Firebase Cloud Messaging)
- Reminders for interviews go via email + in-app notification (24h before, 1h before)

## User Roles
- super_admin — full system access
- staff_admin — operations (no accounts, audit, announcements, coordinators)
- agency — agency portal, own applications only
- patient — patient portal, own data only (self-registers with Patient Access Code)

## Design Principles
- Government-adjacent system. Tone: civic, professional, trustworthy. Not flashy.
- Patient-facing UI must be bilingual (Filipino + English). Use inline bilingual labels where possible. **Enforced** by `npm run lint:i18n` across `src/pages/patient/**`, `src/components/patient/**`, and the shared shell components patients see (Layout, AnnouncementBanner, AnnouncementFeedCard, OfflineBanner, InstallNudge, InstallPrompt).
- **Staff surfaces (agency/admin pages) are English-only by design.** CRMC + partner-agency operators are professionals expected to work in English (clinical / government default language for record-keeping in the Philippines). The eslint linter does NOT enforce i18n on `src/pages/agency/**` or `src/pages/admin/**`. If a future stakeholder reports that staff need bilingual UI, that becomes a scoped epic — adding it to the linter scope requires committing to translating ~30+ staff pages. Not a v1 shortcut.
- Mobile-first thinking for patient screens, even on web. Many patients use phones on slow connections.
- Match CRMC's actual workflow (Client's Information Sheet + Unified Intake Sheet). Don't invent fields they don't use.
- ID verification is **OCR-assisted, social-worker-confirmed**: on-device OCR (tesseract.js) reads the ID name as an advisory cross-check, and a camera-only **live selfie** is compared to the ID by the CRMC social worker. No PhilSys, no automated biometrics — the social worker always makes the final call.
- Patient Access Code (CRMC-YYYY-NNNNN) is the registration gate. Issued in person by Medical Social Services.

## Out Of Scope (do NOT build)
- PhilSys API integration
- Real money movement (no bank APIs, no payments). Note: monetary *commitments* ARE tracked as data — approved amounts, agency budgets, Guarantee Letter status. MAPA records intent; actual settlement happens off-system between agency and provider.
- ~~SMS notifications~~ — **now built** via Semaphore (opt-in, high-value messages only). See Communication Channels. Remaining SMS work (reminders-by-SMS in the Cloud Function) is a scoped follow-up, not out of scope.
- Custom video calling built on raw WebRTC (own signaling/TURN/SFU/media infra) — **not planned.** The online-interview fallback uses Google Meet. A *managed* embedded-video provider (Daily / LiveKit / self-hosted Jitsi) is a reconsiderable production option only if in-app join friction proves to be a real, observed barrier — never a from-scratch WebRTC build. See Communication Channels.
- Donor portal
- Fraud detection engine (manual judgment by social workers)
- Multi-hospital network (CRMC only)
- Real-time IHOMIS integration (use manual case number reference instead)

## Firestore Collections
users, requests, applications, documents, documentContents, documentTypes, assistanceTypes, agencies, hospitalIds, certificates, conversations, notifications/{uid}/items, reports, announcements, auditLog, docReviewPresence, interviewSlots

## Co-funding model (current)
CRMC is the single intake gateway; agencies only fund. The patient submits ONE
**request** (a bill + amount needed) with the full required-document checklist
and a live selfie. CRMC verifies the documents (OCR-assisted), fills the Unified
Intake Sheet, conducts ONE assessment interview, then **endorses** the request to
one or more agencies as child application "slices" toward zero balance. Agencies
do NOT re-review documents or re-interview — they only approve their slice and the
Guarantee Letter issues at approval. See docs/redesign-plan.md.

- **Request lifecycle:** submitted → under_review → assessment → endorsed → partially_funded → fully_funded (or closed / rejected). Patient can withdraw before endorsement.
- **Slice lifecycle:** endorsed → (patient Proceeds) → reviewing ("For Funding") → approved (GL issued) (or needs_info / rejected).
- The interview lives on the **request** (CRMC-conducted, one assessment interview — in-person by default, Google Meet as the online fallback). The agency's job is the funding decision only.

## Coding Conventions
- Components in /src/components, pages in /src/pages
- Firestore queries grouped in /src/utils
- All admin actions must call logAudit()
- All notifications use the notify() utility (writes to Firestore + sends email)
- Use Tailwind utility classes; no inline styles
- Patient-facing strings should be ready for i18n (use t('key') pattern when adding new strings); `npm run lint:i18n` enforces this on patient-facing files
- When building patient-side features in web, keep them mobile-friendly (touch targets ≥44px, large tap areas, readable font sizes on small screens) — the mobile app will reuse the same Firestore data, so the data model should serve both

## Testing & quality gates
- **Tests live in `tests/{utils,components,rules}/`.** Component tests use jsdom + React Testing Library; rules tests use the Firestore emulator; utils tests are pure node.
- **`npm test`** → utils (~3s). **`npm run test:components`** → component smoke tests (~15s). **`npm run test:rules`** → emulator + rules tests (~30s incl. boot). **`npm run test:all`** chains all three.
- **Pre-commit hook** runs utils tests automatically before every commit. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` for trivial / WIP commits. Installed via `simple-git-hooks` on `npm install`.
- **`npm run lint:i18n`** flags hardcoded JSX strings on patient-facing files. Warn-level by design; promote to error when baseline is 0.
- **GitHub Actions CI** runs build + utils + component tests + rules tests in parallel on every push to main and every PR. Vercel deploys independently; CI is a separate signal.

## How To Work With Me
- Read this file at the start of every task
- When you write code, match existing patterns in similar files
- Ask before adding new dependencies (npm packages cost build time and complexity)
- Show code changes before writing them so I can review
- For UI work on patient-facing screens, consider both web and future mobile — avoid web-only patterns where possible (e.g., hover-only interactions don't work on mobile)

## Reference Documents (read when relevant)
- docs/redesign-plan.md — the frozen CRMC-gateway redesign plan (model, lifecycle, phases)
- docs/intake-sheet-fields.md — every field from CRMC's paper intake forms
- docs/sprint-plan.md — current sprint goals
- docs/design-workflow.md — how to combine the design skills + Magic Patterns MCP for web UI work (read before non-trivial reskins)
- docs/reskin-relayout-plan.md — the living tracker of which pages are reskinned/relaid out and what remains (check before touching any page)
- (add others as you create them)