import { useState } from 'react'
import { Sparkles, Copy, Check } from 'lucide-react'
import api from '@/lib/api'
import type { Company, HRContact } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

const PURPOSE_PRESETS = [
  'Initial outreach to invite the company for campus placements',
  'Follow-up on a previous email with no response',
  'Request to schedule a placement drive',
  'Thank-you note after a successful drive',
]

export default function DraftEmailModal({
  company,
  contact,
  onClose,
}: {
  // Only the id and name are ever read here. Taking the narrow shape lets the
  // HR directory open this modal from a row it already has, instead of having
  // to find the full company first (and silently doing nothing when it can't).
  company: Pick<Company, 'id' | 'name'>
  contact: HRContact
  onClose: () => void
}) {
  const [purpose, setPurpose] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const generate = async () => {
    if (!purpose.trim()) {
      setError('Describe what the email should be about first.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post(
        `/companies/${company.id}/hr-contacts/${contact.id}/draft-email`,
        { purpose }
      )
      setEmail(data.email)
    } catch {
      setError('Could not draft the email. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(email)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={!!email || purpose.trim().length > 0}
      panelClassName="w-full max-w-2xl max-h-[88vh] flex flex-col"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-600" />
            <div>
              <ModalTitle>AI Draft Email</ModalTitle>
              <p className="text-xs text-gray-500">To {contact.name} · {company.name}</p>
            </div>
          </div>
          <ModalClose />
        </div>

        <div className="px-6 py-4 border-b border-gray-100 space-y-2">
          <label className="block text-xs font-medium text-gray-500">What is the email about?</label>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={2}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
            placeholder="e.g. Invite them for our 2026 batch campus placements"
          />
          <div className="flex flex-wrap gap-1.5">
            {PURPOSE_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setPurpose(p)}
                disabled={loading}
                className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-60"
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {loading ? 'Drafting...' : email ? 'Regenerate' : 'Draft email'}
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {error ? (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-gray-500 py-10 justify-center text-sm">
              <Sparkles className="w-4 h-4 animate-pulse" />
              Drafting email...
            </div>
          ) : email ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={copy}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-primary-600"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                rows={14}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {contact.email && (
                <a
                  href={`mailto:${contact.email}?subject=${encodeURIComponent('Placement Cell — ' + company.name)}&body=${encodeURIComponent(email)}`}
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
                >
                  Open in mail client →
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-10">
              Describe the email's purpose above and click "Draft email".
            </p>
          )}
        </div>
    </Modal>
  )
}
