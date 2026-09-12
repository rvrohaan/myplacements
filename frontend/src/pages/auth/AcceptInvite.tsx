import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BrainCircuit, Eye, EyeOff, KeyRound, Link2Off } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { all, required, type Rule, type Rules } from '@/lib/validation'

/**
 * Public page behind a one-time invite link: the invitee sets their own
 * password and is signed in on success, so nobody ever handles a temporary
 * password. Unauthenticated by design — the token in the URL is the credential.
 */

type PasswordForm = { password: string; confirm: string }

const minLength = (n: number, message: string): Rule<PasswordForm> => (value) =>
  value.length < n ? message : undefined

const RULES: Rules<PasswordForm> = {
  password: all(
    required('Choose a password.'),
    minLength(8, 'Use at least 8 characters — longer passphrases are harder to guess.'),
  ),
  confirm: (value, form) => {
    if (!value) return 'Type the password again to confirm it.'
    return value === form.password ? undefined : 'The two passwords don’t match. Retype them to be sure.'
  },
}

interface InviteCheck {
  full_name: string
  college_name?: string | null
  is_reset: boolean
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 to-primary-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
            <BrainCircuit className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">MyPlacement.AI</h1>
            <p className="text-xs text-gray-500">Placement Intelligence System</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function AcceptInvite() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const acceptInvite = useAuthStore((s) => s.acceptInvite)

  const [invite, setInvite] = useState<InviteCheck | null>(null)
  const [checking, setChecking] = useState(true)
  const [dead, setDead] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<PasswordForm>()

  // Check the link before showing a form, so an expired one says so up front
  // rather than after someone has chosen a password.
  useEffect(() => {
    let cancelled = false
    api
      .get<InviteCheck>(`/auth/invite/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (!cancelled) setInvite(data)
      })
      .catch(() => {
        if (!cancelled) setDead(true)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(RULES, { password, confirm })) return
    setLoading(true)
    try {
      const user = await acceptInvite(token, password)
      // Accepting signs you in, so go straight where you belong.
      navigate(user.role === 'student' ? '/portal' : '/dashboard', { replace: true })
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setDead(true) // used, expired or superseded while the form was open
      } else {
        setError('Could not set your password just now. Check your connection and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <Shell>
        <p className="text-sm text-gray-500">Checking your link…</p>
      </Shell>
    )
  }

  if (dead || !invite) {
    return (
      <Shell>
        <div className="flex items-center gap-2 mb-1">
          <Link2Off className="w-5 h-5 text-amber-600" />
          <h2 className="text-2xl font-semibold text-gray-800">This link has expired</h2>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Password links can be used once, and only on your college’s portal. Ask your placement
          office to send you a new one.
        </p>
        <button
          onClick={() => navigate('/login')}
          className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          Go to sign in
        </button>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-5 h-5 text-primary-600" />
        <h2 className="text-2xl font-semibold text-gray-800">
          {invite.is_reset ? 'Set a new password' : 'Set your password'}
        </h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Welcome, {invite.full_name}
        {invite.college_name ? ` — ${invite.college_name}` : ''}. Choose a password and you’ll be
        signed in straight away.
      </p>

      {error && (
        <div
          role="alert"
          className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm"
        >
          {error}
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field
          label="Password"
          name="password"
          required
          error={errors.password}
          hint="At least 8 characters"
        >
          {(p) => (
            <div className="relative">
              <input
                {...p}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
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
        <Field label="Confirm password" name="confirm" required error={errors.confirm}>
          {(p) => (
            <input
              {...p}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                clearError('confirm')
                setConfirm(e.target.value)
              }}
              className={inputClass(!!errors.confirm)}
              placeholder="••••••••"
            />
          )}
        </Field>
        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {loading ? 'Setting password…' : 'Set password & continue'}
        </button>
      </form>
    </Shell>
  )
}
