# MAPA Security Improvement Plan

**Created:** 2026-09-03. Companion to `docs/threat-model.md`.

`threat-model.md` records the **current** posture: what's addressed (T1–T10,
each with a rule + test) and what's **accepted** (A1–A8) with rationale. This
document is the **forward-looking backlog** — how to close or shrink the
accepted risks and operational limits, prioritized by risk reduction vs
effort. Each item names the threat-model risk it targets.

Priorities: **P0** = do now (hygiene, no infra needed), **P1** = highest risk
reduction, **P2** = hardening, **P3** = process / long-term.

---

## P0 — Immediate (credential hygiene — this week, no Blaze needed)

### 0.1 Rotate the two exposed credentials  — ✅ done (2026-09)
The **Gmail App Password** (`SMTP_PASS`) and the **Semaphore API key**
(`SEMAPHORE_API_KEY`) were typed in plaintext into an assistant chat/terminal
session, so both were treated as **compromised** and **rotated** — regenerated
and updated in Vercel + the Firebase Functions secret. Ongoing hygiene (0.2,
0.3) still applies.

### 0.2 Secret-scan the repo + full history
- Run `gitleaks`/`trufflehog` over the working tree **and** git history; confirm
  no keys, passwords, or service-account JSON were ever committed.
- Add a pre-commit secret-scan hook and a CI secret-scan job so it can't happen.
- Confirm every secret lives only in Vercel env + Firebase Functions
  `defineSecret`, never in tree.

### 0.3 Service-account key custody  → shrinks **A1**
- Inventory who holds the Firebase service-account JSON; move it to a secret
  manager (not laptops / `Downloads/`).
- Use a separate, least-privilege service account for CI vs. operator scripts.
- Rotate on any personnel change (the runbook already calls for this).

---

## P1 — Highest risk reduction

### 1.1 Firebase App Check  → closes "client-side rate limiting only"; hardens **all** Firestore + Function access  — 🟡 live in monitor mode (2026-09-04)
- **Done:** wired in `src/firebase.js` with the **reCAPTCHA Enterprise**
  provider (v3 is deprecated), key in `VITE_APPCHECK_SITE_KEY`, registered in
  the Firebase console. Running in **monitor mode** — verified traffic is
  being logged.
- **Remaining:** watch App Check → Requests for ~a week, then flip **Enforce**
  on Cloud Firestore + Cloud Functions.

Rules verify *who* you are, not *what app* you're calling from — a valid token
minted by a script still passes rules. App Check attests the request comes from
the genuine app (reCAPTCHA Enterprise on web, Play Integrity / DeviceCheck on
mobile) and is enforced at the Firestore + Cloud Functions layer.
- **Single biggest leverage** against scripted/automated abuse (enumeration,
  spam writes, throttle-bypass attempts).
- reCAPTCHA Enterprise has a free tier adequate for pilot volume.

### 1.2 MFA for all non-patient roles  → closes **A2**  — 🟢 shipped, voluntary enrolment (2026-09-04)
Enable Firebase Auth **MFA (TOTP)** via Identity Platform for `super_admin`,
`staff_admin`, `agency_admin`, and `agency`. A stolen staff password alone no
longer grants access to patient PII or funding controls.
- Patients stay exempt (indigent, phone-primary — the friction isn't worth it
  for the lowest-trust role that only sees its own data).
- **Done:** TOTP enabled on the project (Identity Platform Admin API); code in
  `src/utils/mfa.js` + `MfaEnrollModal` (enrol / verify-email / remove) + the
  login TOTP challenge + a "Two-step verification" entry in the staff profile
  menu. `MFA_MODE = 'prompt'` — enrolment is available but not force-gated, so
  no staff can be locked out during rollout. Verified working end to end.
- **Remaining:** once staff have enrolled, flip `MFA_MODE` to `'required'` to
  hard-gate staff access.

### 1.3 Session timeout + re-auth for sensitive actions  → closes **A2**
- Idle timeout for staff sessions (e.g. 30–60 min).
- Require **recent re-authentication** before destructive/elevated actions:
  account create/delete, role change, agency budget change, marking a GL
  redeemed, and any patient-data export.

### 1.4 Tamper-evident audit log  → shrinks **A1**
Make audit tampering *detectable* even though a `super_admin` can't be fully
prevented:
- Hash-chain entries — a Cloud Function stamps each `auditLog` write with
  `hash(prevHash + entry)`; any later delete/edit breaks the chain.
- Periodically export the chain to a **retention-locked GCS bucket** (or
  BigQuery) for an immutable off-system copy.

---

## P2 — Hardening

### 2.1 Dedicated staging environment  → closes "no staging"
A separate `mapa-staging` Firebase project for dev/test + preview deploys, so
dev work and rules/migration testing never touch production patient data.

