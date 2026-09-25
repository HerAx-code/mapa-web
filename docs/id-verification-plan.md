# ID Verification — Build & UI Plan (Phase 1)

*Written 2026-09-24. Implements the "build now" phase of
`id-verification-research.md`. Audience: whoever builds this + the adviser
reviewing the approach. Phase 2 (PhilID QR) is designed here but feature-
flagged pending PSA clearance.*

## Guiding rules (carried from the research)
1. **Additive & advisory.** New signals *augment* the social worker's decision.
   Nothing auto-rejects an applicant. Same contract as today's `ocrMatch` chip.
2. **On-device.** Liveness + face-match run on the phone; **no raw biometric
   leaves the device**; we persist verdicts + scores, never face templates.
3. **Low-friction / low-bandwidth.** Single-frame where possible; lazy-loaded
   models (like `tesseract.js` already is); graceful null on any failure.
4. **Equity.** Works without a National ID; the National-ID (QR) path is
   optional and never a gate on care.

---

## 1. Scope

**Phase 1 (this plan — build now):**
- **A. On-device face match** — ID portrait ↔ live selfie similarity → advisory
  verdict shown to the worker. *Highest value, lowest friction.*
- **B. Basic liveness** — confirm a real face is present at capture; optional
  single active challenge (blink / slight head-turn) for higher assurance,
  toggleable. *Certified passive PAD is a paid upgrade later (Phase 1.5).*
- **C. Keep OCR** as-is (already advisory) — just render its verdict next to
  the two new ones.

**Phase 2 (designed, flagged):** PhilID **QR verification** — authenticity +
exact name + embedded portrait for a stronger, still on-device face match.

**Out of Phase 1:** NIDAS eVerify / commercial KYC (Phase 3), auto-reject,
mandatory biometrics.

---

## 2. Architecture & libraries

**Model choice — LOCKED: `face-api.js` (self-hosted models), not MediaPipe.**
MediaPipe Tasks Vision has **no face-embedding / recognition task** — only
detection + landmarks — so it cannot produce the *face match* signal, which is
the highest-value output of the whole feature. `face-api.js` is the only mature
in-browser face-**recognition** stack (128-d descriptor + a well-known distance
threshold), and its landmark model *also* covers our liveness needs (face
presence, size, sharpness, eye-aspect-ratio for an optional blink). So **one
model stack does both jobs** — no second dependency.

- **New dependency (needs sign-off):** `face-api.js` (pulls `@tensorflow/tfjs`
  as its runtime). Both are **lazy-loaded** via dynamic `import()` — never in the
  main bundle — exactly like `tesseract.js` is today.
- **Models self-hosted in `/public/models/`** (not fetched from a CDN): three
  files, ~6.6 MB total, downloaded **once** on first reach of the ID/selfie step
  and then cached:
  - `tiny_face_detector` (~190 KB) — face presence + box
  - `face_landmark_68` (~350 KB) — landmarks (framing + liveness)
  - `face_recognition` (~6.2 MB) — the 128-d descriptor for matching
- **PWA caching gotcha (verified):** `vite.config.js` sets
  `maximumFileSizeToCacheInBytes: 5 * 1024 * 1024`, so the 6.2 MB recognition
  model **won't precache**. Do **not** raise the global precache cap (it would
  bloat the install). Instead add a `runtimeCaching` **CacheFirst** entry for
  `/models/` (runtimeCaching is exempt from that cap), alongside the existing
  Firestore/Auth `NetworkOnly` rules. First load pays the ~6.6 MB once; every
  visit after is instant and offline-capable.

