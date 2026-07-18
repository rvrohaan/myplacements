import { useLocation } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/companies': 'Company Database',
  '/students': 'Students',
  '/drives': 'Placement Drives',
  '/officers': 'Officer Allocation',
  '/communications': 'Communication Tracking',
  '/training': 'Training Monitoring',
  '/analytics': 'Analytics',
  '/people': 'People',
  '/colleges': 'Colleges',
}

export default function Header() {
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  let title = PAGE_TITLES[location.pathname] ?? 'MyPlacement.AI'
  // Officers see their own allocation, not the team-management view.
  if (location.pathname === '/officers' && user?.role === 'placement_officer') {
    title = 'My Allocation'
  }

  return (
    <header className="sticky top-0 z-10 bg-white/70 backdrop-blur-md border-b border-gray-200/80 px-6 py-3 flex items-center justify-between">
      <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Notifications"
          className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          <Bell className="w-5 h-5" aria-hidden="true" />
        </button>
        <div
          className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-sm font-semibold shadow-sm shadow-blue-500/30"
          title={user?.full_name}
        >
          <span className="sr-only">{user?.full_name}</span>
          <span aria-hidden="true">{user?.full_name?.charAt(0).toUpperCase()}</span>
        </div>
      </div>
    </header>
  )
}
