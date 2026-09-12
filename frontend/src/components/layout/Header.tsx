import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import NotificationBell from './NotificationBell'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/companies': 'Company Database',
  '/students': 'Students',
  '/drives': 'Placement Drives',
  '/officers': 'Officer Allocation',
  '/communications': 'Communication Tracking',
  '/training': 'Training Monitoring',
  '/daily-update': 'Daily Update',
  '/daily-digest': 'Daily Digest',
  '/opportunities': 'Opportunity Radar',
  '/analytics': 'Analytics',
  '/people': 'People',
  '/colleges': 'Colleges',
  '/platform': 'Platform Settings',
  '/notifications': 'Notifications',
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
        <NotificationBell />
      </div>
    </header>
  )
}
