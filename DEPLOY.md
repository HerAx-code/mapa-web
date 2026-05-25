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

---

## Pre-Pilot Operational Runbook

Items that aren't shipped by `git push` — you (or whoever runs CRMC IT)
have to do these manually before the first patient onboards.

### A. Deploy Firestore rules + indexes

Frontend deploys via Vercel push, but Firestore rules and composite
indexes live on Firebase and need a separate push:

```bash
npm i -g firebase-tools     # one-time install
firebase login              # one-time browser auth
firebase use mapa-crmc      # link to the project
firebase deploy --only firestore:rules,firestore:indexes
```

Re-run **only** the `firebase deploy --only firestore:rules,firestore:indexes`
command any time you edit `firestore.rules` or `firestore.indexes.json`.

**Rules pending deploy as of this writing:** the `notificationErrors`
collection rule (commit 252f47a) and the `hospitalIds` agency-cooldown
update rule (commit fdc9b74). Without deploying these, the notify
error log will silently fail and the hospital-ID cooldown writes will
hit PERMISSION_DENIED at agency approval time.

### B. Email deliverability test

Firebase Auth sends from `noreply@mapa-crmc.firebaseapp.com` by default.
Some Filipino email providers / corporate filters block this sender.
**Before the first real patient registers**, send yourself a real reset:

1. Open https://mapa-web-six.vercel.app/login
2. Click **Forgot password?**
3. Enter your own email (one you can check)
4. Watch for the email — confirm it lands in **Inbox**, not Spam, not
   silently rejected
5. If it lands in Spam:
   - Firebase Console → Authentication → Templates → Customize the
     sender domain to one your DNS controls (e.g. `auth.mapa-crmc.com`)
   - Add SPF + DKIM records per Firebase's guide
   - Retest

If you skip this, patients who can't log in will email support saying
"the reset link never arrived" and you'll have no way to confirm
whether it was sent.

### C. Enable Firestore Point-in-Time Recovery (PITR) backups

Default Firestore retention is the present moment only — there is no
undo for accidental writes / deletes. PITR keeps a 7-day rewind window.

1. Firebase Console → Firestore Database → **Backups** tab
2. Enable **Point-in-time recovery** for the default database
3. Cost: ~$0.18/GB/month plus restore-time compute. For pilot data
   volumes this is a few cents/month — buy the insurance.

You'll also want a periodic export:

```bash
# One-time: create a GCS bucket for backups
gsutil mb -p mapa-crmc -l asia-southeast1 gs://mapa-crmc-firestore-backups/

# Manual export (run weekly via Cloud Scheduler when you're ready):
gcloud firestore export \
  gs://mapa-crmc-firestore-backups/$(date +%Y-%m-%d) \
  --project mapa-crmc
```

### D. Schedule the orphan-document cleanup

The cleanup script at `scripts/cleanup-orphans.js` finds
`documentContents/{id}` entries with no matching `documents/{id}`
(orphans from failed delete races; each is ~900KB of permanent waste).

**Already wired** as a GitHub Actions workflow at
`.github/workflows/cleanup-orphans.yml`. To activate:

1. Firebase Console → Project Settings → **Service accounts** →
   Generate new private key. Download the JSON file.
2. GitHub → repo → Settings → **Secrets and variables → Actions** →
   New repository secret:
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: paste the entire contents of the downloaded JSON
3. The workflow runs every Sunday 11:00 AM Manila in **dry-run mode**
   by default — it audits and reports orphans without deleting.
4. Once you've reviewed a few runs and trust the logic, dispatch the
   workflow manually with `delete=true` to actually clean up:
   GitHub → Actions → "Cleanup Firestore orphans" → Run workflow →
   set `delete` to `true`.

**Delete the JSON file from your local machine** after pasting into
the GitHub secret. Never commit it.

### E. Add Vercel deploy URL to Firebase Auth authorized domains

Already in step 3 of the initial setup, but worth re-confirming any
time you add a custom domain or a new preview URL where login should
work:

- Firebase Console → Authentication → Settings → Authorized domains
- Verify `mapa-web-six.vercel.app` is listed
- Add your custom domain if you've pointed one
- `auth/unauthorized-domain` errors at login are always caused by a
  missing entry here

### F. Final pre-pilot smoke test

After A–E above are done, run an end-to-end test as a real patient:

1. Use a fresh access code from CRMC Medical Social Services
2. Register a real (test) patient account
3. Upload one document
4. Apply to a test agency
5. Switch to agency role → approve the application
6. Print + mark issued + upload signed scan
7. Switch back to patient → confirm GL is downloadable
8. Reverse the approval as agency → confirm cooldown is enforced on
   re-attempt
9. Test password reset on the patient account from /login

If any step misbehaves, that's a real bug. If they all work, you're
pilot-ready.