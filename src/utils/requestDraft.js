// Draft store for the in-progress assistance-request wizard.
//
// The wizard holds everything in volatile React state and only uploads the
// picked photos at the final submit, so navigating to another tab (or the
// phone killing a backgrounded tab) lost the whole draft — fields, step, and
// the staged photos — and the patient had to start over. This persists the
// draft so it survives in-app navigation, a reload, and closing the app.
//
// IndexedDB (not localStorage) because the draft carries File/Blob objects:
// structured clone stores them natively; JSON can't. One object store keyed by
// uid holds a single draft record per patient. Everything is wrapped so a
// blocked or unavailable IndexedDB (private window, denied storage, preview
// capture) degrades to a silent no-op and never breaks the request flow.
//
// See RequestAssistance.jsx (restore + debounced autosave + hide-flush).

const DB_NAME = 'mapa'
const STORE   = 'requestDrafts'
const VERSION = 1
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // drop drafts older than 7 days

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-indexeddb')); return }
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function run(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = store.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// Persist (replace) the draft for this patient. Stamps savedAt for expiry.
export async function saveRequestDraft(uid, draft) {
  if (!uid || !draft) return
  try {
    const db = await openDb()
    await run(db, 'readwrite', s => s.put({ ...draft, savedAt: Date.now() }, uid))
    db.close()
  } catch { /* storage unavailable → draft just isn't saved */ }
}

// Load the draft for this patient, or null. Expired drafts are dropped.
export async function loadRequestDraft(uid) {
  if (!uid) return null
  try {
    const db = await openDb()
    const draft = await run(db, 'readonly', s => s.get(uid))
    db.close()
    if (!draft) return null
    if (draft.savedAt && Date.now() - draft.savedAt > MAX_AGE_MS) {
      clearRequestDraft(uid)
      return null
    }
    return draft
  } catch { return null }
}

// Remove this patient's draft (on successful submit, or an explicit discard).
export async function clearRequestDraft(uid) {
  if (!uid) return
  try {
    const db = await openDb()
    await run(db, 'readwrite', s => s.delete(uid))
    db.close()
  } catch { /* no-op */ }
}
