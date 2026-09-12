import { useEffect, useMemo, useState } from 'react'
import { Search, UserPlus, CheckCircle2, Ban, RotateCcw, Send } from 'lucide-react'
import api from '@/lib/api'
import fetchAll from '@/lib/fetchAll'
import type { Invite, User, UserCreated, UserRole } from '@/types'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useToast } from '@/components/ui/toast'
import { isAdminHost } from '@/lib/tenant'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { email as emailRule, required, type Rules } from '@/lib/validation'
import {
  CopyButton,
  DeliveryNote,
  EmailButton,
  LinkBox,
  WhatsAppButton,
  inviteMessage,
} from '@/components/ui/share-link'

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
  college_id: string
}

const EMPTY_FORM: NewUserForm = {
  full_name: '',
  email: '',
  role: 'placement_officer',
  department: '',
  college_id: '',
}

const RULES: Rules<NewUserForm> = {
  college_id: required('Choose which college this user belongs to.'),
  full_name: required('Enter the person’s full name.'),
  email: emailRule(
    'That doesn’t look like an email address — check for a typo.',
    'Enter the email they will sign in with.',
  ),
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
  const [reissued, setReissued] = useState<{ user: User; invite: Invite } | null>(null)
  const toast = useToast()

  // Load every staff account so the search box below covers all of them, not
  // just the first page the endpoint returns by default.
  const loadUsers = () => {
    setLoading(true)
    fetchAll<User>('/users')
      .then(setUsers)
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

  // Covers both an invite that was never redeemed and a member of staff who is
  // locked out: there is no self-service reset, so re-issuing the link is how
  // someone gets back in.
  const sendLoginLink = async (user: User) => {
    setBusyId(user.id)
    try {
      const { data } = await api.post<Invite>(`/users/${user.id}/invite`)
      setReissued({ user, invite: data })
      if (data.email_status === 'sent') toast.success(`Login link emailed to ${data.email}.`)
      // The account is pending a password again until the link is used.
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, must_reset_password: true } : u))
      )
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not create a login link just now.')
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
                    ) : (
                      <div className="flex items-center justify-end gap-3">
                        {u.is_active && (
                          <button
                            onClick={() => sendLoginLink(u)}
                            disabled={busyId === u.id}
                            title="Email a fresh one-time link for setting their password"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                          >
                            <Send className="w-3.5 h-3.5" />
                            {u.must_reset_password ? 'Resend link' : 'Send link'}
                          </button>
                        )}
                        {u.is_active ? (
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
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {reissued && (
        <InviteModal
          user={reissued.user}
          invite={reissued.invite}
          onClose={() => setReissued(null)}
        />
      )}

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
  const [created, setCreated] = useState<UserCreated | null>(null)

  const { formRef, errors, clearError, validate } = useFieldErrors<NewUserForm>()

  const update = (field: keyof NewUserForm, value: string) => {
    clearError(field)
    setForm((f) => ({ ...f, [field]: value }))
  }

  // Only the console picks a college explicitly; on a college portal the
  // message simply doesn't name one.
  const collegeName = colleges.find((c) => String(c.id) === form.college_id)?.name

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    // On a college portal the tenant is implied by the subdomain, so there's
    // no college field to fill in.
    const rules = ADMIN_HOST ? RULES : { ...RULES, college_id: undefined }
    if (!validate(rules, form)) return
    setLoading(true)
    try {
      // No password is sent: the account is created without one and the
      // response carries a single-use link for the new user to set their own.
      const { data } = await api.post<UserCreated>('/users', {
        full_name: form.full_name,
        email: form.email,
        role: form.role,
        department: form.department || null,
        // Only the console targets a college explicitly; college portals infer it.
        ...(ADMIN_HOST ? { college_id: Number(form.college_id) } : {}),
      })
      setCreated(data)
      onCreated()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not create user')
    } finally {
      setLoading(false)
    }
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
            <InvitePanel
              name={created.full_name}
              invite={created.invite}
              collegeName={collegeName}
              intro={
                <>
                  <span className="font-medium">{created.full_name}</span> has been added. They set
                  their own password from the link below — nothing here is a password, and the link
                  stops working once used.
                </>
              }
            />
            <button
              onClick={onClose}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors shadow-sm shadow-primary-600/25"
            >
              Done
            </button>
          </div>
        ) : (
          <form ref={formRef} onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
            {error && (
              <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}
            {ADMIN_HOST && (
              <Field label="College" name="college_id" required error={errors.college_id}>
                {(p) => (
                  <select
                    {...p}
                    value={form.college_id}
                    onChange={(e) => update('college_id', e.target.value)}
                    className={inputClass(!!errors.college_id)}
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
                )}
              </Field>
            )}
            <Field label="Full name" name="full_name" required error={errors.full_name}>
              {(p) => (
                <input
                  {...p}
                  value={form.full_name}
                  onChange={(e) => update('full_name', e.target.value)}
                  className={inputClass(!!errors.full_name)}
                  placeholder="Jane Doe"
                />
              )}
            </Field>
            <Field label="Email address" name="email" required error={errors.email}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  className={inputClass(!!errors.email)}
                  placeholder="jane@college.edu"
                />
              )}
            </Field>
            <Field label="Role" name="role">
              {(p) => (
                <select
                  {...p}
                  value={form.role}
                  onChange={(e) => update('role', e.target.value)}
                  className={inputClass()}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Department" name="department" optional>
              {(p) => (
                <input
                  {...p}
                  value={form.department}
                  onChange={(e) => update('department', e.target.value)}
                  className={inputClass()}
                  placeholder="Computer Science"
                />
              )}
            </Field>
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
              No password needed. We’ll email them a one-time link to set their own, and show you
              the same link to share on WhatsApp or SMS if you'd rather.
            </p>
            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              {loading ? 'Creating…' : 'Create user & send link'}
            </button>
          </form>
        )}
    </Modal>
  )
}


