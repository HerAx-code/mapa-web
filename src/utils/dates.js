// Defensive Firestore timestamp converter.
//
// Production writes Firestore Timestamp objects (which have .toDate()),
// but legacy / seed data sometimes lands as a JS Date or an ISO string
// instead -- typical sources: pre-redesign documents written before the
// Timestamp serializer was added, manual seed scripts, or imported test
// fixtures. tsToDate() collapses all three shapes to a JS Date so the
// caller can do .toLocaleDateString() etc. without branching.
//
// Returns null on null/undefined input so call sites can fall through
// to a placeholder (`—`) cleanly: `tsToDate(x)?.toLocaleDateString() ?? '—'`.
//
// Previously inlined per file (six explicit copies and many more buried
// inside formatDate / fmtDate helpers). Consolidated here so a future
// change in timestamp handling has exactly one place to land.
export const tsToDate = (ts) => {
  if (!ts) return null
  return ts.toDate ? ts.toDate() : new Date(ts)
}