# MAPA Recovery & Hardening Plan

> Sourced from the senior-engineer onboarding review on 2026-06-19. Findings
> were prioritized by defense-blocking impact, not by category.
>
> **Status as of 2026-06-27: substantially complete.** All of Phase 0,
> all of Phase 1, most of Phase 2 (excluding the big page splits), most
> of Phase 3, and 9 of 10 Phase 4 questions are shipped + deployed.
> The remaining items are the two architectural page splits (2.1/2.2),
> the i18n linter (3.2), pagination (3.4), and a server-side rate
> limit (3.5). See the "Execution log" section at the bottom for the
> commit-by-commit ledger.

---

## Phase 0 — Emergency (defense-blocking, ship today/tomorrow morning)

**Estimated total: 2 hours.** Don't skip Phase 0 because the day plan
says "calm-down day." A panel that finds the documentContents rule leak
in 30 seconds is worse than a slightly rushed morning.

### 0.1 Rotate the service account key (30 min)

**Sequence matters — don't disable the old key until the new one works.**

1. GCP Console → IAM & Admin → Service Accounts → find the account in
   `service-account.json` (`firebase-adminsdk-*@mapa-crmc.iam.gserviceaccount.com`)
2. Keys tab → **Add Key → JSON** → download
3. Save as `service-account.json` in repo root, overwriting the old one
4. Verify:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/check-demo-accounts.js
   ```
   Should print `11/11 OK`.
5. Once verified, return to GCP Console → **Disable** (not Delete) the
   old key. Disable preserves a recovery path.
6. Wait 5 min, re-run the demo check. If green, **Delete** the old key.

**Audit git history for any past commit of the file:**
```bash
git log --all --full-history --source -- service-account.json
git log --all -p -- service-account.json | head -50
```
- If nothing: `.gitignore` did its job, you're fine
- If the file ever landed in a commit: use BFG
  (`bfg --delete-files service-account.json`), then
  ```bash
  git reflog expire --expire=now --all
  git gc --prune=now --aggressive
  git push --force
  ```
  Solo project means no coordination needed, but verify Vercel deploys
  still build after the force push.

**Verification**: demo check passes with the new key, old key disabled
in console.

---

### 0.2 Fix `documentContents` cross-agency leak (15 min)

`firestore.rules:488`. Currently:
```
allow read: if isAuth() && (resource.data.patientId == uid() || isAdmin() || isAgency())
```

Change to mirror the `documents` collection rule on line 219:
```
allow read: if isAuth() && (
  resource.data.patientId == uid() ||
  isAdmin() ||
  (isAgency() && userAgencyId() in
    get(/databases/$(database)/documents/documents/$(docId)).data.agencyIds)
);
```

**Tradeoff**: adds one rules-eval `get()` per content read. Comments in
the file already acknowledge similar `get()` chains as deliberate
(lines 399-404). Acceptable at pilot scale; revisit if rules-eval quota
becomes a constraint.

**Test before deploy**:
1. Sign in as `coordinator@malasakit.gov.ph`
2. Try to open a document from a request NOT endorsed to Malasakit —
   should fail
3. Open a document from a Malasakit-endorsed request — should succeed
4. Sign in as patient → own documents still readable
5. Sign in as admin → all documents readable

**Deploy**: `firebase deploy --only firestore:rules`

**Rollback**: `git revert` the commit and redeploy. The previous rule
becomes live again in <60 sec.

---

### 0.3 Lock down `hospitalIds` enumeration (10 min)

`firestore.rules:313`. Currently:
```
allow get: if true;
```

Without Blaze, no Cloud Function path. Degrade gracefully — keep
`allow get: if true` BUT strip the `usedBy` field from the doc shape.
Make it:
```
{ used: true | false, usedAt?: ts }
```
Move `usedBy` (patient name + uid) to a sub-collection
`hospitalIds/{id}/usage/{usageId}` that requires `isAuth()`.

**Why not** the simpler `allow get: if isAuth()` change: registration
happens before sign-in. Anonymous sign-in (`signInAnonymously()`)
works but adds UX friction. The strip-`usedBy` path keeps the flow
intact.

**Migration script** (`scripts/migrate-hospital-ids.js`):
```js
// pseudocode
for each doc in hospitalIds:
  if doc.usedBy exists:
    move { usedBy } to hospitalIds/{id}/usage/{auto-id}
    delete usedBy from parent doc
