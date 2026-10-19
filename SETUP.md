# MAPA — Setup on a new machine

How to get the web app running on a fresh laptop (Windows, macOS, or Linux),
from a GitHub clone to a running dev server. Commands are the same on all three
OSes unless noted.

> **The one thing that bites everyone:** `.env` is **not** in the repo (it holds
> secrets and is gitignored). A clone will *not* include it, and without it the
> app loads but every Firebase call fails. See step 2.

---

## 0. Prerequisites

Install these on the new machine first:

| Tool | Notes | Check |
|---|---|---|
| **Node.js 20 LTS or newer** | Includes `npm`. (Repo is developed on Node 24; anything ≥20 works.) | `node -v` / `npm -v` |
| **Git** | For cloning and updates. | `git --version` |
| **GitHub access** | The repo is **private** — sign in on the machine first (GitHub Desktop, `gh auth login`, an HTTPS Personal Access Token, or an SSH key). | — |

## 1. Clone the project

```bash
git clone https://github.com/HerAx-code/mapa-web.git
cd mapa-web
```

(Alternatively: GitHub → **Code** → **Download ZIP**, then unzip and `cd` in.
Cloning is preferred — it keeps history and lets you `git pull` updates.)

## 2. Create `.env` (required — not in the repo)

Copy the template and fill in the values:

```bash
cp .env.example .env
```

The minimum keys the app needs to reach Firebase:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_ENABLE_SEED=false
```

Get the values either by:

- **Copying your existing `.env`** from another machine (USB / private transfer) — exact and simplest; or
- Reading them from **Firebase Console → Project settings → Your apps → SDK setup (Config)** for the project.

`.env.example` documents every variable (including optional ones like App Check
and SMTP). Optional keys can be left unset — those features no-op locally.

> Local dev connects to the **real** Firebase project, so you are working against
> live data, not an isolated sandbox. App Check stays a no-op locally (no site key).

## 3. Install dependencies

```bash
npm install
```

Downloads `node_modules` (~760 MB) and builds the **platform-correct** native
binaries for this machine.

> **Never copy `node_modules` from another computer** — its native binaries
> (esbuild/oxc) are OS-specific. Always run `npm install` fresh.

## 4. Run

```bash
npm run dev
```

Open the URL it prints (usually **http://localhost:5173**).

## 5. Other commands (optional)

```bash
npm run build      # production build -> dist/
npm run preview    # serve the production build locally
npm test           # utils tests (fast)
npm run test:components
npm run test:functions
```

These need extra tooling, install only if you'll use them:

- **Deploy functions/rules** → `npm i -g firebase-tools`, then `firebase login`.
- **`npm run test:rules`** → a **JDK (Java)** for the Firestore emulator.
- **`npm run test:e2e`** → `npx playwright install` to fetch the browsers.

---

## Common mistakes

1. **No `.env`** → app loads but all Firebase calls fail. It's required and not in the repo.
2. **Copying `node_modules` across machines** → broken native binaries. Always `npm install`.
3. **Cloning without GitHub access** → "repository not found". The repo is private; sign in first.