### 2.2 Move documents to Cloud Storage  → reduces PII exposure
Migrate `documentContents` from base64-in-Firestore to Cloud Storage with
rules-gated access + short-lived **signed URLs** (code already exists, dormant).
Smaller Firestore surface, per-object ACLs, expiry, and no ~700 KB cap.

### 2.3 Security headers + CSP (Vercel)  — 🟡 partially shipped (2026-09-03)
Add via `vercel.json`: a Content-Security-Policy, `Strict-Transport-Security`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
and `Permissions-Policy`. Limits XSS blast radius + clickjacking.
- **Done:** HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff,
  Referrer-Policy, and Permissions-Policy (camera=(self) so the ID selfie
  keeps working) are live. CSP ships in **Report-Only** mode.
- **Remaining:** watch the browser console for CSP violations on real flows
  (selfie/OCR worker, Firebase, fonts, agency logo URLs), tighten, then flip
  `Content-Security-Policy-Report-Only` → `Content-Security-Policy`. Replacing
  `script-src 'unsafe-inline'` with a nonce is the follow-up hardening.

### 2.4 Rules-deploy gate in CI  → closes "manual rule deploy"  — 🟢 live & proven (2026-09-06)
A CI job that runs the rules tests and (on `main`) deploys `firestore.rules`
via a service account, so production rules can't silently drift from the
tested state or be forgotten after a change.
- **Done + activated:** `.github/workflows/deploy-rules.yml`; the
  `FIREBASE_SERVICE_ACCOUNT` secret is set. **Proven in production 2026-09-06** —
  the `amountApproved` cap (#195) was tested by the gate and auto-deployed on
  merge. Rules no longer require a manual `firebase deploy`.

### 2.5 Harden the Vercel API functions
For `send-email` / `send-sms`: verify the `jose` token strictly (audience +
issuer), add per-uid rate limiting, validate/escape all interpolated content,
cap sizes, and forbid user-controlled recipients/headers — so neither can be
turned into an open email/SMS relay.

---

## P3 — Process & long-term

### 3.1 Dependency / supply-chain scanning  — 🟡 partially shipped (2026-09-03)
Enable Dependabot + `npm audit` (web **and** `functions/`) in CI; review the
`jose` / `nodemailer` / `qrcode` / `firebase` pins.
- **Done:** `.github/dependabot.yml` — weekly npm updates for `/` and
  `/functions` (minor/patch grouped, majors individual) + github-actions; and a
  non-blocking `npm audit --audit-level=high` CI step over both trees (#186).
- **Noted:** the functions deploy warns `firebase-functions` is outdated;
  upgrading has breaking changes, so it's a deliberate scoped task (Dependabot
  will also surface it), not urgent.

### 3.2 RA 10173 program: retention + breach response  — 🟡 partially shipped (2026-09-03)
Define a data retention/erasure schedule; document breach response in the
runbook (rotate creds, revoke sessions, **NPC notification within 72 h**);
confirm consent + DPO coverage.
- **Done:** `docs/incident-response-runbook.md` — the five-phase breach
  response, the 72-hour NPC + data-subject notification with its three
  mandatory conditions, incident-record + notice templates, and a retention
  schedule table.
- **Remaining (CRMC decisions):** appoint + register a **DPO**, register the
  processing system with the NPC, and set the actual **retention durations**
  in the runbook's schedule.

### 3.3 Provenance tagging for client- vs server-written strings  → closes **A8**
Tag `auditLog` / `notifications` entries with a server-set `source` flag so a
human or AI reviewer can tell user-controlled text apart from system text —
extends the T2 mitigation to the whole class.

### 3.4 Recurring security review
Run `/code-review` + `/security-review` on every PR touching `firestore.rules`,
`functions/`, or auth; re-review `threat-model.md` each milestone; commission a
third-party pen test before full-scale (multi-hospital) rollout.

---

## Suggested sequencing
| When | Items |
|------|-------|
| **This week** | P0 (0.1 rotate, 0.2 scan, 0.3 key custody) — pure hygiene |
| **Sprint 1** | 1.1 App Check + 1.2 MFA (largest risk cut) |
| **Sprint 2** | 1.3 session/re-auth, 1.4 audit hash-chain, 2.4 rules CI gate |
| **Ongoing** | 2.x hardening, P3 process |

## Decisions needed (from CRMC / the owner)
- **Blaze budget** confirmation for Identity Platform (MFA), App Check
  (reCAPTCHA Enterprise free tier likely enough), and a staging project.
- Which staff roles get **mandatory** vs optional MFA.
- The **retention period** CRMC wants for patient records + uploaded documents.

## How this document evolves
- Move an item into `threat-model.md`'s **T-table** once its mitigation ships
  with a test; strike it here.
- Re-prioritize at each milestone with pilot stakeholders.
