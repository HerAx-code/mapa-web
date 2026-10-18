# Session Timeout + Terms of Use — plan

**Status:** proposed · **Created:** 2026-10-18 · **Owner:** proponent + CRMC

Two related security/compliance features for the production system: an **idle
session timeout** (already the next planned security item — see
`docs/security-improvement-plan.md` §1.3 and `docs/threat-model.md`) and a
**minimal Terms of Use** acceptance gate. Both are shaped by MAPA's reality:
sensitive medical PII under **RA 10173**, staff who view many patients' records
on potentially shared office machines, and **indigent, low-literacy patients on
personal phones** for whom friction is a real harm, not a nuisance.

The guiding split, kept throughout: **tighten security on staff; protect the
patient experience.**

---

## Part 0 — What already exists (don't rebuild)

- **Auth:** `src/contexts/AuthContext.jsx` exposes `{ user, login, logout, updateUser }`; `logout = () => signOut(auth)`; `user.role` is available. Staff detection: `isCrmcAdminRole(role)` (super_admin + staff_admin) and `isAgencyRole(role)` from `src/utils/constants.js`; patients are `ROLES.PATIENT`.
- **MFA:** TOTP for staff is live (Identity Platform). Session timeout is the explicit *next* item after MFA in the security plan.
- **Privacy / consent:** a full **Privacy Notice** (landing + `profile.privacy`, RA 10173), a registration **declaration** ("I certify this is true"), and **selfie consent** already exist. So the data-privacy consent that RA 10173 actually requires is **already handled** — the Terms of Use below is about *use terms and expectation-setting*, not data-privacy consent.
- **i18n:** every patient-facing string is bilingual (en/fil) via `src/i18n`; staff surfaces are English-only by design.

---

## Part 1 — Research: how professionals do it

### Session / idle timeout
- **OWASP** (Session Management Cheat Sheet / WSTG): every app should have an **idle timeout** tuned to data sensitivity, **and** an **absolute timeout** that fires regardless of activity (caps how long a hijacked session is useful). Example "secure default" cited: **~20 min idle / ~8 h absolute**. High-value apps use 2–5 min idle; low-risk 15–30 min; **15 min** is the classic home-banking example. Users must always be able to **log out immediately**.
- **NIST SP 800-63B (AAL2):** ~1 h inactivity, ~24 h absolute (reference points for a *moderate*-assurance system).
- **Healthcare (HIPAA "automatic logoff", 45 CFR §164.312(a)(2)(iii)):** **no fixed value mandated** — it's risk-based/addressable — but common guidance is **5–15 min** for PHI on shared workstations, layered (screen lock → app inactivity → full logout). A screen-lock that doesn't force **re-authentication** does **not** satisfy it.
- **UX norm:** **warn before logging out** (a short countdown modal with "Stay signed in"), and sync logout **across browser tabs**.

### Terms of Use acceptance (clickwrap)
- Record **per-acceptance**: **who** (user id), **when** (timestamp), and **which version** of the terms. Versioning is the most-missed element.
- Require **explicit assent** — a deliberate action (ticking an **un-checked** box). Pre-checked boxes and "continued use = consent" are routinely held unenforceable.
- Give users a **fair chance to review** before accepting.
- **Re-prompt for fresh consent when the terms change** (link each acceptance to the version in force).

*(Sources at the bottom. These are industry/standards references, not legal advice — the actual legal wording of the Terms should be reviewed by CRMC/counsel.)*

---

## Part 2 — Feature A: idle session timeout (staff-scoped)

### Decisions
| Question | Decision | Why |
|---|---|---|
| Who | **Staff only** (super_admin, staff_admin, agency, agency_admin). **Patients exempt.** | Staff view many patients' PII on shared office machines; patients are on personal phones and auto-logout punishes the vulnerable users MAPA exists to serve. Matches the security plan's staff scope. |
| Idle timeout | **15 min** (configurable) | Health-adjacent PII on shared workstations → stricter than the plan's initial "30–60 min" placeholder; aligns with HIPAA 5–15 min guidance and OWASP's banking example. Configurable so CRMC can relax to 20–30 if field use shows it's too aggressive. |
| Warning | **Countdown modal ~90 s before expiry**: "You'll be signed out for inactivity. **Stay signed in**." | OWASP/UX norm; prevents losing work mid-assessment. |
| Absolute timeout | **~10 h** (a work shift + margin), configurable | Caps a hijacked/forgotten session regardless of activity (OWASP). |
| Manual logout | Already present; keep instant. | OWASP: always allow immediate logout. |
| Re-auth for sensitive actions | **Phase 2 (optional):** re-prompt password/MFA before GL issuance / approval reversal. | Defense-in-depth; not required for v1. |

