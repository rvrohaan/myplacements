import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Building2,
  GraduationCap,
  CalendarDays,
  BarChart3,
  Users,
  School,
  LogOut,
  BrainCircuit,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { isAdminHost } from '@/lib/tenant'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'

const ADMIN_ROLES: UserRole[] = ['super_admin', 'principal', 'pro_chancellor', 'deputy_pro_chancellor']

const navItems = [
  // consoleOnly items appear only on the platform console (admin.*).
  { to: '/colleges', icon: School, label: 'Colleges', consoleOnly: true },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/companies', icon: Building2, label: 'Companies' },
  { to: '/students', icon: GraduationCap, label: 'Students' },
  { to: '/drives', icon: CalendarDays, label: 'Drives' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/people', icon: Users, label: 'People', adminOnly: true },
]

export default function Sidebar() {
  const { user, logout } = useAuthStore()
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role)
  const adminHost = isAdminHost()
  // The platform console shows only its console tools (Colleges, People); college
  // portals show the data tabs and hide console-only items.
  const visibleNavItems = navItems.filter((item) => {
    if (item.consoleOnly) return adminHost
    if (adminHost) return item.to === '/people'
    return !item.adminOnly || isAdmin
  })

  return (
    <aside className="flex flex-col w-60 h-screen shrink-0 bg-primary-900 text-white">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-primary-700">
        <BrainCircuit className="w-7 h-7 text-primary-100" />
        <div>
          <p className="font-bold text-sm leading-tight">MyPlacement.AI</p>
          <p className="text-xs text-primary-300">
            {isAdminHost() ? 'Platform Console' : 'Placement Intelligence'}
          </p>
        </div>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {visibleNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-primary-200 hover:bg-primary-800 hover:text-white'
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-primary-700">
        <div className="px-3 mb-3">
          <p className="text-xs font-semibold text-white truncate">{user?.full_name}</p>
          <p className="text-xs text-primary-300 capitalize">{user?.role?.replace(/_/g, ' ')}</p>
          {user?.department && <p className="text-xs text-primary-400 truncate">{user.department}</p>}
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-primary-200 hover:bg-primary-800 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
