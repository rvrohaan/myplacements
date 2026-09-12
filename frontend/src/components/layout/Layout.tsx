import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { SessionNavBar } from '@/components/ui/sidebar'
import { useNotifications } from '@/store/notifications'
import Header from './Header'

export default function Layout() {
  // Notification polling is scoped to the staff shell: this unmounts on logout
  // (ProtectedRoute redirects) and never mounts for students, so a signed-out
  // tab stops cleanly and the portal never polls at all.
  useEffect(() => {
    const { start, stop } = useNotifications.getState()
    start()
    return stop
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <SessionNavBar />
      {/* pad past the collapsed (3.05rem) rail; the sidebar overlays content when expanded on hover */}
      <div className="flex flex-col flex-1 min-w-0 pl-[3.05rem]">
        <Header />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
