# ID Verification — Research & Integration Plan

*Written 2026-09-24. Companion to `security-research.md` and
`security-improvement-plan.md`. Audience: the MAPA team + CRMC / adviser
deciding how far to take identity assurance. This is a decision document, not
a spec — it ends in a phased recommendation with effort/risk, not code.*

MAPA serves **indigent Filipino patients** applying for medical financial
assistance at CRMC. Identity assurance here is a balance: strong enough that
scarce agency funds reach the real, eligible person — but never so heavy that a
sick person on a ₱2,000 Android over weak Cotabato data gets locked out of a
public-health service. Every recommendation below is weighed against that.

---

## 1. What MAPA does today

The current identity chain (accurate as of this writing):

| Control | Mechanism | Strength |
| --- | --- | --- |
| **Registration gate** | **Patient Access Code** (`CRMC-YYYY-NNNNN`), issued **in person** by Medical Social Services | **Strong.** A human at the counter is the real identity anchor. |
| **ID document** | Patient uploads a photo of a valid ID → Cloud Storage (`/documents/...`), base64 fallback on Spark | Weak on its own — it's just an image. |
| **On-device OCR** | `tesseract.js` (`eng+fil`), fuzzy name-match vs the account name (`src/utils/idOcr.js`); image never leaves the device; **advisory, never blocks** | Weak-to-moderate. Tesseract on phone photos of colored PH IDs is noisy. |
| **Live selfie** | Front-camera capture via `getUserMedia` (`SelfieCaptureModal.jsx`); "can't pick from gallery" is the *only* anti-spoof | **Weak.** No liveness — a printed photo or a phone-screen held to the camera passes. |
| **Human decision** | CRMC social worker eyeballs selfie ↔ ID portrait and verifies/rejects (`VerifyDocsPanel.jsx`) | **Strong but unaided** — fatigue, volume, poor ID-portrait quality. |

**Design principle to preserve:** the social worker makes the final call
(CLAUDE.md). Anything we add should *augment* the worker with a confidence
signal — never silently auto-reject an indigent applicant.

### Gap / threat analysis
1. **No liveness (presentation-attack) detection.** A photo-of-a-photo or a
   screen replay defeats the selfie. This is the single biggest hole.
2. **No automated face match** (ID portrait ↔ selfie). The worker matches by
   eye, on low-quality inputs, at volume.
3. **No document authenticity check.** A Photoshopped or borrowed ID image
   passes OCR + a glance. Nothing detects tampering.
4. **No authoritative cross-check.** Identity is asserted, never confirmed
   against the issuer. The in-person access code is the *only* real anchor.
5. **No same-face duplicate detection.** Cooldown is keyed on `hospitalId`;
   nothing flags one face across several accounts.

The access-code-in-person gate genuinely mitigates #1–#5 at *registration*, and
that must stay. The online step's job is to **confirm the person is the one the
code was issued to** — today it does that weakly.

---

## 2. Constraints that rule the design

- **Devices & network:** cheap Android, 2–3 GB RAM, intermittent 3G. Favor
  **on-device + single-frame + low-payload**. (This is why `idOcr.js` already
  downscales and uses a shared worker — respect that discipline.)
- **Equity / coverage:** not every indigent patient holds a National ID yet.
  Any national-ID path must be **additive and optional**, with the existing
  OCR+selfie+worker flow as the always-available fallback. Never gate care on
  owning a specific credential.
- **Privacy / law:** RA 10173 (Data Privacy Act). A face template/selfie is
  **sensitive personal information**; biometrics raise the bar. Prefer
  **on-device processing** (no raw biometric leaves the phone), explicit
  consent, tight retention, and a clear lawful basis. NPC registration already
  applies to CRMC.
- **Budget:** pilot → production on a shoestring; Firebase Spark→Blaze. Per-
  verification commercial KYC fees (~₱25–₱170 / US$0.50–$3 each, *verify with
  vendors*) are hard to justify for a free public service at scale. Free /
  on-device / government-provided options are strongly preferred.
- **Government-adjacent:** CRMC is a government hospital — a credible candidate
  to become a PhilSys **relying party**, which opens authoritative options that
  are closed to a private startup.

---

## 3. The four layers of ID verification (and where MAPA sits)

Identity proofing is really four independent checks. MAPA today does ½ of one.

