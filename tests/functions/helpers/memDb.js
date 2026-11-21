// A small in-memory Firestore stand-in for Cloud Function handler tests:
// path-addressed docs, where() filters (==, in, array-contains), batches and
// transactions. Enough for the handlers that read and write by path.
// FieldValue.delete() in update() removes the field, as Firestore does.
import { createRequire } from 'node:module'
import path from 'node:path'
// Resolved from functions/ (where firebase-admin is installed), like the handlers.
const { FieldValue } = createRequire(path.join(process.cwd(), 'functions', 'package.json'))('firebase-admin/firestore')
const DELETE = FieldValue.delete()
const applyDeletes = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => !(v && typeof v.isEqual === 'function' && v.isEqual(DELETE))))
let autoId = 0

export function memDb(initial = {}) {
  const store = new Map(Object.entries(initial).map(([p, d]) => [p, { ...d }]))

  const snap = (path) => {
    const d = store.get(path)
    return { id: path.split('/').pop(), exists: d !== undefined, data: () => (d === undefined ? undefined : { ...d }), ref: docRef(path) }
  }

  function docRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => snap(path),
      set: async (data, opts) => { store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data }) },
      update: async (data) => {
        if (!store.has(path)) throw new Error(`NOT_FOUND ${path}`)
        store.set(path, applyDeletes({ ...store.get(path), ...data }))
      },
      delete: async () => { store.delete(path) },
      collection: (name) => collectionRef(`${path}/${name}`),
    }
  }

  function collectionRef(path, filters = []) {
    const depth = path.split('/').length + 1
    const rows = () => [...store.keys()]
      .filter((k) => k.startsWith(`${path}/`) && k.split('/').length === depth)
      .filter((k) => filters.every(([f, op, v]) => {
        const x = store.get(k)[f]
        return op === '==' ? x === v : op === 'in' ? v.includes(x) : op === 'array-contains' ? Array.isArray(x) && x.includes(v) : false
      }))
    return {
      doc: (id) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
      add: async (data) => { const r = docRef(`${path}/auto${++autoId}`); await r.set(data); return r },
      where: (f, op, v) => collectionRef(path, [...filters, [f, op, v]]),
      get: async () => { const docs = rows().map(snap); return { docs, size: docs.length, empty: docs.length === 0 } },
    }
  }

  return {
    store,
    doc: docRef,
    collection: (path) => collectionRef(path),
    batch: () => {
      const ops = []
      return {
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op() },
      }
    },
    runTransaction: async (fn) => fn({
      get: (ref) => ref.get(),
      set: (ref, data, opts) => ref.set(data, opts),
      update: (ref, data) => ref.update(data),
    }),
  }
}
