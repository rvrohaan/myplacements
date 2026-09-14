import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm'
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
import Offers from '@/pages/offers/Offers'
import DriveDetail from '@/pages/drives/DriveDetail'
import Analytics from '@/pages/analytics/Analytics'
import Officers from '@/pages/officers/Officers'
import Communications from '@/pages/communications/Communications'
import HRContacts from '@/pages/hr/HRContacts'
import Training from '@/pages/training/Training'
import DailyUpdate from '@/pages/daily/DailyUpdate'
import DailyDigest from '@/pages/daily/DailyDigest'
import Opportunities from '@/pages/opportunities/Opportunities'
import People from '@/pages/people/People'
import Colleges from '@/pages/colleges/Colleges'
import Platform from '@/pages/platform/Platform'
import Notifications from '@/pages/notifications/Notifications'
import Reports from '@/pages/reports/Reports'
import StudentLayout from '@/pages/portal/StudentLayout'
import StudentDashboard from '@/pages/portal/StudentDashboard'
import Practice from '@/pages/portal/Practice'
import SkillReport from '@/pages/portal/SkillReport'
import ResumeReview from '@/pages/portal/ResumeReview'
import StudentDrives from '@/pages/portal/StudentDrives'
import Landing from '@/pages/marketing/Landing'
import {
  AdminRoute,
  CollegeRoute,
  ConsoleRoute,
  ProtectedRoute,
  StudentRoute,
  home,
  isApex,
} from '@/routes/guards'

// Kept here rather than in guards.tsx: it renders a page, so it is a route
// element rather than a reusable guard.
function ResetPasswordRoute() {
  const isAuthenticated = useAuthStore((s) => !!s.token)
  return isAuthenticated ? <ResetPassword /> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
      <ConfirmProvider>
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
        {/* The staff app needs a tenant subdomain; the apex only serves marketing. */}
        {isApex() && <Route path="/" element={<Landing />} />}
        {!isApex() && (
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to={home()} replace />} />
          {/* Not wrapped in CollegeRoute: a platform admin has their own
              notifications on the console host too. */}
          <Route path="notifications" element={<Notifications />} />
          <Route path="colleges" element={<ConsoleRoute><Colleges /></ConsoleRoute>} />
          {/* Platform-wide switches. Console only, and super_admin only —
              the API refuses anyone else regardless. */}
          <Route path="platform" element={<ConsoleRoute><Platform /></ConsoleRoute>} />
          <Route path="dashboard" element={<CollegeRoute><Dashboard /></CollegeRoute>} />
          <Route path="companies" element={<CollegeRoute><Companies /></CollegeRoute>} />
          <Route path="companies/:id" element={<CollegeRoute><CompanyDetail /></CollegeRoute>} />
          <Route path="students" element={<CollegeRoute><Students /></CollegeRoute>} />
          <Route path="drives" element={<CollegeRoute><Drives /></CollegeRoute>} />
          <Route path="drives/:id" element={<CollegeRoute><DriveDetail /></CollegeRoute>} />
          <Route path="offers" element={<CollegeRoute><Offers /></CollegeRoute>} />
          <Route path="officers" element={<CollegeRoute><Officers /></CollegeRoute>} />
          <Route path="communications" element={<CollegeRoute><Communications /></CollegeRoute>} />
          <Route path="hr-contacts" element={<CollegeRoute><HRContacts /></CollegeRoute>} />
          <Route path="training" element={<CollegeRoute><Training /></CollegeRoute>} />
          <Route path="daily-update" element={<CollegeRoute><DailyUpdate /></CollegeRoute>} />
          <Route
            path="daily-digest"
            element={<CollegeRoute><AdminRoute><DailyDigest /></AdminRoute></CollegeRoute>}
          />
          {/* Staff-wide: officers read the radar, leadership acts on it. The
              action buttons are gated inside the page. */}
          <Route path="opportunities" element={<CollegeRoute><Opportunities /></CollegeRoute>} />
          <Route path="analytics" element={<CollegeRoute><Analytics /></CollegeRoute>} />
          {/* Reports cover the whole college, so they follow the same role gate
              the API enforces: leadership only. */}
          <Route path="reports" element={<CollegeRoute><AdminRoute><Reports /></AdminRoute></CollegeRoute>} />
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
      </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