| Layer | Question | MAPA today | Best-fit upgrade |
| --- | --- | --- | --- |
| **A. Document capture / OCR / MRZ** | What does the ID *say*? | tesseract (weak) | Better OCR, or read the **PhilID QR** (structured, exact) |
| **B. Document authenticity** | Is the ID *genuine / unaltered*? | none | **PhilID QR signature** (cryptographic) or commercial forgery checks |
| **C. Liveness (PAD)** | Is a *real person* present now? | none (gallery-block only) | **On-device passive liveness** (ISO 30107-3) |
| **D. Face match** | Is that person the *ID holder*? | human eye only | **On-device face match** (advisory score) or **PhilSys eVerify** (authoritative) |

---

## 4. Options considered

### Option 1 — On-device passive liveness + face match (open-source / self-hosted)
Add **passive liveness** (single selfie frame, no blink/turn choreography) and
an **ID-portrait ↔ selfie face-match score**, both running **in-browser / on the
phone** (MediaPipe / TensorFlow Lite / face-embedding libraries; commercial
on-device SDKs like Mitek IDLive, Regula, iProov, Identy exist if a paid,
supported PAD is wanted later).

- ✅ Cheap/free, **no biometric leaves the device**, single-frame = low
  bandwidth, augments (doesn't replace) the worker, fits the existing
  on-device OCR philosophy.
- ✅ Directly closes the two biggest holes (liveness #1, face-match #2).
- ⚠️ Open-source PAD is weaker than certified commercial (ISO 30107-3 Level
  1/2); treat the output as a **confidence hint**, not a gate. Model size /
  perf tuning needed for low-RAM phones.

### Option 2 — PhilSys "National ID Check" (QR authenticity), self-hosted
The **PhilID / ePhilID / Digital National ID carry a QR** that PSA signs.
`bettergovph/openverify` (open source, Next.js) demonstrates **decoding and
cryptographically verifying** it: legacy PhilID v1 = Ed25519 signature over
JSON; ePhilID v3 = Base45 + gzip + CBOR **with an embedded photo**; plus an
online proxy to `verify.philsys.gov.ph` for activation status (ACTIVATED /
REVOKED). Tooling: `jsQR` + `@noble/hashes`.

- ✅ **Authoritative document authenticity + exact name** (Layer A+B), and the
  ePhilID v3 QR **embeds the holder photo** → can drive face-match against the
  live selfie **without any server** — huge for low-bandwidth + strong
  assurance at once.
- ✅ Verifiable **offline** (scan + local signature check), degrading to an
  online activation check when there's data.
- ⚠️ **Legal/eligibility unknown:** whether a relying party may verify the QR
  without formal PSA authorization is **not documented** — must be confirmed
  with PSA/NIDAS. Not every patient has a National ID yet → **optional path**.

### Option 3 — PhilSys NIDAS **eVerify** (server-side biometric, authoritative)
PSA's National ID Authentication Services: submit a selfie, PSA does a
**server-side biometric comparison to the reference on file** and returns
pass/fail. The gold standard for "is this the real person."

- ✅ Strongest Layer D, government-authoritative, offloads all biometric
  liability to PSA.
- ⚠️ Requires **approved relying-party status** (CRMC is a plausible applicant
  — timeline/terms/cost unknown), sends a selfie to PSA (consent + RA-10173
  handling), needs connectivity. Best as a **high-assurance option**, not the
  default path.

### Option 4 — Commercial IDV/KYC provider (Onfido, Jumio, Sumsub, HyperVerge, Veriff, iProov…)
Full-stack document + liveness + face-match SaaS.

- ✅ Turnkey, certified PAD, supports many PH IDs, minimal build.
- ⚠️ **Per-verification cost** at public-service scale, sends PII/biometrics to
  a third party (RA-10173 + cross-border data), overkill given the in-person
  access-code anchor. Reasonable only as an **edge-case fallback**, if at all.

### Option 5 — Status quo (human only)
- ✅ Zero build, zero new data collected.
- ❌ Leaves every gap open; doesn't scale with worker load.

---

## 5. Recommendation — a phased, additive path

Keep the **access code + social-worker final call** as the backbone. Layer in
assurance cheapest-and-most-impactful first; make each step **advisory** and
**skippable** so no patient is excluded.

### Phase 1 — On-device liveness + face-match confidence (build now)
*Closes the two biggest holes, no new vendor, no biometric leaves the phone.*
- Add **passive liveness** to `SelfieCaptureModal.jsx`: score the captured
  frame; on a weak score, prompt a gentle recapture — **never hard-block**.
- Add an **ID-portrait ↔ selfie match score** (crop the portrait from the
  uploaded ID, embed both faces on-device, compare) surfaced in
  `VerifyDocsPanel.jsx` beside the existing OCR chip: e.g. *"Face match: likely
  / unclear — verify manually."* Same advisory pattern as `ocrMatch`.
- Store only a **pass/unclear flag + score**, not raw templates. Update
  `docs/threat-model.md` + a short DPIA note.
- *Effort:* medium. *Risk:* low (advisory). *Cost:* ~free.

### Phase 2 — PhilID QR verification (pursue in parallel)
*Authoritative authenticity + a reference photo, low-bandwidth, optional.*
- Add an **optional "Verify with National ID (QR)"** step: scan the PhilID/
  ePhilID/Digital ID QR (`jsQR`), verify the signature (`@noble/hashes`,
  Ed25519 / CBOR per `openverify`), extract the exact name (Layer A+B) and, for
  ePhilID v3, the **embedded photo** to face-match the live selfie (Layer D) —
  all client-side. Add the online activation check when connected.
- **First action item is non-technical:** confirm with **PSA/NIDAS** whether
  CRMC can be a relying party and whether offline QR verification is permitted,
  and on what terms. Build behind a feature flag until cleared.
- Keep OCR+selfie+worker as the fallback for patients without a National ID.
- *Effort:* medium (code) + unknown (PSA process). *Risk:* medium (legal
  clearance). *Assurance gain:* large.

### Phase 3 — NIDAS eVerify / commercial fallback (optional, later)
Only if a specific high-assurance or edge case demands it (e.g. disputed
identity, no ID at all). Introduce **NIDAS eVerify** (if a relying party) or a
**pay-per-use commercial check** for those cases — not the default path.

### Explicitly *not* recommended now
- Mandatory biometrics or auto-reject on any score (equity + RA-10173 risk).
- Routing every applicant through a paid commercial KYC (cost + data exposure).
- Dropping the in-person access code (it's the strongest, cheapest control we
  have).

---

## 6. Privacy & legal (RA 10173) — non-negotiables

- **Sensitive personal information:** selfies/face data need explicit,
  informed **consent** at capture, a stated **purpose** (identity confirmation
  for assistance), and a **retention limit** (e.g. purge selfies after
  verification, or after the case closes).
- **Data minimization / on-device first:** prefer Phase-1 on-device scoring so
  no raw biometric is transmitted or stored server-side. If Phase 3 sends a
  selfie to PSA/a vendor, document the transfer + basis.
- **Human-in-the-loop:** the social worker's final call also satisfies the
  "no solely-automated decision-making with significant effect" spirit — keep
  it.
- Do a short **DPIA** before Phase 1 ships; loop in CRMC's NPC-registered DPO.

---

## 7. Where this touches the code (for whoever builds it)

| Change | File(s) |
| --- | --- |
| Passive liveness on capture | `src/components/SelfieCaptureModal.jsx` |
| ID-portrait ↔ selfie match (advisory) | new `src/utils/faceMatch.js`; surface in `src/components/admin/VerifyDocsPanel.jsx` |
| Better OCR / QR read | extend `src/utils/idOcr.js` (or new `src/utils/philIdQr.js`) |
| PhilID QR verify (Phase 2) | new `src/utils/philIdQr.js` (`jsQR` + `@noble/hashes`); optional step in `RequestAssistance.jsx` |
| Store flags, not templates | `src/utils/uploadDocument.js`; rules for any new fields |
| Feature-flag Phase 2 | env / config gate until PSA clearance |
| Threat model + DPIA note | `docs/threat-model.md`, this doc |

---

## 8. Recommended next step

1. **Decide the assurance target with CRMC** (what fraud are we actually
   worried about — impersonation? duplicate claims? borrowed IDs?). That picks
   the phase depth.
2. **Ship Phase 1** (on-device liveness + advisory face-match) — high impact,
   low risk, no external dependency, fits the existing on-device pattern.
3. **In parallel, email PSA/NIDAS** about CRMC relying-party eligibility and
   PhilID-QR verification terms — that answer unlocks Phase 2/3.

---

## Sources
- PhilSys NIDAS (eVerify + National ID Check / QR): https://www.kairos.com/post/national-id-authentication-services-nidas-what-it-is-how-it-works-and-where-kairos-fits · official portal https://verify.philsys.gov.ph/ · eGovPH https://e.gov.ph/
- Open-source PhilSys verification (QR decode + signature): https://github.com/bettergovph/openverify
- Passive / on-device liveness & PAD (ISO 30107-3): https://www.miteksystems.com/products/face-liveness-detection · https://faceapi.regulaforensics.com/ · https://github.com/kby-ai/Face-Liveness-Detection-SDK · https://github.com/topics/liveness-detection
