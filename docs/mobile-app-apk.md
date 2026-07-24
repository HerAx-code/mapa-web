# Installing MAPA on phones — PWA install and the APK route

Created 2026-07-24.

## TL;DR

**MAPA has no APK, and for most patients it should not need one.** MAPA is
a Progressive Web App (PWA). The safest way to put it on a phone is the
built-in install flow — and that flow is verified working in production.

If a thesis requirement or a stakeholder specifically needs a downloadable
**`.apk` / `.aab` file**, you produce it by *wrapping this same PWA* as a
**Trusted Web Activity (TWA)** — no separate codebase. This doc covers
both, and — importantly — what "safely installed" means for each.

---

## Option 1 — PWA install (recommended; already works)

Nothing to build. The live site at `https://mapa-web-six.vercel.app` is a
fully installable PWA — verified 2026-07-24 against Chrome's install
criteria: valid `manifest.webmanifest`, `name`/`short_name`, 192 + 512 +
maskable icons, `display: standalone`, `start_url` in scope, HTTPS, and a
registered service worker.

**How a patient installs it**
- **Android / Chrome:** open the site → tap the **Install App** button on
  the landing page (or the `/install` page) → Chrome's install dialog
  appears → Install. Also available from Chrome's ⋮ menu → "Install app".
- **iPhone / Safari:** open the site → Share button → **Add to Home
  Screen** → Add. (iOS has no install dialog; the `/install` page shows
  these steps.)

**Why this is the *safe* option.** It installs directly from the browser
over HTTPS. There is **no downloaded file, no "install from unknown
sources", and no Play Protect "unsafe app" warning** — the exact warnings
that a sideloaded APK triggers. For an audience of indigent patients on
low-end Android phones, this is the lowest-friction, lowest-risk channel.

**What changed 2026-07-24.** The landing button read "Download App," which
made people expect an `.apk` file that never arrived. It now reads
**"Install App"**, and the install page states plainly that it installs
from the browser with no file and no security warning.

---

## Option 2 — Real signed APK / AAB via a Trusted Web Activity

A TWA is a thin Android wrapper that runs *this PWA* full-screen (no
browser URL bar) using Chrome under the hood. It is the Google-endorsed
"PWA → Android app" path. You get a real `.aab` (for Play Store) or `.apk`
(for direct install). **It is still the same web app** — no second
codebase, and every MAPA update ships the instant Vercel deploys.

### The honest caveat about "safely installed"

- **Play Store (`.aab`)** → installs with **no warning**. This is the only
  warning-free way to distribute an APK-based app. Requires a Google Play
  Developer account (one-time US$25) and a short review.
- **Sideloaded `.apk`** (download the file, install it directly) → Android
  **always** shows "install from unknown sources" and Play Protect may
  flag it. This is *less* safe than the PWA install, not more. Only choose
  this if a file handoff is a hard requirement (e.g., the panel wants an
  `.apk` on a USB stick).

So: if the goal is "safely installed," Option 1 (PWA) or Play Store beats a
sideloaded APK.

### Easiest build path — PWABuilder (web, no local Android tooling)

1. Go to `https://www.pwabuilder.com` and enter
   `https://mapa-web-six.vercel.app`.
2. It reads the existing manifest (already valid) and scores the PWA.
3. Choose **Android → Generate Package**. Pick "Signed APK" and/or the
   Play Store `.aab`.
4. PWABuilder generates a **signing key** for you (or you upload your own)
   and returns a zip containing the package **and** the
   `assetlinks.json` + the key's SHA-256 fingerprint.
5. Host the Digital Asset Links file (next section). Without it the app
   runs but shows the browser address bar.

### CLI path — Bubblewrap (needs JDK + Android SDK locally)

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://mapa-web-six.vercel.app/manifest.webmanifest
# answer prompts: package id e.g. ph.gov.crmc.mapa, app name MAPA,
# it will create/prompt for a signing keystore
bubblewrap build          # produces app-release-signed.apk + .aab
```

`bubblewrap` reads the same manifest this repo already ships, so app name,
icons, theme colour, and `start_url` all carry over automatically.

### Required: Digital Asset Links (domain ↔ app trust)

For the TWA to run **without the browser URL bar**, the domain must prove
it owns the app. Create this file and let Vercel serve it at
`https://mapa-web-six.vercel.app/.well-known/assetlinks.json` by committing
it to **`public/.well-known/assetlinks.json`** (Vercel serves `public/`
from the site root):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "ph.gov.crmc.mapa",
      "sha256_cert_fingerprints": [
        "REPLACE_WITH_YOUR_SIGNING_KEY_SHA256_FINGERPRINT"
      ]
    }
  }
]
```

- `package_name` must match what you set in PWABuilder / Bubblewrap
  (suggested: `ph.gov.crmc.mapa`).
- The fingerprint comes from your signing key. From a keystore:
  `keytool -list -v -keystore <your.keystore> -alias <alias>` → copy the
  **SHA256** line. PWABuilder prints it in the generated zip.
- This file is intentionally **not committed yet** — it would be a dead
  placeholder until you have a real fingerprint. Add it in the same PR that
  introduces the APK build, once the key exists.

### After you have the package

- **Play Store:** upload the `.aab` in the Play Console, complete the
  listing (the three manifest screenshots under `public/screenshots/` can
  be reused), submit for review.
- **Direct file:** host the `.apk` somewhere and link it — but warn users
  they must allow "install from unknown sources," and expect a Play Protect
  prompt. Prefer the PWA button for real patients.

---

## Recommendation for the pilot

1. **Ship Option 1 to patients** — it's live, safe, and now honestly
   labelled. This is the primary channel for the indigent-patient audience.
2. If the defense panel wants to *see* an installable Android app, generate
   a TWA via **PWABuilder** and either publish the `.aab` to the Play Store
   (warning-free) or bring a signed `.apk` for the demo, with the
   assetlinks file committed so it runs chrome-less.
3. This keeps one codebase: the PWA is the app; the APK is just a wrapper
   around it, updated automatically on every Vercel deploy.

> Note: `CLAUDE.md` lists a separate native mobile app (React Native /
> Flutter) as future work. A TWA is **not** that — it is this web app in an
> Android shell, and does not replace or block the planned native app. It
> is the fast, low-maintenance way to have "an APK" today.
