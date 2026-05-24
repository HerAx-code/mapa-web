# Deploying MAPA

The web app is a Vite + React SPA. The frontend deploys to Vercel; Firestore rules and indexes deploy separately via the Firebase CLI.

## One-time setup

### 1. Vercel project

1. Push this repo to GitHub.
2. Vercel dashboard → **New Project** → import the repo.
3. Confirm auto-detected settings:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
4. Click **Deploy**. The first build will fail without env vars — that's expected; finish step 2 next.

### 2. Environment variables

In **Vercel → Project → Settings → Environment Variables**, add the six `VITE_FIREBASE_*` values from `.env.example`. Set scope to **Production + Preview + Development** for each.

| Key | Value | Notes |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | from Firebase Console → Project Settings | public by design — secured via Firestore rules |
| `VITE_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` | |
| `VITE_FIREBASE_PROJECT_ID` | your project id | |
| `VITE_FIREBASE_STORAGE_BUCKET` | `your-project.appspot.com` | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | numeric id | |
| `VITE_FIREBASE_APP_ID` | `1:xxx:web:xxx` | |
| `VITE_ENABLE_SEED` | `false` for Production | **leave unset or `false` in prod** — `true` exposes the demo accounts panel on Login |

Trigger a redeploy after saving env vars (Vercel → Deployments → "..." → Redeploy).

### 3. Firebase Auth — authorized domains

Firebase Console → **Authentication → Settings → Authorized domains** → Add:

- `your-project.vercel.app` (production URL)
- Each Vercel preview URL you want login working on (or use a stable custom domain)
- Your custom domain when you point one

Without this, sign-in throws `auth/unauthorized-domain`.

### 4. Deploy Firestore rules + indexes

Vercel hosts the frontend only — Firestore configuration lives on Firebase.

```bash
npm install -g firebase-tools
firebase login
firebase use your-project-id
firebase deploy --only firestore:rules,firestore:indexes
```

Re-run this command any time `firestore.rules` or `firestore.indexes.json` changes.

## Ongoing workflow

- **Every push to `main`** → Vercel builds and deploys to production automatically.
- **Every push to a branch / PR** → Vercel builds a preview URL. To make login work on that preview, either add the URL to Firebase Auth authorized domains, or attach a stable custom domain to the production branch only.
- **Firestore changes** → bump `firestore.rules` / `firestore.indexes.json`, commit, then run the `firebase deploy` command above. Vercel does not deploy these.

## SPA routing

`vercel.json` rewrites everything to `index.html` so client-side routes like `/patient/dashboard` survive a hard refresh. If you delete this file, deep links will 404.

## Production checklist before pilot

- [ ] `VITE_ENABLE_SEED` is unset or `false` (demo accounts hidden)
- [ ] All `VITE_FIREBASE_*` env vars set in Production scope
- [ ] Production domain added to Firebase Auth authorized domains
- [ ] `firestore.rules` deployed to the production project
- [ ] `firestore.indexes.json` deployed (composite indexes for inbox/audit queries)
- [ ] Test login → patient dashboard → upload doc → apply → withdraw on the live URL
- [ ] Test login as agency + admin on the live URL
- [ ] Confirm CRMC's email server can receive Firebase Auth password-reset emails (`noreply@<project>.firebaseapp.com`)

## Bandwidth note

Documents are stored as base64 in Firestore and re-fetched on view. Vercel Hobby tier includes 100 GB/month bandwidth. If patient document volume grows past pilot scale, migrate doc content to Cloud Storage (keep the metadata in `documents/`) before upgrading to Vercel Pro.

## Alternative: Firebase Hosting

If you'd rather host on Firebase (one less service to manage):

```bash
# Add to firebase.json:
#   "hosting": { "public": "dist", "rewrites": [{ "source": "**", "destination": "/index.html" }] }
npm run build
firebase deploy --only hosting
```

Both work for thesis/pilot scale. Vercel wins on deploy previews per branch; Firebase Hosting wins on tool consolidation.