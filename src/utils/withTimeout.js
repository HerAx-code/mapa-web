// Race a promise against a timeout.
//
// On timeout the returned promise REJECTS with Error('timeout:<label>'). The
// underlying work keeps running (JS promises aren't cancellable), but the caller
// stops awaiting it. This exists to bound the on-device OCR / face-model loads:
// on a weak mobile network the ~10 MB tesseract language data or the ~6.6 MB
// face-api weights can STALL mid-download without ever erroring, which would
// otherwise leave an advisory check — and its UI spinner ("Reading ID…",
// "Checking…") — pending forever. The callers already treat any rejection as a
// neutral "couldn't run" result, so a timeout degrades exactly like a failure:
// advisory, never blocking care.
//
// ms <= 0 (or non-finite) disables the timeout and returns the promise as-is.
export function withTimeout(promise, ms, label = 'op') {
  if (!(ms > 0)) return promise
  let to
  const timeout = new Promise((_, reject) => {
    to = setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(to))
}

// Resolve the configured model timeout (ms) from an env value, falling back to
// a sensible default. Shared by idOcr + faceCheck so the knob is one name.
export function modelTimeoutMs(envValue, fallback = 20000) {
  const n = Number(envValue)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
