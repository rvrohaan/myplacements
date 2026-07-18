import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  Target,
  Briefcase,
  LogOut,
  GraduationCap,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useDriveAlerts } from '@/store/driveAlerts'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/portal', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/portal/practice', label: 'Mock Practice', icon: MessageSquare },
  { to: '/portal/skills', label: 'Skill Report', icon: Target },
  { to: '/portal/resume', label: 'Resume Review', icon: FileText },
  { to: '/portal/drives', label: 'Jobs & Drives', icon: Briefcase },
]

export default function StudentLayout() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const newCount = useDriveAlerts((s) => s.newCount)
  const refresh = useDriveAlerts((s) => s.refresh)

  // Compute the "new drives" badge once when the portal loads.
  useEffect(() => {
    refresh()
  }, [refresh])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white/70 backdrop-blur-md border-b border-gray-200/80 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center shadow-sm shadow-blue-500/30">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-gray-900">Student Portal</p>
              <p className="text-[11px] text-gray-500">MyPlacement.AI</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:inline">{user?.full_name}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
        <nav className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
              {to === '/portal/drives' && newCount > 0 && (
                <span className="ml-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-[11px] font-semibold leading-none">
                  {newCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
