import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { NotificationRow } from '@/components/layout/NotificationBell'
import { useNotifications } from '@/store/notifications'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/types'

const PAGE_SIZE = 30

// Every filter is expressed as query params the API understands, so the server
// returns exactly the sequence shown on screen. Narrowing a server-paginated
// page in the client would leave `skip` and the total counting different things,
// and "load more" would hand back rows already on screen.
const FILTERS = [
  { key: 'all', label: 'All', params: {} },
  { key: 'unread', label: 'Unread', params: { unread_only: true } },
  { key: 'drives', label: 'Drives', params: { family: ['drive'] } },
  { key: 'allocation', label: 'Allocation', params: { family: ['assignment', 'company'] } },
  { key: 'daily', label: 'Daily updates', params: { family: ['daily_update', 'followup'] } },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

function paramsFor(key: FilterKey): URLSearchParams {
  const search = new URLSearchParams()
  const entry = FILTERS.find((f) => f.key === key)
  const params = (entry?.params ?? {}) as Record<string, unknown>
  for (const [name, value] of Object.entries(params)) {
    // Repeated `family=x&family=y`, which is what FastAPI reads as a list. Left
    // to axios, an array would be serialised as `family[]=x` and ignored.
    if (Array.isArray(value)) value.forEach((v) => search.append(name, String(v)))
    else search.set(name, String(value))
  }
  return search
}

export default function Notifications() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [loading, setLoading] = useState(true)
  const markRead = useNotifications((s) => s.markRead)
  const markAllRead = useNotifications((s) => s.markAllRead)

  // Bumped on every request. A response whose ticket is stale belongs to a
  // filter the user has already moved off, so it is dropped rather than appended
  // into whatever tab is now on screen.
  const ticket = useRef(0)

  const load = useCallback(async (skip: number, current: FilterKey) => {
    const mine = ++ticket.current
    setLoading(true)
    try {
      const search = paramsFor(current)
      search.set('skip', String(skip))
      search.set('limit', String(PAGE_SIZE))
      const { data, headers } = await api.get<AppNotification[]>('/notifications', {
        params: search,
      })
      if (mine !== ticket.current) return
      setItems((prev) => (skip === 0 ? data : [...prev, ...data]))
      setTotal(Number(headers['x-total-count'] ?? 0))
    } finally {
      if (mine === ticket.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(0, filter)
  }, [filter, load])

  const handleSelect = (n: AppNotification) => {
    void markRead(n.id)
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
    if (n.link) navigate(n.link)
  }

  const handleMarkAll = async () => {
    await markAllRead()
    // The Unread tab is a server-side filter, so once everything is read it has
    // nothing left to show - refetch rather than leaving a stale list on screen.
    if (filter === 'unread') void load(0, filter)
    else setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  const hasMore = items.length < total

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                filter === key
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void handleMarkAll()}
          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          Mark all as read
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {items.length === 0 && !loading ? (
          <p className="px-4 py-12 text-center text-sm text-gray-400">
            {filter === 'all'
              ? 'You’re all caught up.'
              : 'Nothing here for this filter.'}
          </p>
        ) : (
          items.map((n) => (
            <NotificationRow key={n.id} notification={n} onSelect={handleSelect} />
          ))
        )}
        {loading && (
          <p className="px-4 py-6 text-center text-sm text-gray-400">Loading&hellip;</p>
        )}
      </div>

      {hasMore && !loading && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => void load(items.length, filter)}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