```

**Test**: fresh registration with a new test code works end-to-end.

---

### 0.4 Forge-proof certificate creation (10 min)

`firestore.rules:472`. Add an `appId == userAgencyId()` cross-check:
```
allow create: if isAdmin() ||
  (isAgency() &&
   request.resource.data.agencyId == userAgencyId() &&
   get(/databases/$(database)/documents/applications/$(certId)).data.agencyId == userAgencyId());
```

**Test**: sign in as Malasakit, try to create a cert for a DSWD
application via direct REST. Should be rejected.

---

### 0.5 Cap the runaway admin listener (5 min)

`src/pages/admin/Requests.jsx:1199`. Add `limit(500)` to the
applications listener:
```js
import { ..., limit } from 'firebase/firestore'

const u3 = onSnapshot(
  query(collection(db, 'applications'),
    where('status', 'in', ['endorsed', 'reviewing', 'awaiting_info', 'approved', 'certificate', 'rejected']),
    limit(500)),
  snap => setAllSlices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
  () => setAllSlices([]),
)
```

**Test**: open `/admin/requests`, verify the table still populates.
At pilot scale this is invisible; at production scale it caps the
damage. Pagination becomes a real ticket if you ever see exactly 500
rows in production.

---

### 0.6 Commit + deploy Phase 0 (15 min)

One commit per fix so each is independently revertable:
```bash
git add firestore.rules
git commit -m "fix(rules): tighten documentContents cross-agency read"
firebase deploy --only firestore:rules
# (repeat for hospitalIds, certificates)

git add src/pages/admin/Requests.jsx
git commit -m "perf: cap admin requests live listener at 500 docs"
git push origin main  # Vercel auto-deploys
```

After each commit, run the full demo smoke test in a real browser
(not localhost — rules deploy is production).

**At this point you can defend the system without a "wait, there's
a rules leak" moment.**

---

## Phase 1 — Safety net (this week)

Smaller surface, lower stakes, but every item raises the floor of
what can go wrong silently.

### 1.1 Top-level error boundary (45 min)

Create `src/components/ErrorBoundary.jsx`:
```jsx
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
    // optional: write to auditLog as a render_error event
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="card p-6 max-w-md text-center">
            <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-500 mb-4">
              Please refresh the page. If it keeps happening, sign out and back in.
            </p>
            <button className="btn-primary" onClick={() => window.location.reload()}>Refresh</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
