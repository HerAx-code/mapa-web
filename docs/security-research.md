# MAPA Security Research & Implementation Reference

**Created:** 2026-09-03. Companion to `docs/threat-model.md` (current posture)
and `docs/security-improvement-plan.md` (prioritized backlog).

This document is the **research-grounded "why and how"**: the security
principles MAPA should be measured against, what a *proper* implementation of
each control looks like on our exact stack (Firebase + Firestore rules +
Cloud Functions + Vercel), and how to integrate it. Sources are cited inline
and collected at the end.

---

## 1. Core principles (and how MAPA already applies them)

Security is not a feature list; it's a set of principles applied consistently.
The five that matter most for MAPA:

| Principle | What it means | Where MAPA already does it / where to extend |
|-----------|---------------|-----------------------------------------------|
| **Deny by default / least privilege** | Grant only the access each role needs; everything not explicitly allowed is denied. | `firestore.rules` denies by default; roles (`patient` < `agency` < `agency_admin` < `staff_admin` < `super_admin`) each see only their own scope. **Extend:** per-key least privilege for secrets; scoped service accounts. |
| **Defense in depth** | Never rely on one control. Layer rules + server logic + monitoring. | T9 stacked *three* layers (PII off the public doc → per-uid throttle → per-IP throttle). **Extend:** App Check as an app-attestation layer *beneath* the rules. |
| **Complete mediation / never trust the client** | The server re-checks every request; client-side checks are UX only. | Rules are the authoritative gate; Cloud Functions enforce integrity the rules can't (`syncRequestFinancials`). **Extend:** move remaining "client-side lazy" jobs behind functions. |
| **Fail secure** | On error, deny / degrade safely — never fall open. | Booking uses a `status=='open'` compare-and-set so a lost race denies rather than double-books. **Watch:** the storage `try/catch` fixes (PR #170) are this principle — an exception must not crash the shell *or* silently grant. |
| **Secure by design** | Security decided at design time, not bolted on. | The co-funding model keeps CRMC as the single verification gateway; agencies never re-handle documents. **Extend:** threat-model review at each milestone (already the doc's closing note). |

These map directly onto the two new-for-2025 OWASP categories below, so the
principles aren't abstract — they're the current consensus root causes.

---

## 2. OWASP Top 10 (2025) mapped to MAPA

The 2025 list is led by **Broken Access Control**, moves **Security
Misconfiguration** to #2, and adds **Software Supply Chain Failures** and
**Mishandling of Exceptional Conditions** as new categories; SSRF folds into
Broken Access Control ([OWASP Top 10:2025](https://owasp.org/Top10/2025/),
[Outpost24](https://outpost24.com/blog/owasp-top-10-2025-what-changed/)).

| OWASP 2025 risk | MAPA status | Action (→ plan item) |
|-----------------|-------------|----------------------|
| **A01 Broken Access Control** | **Strong.** Rules + tests cover T1–T10; role checks, cross-tenant writes, field locks. | Keep the rules-test discipline; add App Check so a valid token from a *non-app* origin still can't call (→ P1.1). |
| **A02 Security Misconfiguration** | **Gap.** No CSP/security headers; rules deployed manually; shared prod/dev project. | CSP + headers (→ P2.3), rules-deploy CI gate (→ P2.4), staging project (→ P2.1). |
| **A03 Software Supply Chain Failures** *(new)* | **Gap.** No dependency scanning. | Dependabot + `npm audit` in CI, pinned deps (→ P3.1). |
| **A04 Cryptographic / sensitive-data exposure** | **Partial.** TLS everywhere; documents are base64-in-Firestore (broad read surface). | Move documents to Storage + signed URLs (→ P2.2). |
| **A05 Injection** | **Low.** No SQL; Firestore is parameterized; React escapes output. | Keep escaping user content in `send-email`/`send-sms` bodies (→ P2.5). |
| **A07 Authentication failures** | **Gap.** No MFA, no session timeout. | MFA for staff + session/re-auth (→ P1.2, P1.3). |
| **A09 Logging/monitoring failures** | **Partial.** `auditLog` exists but is not tamper-evident. | Hash-chain + immutable export (→ P1.4). |
| **Mishandling of Exceptional Conditions** *(new)* | **Improved.** The unguarded-storage crashes (PR #170) were exactly this class. | Continue: every external/`storage`/parse call is `try/catch`ed and fails secure. |

---

## 3. Implementation deep-dives

### 3.1 Firebase App Check — attest the *app*, not just the user

**The gap it closes.** Firestore rules answer *"is this user allowed?"* — but a
valid ID token minted by a script (or a stolen token replayed from `curl`)
still passes the rules. App Check adds a second question the rules can't:
*"did this request come from our genuine app?"* It's the single biggest lever
against scripted enumeration and spam-write abuse
([Firebase App Check](https://firebase.google.com/docs/app-check)).

**Proper implementation:**
- **Providers:** reCAPTCHA Enterprise on web; Play Integrity (Android) /
  App Attest (iOS) when the mobile app ships
  ([provider guidance](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)).
- **Roll out in monitoring mode first.** Register the site key, ship the SDK,
  and watch the verified-vs-unverified ratio for **at least a week** before
  clicking *Enforce* — otherwise you lock out real users mid-session
  ([best-practice writeup](https://medium.com/@himanshusharma_4140/firebase-app-check-stopping-abuse-before-it-costs-you-dac096fbd64c)).
- **Enforce on Firestore *and* Cloud Functions** (and Storage once documents
  migrate). Set a sensible risk threshold — never 0.0 or 1.0.
- **Cost:** reCAPTCHA Enterprise is free for **10,000 assessments/month**,
  ample for pilot volume.

**MAPA integration:**
- Add the App Check SDK to `src/firebase.js` init, guarded so local dev uses a
  **debug token** (the CI/E2E suite and Playwright need debug tokens or they'll
  be blocked).
- The **anonymous-sign-in** flow used for access-code verification (T9) still
  gets an App Check token, so the per-IP/per-uid throttle now sits *behind*
  app attestation — the `signInAnonymously` loop bypass is even harder.
- Verify the App Check token inside `verifyAccessCode` / `send-email` /
  `send-sms` before doing work.

### 3.2 Multi-factor authentication for staff (Identity Platform, TOTP)

**The gap it closes.** A02/A07 + threat-model **A2**: a stolen `agency_admin`
or `super_admin` password today grants full access. MFA makes the password
alone insufficient.

**Proper implementation** ([Firebase MFA](https://firebase.google.com/docs/auth/web/multi-factor),
[Identity Platform TOTP](https://docs.cloud.google.com/identity-platform/docs/admin/enabling-totp-mfa)):
- Requires upgrading Firebase Auth to **Identity Platform** (Blaze).
- Use **TOTP** (authenticator app) as the second factor — no per-SMS cost, works
  offline, stronger than SMS OTP.
- **Prerequisite: a verified email on every MFA user.** Identity Platform
  requires it, and it prevents the "attacker registers with an email they don't
  own, then adds a factor to lock out the real owner" attack.
- Modular JS SDK **≥ v9.19.1**. Note phone-auth and anonymous-auth **cannot**
  carry MFA — which is fine: MFA targets the **email/password staff logins**,
  not the anonymous access-code flow.

**MAPA integration — role-targeted enrollment:**
- MAPA reads role from `/users/{uid}`. Gate the app so that on first login a
  user whose role ∈ {`super_admin`, `staff_admin`, `agency_admin`, `agency`}
  is routed into TOTP enrollment before reaching their dashboard; patients skip
  it (lowest-trust, phone-primary, own-data-only).
- Enforce **verified email** for those roles at account creation (the
  `super_admin`/`agency_admin` creation paths).
- Add a re-enrollment/reset path in `ProfileModals` (lost device).

### 3.3 Firestore Security Rules — reinforce the principles MAPA already follows

MAPA's rules are already strong; the research confirms the pattern and points
at two refinements
([Firebase get-started](https://firebase.google.com/docs/firestore/security/get-started),
[user-based access control](https://oneuptime.com/blog/post/2026-02-17-how-to-write-firestore-security-rules-for-user-based-access-control/view)):

- **Rules are the last line of defense against malformed data** — keep
  validating types, required fields, value ranges, and enum membership on every
  write (MAPA does this: size caps, status enums, byte-identical budget
  round-trips). This is A01's core defense.
- **Consider custom claims for role checks.** MAPA currently resolves role by
  `get(/users/$(uid)).data.role` inside rules — correct, but it costs a
  document read per evaluation and depends on the `users/update` rule fully
  locking the `role` field. The documented best practice for RBAC is a
  **custom claim in the ID token** (`request.auth.token.role`), set only via the
  admin SDK — faster (no extra read) and unforgeable by the user. Worth a
  scoped migration; until then, **audit that `users/update` cannot change
  `role` except by an admin** (this is the companion lock to T1's create rule).
- **Test rules in CI** — MAPA already runs `tests/rules/` in GitHub Actions;
  the P2.4 gate makes that a *deploy* gate too, so prod rules can't drift from
  tested state.

### 3.4 Secrets management & rotation

Grounded in the [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
and [GitGuardian](https://blog.gitguardian.com/secrets-api-management/):

- **Never commit secrets** — env vars or a secret manager only; scan history to
  be sure. (MAPA keeps secrets in Vercel env + Firebase `defineSecret`; verify
  none leaked to git — P0.2.)
- **Least privilege per key** — one all-powerful key is a liability. The Gmail
  **App Password** is broad; prefer a dedicated `no-reply@` sender account whose
  compromise can't touch a person's inbox. Scope the Semaphore key to sending.
- **Dual-phase rotation every 30–90 days** — stage the new credential, cut over,
  *then* revoke the old, so there's no downtime. Automate where possible.
- **Immediate rotation on exposure** — the SMTP + Semaphore values entered in a
  chat session must be rotated now (P0.1); treat any pasted secret as burned.
- Encrypt at rest and in transit (Firebase/Vercel already do).

### 3.5 Cloud Functions / API-route hardening

- **Verify App Check + the Firebase ID token** (`jose`, checking issuer +
  audience) at the top of `send-email`, `send-sms`, and every callable.
- **Rate-limit** these endpoints per-uid (they can otherwise be an open
  email/SMS relay). MAPA already throttles `verifyAccessCode`; extend the
  pattern.
- **Validate and escape all interpolated content**; forbid user-controlled
  recipients/headers; cap payload sizes.
- Keep functions **idempotent** and **fail-secure** (deny on any doubt).

---

## 4. RA 10173 (Data Privacy Act) — proper compliance integration

MAPA processes **sensitive personal information** (health + financial), so the
Act's stricter duties apply.

**Data-privacy principles** to design to: transparency, legitimate purpose,
and **proportionality** (collect only what the intake actually needs — MAPA's
"don't invent fields CRMC doesn't use" rule is exactly this).

**Security measures** the NPC expects — organizational, physical, **and
technical** ([Linklaters PH](https://www.linklaters.com/en/insights/data-protected/data-protected---philippines),
[NPC Circular 16-03](https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf)):
- A **Data Protection Officer** appointed; qualifying processing systems
  **registered** with the NPC.
- A written **data-protection & incident-management policy**, plus an **annual
  report** summarizing incidents/breaches.
- Technical measures: access control (✓ rules), encryption in transit (✓),
  audit logging (✓ — strengthen to tamper-evident), and a documented breach
  procedure.

**Breach notification — the 72-hour rule.** The controller must notify **both
the NPC and affected data subjects within 72 hours** of knowledge of, or
reasonable belief in, a breach. It is **mandatory** when three conditions hold
together: (1) sensitive personal info (or data enabling identity fraud) is
involved, (2) an unauthorized person acquired it, and (3) it is likely to cause
**serious harm**. There must be **no delay** where ≥ 100 data subjects are
affected. Delay is permitted only to scope the breach, prevent further breaches,
and secure the system
([NPC Circular 16-03](https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf),
[Recording Law guide](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/philippines-data-privacy-laws/)).

**MAPA integration (→ plan P3.2):** add a **breach-response runbook** — detect
→ contain (rotate creds, revoke sessions) → assess against the 3 conditions →
notify NPC + subjects within 72 h → document. Define a **retention/erasure
schedule** for patient records and uploaded documents (MAPA already implements
RA 10173 §16(e) erasure via `deleteAuthUser`; retention *duration* is the
open policy decision CRMC must set).

---

## 5. How this integrates into MAPA — the throughline

Everything above reduces to layering four new controls under the strong access
model MAPA already has, in dependency order:

1. **Hygiene now (no Blaze):** rotate exposed secrets, scan history, lock
   service-account custody, add CSP/headers, add the rules-deploy CI gate.
2. **App Check (monitor → enforce):** one attestation layer under all Firestore
   + Function access — the biggest single risk cut, largely free.
3. **MFA + session/re-auth for staff:** kills the stolen-password path, the
   most likely real breach today.
4. **Tamper-evident audit + breach runbook + retention policy:** makes insider
   action detectable and makes the RA 10173 duties operational.

Each shipped control graduates from the improvement plan into a **T-entry** in
`threat-model.md` with a test — the same discipline that already closed T1–T10.

---

## Sources
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) · [What changed (Outpost24)](https://outpost24.com/blog/owasp-top-10-2025-what-changed/)
- [Firebase App Check](https://firebase.google.com/docs/app-check) · [reCAPTCHA Enterprise provider](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider) · [App Check best practices](https://medium.com/@himanshusharma_4140/firebase-app-check-stopping-abuse-before-it-costs-you-dac096fbd64c)
- [Firebase MFA (web)](https://firebase.google.com/docs/auth/web/multi-factor) · [Identity Platform TOTP MFA](https://docs.cloud.google.com/identity-platform/docs/admin/enabling-totp-mfa) · [Working with MFA users](https://docs.cloud.google.com/identity-platform/docs/work-with-mfa-users)
- [Cloud Firestore Security Rules — get started](https://firebase.google.com/docs/firestore/security/get-started) · [User-based access control](https://oneuptime.com/blog/post/2026-02-17-how-to-write-firestore-security-rules-for-user-based-access-control/view)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) · [API key management (GitGuardian)](https://blog.gitguardian.com/secrets-api-management/)
- [RA 10173 — NPC Circular 16-03 (breach management)](https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf) · [Data Protected: Philippines (Linklaters)](https://www.linklaters.com/en/insights/data-protected/data-protected---philippines) · [PH Data Privacy guide (Recording Law)](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/philippines-data-privacy-laws/)
