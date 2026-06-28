# Firestore rules tests

Exercises `firestore.rules` against a local Firebase emulator using
`@firebase/rules-unit-testing`. Each test file owns a distinct
`projectId` so the test environments don't share state.

## What's covered

| File | Surfaces tested |
|------|-----------------|
| `auditLog.rules.test.js`         | `actorId == auth.uid` enforcement, `details` size cap, immutability, role-scoped reads (super_admin vs agency_admin vs patient) |
| `documents.rules.test.js`        | `documents.create`: patientId match, `status == 'pending'`, no agencyIds pre-stamp, ocrText size cap; `documentContents.create`: patientId match |
| `documentContents.rules.test.js` | **Phase 0.2** cross-agency read leak — agency can read only docs where userAgencyId() in parent's `agencyIds[]`; **Phase 1.2** 1MB size cap on update |
| `hospitalIds.rules.test.js`      | **Phase 0.3** parent retains unauth GET (registration path); `privateInfo/{id}` sub-doc gates name read to claimant + admin; create requires self-attribution + 120-char cap on `usedBy` |
| `messages.rules.test.js`         | `conversations.create` participant requirement; `messages.create` from-attribution + size cap; notifications title/body caps |
| `certificates.rules.test.js`     | Cross-agency certificate guard; **Phase 0.4** appId↔application.agencyId cross-check (forge protection); `agencies.update` coordinator budget-write rules including post-review hotfix (coordinator may mutate `committed`/`disbursed` but not `allocated`/`fundSource`) |

Total: ~55 assertions across the six files. They cover every
write-side rule constraint added across security passes
(`f14ea17`, `242c175`, `9a596d4`, `608738b`) and the post-review
hardening (`77e959f`, `b37043c`, `c939815`, `79f51e3`).

## Running the tests

```bash
npm run test:rules
```

That uses `firebase emulators:exec` to spin up the Firestore
emulator on `localhost:8080`, run the tests against it, and tear it
down. Output is verbose by default while the emulator boots.

To run them with the rest of the suite:

```bash
npm run test:all
```

## Setup requirements

1. **Firebase CLI 13+** — `npm install -g firebase-tools` (you likely
   already have this if you've ever run `firebase deploy`).
2. **Java JDK 21 or higher** — the Firestore emulator is a Java
   process. Older versions (JDK 8/11/17) **will not work**. Verify
   with `java -version`. On Windows, the easiest install is from
   https://adoptium.net/temurin/releases/?version=21.
3. **No service account needed** — emulator runs against a fake
   project (`mapa-rules-test`), no production credentials touched.

If the emulator fails to boot with `Error: firebase-tools no longer
supports Java version before 21`, update your JDK and retry.

## When to update these tests

Anytime you change `firestore.rules`. Add a test for the new constraint
you wrote, in the file matching the collection. A passing rules diff
without a matching test means the constraint is unverified.

## Why no production rules tests run in `npm test`

`npm test` is the fast feedback loop (utils only, no emulator). The
rules tests intentionally live behind a separate script because they
require the JDK + take ~10-15 seconds to boot the emulator. Run them
before any commit that touches `firestore.rules`, and in CI as a gate
before deploy.