```
Wrap in `App.jsx` around the `<Routes>` block.

**Test**: temporarily throw inside any page render, confirm the
fallback shows. Then revert the throw.

---

### 1.2 Cap `documentContents` upload size (5 min)

`firestore.rules:495`. Add to both update predicates:
```
&& request.resource.data.content.size() <= 1000000
```
Deploy, test by uploading a valid doc.

---

### 1.3 Dev-gate the console noise (30 min)

Bulk grep + audit:
```bash
rg -n "console\.(error|warn|log)" src/ | head -30
```
Wrap each non-critical statement:
```js
if (import.meta.env.DEV) console.error('[Foo] thing failed:', err)
```
For things that should reach prod logs (security-relevant, auth
failures), leave them alone. Use judgment.

---

### 1.4 Service-worker role-change banner (45 min)

Add to `Layout.jsx`:
```js
const lastRole = useRef(user?.role)
useEffect(() => {
  if (lastRole.current && user?.role && lastRole.current !== user.role) {
    toast('Your role changed — please refresh.', { duration: Infinity, icon: '🔄' })
  }
  lastRole.current = user?.role
}, [user?.role])
```

Handles the rare case agents flagged: cached chunks vs. new role.
Five lines, no infrastructure cost.

---

### 1.5 Enable Firestore offline persistence (15 min)

`src/firebase.js`:
```js
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore'

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
})
```
Replace the existing `getFirestore(app)` call. No code changes
elsewhere — Firestore handles it transparently.

**Test**: load `/patient/dashboard`, DevTools → Network → Offline,
navigate around. Cached docs should still render.

---

### 1.6 Commit + deploy Phase 1 (30 min)

One commit per item. Verify the demo flow after each.

---

## Phase 2 — Architecture refactors (next sprint, post-defense)

These need code review and a calm afternoon. **Don't ship them this
week.** Don't slip them into Phase 0/1 commits.

### 2.1 Split `ApplicationDetail.jsx` (1 day)

Target: under 800 lines.

1. Move slice-status branching (the giant `if (app.status === 'submitted') ... else if ...` chain) into
   `src/pages/agency/applicationDetail/statusConfig.js`
2. Extract `useApplicationApproval()` hook in `src/hooks/` — owns
   `showApprove`, `handleApprove`, transaction logic
3. Extract `useApplicationRejection()` and `useRequestInfo()` similarly
4. Page becomes: `<Layout>` → status config render → modal hooks
   wire-up

**Verification**: every existing test case (approve, reject, request
info, GL issuance, expiry, redeem) still works in browser.

### 2.2 Split `Messages.jsx` (1 day)

The three inline modals (`ConversationModal`, `PatientComposeModal`,
`AdminComposeModal`) each get their own file in `src/components/admin/`.
Extract `useCompose()` for the shared logic.

### 2.3 Extract `useModal` and shared UI helpers (half day)

```js
// src/hooks/useModal.js
export const useModal = (initial = false) => {
  const [open, setOpen] = useState(initial)
  return {
    open,
    openModal: () => setOpen(true),
    close:     () => setOpen(false),
  }
}
```

Promote `<Field>` and `<PesoInput>` from `IntakeSheet.jsx` to
`src/components/ui/`. Same for any other helper still co-located.

### 2.4 Migrate profile photos to Cloud Storage (half day)

Mirror the patient-document pattern. Rules already exist in
`storage.rules`. Migration:
- New uploads → Cloud Storage
- Existing base64 in `users/{uid}.photoURL` stays as-is (read-only fallback)
- `<Avatar>` component handles both: if `photoURL` starts with `data:`,
  render directly; if `https://`, render normally
- No backfill script needed; users re-upload over time

### 2.5 Resolve `audience` vs `targetRoles` (15 min decision, 30 min code)

These are two names for the same concept. R38 added `targetRoles`;
agency forms still write `audience: 'patients'`.

**Recommended**: deprecate `audience`. Reasons:
- `targetRoles` is structured (array), `audience` is a magic string
- `targetRoles` cleanly handles future "agencies + admins" combinations
- The `audience` field on agency promotions duplicates
  `targetRoles: ['patient']`

**Migration**:
1. In agency form `onSave`: write both fields for back-compat
2. Update `computeTargetRoles` to ignore `audience` and only trust
   `targetRoles`
3. In a follow-up release, stop writing `audience`

### 2.6 Set up rules unit tests (half day)

```bash
npm install --save-dev @firebase/rules-unit-testing
firebase init emulators  # pick firestore
```

Smoke test for each collection: at least one positive + one negative
case per role:
```js
// tests/rules/documents.test.js
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing'

test('agency cannot read a document not in their agencyIds', async () => {
  const malasakitCtx = env.authenticatedContext('mal-user', {
    role: 'agency',
    agencyId: 'malasakit',
  })
  await assertFails(
    getDoc(doc(malasakitCtx.firestore(), 'documents/foreign-doc'))
  )
})
```

Run on every push (add to `package.json` `test` script). This is your
real defense against the documentContents-style leak ever happening
again.

---

## Phase 3 — Engineering debt (this quarter)

### 3.1 Lazy-load tesseract.js (1 hour)

Audit `package.json` for `tesseract.js`. In the OCR call site, change
the import:
```js
const performOCR = async (image) => {
  const { createWorker } = await import('tesseract.js')  // lazy
  const worker = await createWorker('eng')
  // ...
}
```

Verify in build output: tesseract should be in its own chunk, not in
`index-*.js`. If `dist/assets/index-*.js` shrinks by ~2 MB, it worked.

