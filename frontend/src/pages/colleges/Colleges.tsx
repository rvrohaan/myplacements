import { useEffect, useState } from 'react'
import { Plus, CheckCircle2, Building, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import type { College, Invite } from '@/types'
import { formatDate } from '@/lib/utils'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { all, email as emailRule, required, type Rules } from '@/lib/validation'
import {
  CopyButton,
  DeliveryNote,
  EmailButton,
  LinkBox,
  WhatsAppButton,
  inviteMessage,
} from '@/components/ui/share-link'

const BASE_DOMAIN = 'myplacements.in'

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

interface NewCollegeForm {
  name: string
  code: string
  city: string
  logo_url: string
  admin_full_name: string
  admin_email: string
}

const EMPTY_FORM: NewCollegeForm = {
  name: '',
  code: '',
  city: '',
  logo_url: '',
  admin_full_name: '',
  admin_email: '',
}

export default function Colleges() {
  const [colleges, setColleges] = useState<College[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const load = () => {
    setLoading(true)
    api
      .get<College[]>('/colleges')
      .then((r) => setColleges(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Each college gets its own portal at <span className="font-medium">code.{BASE_DOMAIN}</span>.
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm shadow-primary-600/25"
        >
          <Plus className="w-4 h-4" />
          Add college
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : colleges.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          No colleges yet. Add your first one to spin up its portal.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colleges.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                {c.logo_url ? (
                  <img src={c.logo_url} alt={c.name} className="w-10 h-10 rounded-lg object-contain bg-gray-50" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                    <Building className="w-5 h-5 text-primary-600" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                  {c.city && <p className="text-xs text-gray-500 truncate">{c.city}</p>}
                </div>
              </div>
              <a
                href={`https://${c.code}.${BASE_DOMAIN}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {c.code}.{BASE_DOMAIN}
              </a>
            </div>
          ))}
        </div>
      )}

      {showModal && <AddCollegeModal onClose={() => setShowModal(false)} onCreated={load} />}
    </div>
  )
}

const RULES: Rules<NewCollegeForm> = {
  name: required('Enter the college’s full name.'),
  code: all(
    required('Choose a subdomain code, e.g. rit.'),
    (value) =>
      SUBDOMAIN_RE.test(value)
        ? undefined
        : 'Use lowercase letters, digits and hyphens only — and don’t start or end with a hyphen.',
  ),
  logo_url: (value) => {
    if (!value.trim()) return undefined
    return /^https?:\/\/.+/i.test(value.trim())
      ? undefined
      : 'Paste the full image address, starting with https://.'
  },
  admin_full_name: required('Enter the placement head’s name.'),
  admin_email: emailRule(
    'That doesn’t look like an email address — check for a typo.',
    'Enter the email they will sign in with.',
  ),
}

function AddCollegeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<NewCollegeForm>(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<{ form: NewCollegeForm; invite?: Invite | null } | null>(
    null,
  )

  const { formRef, errors, clearError, validate } = useFieldErrors<NewCollegeForm>()

  const update = (field: keyof NewCollegeForm, value: string) => {
    clearError(field)
    setForm((f) => ({ ...f, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(RULES, form)) return
    setLoading(true)
    try {
      // No password is chosen here: the head gets a one-time link to set theirs.
      const { data } = await api.post('/colleges', {
        name: form.name,
        code: form.code,
        city: form.city || null,
        logo_url: form.logo_url || null,
        admin: {
          email: form.admin_email,
          full_name: form.admin_full_name,
        },
      })
      setCreated({ form, invite: data.invite })
      onCreated()
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || 'Could not create this college. Check your connection and try again.',
      )
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
            {created ? 'College created' : 'Add new college'}
          </ModalTitle>
          <ModalClose />
        </div>

        {created ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <p className="text-sm text-green-800">
                <span className="font-medium">{created.form.name}</span> is live at{' '}
                <span className="font-medium">
                  {created.form.code}.{BASE_DOMAIN}
                </span>
                . Its placement head sets their own password from the link below.
              </p>
            </div>

            {created.invite && (
              <>
                <div
                  className={
                    created.invite.email_status === 'sent'
                      ? 'px-4 py-3 bg-green-50 border border-green-200 rounded-lg'
                      : 'px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg'
                  }
                >
                  <DeliveryNote
                    status={created.invite.email_status}
                    email={created.invite.email}
                  />
                </div>

                <div className="space-y-2">
                  <LinkBox url={created.invite.url} />
                  <p className="text-xs text-gray-500">
                    Works once, and expires on {formatDate(created.invite.expires_at)}.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <CopyButton value={created.invite.url} label="Copy" className="px-2" />
                  <WhatsAppButton
                    message={inviteMessage(
                      created.form.admin_full_name,
                      created.invite.url,
                      created.form.name,
                    )}
                    className="px-2"
                  />
                  <EmailButton
                    to={created.invite.email}
                    subject={`Your ${created.form.name} placement portal`}
                    body={inviteMessage(
                      created.form.admin_full_name,
                      created.invite.url,
                      created.form.name,
                    )}
                    className="px-2"
                  />
                </div>
              </>
            )}

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

            <Field label="College name" name="name" required error={errors.name}>
              {(p) => (
                <input
                  {...p}
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  className={inputClass(!!errors.name)}
                  placeholder="Ramaiah Institute of Technology"
                />
              )}
            </Field>

            <Field
              label="Subdomain code"
              name="code"
              required
              error={errors.code}
              hint="Lowercase letters, digits and hyphens. This becomes the portal address."
            >
              {(p) => (
                <div className="flex items-center">
                  <input
                    {...p}
                    value={form.code}
                    onChange={(e) => update('code', e.target.value.toLowerCase())}
                    className={inputClass(!!errors.code, 'rounded-r-none font-mono')}
                    placeholder="rit"
                  />
                  <span className="px-3 py-2.5 border border-l-0 border-gray-300 rounded-r-lg bg-gray-50 text-sm text-gray-500 whitespace-nowrap">
                    .{BASE_DOMAIN}
                  </span>
                </div>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="City" name="city" optional>
                {(p) => (
                  <input
                    {...p}
                    value={form.city}
                    onChange={(e) => update('city', e.target.value)}
                    className={inputClass()}
                    placeholder="Bengaluru"
                  />
                )}
              </Field>
              <Field label="Logo URL" name="logo_url" optional error={errors.logo_url}>
                {(p) => (
                  <input
                    {...p}
                    type="url"
                    value={form.logo_url}
                    onChange={(e) => update('logo_url', e.target.value)}
                    className={inputClass(!!errors.logo_url)}
                    placeholder="https://..."
                  />
                )}
              </Field>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-3">First admin (placement head)</p>
              <div className="space-y-4">
                <Field label="Full name" name="admin_full_name" required error={errors.admin_full_name}>
                  {(p) => (
                    <input
                      {...p}
                      value={form.admin_full_name}
                      onChange={(e) => update('admin_full_name', e.target.value)}
                      className={inputClass(!!errors.admin_full_name)}
                      placeholder="Jane Doe"
                    />
                  )}
                </Field>
                <Field label="Email address" name="admin_email" required error={errors.admin_email}>
                  {(p) => (
                    <input
                      {...p}
                      type="email"
                      value={form.admin_email}
                      onChange={(e) => update('admin_email', e.target.value)}
                      className={inputClass(!!errors.admin_email)}
                      placeholder="head@college.edu"
                    />
                  )}
                </Field>
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
                  No password needed — we’ll email them a one-time link to set their own, and show
                  you the same link to share.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              {loading ? 'Creating…' : 'Create college & send link'}
            </button>
          </form>
        )}
    </Modal>
  )
}
