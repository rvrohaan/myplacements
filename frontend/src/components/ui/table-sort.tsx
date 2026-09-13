import { useEffect, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SortOrder = 'asc' | 'desc'

/** The column a list is ordered by, and which way. Sent straight to the API. */
export type Sorting<K extends string> = { sort: K; order: SortOrder }

/**
 * One heading in a sortable table. Omit `sort` for a column the API can't
 * order by (an actions column, say) — it renders as plain text.
 * `firstOrder` is the direction the first click picks: text reads best A-Z,
 * while money, dates and scores are most useful largest/newest first.
 */
export type SortColumn<K extends string> = {
  label: string
  sort?: K
  firstOrder?: SortOrder
  /** Announced to screen readers when the heading itself is blank. */
  srLabel?: string
}

/**
 * Sorting state for a server-ordered list, remembered for the browser session
 * so opening a row and coming back lands on the same ordering. sessionStorage
 * rather than localStorage: a new tab starts from the default.
 */
export function useTableSorting<K extends string>({
  storageKey,
  fallback,
  keys,
  onChange,
}: {
  storageKey: string
  fallback: Sorting<K>
  /** Every key the API accepts. Anything else is ignored, since an invalid key would make the API 422. */
  keys: readonly K[]
  /** Called after the sort changes — pages use it to return to page one. */
  onChange?: () => void
}) {
  const [sorting, setSorting] = useState<Sorting<K>>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw) as Sorting<K>
        if (keys.includes(saved.sort) && (saved.order === 'asc' || saved.order === 'desc')) {
          return saved
        }
      }
    } catch {
      // Storage disabled or holding something we didn't write - use the default.
    }
    return fallback
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(sorting))
    } catch {
      // Storage unavailable - sorting still works, it just won't be remembered.
    }
  }, [storageKey, sorting])

  // Clicking the active column flips direction; a new column starts in its own
  // most useful direction.
  const applySort = (key: K, firstOrder: SortOrder = 'asc') => {
    setSorting((prev) =>
      prev.sort === key
        ? { sort: key, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : { sort: key, order: firstOrder },
    )
    onChange?.()
  }

  return { sorting, applySort }
}

/** The `<thead>` of a sortable table: click a heading to order by that column. */
export function SortableHead<K extends string>({
  columns,
  sorting,
  onSort,
}: {
  columns: readonly SortColumn<K>[]
  sorting: Sorting<K>
  onSort: (key: K, firstOrder?: SortOrder) => void
}) {
  return (
    <thead className="bg-gray-50 border-b border-gray-200">
      <tr>
        {columns.map((col, i) => {
          const active = !!col.sort && col.sort === sorting.sort
          return (
            <th
              key={col.label || i}
              scope="col"
              aria-sort={active ? (sorting.order === 'asc' ? 'ascending' : 'descending') : undefined}
              className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >
              {col.sort ? (
                <button
                  onClick={() => onSort(col.sort!, col.firstOrder)}
                  className={cn(
                    'group flex items-center gap-1 uppercase tracking-wide hover:text-gray-700 transition-colors',
                    active && 'text-primary-600',
                  )}
                  title={`Sort by ${col.label.toLowerCase()}`}
                >
                  {col.label}
                  {active ? (
                    sorting.order === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronsUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              ) : (
                col.label || <span className="sr-only">{col.srLabel ?? 'Actions'}</span>
              )}
            </th>
          )
        })}
      </tr>
    </thead>
  )
}