### 3.2 i18n linter (2 hours setup + ongoing fixes)

```bash
npm install --save-dev eslint-plugin-i18next
```
`.eslintrc`:
```json
{ "extends": ["plugin:i18next/recommended"] }
```
Set the rule severity to `'warn'` first. Drive the warning count to
zero over a week. Then promote to `'error'`.

Start with the patient surfaces — they're the ones that actually
need i18n.

### 3.3 Agency cache in `LiveDataContext` (1 hour)

```js
// LiveDataContext.jsx
const [agencyMap, setAgencyMap] = useState({})
useEffect(() => {
  if (!user) return
  const unsub = onSnapshot(collection(db, 'agencies'), snap => {
    const map = {}
    snap.docs.forEach(d => map[d.id] = { id: d.id, ...d.data() })
    setAgencyMap(map)
  })
  return unsub
}, [user?.uid])
```

Then `TrackStatus.jsx:380` becomes one O(1) lookup instead of N
getDocs.

### 3.4 Pagination on `admin/Requests.jsx` (half day)

Replace the unbounded listener with cursor-based pagination:
- First page: `limit(50)` ordered by `createdAt desc`
- "Load more" button: `startAfter(lastDoc)`
- Update the snapshot listener to only watch the visible page

### 3.5 Server-side access code rate limiting (deferred — needs Blaze)

Document as "post-Blaze improvement." Cloud Function with reCAPTCHA v3.
Not worth working around without the infrastructure.

### 3.6 Sunset legacy `address` flat string field

Decide: is `users.address` (joined) or `users.{barangay,city,province}`
(structured) the source of truth? The Guarantee Letter reads `address`.
R39 derives it from the structured fields. Pick one.

**Recommended**: structured is source of truth, `address` is a derived
read-only mirror that's rewritten on every save. Document the decision
in CLAUDE.md. Audit GL render to read structured fields directly so
you can drop the mirror in a future release.

---

## Phase 4 — Open question resolution

| # | Question | Action |
|---|---|---|
| 1 | Why does `ProfileModals.jsx` own 4 unrelated modals? | Split during Phase 2.3. Replace with a `ProfileModalContext` so any page can dispatch open. |
| 2 | `address` vs `barangay/city/province` | Phase 3.6 — pick structured as source of truth |
| 3 | `referralSuggestions.resultingApplicationId` never set | Either wire it on `handleAcceptSuggestion` (accepted suggestions track to the endorsement), or remove from schema |
| 4 | R34 watchers populated but never read | Investigate: is the notification fan-out wired? Search for `requests.watchers[]` reads. If unused, document as "planned for Phase 2" |
| 5 | `audience` vs `targetRoles` | Phase 2.5 — deprecate `audience` |
| 6 | OCR lazy-loaded? | Phase 3.1 — verify in build output |
| 7 | Demo seed in CLI vs. UI | Add a super-admin-only "Seed demo data" button on `/admin/dashboard`. 2 hours. Independence from CLI = defense reliability. |
| 8 | Access code revoke + reissue UI | Add to admin/Patients page. 4 hours including audit log entries. |
| 9 | No tests | Phase 2.6 — start with rules tests, add component tests as bugs surface |
| 10 | "Installed app is for patients" | Investigate `Layout.jsx:1010`. Either i18n it or update the comment to reflect reality. |

---

## Timeline

| When | What | Hours |
|---|---|---|
| **Tomorrow morning** (replaces day plan §1.2-1.3) | Phase 0 emergency | 2 |
| **Tomorrow afternoon** (replaces day plan Block 2) | Phase 1 safety net | 3 |
| **Day after tomorrow** | Document + rehearse (original day plan Blocks 2 + 3) | 4 |
| **Sprint 1** (next 2 weeks) | Phase 2 architecture | ~5 days |
| **Sprint 2-3** | Phase 3 engineering debt | ~5 days |
| **Anytime** | Phase 4 question resolution | ~3 days scattered |

**Total recovery cost: ~20 engineer-days.** Most of it post-defense.

---

## Pre-defense hard line