/**
 * What to do with a freshly minted setup link. Email is attempted server-side;
 * these buttons cover the channels we can't send ourselves yet, by handing the
 * message to the sender's own WhatsApp or mail client.
 */
function InvitePanel({
  name,
  invite,
  collegeName,
  intro,
}: {
  name: string
  invite?: Invite | null
  collegeName?: string
  intro: React.ReactNode
}) {
  if (!invite) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
        <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
        <p className="text-sm text-green-800">{intro}</p>
      </div>
    )
  }

  const message = inviteMessage(name, invite.url, collegeName)
  const expires = formatDate(invite.expires_at)

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
        <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
        <p className="text-sm text-green-800">{intro}</p>
      </div>

      <div
        className={
          invite.email_status === 'sent'
            ? 'px-4 py-3 bg-green-50 border border-green-200 rounded-lg'
            : 'px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg'
        }
      >
        <DeliveryNote status={invite.email_status} email={invite.email} />
      </div>

      <div className="space-y-2">
        <LinkBox url={invite.url} />
        <p className="text-xs text-gray-500">Works once, and expires on {expires}.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <CopyButton value={invite.url} label="Copy" copiedLabel="Copied" className="px-2" />
        <WhatsAppButton message={message} className="px-2" />
        <EmailButton
          to={invite.email}
          subject="Your MyPlacement.AI account"
          body={message}
          className="px-2"
        />
      </div>
    </>
  )
}

/** Shown after re-issuing a link from the table, so it can be sent on. */
function InviteModal({
  user,
  invite,
  onClose,
}: {
  user: User
  invite: Invite
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <ModalTitle>Login link for {user.full_name}</ModalTitle>
        <ModalClose />
      </div>
      <div className="p-6 space-y-4">
        <InvitePanel
          name={user.full_name}
          invite={invite}
          intro={
            <>
              A new link is ready. Any link sent earlier has stopped working, so send this one.
            </>
          }
        />
        <button
          onClick={onClose}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors shadow-sm shadow-primary-600/25"
        >
          Done
        </button>
      </div>
    </Modal>
  )
}
