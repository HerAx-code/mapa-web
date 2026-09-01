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

// PH-local "YYYY-MM-DD" for a moment (defaults to now). This is the canonical
// "which day is it at the pilot site" key: everything day-bucketed for CRMC /
// the agencies is anchored to Asia/Manila (UTC+8, no DST), never to UTC or the
// host machine's zone.
//
// The daily slot reset writes agency.lastResetDate with exactly this shape
// (Dashboard), and Slot Management compares its "has today's reset run?" check
// against it. Both MUST derive the key the same way or they disagree for the
// 8h window each PH day when UTC still reads the previous date -- which is what
// made Slot Management flash a spurious "Pending reset" right after a reset.
// 'en-CA' yields the YYYY-MM-DD ordering; the timeZone option does the shift.
export const phTodayKey = (now = new Date()) =>
  now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })