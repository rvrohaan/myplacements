import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrainCircuit, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
import { getSubdomain, isAdminHost } from '@/lib/tenant'
import type { CollegeBranding } from '@/types'

export default function Login() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const studentLogin = useAuthStore((s) => s.studentLogin)
  const [mode, setMode] = useState<'staff' | 'student'>('staff')
  const [email, setEmail] = useState('')
  const [rollNumber, setRollNumber] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Resolve the college from the subdomain so the login screen is branded and
  // we can warn when someone lands on an unknown / apex host. The admin console
  // (admin.*) is not a college — it gets its own branding and skips the lookup.
  const adminHost = isAdminHost()
  const [college, setCollege] = useState<CollegeBranding | null>(null)
  const [tenantError, setTenantError] = useState(false)
  const hasSubdomain = !!getSubdomain()

  useEffect(() => {
    if (!hasSubdomain || adminHost) return
    api
      .get<CollegeBranding>('/colleges/current')
      .then(({ data }) => setCollege(data))
      .catch(() => setTenantError(true))
  }, [hasSubdomain, adminHost])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const isStudent = mode === 'student' && !adminHost
      const user = isStudent
        ? await studentLogin(rollNumber, password)
        : await login(email, password)
      const home = isStudent ? '/portal' : adminHost ? '/colleges' : '/dashboard'
      navigate(user.must_reset_password ? '/reset-password' : home)
    } catch {
      setError(mode === 'student' ? 'Invalid roll number or password' : 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  // Students sign in only on a real college portal, not the apex/admin host.
  const showStudentToggle = hasSubdomain && !adminHost

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 to-primary-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-8">
          {adminHost ? (
            <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
          ) : college?.logo_url ? (
            <img
              src={college.logo_url}
              alt={college.name}
              className="w-10 h-10 rounded-xl object-contain bg-white"
            />
          ) : (
            <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {adminHost ? 'MyPlacement.AI' : college?.name ?? 'MyPlacement.AI'}
            </h1>
            <p className="text-xs text-gray-500">
              {adminHost
                ? 'Platform Console'
                : college
                ? 'Powered by MyPlacement.AI'
                : 'Placement Intelligence System'}
            </p>
          </div>
        </div>

        <h2 className="text-2xl font-semibold text-gray-800 mb-1">Welcome back</h2>
        <p className="text-sm text-gray-500 mb-6">
          {adminHost ? 'Sign in to the platform console' : 'Sign in to your account'}
        </p>

        {showStudentToggle && (
          <div className="flex p-1 mb-6 bg-gray-100 rounded-lg text-sm font-medium">
            {(['staff', 'student'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m)
                  setError('')
                }}
                className={
                  'flex-1 py-1.5 rounded-md capitalize transition-colors ' +
                  (mode === m ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700')
                }
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {tenantError && !adminHost && (
          <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
            This college portal could not be found. Check the address — it should look like{' '}
            <span className="font-medium">yourcollege.myplacements.in</span>.
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'student' && showStudentToggle ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Roll number</label>
              <input
                type="text"
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="e.g. CS21001"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="you@college.edu"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-center text-gray-400 mt-6">
          Contact your placement admin to get account access.
        </p>
      </div>
    </div>
  )
}
