import { useState, useRef, useEffect, useId, useMemo, useCallback } from 'react'
import { MdKeyboardArrowDown, MdSearch, MdCheck } from 'react-icons/md'

/**
 * SearchableSelect — an accessible, mobile-friendly dropdown that replaces the
 * native <select> for long option lists (barangays, cities, agencies…).
 *
 * Why this exists: the native <select> on a long list (Cotabato City has 37
 * barangays) gives a cramped OS popup with no search, forcing the patient to
 * scroll a wall of near-identical names on a phone. This renders a styled
 * trigger + a popover with a type-to-filter search box and full keyboard
 * navigation, while keeping the app's field styling (.input) and brand focus
 * ring so it reads as one system.
 *
 * Controlled:
 *   value       string    the selected option's value ('' = unset)
 *   onChange    (v)=>void  called with the chosen value
 *   options     [{ value, label }]
 *
 * Optional:
 *   placeholder      shown on the trigger when nothing is selected
 *   searchPlaceholder text in the filter box
 *   pinnedOption     { value, label } always shown at the bottom, below a
 *                    divider, and never filtered out — used for the
 *                    "Other (not listed)" free-text escape hatch.
 *   disabled, error (red border), id, dataField (for [data-field] lookups),
 *   ariaLabel, className, emptyText
 *
 * The search box only appears once the list is long enough to need it
 * (> 7 entries), so short pickers stay clean.
 */
export default function SearchableSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  pinnedOption = null,
  disabled = false,
  error = false,
  id,
  dataField,
  ariaLabel,
  className = '',
  emptyText = 'No matches',
}) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const [active, setActive] = useState(0)

  const rootRef   = useRef(null)
  const searchRef = useRef(null)
  const optionRefs = useRef([])

  const reactId = useId()
  const listId  = `${reactId}-list`
  const optId   = (i) => `${reactId}-opt-${i}`

  const selected = useMemo(
    () => options.find(o => o.value === value) ?? (pinnedOption?.value === value ? pinnedOption : null),
    [options, value, pinnedOption],
  )

  // The rows the popover shows: options filtered by the query, with the
  // pinned option always appended (unfiltered) below a divider.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  const rows = useMemo(
    () => (pinnedOption ? [...filtered, { ...pinnedOption, __pinned: true }] : filtered),
    [filtered, pinnedOption],
  )

  const showSearch = options.length + (pinnedOption ? 1 : 0) > 7

  const close = useCallback(() => { setOpen(false); setQuery('') }, [])

  const choose = useCallback((v) => {
    onChange?.(v)
    close()
    // Return focus to the trigger so keyboard users keep their place.
    rootRef.current?.querySelector('button')?.focus()
  }, [onChange, close])

  // Open the list: reset the filter and highlight the current selection.
  const openList = () => {
    if (disabled) return
    setOpen(true)
    const idx = rows.findIndex(r => r.value === value)
    setActive(idx >= 0 ? idx : 0)
  }

  // Close on any click outside the component.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => { if (!rootRef.current?.contains(e.target)) close() }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, close])

  // Focus the search box when the popover opens.
  useEffect(() => { if (open && showSearch) searchRef.current?.focus() }, [open, showSearch])

  // Keep the query from pointing past the end of a shrinking filtered list.
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, rows.length - 1))) }, [rows.length])

  // Scroll the highlighted option into view as the user arrows through.
  useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList() }
      return
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); break
      case 'ArrowUp':   e.preventDefault(); setActive(a => Math.max(a - 1, 0)); break
      case 'Home':      e.preventDefault(); setActive(0); break
      case 'End':       e.preventDefault(); setActive(rows.length - 1); break
      case 'Enter':     e.preventDefault(); if (rows[active]) choose(rows[active].value); break
      case 'Escape':    e.preventDefault(); close(); break
      case 'Tab':       close(); break
      default: break
    }
  }

  const triggerCls =
    'input flex items-center justify-between gap-2 text-left cursor-pointer ' +
    (disabled ? 'opacity-60 cursor-not-allowed ' : '') +
    (error ? 'border-red-400 bg-red-50 ' : '') +
    (open ? 'ring-2 ring-brand-500 border-transparent ' : '')

  return (
    <div ref={rootRef} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        id={id}
        data-field={dataField}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        className={triggerCls}>
        <span className={`truncate ${selected ? 'text-gray-900' : 'text-gray-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <MdKeyboardArrowDown
          size={18}
          className={`flex-shrink-0 text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          {showSearch && (
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <MdSearch size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="text"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-expanded="true"
                  aria-activedescendant={rows[active] ? optId(active) : undefined}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setActive(0) }}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-2 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
            </div>
          )}

          <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
            {rows.length === 0 && (
              <li className="px-3 py-2.5 text-sm text-gray-400 select-none">{emptyText}</li>
            )}
            {rows.map((row, i) => {
              const isSel    = row.value === value
              const isActive = i === active
              return (
                <li
                  key={`${row.value}-${i}`}
                  id={optId(i)}
                  role="option"
                  aria-selected={isSel}
                  ref={el => (optionRefs.current[i] = el)}
                  onClick={() => choose(row.value)}
                  onMouseEnter={() => setActive(i)}
                  className={
                    'flex items-center justify-between gap-2 px-3 py-2.5 text-sm cursor-pointer ' +
                    (row.__pinned ? 'border-t border-gray-100 text-brand-600 font-medium ' : '') +
                    (isActive ? 'bg-brand-50 ' : '') +
                    (isSel && !row.__pinned ? 'text-brand-700 font-medium ' : 'text-gray-700 ')
                  }>
                  <span className="truncate">{row.label}</span>
                  {isSel && <MdCheck size={16} className="flex-shrink-0 text-brand-600" aria-hidden="true" />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
