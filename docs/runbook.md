# MAPA operational runbook

Last updated: 2026-06-01.

What to do when something breaks. Organised by scenario; each entry
links to the underlying scripts / files / rule paths.

## Routine procedures

### Deploy Firestore rules

```powershell
firebase deploy --only firestore:rules
```

**Before deploying:** run the rules tests against the local emulator if
your JDK is 21+:

```powershell
npm run test:rules
```

Tests not running is acceptable for emergency hotfixes; in normal flow,
they should pass. See `tests/rules/README.md` for setup.

**After deploying:** verify the deploy in the Firebase Console under
Firestore → Rules → History. The latest entry should reference the
commit you just deployed.

**If the deploy locks you out:**
Sign in via the service account (admin SDK) — it bypasses rules. From
there, re-deploy the previous known-good rules version via the Console's
"Rollback" affordance on the History page.

### Deploy app changes

```powershell
npm run build
firebase deploy --only hosting
```

The build output goes to `dist/`. Firebase Hosting takes ~30 seconds to
roll over.

### Deploy Cloud Functions (Blaze plan only — not required for the pilot)

The pilot runs on the free **Spark plan**. The Cloud Functions in
`functions/` are NOT deployed; they exist as future work for a
production deploy on Blaze. The same scheduled work is currently done
by client-side lazy fallbacks in `src/pages/agency/Dashboard.jsx`:

- **Slot reset** — when an agency user opens the dashboard, the first
  read of the day flips `slots.remaining = slots.total` if
  `lastResetDate` doesn't match today's Manila date.
- **GL expiry sweep** — same useEffect on dashboard load walks the
  agency's `applications` where `glStatus='issued'`, expires any past
  the 30-day window, releases committed budget, and audit-logs each.

This means: an agency must open the dashboard at least once per day
for the slot reset and expiry sweep to run. In practice this happens
naturally (coordinators check their inbox every morning), but if no
one logs in for a multi-day stretch, the resets back-fill on the next
visit.

**If you do upgrade to Blaze later:**

```powershell
firebase deploy --only functions
```

Deploys:
- `resetAgencySlots` — daily 00:00 Asia/Manila, `asia-southeast1`
- `glExpirySweep` — hourly, `asia-southeast1`

The client-side fallbacks remain (defense in depth). Both paths use
the same end-state, so an overlap is a no-op (the function re-reads
inside its transaction; the client sweep skips already-expired rows).

**Local emulator** (no Blaze, no billing):

```powershell
firebase emulators:start --only firestore,functions
```

Loads both definitions; scheduler triggers won't fire without the
Pub/Sub emulator, but you can exercise them manually:

```powershell
firebase functions:shell
> resetAgencySlots()
> glExpirySweep()
```

### Deploy Firestore indexes

```powershell
firebase deploy --only firestore:indexes
```

Add this alongside the rules deploy whenever a new index is added to
`firestore.indexes.json`. Indexes can take several minutes to build on
prod.

### Deploy Storage rules

```powershell
firebase deploy --only storage
```

Use after editing `storage.rules`. Takes effect in ~30 seconds.

### Migrate documentContents to Cloud Storage (one-shot)

After Tier-2 item 8, NEW patient document uploads go to Cloud Storage
at `/documents/{patientId}/{docId}/{file}`. Existing legacy documents
keep their base64 content in the `documentContents` Firestore collection
until this migration runs.

```powershell
# 1. Dry-run audit -- prints intended uploads, no writes
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
node scripts/migrate-doc-content-to-storage.js

# 2. Apply -- uploads each base64 to Storage + stamps storagePath on
#    the corresponding documents/{docId} doc. Idempotent.
node scripts/migrate-doc-content-to-storage.js --apply

# 3. Apply + delete -- same as #2 but ALSO removes the legacy
#    documentContents docs after the Storage upload + stamp succeeds.
node scripts/migrate-doc-content-to-storage.js --apply --delete
```

Resumable: each iteration reads the current state of
documents/{docId}.storagePath and skips already-migrated docs.
Interrupting mid-run is safe.

**Order on first deploy:**

1. Deploy code (`firebase deploy --only hosting`)
2. Deploy rules + indexes + Storage rules
3. Run migration script with `--apply --delete`

New uploads go to Storage from step 1 onward, so users uploading during
the migration window aren't affected.

### Run unit tests

```powershell
npm test              # fast utils-only, no emulator
npm run test:rules    # rules tests, requires JDK 21+ + emulator
npm run test:all      # both
```

### Run the user bootstrap (first deploy / new project)

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
node scripts/bootstrap-users.js
```

Idempotent. Creates the 10 seed users (super_admin, staff_admin,
4 agency_admins, 4 coordinators, 1 demo patient). Safe to re-run; it
will report `created / repaired / skipped / failed` counts.

### Re-seed reference data

After bootstrap-users, sign in as `admin@crmc.gov.ph` in the web app
and visit `/seed`. Click **Seed Database** to refresh agencies, document
types, assistance types, and hospital IDs.

## Incident response

### "I think someone planted bad data in the audit log"

Symptom: entries with `actorId == 'system'` or actor names like
"Migration Daemon" / "Recovery Engine" / "Rules Engine" in
`/admin/auditlog`. Possibly carrying shell-command payloads in
`details`.

**Step 1:** Confirm rule layer is deployed. Open Firebase Console →
Firestore → Rules → History. The current version should require
`actorId == request.auth.uid` (introduced commit `f14ea17`). If not,
deploy `firestore.rules` immediately.

**Step 2:** Audit the planted entries:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
node scripts/cleanup-injection-audit.js
```

Dry-run; lists candidates with actor / action / details preview.

