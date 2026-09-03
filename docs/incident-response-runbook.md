# MAPA Incident Response & Data-Breach Runbook

**Created:** 2026-09-03. Implements security-improvement-plan **P3.2** and the
RA 10173 duties documented in `security-research.md §4`. Companion to
`docs/runbook.md` (operations) and `docs/threat-model.md`.

This is the step-by-step to follow **when a security incident or personal-data
breach is suspected or confirmed** — MAPA holds *sensitive personal
information* (health + financial), so the Data Privacy Act's stricter duties
apply, including the **72-hour notification clock**.

---

## 0. Roles

| Role | Responsibility in an incident |
|------|-------------------------------|
| **Data Protection Officer (DPO)** | Owns the response; decides on and files NPC + data-subject notifications; keeps the incident record. *(Appoint one — RA 10173 requirement; NPC registration.)* |
| **System owner / `super_admin`** | Executes containment (rotate creds, revoke sessions, deploy rules, pull backups). |
| **CRMC Malasakit lead** | Coordinates patient-facing communication and paper-trail cross-checks. |

Keep an out-of-band contact list (phone, not just email — email may be the
compromised channel).

---

## 1. The five phases

### Phase 1 — Detect & triage
Triggers: an anomaly in `auditLog`, a report from a user/agency, an unexpected
spike in writes or notifications, a leaked credential, or a failed-login
pattern. **Record the time of discovery** — the 72-hour clock (Phase 4) starts
at *knowledge of, or reasonable belief in,* a breach.

### Phase 2 — Contain (stop the bleeding)
Do the applicable actions immediately; log each with a timestamp.

- **Leaked credential / API key** → rotate now (dual-phase): SMTP (Gmail App
  Password), `SEMAPHORE_API_KEY`, and the **Firebase service-account key** if
  it may be exposed. See `security-improvement-plan.md P0.1`.
- **Compromised user account** → disable it: set `users/{uid}.active = false`
  **and** disable the Firebase Auth account (`admin.auth().updateUser(uid,
  { disabled: true })`), then **revoke its sessions**
  (`admin.auth().revokeRefreshTokens(uid)`), forcing re-login everywhere.
- **Compromised `super_admin` / service account** → rotate the service-account
  key, review its recent `auditLog`, and (if needed) revoke refresh tokens
  for all elevated users.
- **Exploited rule/permission** → tighten `firestore.rules`, add a rules test
  reproducing the hole, and `firebase deploy --only firestore:rules`.
- **Planted/adversarial data** (cf. T2) → purge with a targeted script in the
  mould of `scripts/cleanup-injection-audit.js`.
- **Before any destructive cleanup**, snapshot evidence:
  `node scripts/export-firestore.js` (backup) so the incident record and any
  later forensics survive.

### Phase 3 — Assess (is it a *notifiable* breach?)
Under NPC Circular 16-03, notification to the NPC **and** affected data
subjects is **mandatory when all three hold together**:
1. the breach involves **sensitive personal information** (or data that could
   enable identity fraud) — MAPA's patient records qualify;
2. an **unauthorized person acquired** the information; and
3. the acquisition is **likely to cause serious harm**.

There must be **no delay** where **≥ 100 data subjects** are affected or where
disclosure will clearly harm the subject. Delay is permitted *only* to scope
the breach, prevent further breaches, and secure the system.

Write down: what data, how many subjects, which fields (esp. sensitive), the
window of exposure, and whether the 3 conditions are met.

### Phase 4 — Notify (within 72 hours)
If Phase 3 says notifiable, **within 72 hours of discovery** notify:
- **The National Privacy Commission** — via the NPC's breach-notification
  channel. Include: nature of the breach, the sensitive PII involved, the
  (approx.) number of affected subjects, the measures taken to address it, and
  DPO contact details.
- **The affected data subjects** — in clear language (bilingual for patients):
  what happened, what information was involved, what you're doing about it,
  what they should do (e.g. reset password, watch for fraud), and how to reach
  the DPO. Templates below.

### Phase 5 — Document & review
- Complete the **incident record** (template below) and retain it.
- Add the attack class to `threat-model.md` (a new T-entry + a rules/functions
  test if applicable) so the same hole can't reopen.
- Feed corrective actions back into `security-improvement-plan.md`.
- Include the incident in the **annual summary of security incidents** filed
  with the NPC.

---

## 2. Templates

### 2a. Incident record (keep for every incident)
```
Incident ID:            INC-YYYY-NNN
Discovered (date/time): __________  (start of the 72h clock)
Discovered by:          __________
Summary:                __________
Data involved:          __________  (fields; is any sensitive PII?)
Subjects affected:      __________  (count)
3 notifiable conditions met? (Y/N, with reasoning)
Containment actions (with timestamps): __________
NPC notified?  (date/time, reference): __________
Subjects notified? (date/time, method): __________
Root cause:             __________
Corrective actions / new tests: __________
Closed (date):          __________
```

### 2b. Data-subject notice (patient) — bilingual skeleton
> **Notice / Abiso:** We are writing to let you know about a security incident
> that may have involved some of your MAPA information. / *Ipinapaalam namin
> ang isang insidente sa seguridad na maaaring may kinalaman sa ilan ninyong
> impormasyon sa MAPA.*
>
> **What happened / Ano ang nangyari:** … **Information involved / Impormasyong
> apektado:** … **What we're doing / Ang ginagawa namin:** … **What you can do
> / Ang maaari ninyong gawin:** (e.g. change your password / palitan ang
> password). **Contact / Makipag-ugnayan:** DPO — [name, email, phone].

### 2c. NPC notification — checklist
- [ ] Nature of the breach and how it was discovered
- [ ] Sensitive personal information involved
- [ ] Approximate number of data subjects
- [ ] Measures taken / to be taken to address the breach and limit harm
- [ ] DPO name + contact

---

## 3. Data retention & erasure schedule (CRMC to finalize)

Retention is a **CRMC policy decision** (align to DOH records rules + RA 10173
proportionality). Fill the durations, then this becomes the standing schedule.

| Data | Suggested basis | Retention (CRMC sets) |
|------|-----------------|-----------------------|
| Patient records (`requests`, `applications`, `users` patient) | Keep while case is active + a defined period after closure | `____` |
| Uploaded documents (`documents`/`documentContents`: IDs, bills, abstracts) | Same as the record they support | `____` |
| Certificates / Guarantee Letters (`certificates`) | Retain for audit of commitments | `____` |
| `auditLog` | Longer — accountability + annual NPC report | `____` |
| Notifications, conversations | Short — operational only | `____` |
| Hashed rate-limit / diagnostic docs | Ephemeral — auto-expire | `____` |

**Erasure on request (RA 10173 §16(e))** is already implemented: patient
deletion removes the Firestore profile **and** the Firebase Auth account via
the deployed `deleteAuthUser` Cloud Function. When retention periods above are
reached, apply the same erasure path in a scheduled cleanup.

---

## 4. Quick command reference
```
# Snapshot before any cleanup
node scripts/export-firestore.js

# Disable + revoke a compromised account (admin SDK context)
admin.auth().updateUser(uid, { disabled: true })
admin.auth().revokeRefreshTokens(uid)   # forces re-login everywhere

# Deploy tightened rules after a permission fix
firebase deploy --only firestore:rules --project mapa-crmc

# Rotate secrets: update in Vercel env + Firebase Functions secrets, then redeploy
```

> Review this runbook at each milestone and after every real incident.
