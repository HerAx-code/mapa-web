# MAPA Project Context

## What This Is
MAPA (Medical Assistance Portal Access) is a platform for Cotabato Regional Medical Center (CRMC). It digitizes the medical financial assistance application process — patients apply online, agencies review and conduct online interviews, approved patients receive digital certificates to claim at the agency office.

This is a thesis project (solo student, 9 months). The pilot partner is CRMC Malasakit Center in Cotabato City, Philippines.

The system has two patient-facing surfaces:
- A web portal (this codebase) — used by agencies, admins, and patients who prefer browser access
- A mobile app (planned, separate project) — the primary patient experience, more user-friendly than the web for indigent users on phones

Agencies and admins use the web only. Patients can use either, but mobile is the intended primary channel.

## Tech Stack (do not change without discussion)
- Frontend (web): React 18 + Vite + Tailwind CSS
- Backend: Firebase (Firestore, Auth, Hosting)
- Auth: Firebase Authentication (email + password)
- Database: Cloud Firestore (NoSQL)
- Mobile app: planned, framework TBD (likely React Native or Flutter — share Firebase backend with web)
- i18n: react-i18next for Filipino/English support — not yet integrated

## Communication Channels (current decisions)
- Online interviews: Google Meet links (free, reliable, no API integration needed)
  - Agency generates a Google Meet link manually or via Google Calendar
  - System stores and shares the link with the patient
  - Patient clicks link to join in their browser or Google Meet app
- Notifications: in-app notifications (Firestore) + email (Firebase)
  - NO SMS — cost not feasible for thesis pilot
  - When mobile app ships, add push notifications (free via Firebase Cloud Messaging)
- Reminders for interviews go via email + in-app notification (24h before, 1h before)

## User Roles
- super_admin — full system access
- staff_admin — operations (no accounts, audit, announcements, coordinators)
- agency — agency portal, own applications only
- patient — patient portal, own data only (self-registers with Patient Access Code)

## Design Principles
- Government-adjacent system. Tone: civic, professional, trustworthy. Not flashy.
- Patient-facing UI must be bilingual (Filipino + English). Use inline bilingual labels where possible.
- Mobile-first thinking for patient screens, even on web. Many patients use phones on slow connections.
- Match CRMC's actual workflow (Client's Information Sheet + Unified Intake Sheet). Don't invent fields they don't use.
- ID verification is **OCR-assisted, social-worker-confirmed**: on-device OCR (tesseract.js) reads the ID name as an advisory cross-check, and a camera-only **live selfie** is compared to the ID by the CRMC social worker. No PhilSys, no automated biometrics — the social worker always makes the final call.
- Patient Access Code (CRMC-YYYY-NNNNN) is the registration gate. Issued in person by Medical Social Services.

## Out Of Scope (do NOT build)
- PhilSys API integration
- Real money movement (no bank APIs, no payments). Note: monetary *commitments* ARE tracked as data — approved amounts, agency budgets, Guarantee Letter status. MAPA records intent; actual settlement happens off-system between agency and provider.
- SMS notifications (cost not feasible — use email + in-app + future push notifications)
- Embedded video calling (use Google Meet links instead — no Daily.co, Jitsi, or WebRTC integration)
- Donor portal
- Fraud detection engine (manual judgment by social workers)
- Multi-hospital network (CRMC only)
- Real-time IHOMIS integration (use manual case number reference instead)

## Firestore Collections
users, requests, applications, documents, documentContents, documentTypes, assistanceTypes, agencies, hospitalIds, certificates, conversations, notifications/{uid}/items, reports, announcements, auditLog, docReviewPresence

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
- The interview lives on the **request** (CRMC-conducted, one Google Meet). The agency's job is the funding decision only.

## Coding Conventions
- Components in /src/components, pages in /src/pages
- Firestore queries grouped in /src/utils
- All admin actions must call logAudit()
- All notifications use the notify() utility (writes to Firestore + sends email)
- Use Tailwind utility classes; no inline styles
- Patient-facing strings should be ready for i18n (use t('key') pattern when adding new strings)
- When building patient-side features in web, keep them mobile-friendly (touch targets ≥44px, large tap areas, readable font sizes on small screens) — the mobile app will reuse the same Firestore data, so the data model should serve both

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
- (add others as you create them)