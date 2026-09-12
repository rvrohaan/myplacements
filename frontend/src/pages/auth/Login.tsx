import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrainCircuit, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'
import { getSubdomain, isAdminHost } from '@/lib/tenant'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { email as emailRule, required, type Rules } from '@/lib/validation'
import type { CollegeBranding } from '@/types'

type Credentials = { email: string; rollNumber: string; password: string }

const STAFF_RULES: Rules<Credentials> = {
  email: emailRule(
    'That doesn’t look like an email address — check for a typo.',
    'Enter the email address you signed up with.',
  ),
  password: required('Enter your password.'),
}

const STUDENT_RULES: Rules<Credentials> = {
  rollNumber: required('Enter your roll number, e.g. CS21001.'),
  password: required('Enter your password.'),
}

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
  const [showPassword, setShowPassword] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<Credentials>()

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
    const isStudent = mode === 'student' && !adminHost
    if (!validate(isStudent ? STUDENT_RULES : STAFF_RULES, { email, rollNumber, password })) return
    setLoading(true)
    try {
      const user = isStudent
        ? await studentLogin(rollNumber, password)
        : await login(email, password)
      const home = isStudent ? '/portal' : adminHost ? '/colleges' : '/dashboard'
      navigate(user.must_reset_password ? '/reset-password' : home)
    } catch {
      // Deliberately vague about which half was wrong — naming the field would
      // tell an attacker which accounts exist.
      setError(
        mode === 'student'
          ? 'That roll number and password don’t match. Check them and try again.'
          : 'That email and password don’t match. Check them and try again.',
      )
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
                  clearError('email')
                  clearError('rollNumber')
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
          <div
            role="alert"
            className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm"
          >
            {error}
          </div>
        )}

        {/* noValidate keeps the browser's own validation tooltips off the field;
            the messages below each input say the same thing, in our voice. */}
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
          {mode === 'student' && showStudentToggle ? (
            <Field label="Roll number" name="rollNumber" required error={errors.rollNumber}>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  autoComplete="username"
                  value={rollNumber}
                  onChange={(e) => {
                    clearError('rollNumber')
                    setRollNumber(e.target.value)
                  }}
                  className={inputClass(!!errors.rollNumber)}
                  placeholder="e.g. CS21001"
                />
              )}
            </Field>
          ) : (
            <Field label="Email address" name="email" required error={errors.email}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    clearError('email')
                    setEmail(e.target.value)
                  }}
                  className={inputClass(!!errors.email)}
                  placeholder="you@college.edu"
                />
              )}
            </Field>
          )}
          <Field label="Password" name="password" required error={errors.password}>
            {(p) => (
              <div className="relative">
                <input
                  {...p}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    clearError('password')
                    setPassword(e.target.value)
                  }}
                  className={inputClass(!!errors.password, 'pr-12')}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2.5 text-gray-400 hover:text-gray-600 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}
          </Field>
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-center text-gray-400 mt-6">
          Contact your placement admin to get account access.
        </p>
      </div>
    </div>
  )
}
