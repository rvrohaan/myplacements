import { create } from 'zustand'
import api from '@/lib/api'
import { useAuthStore } from './authStore'
import type { StudentDrive } from '@/types'

// "New" drives are tracked per student in localStorage (no backend/infra). A drive
// is "new to apply" if the student hasn't viewed the Jobs & Drives page since it
// appeared AND they haven't already applied.

const seenKey = (userId?: number) => `seen_drives_${userId ?? 'anon'}`

function getSeen(userId?: number): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey(userId)) || '[]'))
  } catch {
    return new Set()
  }
}

interface DriveAlertsState {
  newCount: number
  /** Fetch eligible drives and recompute the unseen, not-yet-applied count. */
  refresh: () => Promise<void>
  /** Mark the given drive ids as seen (call when the student views the list). */
  markSeen: (ids: number[]) => void
}

export const useDriveAlerts = create<DriveAlertsState>((set) => ({
  newCount: 0,
  refresh: async () => {
    const userId = useAuthStore.getState().user?.id
    try {
      const { data } = await api.get<StudentDrive[]>('/portal/me/drives')
      const seen = getSeen(userId)
      const count = data.filter((d) => !seen.has(d.id) && !d.applied).length
      set({ newCount: count })
    } catch {
      /* non-fatal: leave the current count */
    }
  },
  markSeen: (ids) => {
    const userId = useAuthStore.getState().user?.id
    const seen = getSeen(userId)
    ids.forEach((id) => seen.add(id))
    localStorage.setItem(seenKey(userId), JSON.stringify([...seen]))
    set({ newCount: 0 })
  },
}))