New util **`src/utils/faceCheck.js`**, modeled on `idOcr.js`:
  - **Lazy-loaded** `face-api.js` + tfjs, single shared init promise (mirror
    `idOcr.js`'s `_workerPromise` pattern), models loaded once.
  - `detectFace(image)` → box + landmarks (presence + crop). Returns `null` if
    no face / >1 face.
  - `embed(faceCrop)` → 128-d descriptor; `similarity(a,b)` → cosine [0..1]
    (face-api gives euclidean distance; convert so the whole app speaks one
    scale, matching the plan's verdict bands).
  - `livenessHint(image)` → `{ verdict, score }` from face-present + single-face
    + size/sharpness heuristics on the captured still. **No trained PAD in
    Phase 1** — screen/print spoof detection is honestly out of reach without a
    certified model (that's Phase 1.5, paid). We say what this does and doesn't
    catch rather than overclaim.
  - Every function **fails to `{ verdict: null }`** — never throws into the flow.
    If the ~6.6 MB doesn't download on a weak rural connection, the flow proceeds
    unaided (the advisory contract), never blocking care.
  - Respect low-RAM: downscale first (reuse `idOcr`'s `preprocessImage` /
    `loadImage` + `close()` bitmaps), single shared instance, one inference at a
    time.
- **Perf budget:** after models are cached, target < ~2 s per pair on a mid
  Android. First-load is dominated by the one-time ~6.6 MB download (comparable
  to tesseract's ~10 MB eng+fil the team already accepts). If a device can't run
  it, fall through to null.
- **Accuracy is a hint, not proof.** Benchmarks (LFW ~99%) are photo-to-photo;
  our job is *printed, low-res ID portrait ↔ live phone selfie* — a materially
  harder cross-domain match. So thresholds run **conservative for precision** (a
  green "match" chip must be trustworthy; borderline falls to amber "verify
  manually"), and we calibrate on real logged scores before trusting the chips
  (see §7).

### Verdict bands (advisory, tunable via config — not hardcoded in components)
| Signal | `pass` | `unclear` | `null` |
| --- | --- | --- | --- |
| Face match | similarity ≥ `MATCH_HI` | between | no face found / error |
| Liveness | score ≥ `LIVE_HI` | between | unsupported / error |

There is **no `fail`→block** state. "Unclear" = "verify manually," mirroring
`ocrMatch === false`.

---

## 3. Data model

Stamp verdicts on document metadata (alongside the existing `ocrMatch` /
`ocrText`). **Store flags + scores, not templates.** The pairwise face/liveness
result goes on the **selfie doc**; the detected type goes on the **ID doc**.

```
documents/{docId}
  ── existing ──
  ocrMatch:        true | false | null         // ID docs
  ocrText:         string                       // ID docs
  ── NEW, on the SELFIE doc ──
  faceMatch:       'pass' | 'unclear' | null   // ID portrait ↔ live selfie
  faceMatchScore:  number  (0..1)              // for tuning / audit
  liveness:        'pass' | 'unclear' | null
  livenessScore:   number  (0..1)
  idVerifyMethod:  'ocr' | 'philid_qr' | null  // Phase 2 sets philid_qr
  ── NEW, on the ID doc ──
  idTypeDetected:  string | null               // e.g. "Driver's License" (advisory)
```

### 3a. Where the images actually live (VERIFIED — corrects the old assumption)
The app is on the **Spark (free) plan; Cloud Storage is disabled**
(`uploadDocument.js` history comment). Selfies/IDs are compressed to
≤900 KB / 1200 px and stored as **base64 in `documentContents/{docId}`**, not in
Storage. Consequences that shape the build:
- **Run face-match on the original in-memory `File` objects at submit** — full
  quality, *before* the 1200 px recompression — never on the stored copy.
- **Admin side-by-side** loads both images from `documentContents` base64 (the
  path `DocViewerModal` already uses). The worker view only *renders* the stored
  score + the two images; it does **not** re-run the model.
- **Retention (privacy §6) = delete the `documentContents` + `documents` docs**
  after case close, *not* a Storage purge. The non-biometric verdict flags may
  persist for audit.

### 3b. Firestore rules changes (REQUIRED — two edits, one is a sharp edge)
`firestore.rules` → `match /documents/{docId}`:
1. **`create`** (line ~291) doesn't allowlist fields, so new fields are accepted
   — but **add server-side bounds** the way `ocrText` is bounded: verdicts must
   be `'pass'`/`'unclear'` (or absent), scores must be numbers in `[0,1]`,
   `idTypeDetected` a string ≤ 100 chars. Keeps a hostile client from writing
   junk into the audit trail.
2. **`update`** (line ~322) — **this is the sharp edge.** The patient-update rule
   is `hasOnly([...])` with an **exact** allowlist. `replacePatientDocument`
   (re-upload of a rejected doc) does an `updateDoc`; the instant a doc carries
   the new fields, that write is **denied** unless the allowlist grows. Add
   `faceMatch, faceMatchScore, liveness, livenessScore, idVerifyMethod,
   idTypeDetected` to the `hasOnly([...])` list, with the same value bounds as
   (1). Missing this = re-upload silently breaks in production.

No new collection. Agencies/admin already have read.

---

## 4. Build tasks

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 1 | `faceCheck` util (detect / embed / similarity / liveness), lazy-loaded, fails-null | `src/utils/faceCheck.js` (new) | Mirror `idOcr.js` structure + tests |
| 2 | Liveness on capture + inline result + soft retake nudge | `src/components/SelfieCaptureModal.jsx` | Never hard-block; see UI §5.1 |
| 3 | Face-match fired when BOTH ID + selfie present; stamp on selfie | `src/pages/patient/RequestAssistance.jsx` | Pairwise, so NOT per-file like OCR — see §4a |
| 3b | `idTypeDetected` classifier from OCR text | `src/utils/idOcr.js` | Regex map, advisory; no patient picker |
| 4 | Show Liveness + Face-match advisory lines + side-by-side compare | `src/components/admin/VerifyDocsPanel.jsx` | Same chip pattern as OCR; loads base64 |
| 5 | Persist new fields (create path) + extend both rules | `src/utils/uploadDocument.js`, `firestore.rules` | **Update allowlist §3b(2) or re-upload breaks** |
| 5b | PWA CacheFirst for `/models/` | `vite.config.js` | Don't raise global precache cap; see §2 |
| 6 | Bilingual copy (patient side) | `src/i18n/locales/{en,fil}.json` | `patient.request.selfie*`, new keys |
| 7 | Config + feature flags (thresholds, Phase-2 gate) | `src/utils/constants.js` / env | Tunable without redeploy where possible |
| 8 | Tests | `tests/utils/faceCheck.test.js`, component smoke | cosine/verdict bands, null-safety |

### 4a. Integration points (verified against current code)
- **Liveness** runs in `SelfieCaptureModal.jsx` on the captured still (in
  `capture()`, on the `blob`/`preview` already produced at line ~45). It sets the
  banner state (§5.1) and returns `{ liveness, livenessScore }` up via `onCapture`.
- **Face-match** runs in `RequestAssistance.jsx` as a **background task**, fired
  when *both* the ID `File` and the selfie `File` are present in `pendingFiles`.
  OCR today is **per-file at attach** (`startOcr`, `attachReq`, guarded by the
  `ocrTokens` ref, lines ~88-126); face-match is **pairwise**, so it belongs in a
  small `useEffect` watching `pendingFiles` for the ID-type + selfie-type pair,
  storing into a `faceResults` ref mirroring `ocrResults`. Read it at submit
  where `ocr` is read today (line ~394) and pass it into `uploadPatientDocument`
  for the **selfie** doc.
- **Persist**: `uploadPatientDocument` (line ~94) already spreads `ocr` fields at
  **create**; add a `face`/`live`/`idTypeDetected` param spread the same way.
  `replacePatientDocument` (line ~145) is the one that also needs the rule
  allowlist widened (§3b).
- **Admin**: `VerifyDocsPanel.jsx` renders the OCR advisory line off
  `d.ocrMatch`; add two sibling lines off `d.faceMatch` / `d.liveness` using the
  identical green/amber/gray chip, and a "Compare side-by-side" toggle that loads
  the ID + selfie base64 from `documentContents`.

---

## 5. UI / UX design

Everything reuses MAPA's existing design language: the patient side is
**mobile-first, bilingual, centered, ≥44px targets**; the admin side is the
**advisory-chip pattern** already established by OCR. No new visual system.

### 5.1 Patient — selfie capture with liveness (mobile, bilingual)

Extends the existing `SelfieCaptureModal` (bottom-sheet on phones). Adds a
framing overlay, a brief on-device "checking" state, and a result banner that
**nudges** but never blocks.

```
┌──────────────────────────────┐    ┌──────────────────────────────┐    ┌──────────────────────────────┐
│  Take a live selfie      ✕   │    │  Checking your photo…    ✕   │    │  Looks good ✓            ✕   │
│  Kunan ng live selfie        │    │                              │    │                              │
├──────────────────────────────┤    ├──────────────────────────────┤    ├──────────────────────────────┤
│  Center your face in the     │    │   ┌────────────────────┐     │    │   ┌────────────────────┐     │
│  circle, good light.         │    │   │   [ captured photo ]│     │    │   │   [ captured photo ]│     │
│                              │    │   │      ◐ checking     │     │    │   └────────────────────┘     │
│   ┌────────────────────┐     │    │   └────────────────────┘     │    │  ✓ Live photo confirmed      │
│   │      ╭────────╮     │     │    │  Confirming a real, live     │    │  ✓ Buhay na larawan          │
│   │      │  face   │     │     │    │  photo — stays on your phone.│    │                              │
│   │      │  oval   │     │     │    │                              │    │  [ ☑ ] I consent to CRMC     │
│   │      ╰────────╯     │     │    │                              │    │        using this photo…      │
│   └────────────────────┘     │    │                              │    │                              │
│                              │    │                              │    │  [ Retake ]     [ Use photo ]│
│        (  ● Capture  )        │    │                              │    │                              │
└──────────────────────────────┘    └──────────────────────────────┘    └──────────────────────────────┘
        default / live                     on-device check (~1–2s)              pass → allow "Use"
```

**Unclear-liveness state** (advisory nudge, still usable):
```
│  ⚠ Hard to confirm a live photo                     │
│  Try again in brighter light, facing the camera.    │
│  Nahirapang kumpirmahin — subukan sa mas maliwanag. │
│  [ Retake ]        [ Use anyway ]  ← still allowed  │
```
- **Face oval overlay** guides framing (helps low-literacy users, improves
  capture quality → better OCR + match).
- **"Checking…"** runs `faceCheck` on-device; copy reassures the image stays on
  the phone (RA-10173 trust).
- **Never blocks:** even "Use anyway" is available — the worker still decides.
  This protects an elderly/ill applicant whose phone camera is poor.
- **Optional active challenge** (config-gated, higher-assurance sites): a single
  step — *"Please blink"* / *"Turn your head slightly"* — shown before capture.
  Off by default for accessibility; on where fraud risk warrants it.
- Consent checkbox already exists — keep it; expand copy to name face-match.

### 5.2 Social worker — verify panel (desktop, English)

Extend each ID/selfie row in `VerifyDocsPanel` with **two more advisory lines**
in the exact style of the current OCR line, plus a **side-by-side compare** the
worker can open. The Verify / Reject / Reset buttons are unchanged.

```
┌── ① Verify documents ─────────────────────────  [3/3 verified] ─┐
│ 📄 Valid ID (PhilSys)                    [Pending]        👁  │
│    ✓ OCR: ID name matches the account      See what OCR read  │
│    ✓ Face match: selfie likely matches ID  Compare side-by-side│
│    ⚠ Liveness: unclear — verify manually                       │
│      [ ✓ Verify ]   [ ⦸ Reject ]                              │
│                                                                │
│  ▸ Compare side-by-side (opens):                               │
│    ┌───────────────┐   ┌───────────────┐                       │
│    │  ID portrait  │   │  live selfie  │   Face match: 0.82 ✓  │
│    │   [ photo ]   │   │   [ photo ]   │   Liveness:  unclear  │
│    └───────────────┘   └───────────────┘   (advisory — you     │
│                                             make the final call)│
└────────────────────────────────────────────────────────────────┘
```
- **Chip tones** reuse the OCR palette: `pass` = green ✓, `unclear` = amber ⚠,
  `null` = gray "could not check — verify manually."
- **Side-by-side** is the highest-value affordance: it puts the two faces
  next to each other so the human match is fast and accurate, with the score as
  a hint. This is what actually reduces worker fatigue.
- Framing line: *"advisory — you make the final call"* keeps the human
  decision primary (design principle + RA-10173).

### 5.3 Phase 2 — "Verify with National ID (QR)" (designed, flagged)

An **optional** accelerator offered on the ID step, behind a feature flag until
PSA clearance:
```
┌───────────────────────────────┐   ┌───────────────────────────────┐
│  Faster: verify with your      │   │  Scan the QR on your National  │
│  National ID (optional)        │   │  ID                            │
│  Mas mabilis gamit ang         │   │   ┌──────────────────────┐     │
│  National ID (opsyonal)        │   │   │  [ camera → QR box ]  │     │
│                                │   │   └──────────────────────┘     │
│  [ Scan National ID QR ]       │   │  Verified locally on your      │
│  ─────────  or  ───────────    │   │  phone. ✓ Name & photo read.   │
│  [ Upload an ID photo instead ]│   │  [ Continue ]                  │
└───────────────────────────────┘   └───────────────────────────────┘
```
- On success: authenticity ✓ (signature), exact name (Layer A/B), and — for
  ePhilID v3 — the **embedded portrait drives the face-match** against the live
  selfie, all client-side. Falls back to the normal upload path for anyone
  without a National ID.

---

## 6. Privacy in the UI (RA 10173)
- Consent copy at capture explicitly names **liveness + face-match**, purpose
  (confirming identity for assistance), and that processing is **on-device**.
- **Retention:** add a job to delete the selfie's `documentContents/{docId}`
  (base64 image) — and optionally the `documents/{docId}` — after case close;
  keep only the non-biometric verdict flags for audit. (Firestore, **not**
  Storage — see §3a. Today selfies persist as base64.)
- Human-in-the-loop preserved (no solely-automated adverse decision).
- Short **DPIA** update in `threat-model.md` before shipping; loop in CRMC DPO.

---

## 7. Sequencing, testing, rollout
1. `faceCheck` util + unit tests (thresholds, cosine, null-safety) — no UI yet.
2. Wire face-match at submit + admin panel display (advisory) — **ship this
   first**; it's the clearest win and needs no capture-UX change.
3. Add liveness + capture-UX (overlay, checking, nudge).
4. **Roll out behind a config flag with thresholds tunable**; log scores
   (non-PII) for a week to calibrate `MATCH_HI` / `LIVE_HI` before trusting the
   chips. Gate is the CI test suite + `lint:i18n` for the new patient copy.
5. Phase 2 stays flagged until PSA answers.

### ✅ BUILT — Phase 1 (PR #229, branch `feat/id-verification-phase1`)
Tasks 1–8 are implemented, tested (utils 161 · components 94 · rules 179 ·
lint:i18n clean) and open for review. What shipped vs this plan:
- **Model:** `@vladmandic/face-api` (maintained face-api.js fork; original breaks
  under Vite — same API/model format), weights vendored in `public/models/`.
- **Rollout kill-switch:** `VITE_ID_VERIFY_ENABLED` (default on; `false` disables
  the whole check + model download → OCR-only fallback).
- **Calibration data:** `faceMatchScore` / `livenessScore` are already persisted
  per doc, so the scores to tune `FACE_MATCH_HI` / `LIVENESS_HI` accrue in
  Firestore during the advisory-only period — no extra logging pipeline needed.
- **DPIA:** recorded in `docs/threat-model.md` (A6a) — on-device, no templates,
  consent, human-in-loop, kill-switch, retention pending.

**Remaining before "trust the chips":**
- Calibrate `FACE_MATCH_HI` / `LIVENESS_HI` on real logged scores (still
  PROVISIONAL in `constants.js`).
- Selfie-retention purge job (needs the window decision below).
- Live device verification on the Vercel preview (CI can't drive the camera).

## 8. Decisions

**Resolved (this pass):**
- ✅ **Face model:** `face-api.js` self-hosted (see §2) — MediaPipe can't do
  face embeddings, which are the point.
- ✅ **Where images live:** Firestore base64, not Storage (§3a) — drives the
  submit-time / original-`File` face-match and the base64 admin compare.
- ✅ **Rules:** two edits, and the `update` allowlist one is mandatory (§3b).
- ✅ **PWA caching:** runtimeCaching CacheFirst for `/models/`, don't touch the
  global precache cap (§2 / task 5b).
- ✅ **ID categorization:** no patient dropdown; OCR-driven advisory
  `idTypeDetected`, worker confirms at review (task 3b + mockup §5.2).

- ✅ **New dependency:** approved — add `face-api.js` (+ `@tensorflow/tfjs`,
  lazy-loaded, self-hosted models) [2026-09-24].
- ✅ **Liveness depth:** passive heuristic is the Phase-1 default; active blink
  challenge stays config-gated + off [2026-09-24].

**Still need a call before building:**
- **Selfie retention window:** purge on case close vs fixed N days.
- **Certified PAD (Phase 1.5):** pursue only if pilot fraud data warrants.

---

## Next step
Plan is solidified against the code (Spark/base64 storage, the rules allowlist,
the model choice, PWA caching all verified above). A visual mockup of the three
flows exists for design sign-off.

**Recommended build order — (1 → 3b → 3 → 5 → 4), then liveness (2):**
face-match util → ID-type classifier → submit wiring + persist + rules → admin
side-by-side (biggest worker win, no capture-UX change), then the liveness
capture UX last.

**Blocking gate:** dependency sign-off for `face-api.js` (+ `@tensorflow/tfjs`,
lazy-loaded) before task 1 (§8). Ship behind a config flag; log scores for a
week to calibrate thresholds before the chips are trusted (§7).
