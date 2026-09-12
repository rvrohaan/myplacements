/**
 * Turning a discovered opening into a company - and, in the same step, into
 * somebody's job.
 *
 * Adding without allocating is how a lead becomes another untouched row in the
 * companies table, so the officer picker sits in this dialog rather than behind
 * a second trip to the Officers page. It stays optional: leadership sometimes
 * wants the company on the list before deciding who works it.
 */

import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import api from '@/lib/api'
import { Modal, ModalCancelButton, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import type { JobLead, Officer } from '@/types'
import { LeadTypeBadge, postedText, SourceLink } from './leadParts'

export default function AddCompanyModal({
  lead,
  onClose,
  onAdded,
}: {
  lead: JobLead
  onClose: () => void
  onAdded: (updated: JobLead) => void
}) {
  const toast = useToast()
  const [sector, setSector] = useState('')
  const [officerId, setOfficerId] = useState('')
  const [officers, setOfficers] = useState<Officer[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/officers').then((r) => setOfficers(r.data)).catch(() => setOfficers([]))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const r = await api.post(`/job-leads/${lead.id}/add-company`, {
        sector: sector.trim() || null,
        officer_id: officerId ? Number(officerId) : null,
      })
      const officerName = officers.find((o) => String(o.id) === officerId)?.officer_name
      toast.success(
        officerName
          ? `${lead.company_name} added and allocated to ${officerName}.`
          : `${lead.company_name} added to your companies.`,
      )
      onAdded(r.data)
      onClose()
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          'Could not add this company. Check your connection and try again.',
      )
      setSaving(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={!!sector || !!officerId}
      panelClassName="w-full max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary-600" aria-hidden="true" />
          <ModalTitle>Add to companies</ModalTitle>
        </div>
        <ModalClose />
      </div>

      <form onSubmit={submit} noValidate className="p-6 space-y-4">
        {error && (
          <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* What is about to be created, so nobody adds a company they misread. */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">{lead.company_name}</p>
              <p className="mt-0.5 text-xs text-gray-600">
                {lead.role_title || 'Role not stated'}
                {lead.location ? ` · ${lead.location}` : ''} · {postedText(lead)}
              </p>
            </div>
            <LeadTypeBadge type={lead.lead_type} />
          </div>
          <div className="mt-2">
            <SourceLink lead={lead} />
          </div>
        </div>

        <Field label="Sector" name="sector" optional hint="Used for allocation and reporting.">
          {(p) => (
            <input
              {...p}
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="IT Services"
            />
          )}
        </Field>

        <Field
          label="Allocate to"
          name="officer_id"
          optional
          hint="The officer who will own the relationship. You can allocate later instead."
        >
          {(p) => (
            <select
              {...p}
              value={officerId}
              onChange={(e) => setOfficerId(e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
            >
              <option value="">Nobody yet</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.officer_name || `Officer #${o.id}`}
                  {o.region ? ` — ${o.region}` : ''} ({o.active_count} active)
                </option>
              ))}
            </select>
          )}
        </Field>

        <p className="text-xs text-gray-500">
          The role, source and posting link are saved on the company's notes, so whoever
          picks it up can see where it came from.
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <ModalCancelButton />
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {saving ? 'Adding…' : 'Add company'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
