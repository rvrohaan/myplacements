import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrainCircuit, KeyRound } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'

export default function ResetPassword() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const resetPassword = useAuthStore((s) => s.resetPassword)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      await resetPassword(password)
      // Students live in the portal; staff land on their dashboard.
      navigate(user?.role === 'student' ? '/portal' : '/dashboard')
    } catch {
      setError('Could not update password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

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

        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-5 h-5 text-primary-600" />
          <h2 className="text-2xl font-semibold text-gray-800">Set a new password</h2>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Welcome{user?.full_name ? `, ${user.full_name}` : ''}. For security, please choose a new
          password before continuing.
        </p>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
            {loading ? 'Updating...' : 'Update password & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
