import { useEffect, useState } from 'react'
import { Plus, CheckCircle2, Copy, Building, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import type { College } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

const BASE_DOMAIN = 'myplacements.in'

interface NewCollegeForm {
  name: string
  code: string
  city: string
  logo_url: string
  admin_full_name: string
  admin_email: string
  admin_password: string
}

const EMPTY_FORM: NewCollegeForm = {
  name: '',
  code: '',
  city: '',
  logo_url: '',
  admin_full_name: '',
  admin_email: '',
  admin_password: '',
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

function AddCollegeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<NewCollegeForm>(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<NewCollegeForm | null>(null)
  const [copied, setCopied] = useState(false)

  const update = (field: keyof NewCollegeForm, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.admin_password.length < 8) {
      setError('Admin password must be at least 8 characters long')
      return
    }
    setLoading(true)
    try {
      await api.post('/colleges', {
        name: form.name,
        code: form.code,
        city: form.city || null,
        logo_url: form.logo_url || null,
        admin: {
          email: form.admin_email,
          full_name: form.admin_full_name,
          password: form.admin_password,
        },
      })
      setCreated(form)
      onCreated()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not create college')
    } finally {
      setLoading(false)
    }
  }

  const copyCredentials = () => {
    if (!created) return
    navigator.clipboard.writeText(
      `Portal: https://${created.code}.${BASE_DOMAIN}\n` +
        `Email: ${created.admin_email}\nTemporary password: ${created.admin_password}`
    )
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
            {created ? 'College created' : 'Add new college'}
          </ModalTitle>
          <ModalClose />
        </div>

        {created ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <p className="text-sm text-green-800">
                <span className="font-medium">{created.name}</span> is live. Share the portal link
                and credentials with its admin — they’ll set their own password on first login.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-gray-500">Portal</span>
                <span className="font-medium text-gray-900">{created.code}.{BASE_DOMAIN}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-gray-500">Admin email</span>
                <span className="font-medium text-gray-900">{created.admin_email}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-gray-500">Temporary password</span>
                <span className="font-mono font-medium text-gray-900">{created.admin_password}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyCredentials}
                className="flex-1 flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                <Copy className="w-4 h-4" />
                {copied ? 'Copied!' : 'Copy details'}
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">College name</label>
              <input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Ramaiah Institute of Technology"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subdomain code</label>
              <div className="flex items-center">
                <input
                  value={form.code}
                  onChange={(e) => update('code', e.target.value.toLowerCase())}
                  required
                  pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                  title="Lowercase letters, digits and hyphens only"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-l-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="rit"
                />
                <span className="px-3 py-2.5 border border-l-0 border-gray-300 rounded-r-lg bg-gray-50 text-sm text-gray-500 whitespace-nowrap">
                  .{BASE_DOMAIN}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Lowercase letters, digits and hyphens. This is the portal address.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  City <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Bengaluru"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Logo URL <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  value={form.logo_url}
                  onChange={(e) => update('logo_url', e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-3">First admin (placement head)</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
                  <input
                    value={form.admin_full_name}
                    onChange={(e) => update('admin_full_name', e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                  <input
                    type="email"
                    value={form.admin_email}
                    onChange={(e) => update('admin_email', e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="head@college.edu"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Temporary password</label>
                  <input
                    type="text"
                    value={form.admin_password}
                    onChange={(e) => update('admin_password', e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="At least 8 characters"
                  />
                  <p className="text-xs text-gray-400 mt-1">They’ll be asked to change this on first login.</p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25"
            >
              {loading ? 'Creating...' : 'Create college'}
            </button>
          </form>
        )}
    </Modal>
  )
}
