import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdSearch } from 'react-icons/md'

// ⌘K / Ctrl-K command palette for the admin workspace. Dependency-free: a
// global key listener toggles it, arrow keys + Enter drive it, Esc closes it.
// `items` are { key, label, icon, to?, action?, section?, keywords?, hint? };
// selecting one navigates to `to` or runs `action`. v1 is navigation + quick
// actions; entity search (requests / patients by id) can layer on later.
export default function CommandPalette({ items = [] }) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  // Global toggle. Cmd/Ctrl-K opens or closes; Esc always closes. preventDefault
  // on the combo so the browser's own find-as-you-type doesn't swallow it.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Fresh query + focus each time it opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(it =>
      it.label.toLowerCase().includes(q) ||
      it.section?.toLowerCase().includes(q) ||
      it.keywords?.some(k => k.toLowerCase().includes(q))
    )
  }, [query, items])

  // Keep the highlighted row valid as the list shrinks/grows.
  useEffect(() => { setActive(a => Math.min(a, Math.max(results.length - 1, 0))) }, [results.length])

  const run = useCallback((item) => {
    if (!item) return
    setOpen(false)
    if (item.to) navigate(item.to)
    else item.action?.()
  }, [navigate])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown')      { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter')     { e.preventDefault(); run(results[active]) }
  }

  // Scroll the active row into view when arrowing past the fold.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center bg-black/40 px-4 pt-[14vh]"
      onClick={e => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">

        <div className="flex items-center gap-2.5 border-b border-gray-100 px-4">
          <MdSearch size={18} className="flex-shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page…"
            aria-label="Search commands"
            className="flex-1 bg-transparent py-3.5 text-sm text-gray-800 outline-none placeholder:text-gray-400"
          />
          <kbd className="flex-shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">Esc</kbd>
        </div>

        <ul ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-gray-400">No matches for “{query}”.</li>
          )}
          {results.map((it, i) => {
            const isActive = i === active
            const Icon = it.icon
            // Section header when this row starts a new section (only while unfiltered-ish).
            const showSection = it.section && (i === 0 || results[i - 1].section !== it.section)
            return (
              <li key={it.key}>
                {showSection && (
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{it.section}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(it)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-800' : 'text-gray-700'
                  }`}>
                  {Icon && <Icon size={16} className={isActive ? 'text-brand-600' : 'text-gray-400'} />}
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-xs text-gray-400">{it.hint}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
