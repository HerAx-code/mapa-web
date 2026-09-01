import { tsToDate } from './dates'

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }

/**
 * Bucket a list into day groups with a friendly heading — Today / Yesterday /
 * weekday — so a long stream becomes navigable instead of one flat wall. The
 * facet-sidebar record pages (Audit Log, App Logs, Reports, on both admin and
 * agency) all render their streams through this.
 *
 * Items are expected to arrive already sorted newest-first; consecutive items
 * on the same calendar day are grouped together. An item whose timestamp can't
 * be parsed lands in an "Undated" bucket.
 *
 * @param {Array}    items  the (desc-sorted) rows
 * @param {Function} getTs  extracts the timestamp from a row (default: createdAt)
 * @param {number}   nowMs  reference "now" in ms — injectable for tests
 * @returns {Array<{ key:string, label:string, sub:string, entries:Array }>}
 */
export function groupByDay(items, getTs = (it) => it.createdAt, nowMs = Date.now()) {
  const groups = []
  const today = startOfDay(new Date(nowMs))
  const oneDay = 86400000
  for (const it of items) {
    const d = tsToDate(getTs(it))
    const key = d ? String(startOfDay(d)) : 'unknown'
    let g = groups.length && groups[groups.length - 1].key === key ? groups[groups.length - 1] : null
    if (!g) {
      let label = 'Undated', sub = ''
      if (d) {
        const day = startOfDay(d)
        label = day === today ? 'Today'
          : day === today - oneDay ? 'Yesterday'
          : d.toLocaleDateString([], { weekday: 'long' })
        sub = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
      }
      g = { key, label, sub, entries: [] }
      groups.push(g)
    }
    g.entries.push(it)
  }
  return groups
}
