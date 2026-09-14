/**
 * Route guards, and the two host questions they turn on.
 *
 * Lifted out of App.tsx so they can be tested without pulling in every page
 * module the router references. They are a convenience, not the enforcement:
 * their job is to stop the UI *offering* something the API would refuse. The
 * server decides, and app/core/deps.py is where that happens.
 */
import { Navigate } from 'react-router-dom'

import { getSubdomain, isAdminHost } from '@/lib/tenant'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'

export const ADMIN_ROLES: UserRole[] = [
  'super_admin',
  'principal',
  'pro_chancellor',
  'deputy_pro_chancellor',
]

// Where "home" is depends on the host: the platform console manages colleges.
//
// Read at render time, not at module scope: a module-level constant is frozen
// at import, which makes the host untestable (and would survive a soft
// navigation between hosts). Both calls are trivial string work.
export function home(): string {
  return isAdminHost() ? '/colleges' : '/dashboard'
}

// The apex domain (myplacements.in, no subdomain) carries no tenant, so it
// serves the public marketing site instead of the staff app.
export function isApex(): boolean {
  return getSubdomain() === null
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => !!s.token)
  const mustResetPassword = useAuthStore((s) => !!s.user?.must_reset_password)
  const role = useAuthStore((s) => s.user?.role)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (mustResetPassword) return <Navigate to="/reset-password" replace />
  // Students live in the portal; keep them out of the staff app.
  if (role === 'student') return <Navigate to="/portal" replace />
  return <>{children}</>
}

export function StudentRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => !!s.token)
  const mustResetPassword = useAuthStore((s) => !!s.user?.must_reset_password)
  const role = useAuthStore((s) => s.user?.role)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (mustResetPassword) return <Navigate to="/reset-password" replace />
  if (role !== 'student') return <Navigate to={home()} replace />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  return user && ADMIN_ROLES.includes(user.role) ? <>{children}</> : <Navigate to={home()} replace />
}

// College-data pages don't exist on the platform console — send them to People.
export function CollegeRoute({ children }: { children: React.ReactNode }) {
  return isAdminHost() ? <Navigate to="/people" replace /> : <>{children}</>
}

// Console-only pages (e.g. Colleges) exist only on the platform console.
export function ConsoleRoute({ children }: { children: React.ReactNode }) {
  return isAdminHost() ? <>{children}</> : <Navigate to={home()} replace />
}

