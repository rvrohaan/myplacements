import { useState } from 'react'
import {
  CalendarClock,
  Linkedin,
  Mail,
  Pencil,
  Phone,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm'
import { cn, formatDate } from '@/lib/utils'
import type { HRContact } from '@/types'
import HRContactModal, { STRENGTH_LABELS } from './HRContactModal'

/** The 1-5 rating, read-only: five rungs, filled to the current value. */
export function StrengthBar({ value, className }: { value: number; className?: string }) {
  const level = Math.max(1, Math.min(5, value || 3))
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 align-middle', className)}
      title={STRENGTH_LABELS[level]}
      aria-label={`Relationship strength: ${STRENGTH_LABELS[level]}`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          aria-hidden="true"
          className={cn(
            'w-1.5 h-3 rounded-sm',
            n <= level ? 'bg-primary-500' : 'bg-gray-200',
          )}
        />
      ))}
    </span>
  )
}

function ContactCard({
  contact,
  onEdit,
  onDelete,
  onDraftEmail,
}: {
  contact: HRContact
  onEdit: () => void
  onDelete: () => void
  onDraftEmail: () => void
}) {
  const overdue =
    contact.next_followup_date && new Date(contact.next_followup_date) < new Date()

  return (
    <div className="border border-gray-100 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 text-sm truncate">{contact.name}</p>
          {contact.designation && (
            <p className="text-xs text-gray-500 truncate">{contact.designation}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onDraftEmail}
            title="Draft an email to this contact"
            className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Draft email
          </button>
          <button
            onClick={onEdit}
            title="Edit this contact"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            title="Remove this contact"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2">
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            title={contact.email}
            className="text-gray-400 hover:text-primary-600"
          >
            <Mail className="w-3.5 h-3.5" />
          </a>
        )}
        {contact.mobile && (
          <a
            href={`tel:${contact.mobile}`}
            title={contact.mobile}
            className="text-gray-400 hover:text-primary-600"
          >
            <Phone className="w-3.5 h-3.5" />
          </a>
        )}
        {contact.linkedin && (
          <a
            href={contact.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            title="LinkedIn profile"
            className="text-gray-400 hover:text-primary-600"
          >
            <Linkedin className="w-3.5 h-3.5" />
          </a>
        )}
        <StrengthBar value={contact.relationship_strength} className="ml-auto" />
      </div>

      {contact.next_action && (
        <p className="text-xs text-gray-600 mt-2 flex items-start gap-1.5">
          <span className="text-gray-400 shrink-0">Next:</span>
          <span className="min-w-0">{contact.next_action}</span>
        </p>
      )}
      {contact.next_followup_date && (
        <p
          className={cn(
            'text-xs mt-1 flex items-center gap-1',
            overdue ? 'text-red-600 font-medium' : 'text-orange-600',
          )}
        >
          <CalendarClock className="w-3 h-3 shrink-0" />
          {overdue ? 'Overdue since' : 'Follow-up'} {formatDate(contact.next_followup_date)}
        </p>
      )}
    </div>
  )
}

/**
 * The HR contacts of one company. The cross-company view of the same people
 * lives at /hr-contacts — this one is for working a single company.
 *
 * There is no separate permission gate here on purpose: the backend's only rule
 * for managing a contact is that you can reach its company (officers reach the
 * ones allocated to them), so reaching this page *is* the permission. Gating
 * the buttons on a role as well would hide actions the API would have allowed.
 */
export default function HRContactsPanel({
  companyId,
  contacts,
  onChanged,
  onDraftEmail,
}: {
  companyId: number
  contacts: HRContact[]
  onChanged: () => void | Promise<void>
  onDraftEmail: (contact: HRContact) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<HRContact | null>(null)

  const remove = async (contact: HRContact) => {
    const ok = await confirm({
      title: `Remove ${contact.name}?`,
      message:
        'Communications already logged against them are kept — they stay on the company’s timeline, just without a contact attached.',
      confirmLabel: 'Remove contact',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/companies/${companyId}/hr-contacts/${contact.id}`)
      await onChanged()
      toast.success(`${contact.name} removed.`)
    } catch {
      toast.error('Could not remove this contact. Please try again.')
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-gray-800">HR Contacts ({contacts.length})</h3>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-gray-400">No HR contacts added yet</p>
      ) : (
        <div className="space-y-3">
          {contacts.map((hr) => (
            <ContactCard
              key={hr.id}
              contact={hr}
              onEdit={() => setEditing(hr)}
              onDelete={() => remove(hr)}
              onDraftEmail={() => onDraftEmail(hr)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <HRContactModal
          companyId={companyId}
          onClose={() => setShowAdd(false)}
          onSaved={onChanged}
        />
      )}
      {editing && (
        <HRContactModal
          companyId={companyId}
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  )
}