**Step 3:** If the candidates look correct (no legitimate entries
accidentally caught), purge:

```powershell
node scripts/cleanup-injection-audit.js --delete
```

For broader matching (catches `details` containing `claude -p`,
`firebase deploy`, etc.):

```powershell
node scripts/cleanup-injection-audit.js --strict --delete
```

**Step 4:** Record the cleanup in your project log. Admin-SDK deletes
are not audit-logged — there is no client-visible record.

### "A user got locked out after a rule deploy"

Symptom: a user reports they can no longer read or write some
collection, traceable to the latest rule deploy.

**Step 1:** Open Firebase Console → Firestore → Rules → History.
Compare the current rules to the previous version. Identify the rule
that changed for the affected collection.

**Step 2:** Reproduce locally:

```powershell
npm run test:rules
```

Add a test case that matches the user's role + write payload.
The test will fail (and explain why).

**Step 3:** Either patch the rule in `firestore.rules` and re-deploy,
or use the Console's **Rollback** to revert to the previous version
while you investigate.

### "The Firebase project is showing high cost / unusual reads"

Open Firebase Console → Usage and billing.

Common causes:

1. **A subscription loop** — `onSnapshot` re-subscribing on every
   render. Check Layout re-mounts (see deferred L6 finding in
   `docs/revision-list.md` §B.13).
2. **A missed `where` clause** — a list query without a constraint
   pulls the whole collection. The L1 finding in `docs/revision-list.md`
   §B.13 documents one such case.
3. **Background traffic from a script** — check whether a cleanup or
   migration script is still running.

### "I accidentally deployed broken Firestore rules"

**Immediate:** Firebase Console → Firestore → Rules → History → click
the previous version → **Rollback**. Takes effect in ~30 seconds.

**Then:** in your local repo, `git revert` the offending commit, make
sure `npm run test:rules` passes against the reverted version,
re-deploy.

**Do NOT** try to deploy a fix on top of a broken rule without testing
locally first. A rule that takes down the patient flow can be
catastrophic for the pilot.

### "The dev server is dead"

```powershell
npm run dev
```

If it dies on start with `EADDRINUSE`: port 5173 is held by an old
node. `taskkill /F /IM node.exe` and retry.

### "I need to find the latest activity for a specific patient"

`admin/AuditLog` filters by actor name. For a holistic view of one
patient across applications, requests, slices, notifications, and
documents: use the patient's `uid` and query each collection. There is
no single "patient timeline" view yet — `docs/revision-list.md`
documents this as future work.

## Credential rotation

### Service account key

The service account key file (commonly
`C:\Users\<you>\Downloads\mapa-crmc-firebase-adminsdk-*.json`) has full
admin SDK access. Rotate on:

- Personnel change (someone leaves the project).
- Suspected compromise.
- Annually as a baseline.

**Steps:**

1. Firebase Console → Project Settings → Service Accounts → Manage
   service account permissions → identify the existing key.
2. Generate a new private key.
3. Update `$env:GOOGLE_APPLICATION_CREDENTIALS` (or the equivalent on
   the operator's machine).
4. Verify by running `node scripts/bootstrap-users.js` (idempotent —
   prints "already complete" for existing users).
5. Revoke the old key from the same screen.

### Firebase admin login passwords

The seed user passwords in `scripts/bootstrap-users.js` (`admin123` /
`agency123` / `patient123`) are demo-only. **Before any pilot rollout:**

1. Update `bootstrap-users.js` to use stronger passwords.
2. Re-run the script (idempotent — does NOT change passwords for
   existing Auth users; you'll need to use Firebase Console → Auth →
   per-user → Reset Password for any existing accounts).

### Vercel SMTP env vars

The `/api/send-email` Vercel route uses a Gmail App Password stored in
Vercel env vars. Rotate via:

1. Google account → Security → App Passwords → revoke + regenerate.
2. Vercel project → Settings → Environment Variables → update.
3. Re-deploy the Vercel project (env-var changes take effect on next
   deploy).

## Backup and recovery

### Firestore backup

Firebase ships automatic Point-in-Time Recovery for Firestore. To
restore to a specific timestamp:

```powershell
gcloud firestore databases restore --source-database=projects/mapa-crmc/databases/(default) --destination-database=projects/mapa-crmc/databases/restore-YYYYMMDD --snapshot-time="2026-06-01T00:00:00Z"
```

This creates a *new* database; you'd then need to manually copy
documents back to `(default)`. There is no scripted full restore.
Use the Firebase Console for manual document-level recovery in normal
cases.

### Auth backup

Firebase Auth users can be exported via `gcloud auth export-users`.
There is no scheduled backup; for a thesis pilot the user list is
small and re-derivable from `bootstrap-users.js`.

## Known-good versions / dependencies

| Component | Pinned version |
|-----------|----------------|
| Node | v24.15.0 (local) |
| Firebase CLI | 15.18.0 |
| Vite | 5.x |
| React | 18.x |
| Firebase JS SDK | 12.13.0 |
| Firebase Admin | 13.10.0 |
| Vitest | 4.1.8 |
| @firebase/rules-unit-testing | 5.0.1 |
| JDK (for emulator) | 21+ required by recent firebase-tools |

## Contacts and escalation

- **Pilot stakeholder:** CRMC Malasakit Center coordinator.
- **Adviser:** thesis adviser.
- **Hosting / domain:** Firebase Hosting + Vercel free tiers; no SLA.
- **Email channel:** Gmail App Password backed; if it stops, in-app
  notifications continue (see `src/utils/notifications.js`).

For technical incidents during the pilot, the operator (CRMC) reaches
out via the thesis-defined channel. There is no oncall rotation
because there is no oncall — this is a single-developer project.