If only **four hours** are available before defense:
- **Phase 0 entirely** (2 hours)
- **Phase 1.1** error boundary
- **Phase 1.5** offline persistence
- **Phase 4 #10** fix the English-only string

After that, the system isn't perfect but it's defensible. Every other
item can be on the "known and scheduled" slide.

---

## How this interacts with the existing day plan

`docs/day-plan-2026-06-20.md` was written as a calm-down day. The
review surfaced four items that override that intent:

1. Phase 0.1 (service account rotation) replaces the morning quota probe
2. Phase 0.2-0.4 (rule fixes) replace the §1.2 test matrix's first half
3. Phase 0.5 (limit on listener) is a one-line fix that fits anywhere
4. Phase 1 items fit into the original Block 2 slot

**Recommended order tomorrow**:
- 30 min: Phase 0.1 service account
- 30 min: Phase 0.2-0.5 rule fixes + deploy
- 30 min: re-run `check-demo-accounts` + browser smoke test
- 90 min: original day plan §1.2 test matrix (now with hardened rules)
- 30 min: lunch
- 3 hours: original day plan Block 2 (thesis docs)
- 90 min: original day plan Block 3 (rehearsal)

Skip Phase 1 if energy runs out — Phase 0 is the hard line, not Phase 1.

---

## Decision log

Items that need an explicit decision before code:
1. **Phase 0.3** — strip-`usedBy` vs anonymous-sign-in. Recommend strip-`usedBy`.
2. **Phase 2.5** — deprecate `audience` vs `targetRoles`. Recommend deprecate `audience`.
3. **Phase 3.6** — `address` source of truth. Recommend structured.
4. **Phase 4 #3** — write or remove `resultingApplicationId`. Recommend wire it (accepted suggestions are auditable).
5. **Phase 4 #4** — R34 watcher reads. Investigate first; might be dead schema.

Once decided, document each in CLAUDE.md so the next reviewer doesn't
have to re-derive them.

---

> **Reminder for future-self**: this plan was written in the context of
> a 2026-06-19 review. Re-read the review (in conversation history or
> as a separate doc) for the "why" behind each item. If a finding here
> looks too aggressive or too lax, the conversation has the reasoning.

---

## Execution log (2026-06-19 → 2026-06-27)

### Closed in production

| Item | Commit | Note |
|---|---|---|
| 0.1 Service account key rotated | (manual) | Jun 27 key active; Jun 1 + Jun 5 keys deleted in GCP console |
| 0.2 documentContents cross-agency leak | `77e959f` | Rule live; **rules test pinning** added in `371a6c4` |
| 0.3 hospitalIds privateInfo sub-doc | `b37043c` | Chose Option A (strip-`usedBy`); 1 record migrated; tests added in `371a6c4` |
| 0.4 Certificate forge-protection | `77e959f` | get() chain on parent application; tests in `371a6c4` |
| 0.5 Admin listener limit(500) | `224a6df` | One-line cap; pagination (3.4) deferred |
| 1.1 ErrorBoundary | (pre-existing) | Already wired in `main.jsx` since May; review missed it |
| 1.2 documentContents size cap | `c939815` | + dedicated test |
| 1.3 Dev-gate console noise | `c939815` | One-line Vite esbuild config (drops console.log/debug/info from prod builds) |
| 1.4 Role-change refresh banner | `c939815` | `useRef`-tracked role transition in Layout |
| 1.5 Firestore offline persistence | `c939815` | `persistentLocalCache` + multi-tab manager |
| 2.3 useModal + Field/PesoInput → ui/ | `e2905cf` | Three new files; IntakeSheet updated; future modal sites use the hook |
| 2.4 Profile photos → Cloud Storage | (this commit) | Code shipped + storage rules updated; **awaiting one-time Firebase Storage initialization** (Console "Get Started" click) |
| 2.5 Deprecate `audience` field | `f93e748` | Simpler than planned — nothing read it |
| 2.6 Rules unit tests for Phase 0/1 | `371a6c4` | **75/75 pass**; +21 assertions across 3 files; caught a fundSource bug in our own hotfix that we shipped earlier the same night |
| 3.1 Lazy-load tesseract.js | (pre-existing) | Already a dynamic import; verified |
| 3.3 Agency cache in LiveDataContext | (this commit) | Kills N+1 in TrackStatus; available to any future page |
| 3.6 Sunset legacy `address` field | (this commit) | `formatUserAddress` helper + GL render switched; structured fields canonical |
| 4.3 `resultingApplicationId` removed | (this commit) | Was dead field; wiring would have been ~2h on a critical path for marginal value |
| 4.4 R34 watcher reads | (closed) | Already wired -- notifications fan out on approve/reject in agency/ApplicationDetail |
| 4.5 audience vs targetRoles | duplicate of 2.5 | |
| 4.6 OCR lazy-loaded | duplicate of 3.1 | |
| 4.7 Super-admin Seed demo button | (this commit) | Reseeds the 14-day-expiry announcements without CLI dependency |
| 4.8 Access code revoke confirm | (this commit) | Inline-row amber confirmation; revoke already existed but was a one-click destructive action |
| 4.10 PWA staff-blocker bilingual | `625428d` | New `shell.staffInPWA` i18n namespace |