Patients: **no idle timeout**. (Optional later: a *long* absolute cap only, e.g. 24 h, with no idle component — decide with CRMC; default is none.)

### Design
- **`SessionTimeoutProvider`** (new, `src/components/SessionTimeoutProvider.jsx`) mounted once inside the authenticated app shell (e.g. in `Layout` or `App` under `AuthProvider`). It is a **no-op for patients and logged-out users** — it reads `user.role` and only arms for staff.
- **Idle detection:** a throttled listener on `mousemove`, `keydown`, `click`, `scroll`, `touchstart`, and `visibilitychange`; each resets a "last activity" timestamp. A single `setInterval` (every ~15–30 s) compares `now − lastActivity` against the idle threshold rather than a pile of `setTimeout`s (cheaper, drift-free).
- **Warning stage:** when `idle ≥ (threshold − 90 s)`, show the countdown modal; any activity or "Stay signed in" dismisses it and resets.
- **Expiry:** call `logout()` (from `AuthContext`), then redirect to `/login?reason=timeout` so the login page can show a calm bilingual "You were signed out for inactivity" notice (EN only is fine since this is a staff surface, but the login page is shared — use the existing i18n).
- **Absolute timeout:** store `loginAt` (ms) in `sessionStorage` at login; the same interval also logs out when `now − loginAt ≥ absolute`.
- **Cross-tab sync:** broadcast activity/logout via a `BroadcastChannel('mapa-session')` (fallback: a `localStorage` "ping" key). One tab's logout logs out the others; activity in one tab keeps the others alive.
- **Don't interrupt work:** the intake sheet already auto-saves (agency/patient intake); still, the 90 s warning gives a save window. Typing/scrolling counts as activity, so an operator actively reading/working won't be logged out — only true inactivity triggers it.
- **Config:** add `SESSION_IDLE_MS`, `SESSION_WARN_MS`, `SESSION_ABSOLUTE_MS` to `src/utils/constants.js` (or `src/config/org.js` if a deployment should tune them via env). Patients map to "disabled."
- **PWA/offline:** timers are client-side and keep working offline; on expiry while offline, `signOut` clears local state and the next load lands on login.

### Firestore / backend
- **None required.** This is a client-side inactivity control; Firebase ID tokens already auto-refresh (~1 h) independently. A *true* server-enforced absolute session would need token-revocation plumbing — **out of scope for v1** (note it as a residual, same framing the threat model already uses).

### Testing
- Component test (`tests/components/`) with fake timers: arms for a staff role, not for a patient; fires the warning at T−90 s; "Stay signed in" resets; expiry calls `logout`; absolute cap fires independent of activity.

### Effort / risk
- **Effort:** S–M (one provider + hook + modal + constants + one test). **Risk:** Low — additive, staff-only, no data-model or rules change. Reversible (unmount the provider).

---

## Part 3 — Feature B: Terms of Use (minimal, bilingual)

