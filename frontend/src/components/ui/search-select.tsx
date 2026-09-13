import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchOption {
  id: number
  label: string
  /** Secondary line — a roll number, a sector, whatever tells two apart. */
  hint?: string
}

/** Wait for a pause in typing rather than querying on every keystroke. */
const DEBOUNCE_MS = 250

/**
 * A picker that searches the server instead of listing everything.
 *
 * A `<select>` is fine while a college has a hundred students; at a hundred
 * thousand it means paging the whole table into the browser before the form can
 * be used at all. This asks the API for the handful that match what's typed, so
 * the cost of opening the form doesn't grow with the client.
 *
 * Focus stays on the input the whole time — the menu is navigated with the
 * arrow keys — which keeps it compatible with the focus trap in <Modal>, since
 * the menu itself renders in a portal outside the dialog.
 */
export default function SearchSelect({
  value,
  onChange,
  search,
  placeholder = 'Search…',
  emptyText = 'No matches',
  /** Shown under the list when the API returned a full page. */
  moreHint = 'Keep typing to narrow this down',
  disabled,
  hasError,
  id,
  required,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: {
  value: SearchOption | null
  onChange: (option: SearchOption | null) => void
  /** Runs the query. Returning a full page is what triggers `moreHint`. */
  search: (query: string) => Promise<SearchOption[]>
  placeholder?: string
  emptyText?: string
  moreHint?: string
  disabled?: boolean
  hasError?: boolean
  id?: string
  required?: boolean
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<SearchOption[]>([])
  const [loading, setLoading] = useState(false)
  const [capped, setCapped] = useState(false)
  const [active, setActive] = useState(0)
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const updateCoords = () => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }

  useLayoutEffect(() => {
    if (open) updateCoords()
  }, [open])

  // Only the newest query may write to state: a slow early request must not
  // overwrite the results of a later, narrower one.
  const latest = useRef(0)

  useEffect(() => {
    if (!open) return
    const requestId = ++latest.current
    setLoading(true)
    const timer = setTimeout(() => {
      search(query)
        .then((rows) => {
          if (requestId !== latest.current) return
          setOptions(rows)
          setCapped(rows.length >= 20)
          setActive(0)
        })
        .catch(() => {
          if (requestId === latest.current) setOptions([])
        })
        .finally(() => {
          if (requestId === latest.current) setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `search` is recreated each render by callers; depending on it would
    // re-query on every keystroke of an unrelated field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  /**
   * Choosing an option puts focus back on the input, and focus is what opens the
   * menu — so without this the list springs straight back open, unfiltered, on
   * top of the choice just made. Set for exactly one focus event.
   */
  const skipOpenOnFocus = useRef(false)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) close()
    }
    const onScrollOrResize = () => updateCoords()
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  /**
   * Escape closes the menu, not the dialog around it. <Modal> listens for
   * Escape in the capture phase on `document`, which would otherwise win and
   * shut the whole form. Capture on `window` runs one step earlier in the
   * capture path, so this gets first refusal while the menu is open.
   */
  useEffect(() => {
    if (!open) return
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      close()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDownCapture, true)
    return () => window.removeEventListener('keydown', onKeyDownCapture, true)
  }, [open])

  const choose = (option: SearchOption) => {
    onChange(option)
    skipOpenOnFocus.current = true
    close()
    inputRef.current?.focus()
    // If the input already had focus, focus() fires nothing and the flag would
    // otherwise swallow the user's next click on the field.
    setTimeout(() => { skipOpenOnFocus.current = false }, 0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      // Don't submit the surrounding form while a choice is pending.
      e.preventDefault()
      if (options[active]) choose(options[active])
    } else if (e.key === 'Tab') {
      close()
    }
  }

  // Closed, the field reads as the thing you picked; open, it's a search box.
  const shown = open ? query : value?.label ?? ''

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={cn(
          'flex items-center gap-2 w-full px-3 py-2.5 border rounded-lg text-sm transition-colors',
          hasError
            ? 'border-red-400 bg-red-50/40 focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-500'
            : 'border-gray-300 bg-white focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500',
          disabled && 'bg-gray-50',
        )}
      >
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          ref={inputRef}
          id={id}
          required={required}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={shown}
          placeholder={value ? value.label : placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => {
            if (skipOpenOnFocus.current) {
              skipOpenOnFocus.current = false
              return
            }
            if (!disabled) setOpen(true)
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'flex-1 min-w-0 bg-transparent outline-none placeholder:text-gray-400',
            disabled && 'text-gray-500',
          )}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => { onChange(null); setQuery(''); inputRef.current?.focus() }}
            aria-label="Clear selection"
            className="shrink-0 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <ChevronDown className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </div>

      {open && !disabled && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          style={{ top: coords.top, left: coords.left, width: coords.width }}
          className="fixed z-[60] max-h-64 overflow-y-auto bg-white rounded-lg border border-gray-200 shadow-xl py-1"
        >
          {loading && (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </p>
          )}
          {!loading && options.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500">{emptyText}</p>
          )}
          {!loading && options.map((option, i) => (
            <button
              key={option.id}
              type="button"
              id={`${listId}-${option.id}`}
              role="option"
              aria-selected={option.id === value?.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(option)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm transition-colors',
                i === active ? 'bg-primary-50 text-primary-900' : 'text-gray-700 hover:bg-gray-50',
              )}
            >
              <span className="font-medium">{option.label}</span>
              {option.hint && <span className="block text-xs text-gray-500">{option.hint}</span>}
            </button>
          ))}
          {!loading && capped && (
            <p className="px-3 py-2 text-xs text-gray-400 border-t border-gray-100">{moreHint}</p>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
