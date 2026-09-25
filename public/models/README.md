# Face models (self-hosted)

On-device face-match + liveness weights for `src/utils/faceCheck.js`, served
statically from `/models` (Vite copies `public/` to the site root). See
`docs/id-verification-plan.md` §2.

These are **vendored from the `@vladmandic/face-api` npm package** (a maintained
face-api.js fork) — copied verbatim from
`node_modules/@vladmandic/face-api/model/`. Three model sets, ~6.6 MB total:

| Files | Purpose | Size |
| --- | --- | --- |
| `tiny_face_detector_model-weights_manifest.json` + `.bin` | face presence + box | ~190 KB |
| `face_landmark_68_model-weights_manifest.json` + `.bin` | landmarks (framing / liveness) | ~350 KB |
| `face_recognition_model-weights_manifest.json` + `.bin` | 128-d descriptor for matching | ~6.2 MB |

## Updating
Bump `@vladmandic/face-api`, then re-copy the six files above from
`node_modules/@vladmandic/face-api/model/`. The manifest `.json` references its
`.bin` by name — keep the pairs together and don't rename them.

## Caching
`face_recognition_model.bin` (6.2 MB) exceeds the PWA precache cap
(`maximumFileSizeToCacheInBytes` in `vite.config.js`), so these are cached via a
`runtimeCaching` **CacheFirst** rule for `/models/` (added with the persist +
rules task), not precached. First load pays the ~6.6 MB once; later visits are
instant and offline-capable. If a device never downloads them, `faceCheck`
returns null and the flow proceeds unaided (advisory contract).
