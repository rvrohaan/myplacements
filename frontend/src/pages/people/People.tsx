import { useEffect, useMemo, useState } from 'react'
import { Search, UserPlus, CheckCircle2, Copy, Ban, RotateCcw } from 'lucide-react'
import api from '@/lib/api'
import type { User, UserRole } from '@/types'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { isAdminHost } from '@/lib/tenant'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

interface CollegeOption {
  id: number
  name: string
  code: string
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'principal', label: 'Principal' },
  { value: 'pro_chancellor', label: 'Pro Chancellor' },
  { value: 'deputy_pro_chancellor', label: 'Deputy Pro Chancellor' },
  { value: 'placement_officer', label: 'Placement Officer' },
  { value: 'department_coordinator', label: 'Department Coordinator' },
  { value: 'student', label: 'Student' },
]

const ROLE_LABELS: Record<UserRole, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label])
) as Record<UserRole, string>

interface NewUserForm {
  full_name: string
  email: string
  role: UserRole
  department: string
  password: string
  college_id: string
}

const EMPTY_FORM: NewUserForm = {
  full_name: '',
  email: '',
  role: 'placement_officer',
  department: '',
  password: '',
  college_id: '',
}

// On the platform console a user isn't tied to the current subdomain, so the
// college must be chosen explicitly; on a college portal it's implied.
const ADMIN_HOST = isAdminHost()
// Table column count for full-width loading/empty rows (+College on the console).
const COL_COUNT = ADMIN_HOST ? 8 : 7

export default function People() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<User[]>([])
  const [colleges, setColleges] = useState<CollegeOption[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const loadUsers = () => {
    setLoading(true)
    api
      .get('/users')
      .then((r) => setUsers(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(loadUsers, [])

  // The console needs the college list (for the picker + a College column).
  useEffect(() => {
    if (ADMIN_HOST) api.get<CollegeOption[]>('/colleges').then((r) => setColleges(r.data))
  }, [])

  const collegeById = useMemo(
    () => Object.fromEntries(colleges.map((c) => [c.id, c])) as Record<number, CollegeOption>,
    [colleges]
  )

  const toggleActive = async (user: User) => {
    setBusyId(user.id)
    try {
      const { data } = await api.put(`/users/${user.id}`, { is_active: !user.is_active })
      setUsers((prev) => prev.map((u) => (u.id === user.id ? data : u)))
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(
    () =>
      users.filter(
        (u) =>
          !search ||
          u.full_name.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase())
      ),
    [users, search]
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm shadow-primary-600/25"
        >
          <UserPlus className="w-4 h-4" />
          Add user
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Name', 'Email', 'Role', ...(ADMIN_HOST ? ['College'] : []), 'Department', 'Status', 'Created'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={COL_COUNT} className="text-center py-10 text-gray-400">Loading...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="text-center py-10 text-gray-400">No users found</td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.full_name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3 text-gray-600">{ROLE_LABELS[u.role] ?? u.role}</td>
                  {ADMIN_HOST && (
                    <td className="px-4 py-3 text-gray-500">
                      {u.college_id ? collegeById[u.college_id]?.name ?? `#${u.college_id}` : '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-500">{u.department || '—'}</td>
                  <td className="px-4 py-3">
                    {u.must_reset_password ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                        Pending password reset
                      </span>
                    ) : u.is_active ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {u.id === currentUser?.id ? (
                      <span className="text-xs text-gray-400">You</span>
                    ) : u.is_active ? (
                      <button
                        onClick={() => toggleActive(u)}
                        disabled={busyId === u.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        Disable
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleActive(u)}
                        disabled={busyId === u.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-700 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Enable
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddUserModal
          colleges={colleges}
          onClose={() => setShowModal(false)}
          onCreated={() => {
            loadUsers()
          }}
        />
      )}
    </div>
  )
}

function AddUserModal({
  colleges,
  onClose,
  onCreated,
}: {
  colleges: CollegeOption[]
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<NewUserForm>(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<NewUserForm | null>(null)
  const [copied, setCopied] = useState(false)

  const update = (field: keyof NewUserForm, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }
    if (ADMIN_HOST && !form.college_id) {
      setError('Please select a college')
      return
    }
    setLoading(true)
    try {
      await api.post('/users', {
        full_name: form.full_name,
        email: form.email,
        role: form.role,
        department: form.department || null,
        password: form.password,
        // Only the console targets a college explicitly; college portals infer it.
        ...(ADMIN_HOST ? { college_id: Number(form.college_id) } : {}),
      })
      setCreated(form)
      onCreated()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not create user')
    } finally {
      setLoading(false)
    }
  }

  const copyCredentials = () => {
    if (!created) return
    navigator.clipboard.writeText(`Email: ${created.email}\nTemporary password: ${created.password}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={!created && JSON.stringify(form) !== JSON.stringify(EMPTY_FORM)}
      panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
          <ModalTitle>
            {created ? 'User created' : 'Add new user'}
          </ModalTitle>
          <ModalClose />
        </div>

        {created ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <p className="text-sm text-green-800">
                <span className="font-medium">{created.full_name}</span> can now sign in. Share the
                credentials below — they’ll be asked to set their own password on first login.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-gray-500">Email</span>
                <span className="font-medium text-gray-900">{created.email}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-gray-500">Temporary password</span>
                <span className="font-mono font-medium text-gray-900">{created.password}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyCredentials}
                className="flex-1 flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                <Copy className="w-4 h-4" />
                {copied ? 'Copied!' : 'Copy credentials'}
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors shadow-sm shadow-primary-600/25"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}
            {ADMIN_HOST && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">College</label>
                <select
                  value={form.college_id}
                  onChange={(e) => update('college_id', e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="" disabled>
                    Select a college…
                  </option>
                  {colleges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
              <input
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="jane@college.edu"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => update('role', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Department <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Computer Science"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Temporary password</label>
              <input
                type="text"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="At least 8 characters"
              />
              <p className="text-xs text-gray-400 mt-1">
                The user will be required to change this on first login.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25"
            >
              {loading ? 'Creating...' : 'Create user'}
            </button>
          </form>
        )}
    </Modal>
  )
}