### Decisions
| Question | Decision | Why |
|---|---|---|
| Form | **Clickwrap** — an **un-checked** checkbox + a readable Terms modal, at **registration**. | Explicit assent is the enforceability bar; pre-checked/implied consent fails. |
| Audience & length | **Short, plain-language, bilingual (EN/FIL).** A one-screen summary with the full text in a scrollable modal. | Indigent, low-literacy patients — a wall of legalese undercuts the "short form, staff can help you" promise. |
| What it covers | Expectation-setting, **not** data privacy (that's the existing Privacy Notice). | The RA 10173 consent already exists; Terms adds *use* terms. |
| Record | `users.{ termsVersion, termsAcceptedAt }` written at acceptance. | Research: store **who + when + which version**. |
| Versioning | A `TERMS_VERSION` constant; on bump, **re-prompt existing users** at next login via a blocking gate. | Fresh consent on change. |
| Access | Linked from the landing footer and `profile` (view anytime). | Fair chance to review. |

### Content outline (the actual Terms — draft for CRMC/counsel to finalize)
Keep to ~6 short points, each one line, bilingual:
1. **What MAPA is** — a portal to apply for medical financial assistance through {{gateway}}; it records and routes requests, it does not itself pay.
2. **Assistance is not guaranteed** — approval, amount, and timing depend on each agency's decision, budget, and available slots.
3. **No fees, ever** — MAPA/{{gateway}} never charge for registration, access codes, or releasing a Guarantee Letter; report anyone who asks for payment.
4. **Accurate information** — you confirm the information and documents you submit are true; false information may void assistance. *(Mirrors the existing declaration.)*
5. **Your data** — handled under the Privacy Notice (RA 10173) — link to it.
6. **Acceptable use** — one active request at a time; don't impersonate others or misuse the system.

### Design
- **`TERMS_VERSION`** constant (e.g. `'2026-10-18'`) in `src/utils/constants.js`.
- **i18n:** a `terms.*` namespace (en + fil) for the modal content + checkbox label.
- **Registration gate:** add the checkbox to the final `Register` step (`src/pages/auth/Register.jsx`), next to the existing declaration; block submit until ticked. On account creation, write `termsVersion: TERMS_VERSION, termsAcceptedAt: serverTimestamp()` onto the `users/{uid}` doc.
- **Existing-user re-accept gate:** a small `TermsGate` mounted in the authenticated shell — if `user.termsVersion !== TERMS_VERSION`, show a blocking modal ("Our terms have been updated — please review and accept to continue") with Accept → `updateUser({ termsVersion, termsAcceptedAt })`. Patients and staff both see it (it's quick and one-time per version).
- **Footer/profile link:** reuse the existing Privacy Notice modal pattern for a "Terms of Use" entry.

### Firestore rules
- The `users/{userId}` self-update rule (`firestore.rules` line 68) already allows a user to update their own doc as long as `role`/`agencyId`/`active`/`rank` are byte-identical (role-escalation guard). Adding `termsVersion` (string) + `termsAcceptedAt` (timestamp) fields is allowed by that rule **as-is** — **verify** with a rules test that a self-write of just these two fields passes and that they can't be used to smuggle a role change (they can't — the guard checks the sensitive fields regardless of what else changes). Add a focused `tests/rules/` case.

### Testing
- Component: registration submit is blocked until the box is ticked; `TermsGate` shows when `termsVersion` is stale and clears on accept.
- Rules: self-write of `{termsVersion, termsAcceptedAt}` allowed; a piggybacked `role` change still denied.
- i18n: `npm run lint:i18n` stays clean (new strings use `t()`).

### Effort / risk
- **Effort:** M (content + i18n + registration gate + re-accept gate + rules test). **Risk:** Low–Med — touches the registration path and a (permissive) rules path; gate behind the version check so it's inert until `TERMS_VERSION` is set and the content is approved.

---

## Part 4 — Sequencing & open questions

**Recommended order:**
1. **Staff idle timeout** — it's the already-planned security item, self-contained, no legal dependency. Ship first.
2. **Terms of Use** — needs CRMC/counsel to approve the wording first; build the gate in parallel, flip it on once the text is final.

**Open questions for the owner (CRMC):**
- Idle timeout **value** for staff — start at **15 min** (recommended) or the plan's **30 min**? And absolute cap (**10 h**?).
- Do patients get **any** cap (default: none)?
- Phase-2 **re-auth** before GL issuance / approval reversal — wanted?
- Who **drafts/approves** the Terms wording, and the **version-bump** policy (who decides a change needs re-acceptance)?
- Terms acceptance for **existing** users — one-time blocking gate at next login (recommended) vs. a dismissible banner?

**Success criteria:** no staff session stays alive indefinitely on an unattended machine; a hijacked/forgotten session is capped; every account has an auditable `{termsVersion, termsAcceptedAt}`; **patient UX is unchanged** (no new friction on the patient phone path beyond one registration checkbox).

---

## Sources
- OWASP WSTG — Testing for Session Timeout: https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/06-Session_Management_Testing/07-Testing_Session_Timeout
- OWASP Periodic Table — Insufficient Session Expiration (idle/absolute defaults): https://owasp.org/index.php/OWASP_Periodic_Table_of_Vulnerabilities_-_Insufficient_Session_Expiration
- Session-timeout value ranges + NIST SP 800-63B summary: https://mojoauth.com/glossary/session-timeout
- HIPAA automatic logoff requirements & practice: https://www.accountablehq.com/post/hipaa-automatic-logoff-requirements-and-best-practices
- HIPAA technical safeguards — automatic logoff: https://censinet.com/perspectives/hipaa-technical-safeguards-automatic-logoff-explained
- Clickwrap enforceability & acceptance records (who/when/version): https://www.sirion.ai/library/contract-management/clickwrap-agreement
- Clickwrap versioning / re-consent on change: https://ironcladapp.com/
