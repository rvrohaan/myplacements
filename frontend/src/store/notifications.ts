import { create } from 'zustand'
import api from '@/lib/api'
import type { AppNotification } from '@/types'

// Not persisted, unlike driveAlerts: the server is the source of truth here, and
// a badge restored from localStorage that says "3 unread" when there are none is
// worse than a moment with no badge at all.

const POLL_MS = 60_000
// How many rows the dropdown holds. Anything older is the /notifications page's
// job, which is why that page exists.
const DROPDOWN_LIMIT = 20

// The timer lives at module scope rather than in a component effect. A remount
// would otherwise stack a second interval and quietly double the request rate.
let timer: ReturnType<typeof setInterval> | null = null
let visibilityBound = false

interface NotificationsState {
  items: AppNotification[]
  unread: number
  loading: boolean
  open: boolean
  setOpen: (open: boolean) => void
  /** The cheap poll: just the badge number. */
  fetchUnread: () => Promise<void>
  /** The dropdown's contents, fetched only when it opens. */
  fetchList: () => Promise<void>
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
  start: () => void
  stop: () => void
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  items: [],
  unread: 0,
  loading: false,
  open: false,

  setOpen: (open) => {
    set({ open })
    if (open) void get().fetchList()
  },

  fetchUnread: async () => {
    try {
      const { data } = await api.get<{ unread: number }>('/notifications/unread-count')
      set({ unread: data.unread })
    } catch {
      /* non-fatal: a failed poll keeps the current count and never raises a toast */
    }
  },

  fetchList: async () => {
    set({ loading: true })
    try {
      const { data } = await api.get<AppNotification[]>('/notifications', {
        params: { limit: DROPDOWN_LIMIT },
      })
      set({ items: data })
    } catch {
      /* leave whatever is already on screen */
    } finally {
      set({ loading: false })
    }
  },

  markRead: async (id) => {
    const target = get().items.find((n) => n.id === id)
    if (target && target.is_read) return
    // Optimistic: the row greys out immediately, and the authoritative count
    // comes back in the response.
    set({
      items: get().items.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      unread: Math.max(0, get().unread - 1),
    })
    try {
      const { data } = await api.post<{ unread: number }>(`/notifications/${id}/read`)
      set({ unread: data.unread })
    } catch {
      void get().fetchUnread()
    }
  },

  markAllRead: async () => {
    set({ items: get().items.map((n) => ({ ...n, is_read: true })), unread: 0 })
    try {
      await api.post('/notifications/read-all')
    } catch {
      void get().fetchUnread()
    }
  },

  start: () => {
    void get().fetchUnread()
    if (timer === null) timer = setInterval(() => void get().fetchUnread(), POLL_MS)
    if (!visibilityBound) {
      document.addEventListener('visibilitychange', onVisibility)
      visibilityBound = true
    }
  },

  stop: () => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    if (visibilityBound) {
      document.removeEventListener('visibilitychange', onVisibility)
      visibilityBound = false
    }
    set({ items: [], unread: 0, open: false })
  },
}))

// Pause while the tab is hidden - a backgrounded tab polling all afternoon is
// pure waste - and catch up the moment it comes back.
function onVisibility() {
  if (document.hidden) {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    return
  }
  const { fetchUnread } = useNotifications.getState()
  void fetchUnread()
  if (timer === null) timer = setInterval(() => void fetchUnread(), POLL_MS)
}