### Production hotfixes that surfaced during execution

| Issue | Commit | Cause |
|---|---|---|
| `ReferenceError: orderBy is not defined` in ApplicationDetail | `61a1350` | Latent missing import from R33 (May); dev silently resolved it; today's chunk churn forced a re-download |
| Missing composite indexes | `79f51e3` | Two indexes (auditLog requestId+createdAt, referralSuggestions status+createdAt) added at the same time as the queries but never written to firestore.indexes.json |
| GL expiry sweep permission denied | `79f51e3` | Agencies update rule blocked all coordinator budget writes; sweep needs `budget.committed` mutation. Hotfix: pin only `allocated` + `fundSource` |
| `fundSource is undefined on object` | `371a6c4` | Above hotfix had a brittle equality check on a potentially-missing field. **Caught by the rules tests we wrote in 2.6.** Replaced with `.get('fundSource', null)` |

### Still pending (post-defense)

| Phase | Item | Why not now |
|---|---|---|
| 2.1 | Split ApplicationDetail.jsx (1,991 lines) | High regression risk; explicitly "post-defense" in original plan |
| 2.2 | Split Messages.jsx (1,460 lines) | Same |
| 3.2 | i18n linter | Tooling cleanup; doesn't change runtime |
| 3.4 | Real pagination on admin/Requests | `limit(500)` cap from 0.5 buys 100× headroom; revisit at scale |
| 3.5 | Server-side rate limit on access codes | Now possible on Blaze; not yet built |
| 4.1 | ProfileModalContext | Depends on a broader Layout refactor |
| 4.2 | Address structured vs flat decision | Settled via 3.6 helper; doc explicitly resolves it |
| 4.9 | Open-ended component tests | Time-unbounded; add as bugs surface |

### Manual step required for 2.4

Profile photo migration is **code-complete** but won't activate until
Firebase Storage is initialized on the project:

  1. Open https://console.firebase.google.com/project/mapa-crmc/storage
  2. Click **Get Started**
  3. Accept the default location (asia-southeast1 — same region as Firestore)
  4. From terminal: `firebase deploy --only storage`

Until then:
  - Existing base64-stored profile photos render fine (data: URLs work)
  - New uploads will throw on the `uploadBytes()` call -- toast surfaces the error
  - The user can keep their existing photo or remove it

After the Storage init + deploy, new uploads write to
`/profilePhotos/{uid}/avatar.jpg` and the download URL goes into
`users/{uid}.photoURL`. Old base64 photos coexist seamlessly.

### Key learnings worth carrying forward

1. **Build chunk churn surfaces latent bugs.** Three of the four
   hotfixes above only surfaced because a different commit invalidated
   the chunk hash. Re-deployment is its own test.
2. **The rules tests added in 2.6 paid for themselves the same night**
   by catching the `fundSource` issue.
3. **`firebase firestore:indexes` shows the registered list** but not
   build state -- always confirm via Firebase Console after a deploy.
4. **Every new Firestore query needs three things**: a matching import,
   a composite index if it filters+orders on multiple fields, and a
   rule path that permits every transaction step.
