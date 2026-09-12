import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import { useAuthStore } from '@/store/authStore'
import Layout from '@/components/layout/Layout'
import Login from '@/pages/auth/Login'
import ResetPassword from '@/pages/auth/ResetPassword'
import AcceptInvite from '@/pages/auth/AcceptInvite'
import Dashboard from '@/pages/dashboard/Dashboard'
import Companies from '@/pages/companies/Companies'
import CompanyDetail from '@/pages/companies/CompanyDetail'
import Students from '@/pages/students/Students'
import Drives from '@/pages/drives/Drives'
import DriveDetail from '@/pages/drives/DriveDetail'
import Analytics from '@/pages/analytics/Analytics'
import Officers from '@/pages/officers/Officers'
import Communications from '@/pages/communications/Communications'
import Training from '@/pages/training/Training'
import People from '@/pages/people/People'
import Colleges from '@/pages/colleges/Colleges'
import SidebarPreview from '@/pages/SidebarPreview'
import StudentLayout from '@/pages/portal/StudentLayout'
import StudentDashboard from '@/pages/portal/StudentDashboard'
import Practice from '@/pages/portal/Practice'
import SkillReport from '@/pages/portal/SkillReport'
import ResumeReview from '@/pages/portal/ResumeReview'
import StudentDrives from '@/pages/portal/StudentDrives'
import Landing from '@/pages/marketing/Landing'
import { getSubdomain, isAdminHost } from '@/lib/tenant'
import type { UserRole } from '@/types'

const ADMIN_ROLES: UserRole[] = ['super_admin', 'principal', 'pro_chancellor', 'deputy_pro_chancellor']

// Where "home" is depends on the host: the platform console manages colleges.
const HOME = isAdminHost() ? '/colleges' : '/dashboard'

// The apex domain (myplacements.in, no subdomain) carries no tenant, so it
// serves the public marketing site instead of the staff app.
const IS_APEX = getSubdomain() === null

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => !!s.token)
  const mustResetPassword = useAuthStore((s) => !!s.user?.must_reset_password)
  const role = useAuthStore((s) => s.user?.role)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (mustResetPassword) return <Navigate to="/reset-password" replace />
  // Students live in the portal; keep them out of the staff app.
  if (role === 'student') return <Navigate to="/portal" replace />
  return <>{children}</>
}

function StudentRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => !!s.token)
  const mustResetPassword = useAuthStore((s) => !!s.user?.must_reset_password)
  const role = useAuthStore((s) => s.user?.role)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (mustResetPassword) return <Navigate to="/reset-password" replace />
  if (role !== 'student') return <Navigate to={HOME} replace />
  return <>{children}</>
}

function ResetPasswordRoute() {
  const isAuthenticated = useAuthStore((s) => !!s.token)
  return isAuthenticated ? <ResetPassword /> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  return user && ADMIN_ROLES.includes(user.role) ? <>{children}</> : <Navigate to={HOME} replace />
}

// College-data pages don't exist on the platform console — send them to People.
function CollegeRoute({ children }: { children: React.ReactNode }) {
  return isAdminHost() ? <Navigate to="/people" replace /> : <>{children}</>
}

// Console-only pages (e.g. Colleges) exist only on the platform console.
function ConsoleRoute({ children }: { children: React.ReactNode }) {
  return isAdminHost() ? <>{children}</> : <Navigate to={HOME} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPasswordRoute />} />
        {/* Public: the token in the URL is the credential, so no session is
            required (and an existing one is irrelevant). */}
        <Route path="/accept-invite/:token" element={<AcceptInvite />} />
        <Route
          path="/portal"
          element={
            <StudentRoute>
              <StudentLayout />
            </StudentRoute>
          }
        >
          <Route index element={<StudentDashboard />} />
          <Route path="practice" element={<Practice />} />
          <Route path="skills" element={<SkillReport />} />
          <Route path="resume" element={<ResumeReview />} />
          <Route path="drives" element={<StudentDrives />} />
        </Route>
        <Route
          path="/sidebar-preview"
          element={
            <ProtectedRoute>
              <SidebarPreview />
            </ProtectedRoute>
          }
        />
        {/* The staff app needs a tenant subdomain; the apex only serves marketing. */}
        {IS_APEX && <Route path="/" element={<Landing />} />}
        {!IS_APEX && (
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to={HOME} replace />} />
          <Route path="colleges" element={<ConsoleRoute><Colleges /></ConsoleRoute>} />
          <Route path="dashboard" element={<CollegeRoute><Dashboard /></CollegeRoute>} />
          <Route path="companies" element={<CollegeRoute><Companies /></CollegeRoute>} />
          <Route path="companies/:id" element={<CollegeRoute><CompanyDetail /></CollegeRoute>} />
          <Route path="students" element={<CollegeRoute><Students /></CollegeRoute>} />
          <Route path="drives" element={<CollegeRoute><Drives /></CollegeRoute>} />
          <Route path="drives/:id" element={<CollegeRoute><DriveDetail /></CollegeRoute>} />
          <Route path="officers" element={<CollegeRoute><Officers /></CollegeRoute>} />
          <Route path="communications" element={<CollegeRoute><Communications /></CollegeRoute>} />
          <Route path="training" element={<CollegeRoute><Training /></CollegeRoute>} />
          <Route path="analytics" element={<CollegeRoute><Analytics /></CollegeRoute>} />
          <Route
            path="people"
            element={
              <AdminRoute>
                <People />
              </AdminRoute>
            }
          />
        </Route>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}
