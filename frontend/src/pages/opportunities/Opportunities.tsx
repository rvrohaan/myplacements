/**
 * Opportunity radar - job and internship openings the daily scan found on the web.
 *
 * The daily digest covers what the cell did. This covers what the market did,
 * and it exists to close one gap: an opening nobody in the cell heard about is
 * an opening that never becomes a company, never gets allocated, and never
 * becomes a drive.
 *
 * Everything here is a suggestion. Nothing enters the companies table until
 * somebody with manage rights clicks Add, which is also where the opening can be
 * handed to an officer. Officers themselves get the list read-only - knowing
 * the market moved is useful to them even when acting on it is not their call.
 *
 * The openings themselves are found once for the whole platform (campus hiring
 * is national - an opening in Kolkata still recruits from a Bangalore campus),
 * so what is private to this college is only what it *does* with them: adding,
 * dismissing, and the focus filter below.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2,
  Clock,
  MapPin,
  PauseCircle,
  Radar,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useConfirm } from '@/components/ui/confirm-context'
import { useToast } from '@/components/ui/toast'
import { Field, inputClass } from '@/components/ui/field'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Skeleton } from '@/components/ui/skeleton'
import type { JobLead, JobScan, JobScanSettings, LeadStatus, LeadType, UserRole } from '@/types'
import AddCompanyModal from './AddCompanyModal'
import { ConfidenceChip, LeadTypeBadge, postedText, scanText, SourceLink } from './leadParts'

// Same set that approves officer leads and runs auto-allocation.
const MANAGE_ROLES: UserRole[] = [
  'super_admin',
  'principal',
  'pro_chancellor',
  'deputy_pro_chancellor',
]

const TABS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'added', label: 'Added' },
  { value: 'dismissed', label: 'Dismissed' },
]

const TYPES: { value: '' | LeadType; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'job', label: 'Jobs' },
  { value: 'internship', label: 'Internships' },
]

function LeadCard({
  lead,
  canManage,
  onAdd,
  onDismiss,
  onRestore,
}: {
  lead: JobLead
  canManage: boolean
  onAdd: (lead: JobLead) => void
  onDismiss: (lead: JobLead) => void
  onRestore: (lead: JobLead) => void
}) {
  const tracked = !!lead.existing_company_id && lead.status === 'new'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{lead.company_name}</h3>
            <LeadTypeBadge type={lead.lead_type} />
            <ConfidenceChip level={lead.confidence} />
          </div>
          <p className="mt-1 text-sm text-gray-700">{lead.role_title || 'Role not stated'}</p>
        </div>

        {/* Actions. An officer sees the card without this column. */}
        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            {lead.status === 'new' &&
              (tracked ? (
                <Link
                  to={`/companies/${lead.existing_company_id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Already tracked
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdd(lead)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                >
                  <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Add to companies
                </button>
              ))}
            {lead.status === 'new' && (
              <button
                type="button"
                onClick={() => onDismiss(lead)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                Dismiss
              </button>
            )}
            {lead.status === 'dismissed' && (
              <button
                type="button"
                onClick={() => onRestore(lead)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Restore
              </button>
            )}
            {lead.status === 'added' && lead.company_id && (
              <Link
                to={`/companies/${lead.company_id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                Open company
              </Link>
            )}
          </div>
        )}
      </div>

      {lead.summary && <p className="mt-2 text-sm text-gray-600">{lead.summary}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500">
        {lead.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            {lead.location}
            {lead.work_mode ? ` · ${lead.work_mode}` : ''}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          {postedText(lead)}
        </span>
        {lead.compensation && (
          <span className="inline-flex items-center gap-1">
            <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
            {lead.compensation}
          </span>
        )}
        <SourceLink lead={lead} className="ml-auto" />
      </div>

      {lead.eligibility && (
        <p className="mt-2 text-xs text-gray-500">
          <span className="font-medium text-gray-600">Eligibility as posted:</span> {lead.eligibility}
        </p>
      )}

      {tracked && (
        <p className="mt-2 text-xs text-amber-700">
          {lead.existing_company_name} is already on your companies list — this is a new opening
          at a company you track.
        </p>
      )}
      {lead.status === 'dismissed' && lead.dismiss_reason && (
        <p className="mt-2 text-xs text-gray-500">Dismissed: {lead.dismiss_reason}</p>
      )}
    </div>
  )
}

function ScanSettingsModal({
  current,
  onClose,
  onSaved,
}: {
  current: JobScanSettings
  onClose: () => void
  onSaved: (next: JobScanSettings) => void
}) {
  const toast = useToast()
  const [focus, setFocus] = useState(current.job_scan_focus ?? '')
  const [enabled, setEnabled] = useState(current.job_scan_enabled)
  const [scheduled, setScheduled] = useState(current.schedule_enabled)
  const [saving, setSaving] = useState(false)

  const dirty =
    focus !== (current.job_scan_focus ?? '') ||
    enabled !== current.job_scan_enabled ||
    scheduled !== current.schedule_enabled

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await api.put('/job-leads/settings', {
        job_scan_focus: focus,
        job_scan_enabled: enabled,
        // Only sent when this person may change it; the server refuses otherwise.
        schedule_enabled: current.can_manage_schedule ? scheduled : undefined,
      })
      toast.success('Scan settings saved.')
      onSaved(r.data)
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not save the settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} isDirty={dirty} panelClassName="w-full max-w-md">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <ModalTitle>Scan settings</ModalTitle>
        <ModalClose />
      </div>
      <form onSubmit={save} noValidate className="p-6 space-y-4">
        <Field
          label="Only show openings matching"
          name="job_scan_focus"
          optional
          hint="Comma-separated words, matched against the company, role, location and eligibility. Leave blank to see everything."
        >
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="mechanical, civil, core, graduate engineer trainee"
            />
          )}
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span>
            <span className="font-medium">Show discovered openings</span>
            <span className="block text-xs text-gray-500">
              Turning this off hides the radar from this college. It does not stop the search.
            </span>
          </span>
        </label>

        {/* The platform switch. Separated because it is a different kind of
            setting: it spends credit on everybody's behalf, every morning. */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Platform setting
          </p>
          {current.can_manage_schedule ? (
            <label className="mt-2 flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduled}
                onChange={(e) => setScheduled(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span>
                <span className="font-medium">Run the daily scan automatically</span>
                <span className="block text-xs text-gray-500">
                  One search each morning, shared by every college on MyPlacement.AI, billed
                  whether or not anyone reads it. Leave it off while nobody is watching —
                  &ldquo;Scan now&rdquo; keeps working either way.
                </span>
              </span>
            </label>
          ) : (
            <p className="mt-2 text-sm text-gray-600">
              The daily scan is currently{' '}
              <span className="font-medium">{scheduled ? 'running' : 'stopped'}</span>. Only a
              platform administrator can change that.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function Opportunities() {
  const role = useAuthStore((s) => s.user?.role)
  const canManage = !!role && MANAGE_ROLES.includes(role)
  const toast = useToast()
  const confirm = useConfirm()

  const [leads, setLeads] = useState<JobLead[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<LeadStatus>('new')
  const [type, setType] = useState<'' | LeadType>('')
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<JobScan | null>(null)
  // Whether the scan runs on its own. Worth showing: with it stopped, an empty
  // list means "nobody has run one", not "the market was quiet".
  const [scheduled, setScheduled] = useState(true)
  const [settings, setSettings] = useState<JobScanSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [adding, setAdding] = useState<JobLead | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .get('/job-leads', { params: { status, lead_type: type || undefined, limit: 200 } })
      .then((r) => setLeads(r.data))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false))
  }, [status, type])

  useEffect(load, [load])

  // The last scan is what tells a reader whether an empty list means "nothing
  // was posted" or "nothing has run yet".
  useEffect(() => {
    api
      .get('/job-leads/summary')
      .then((r) => {
        setLastScan(r.data.last_scan ?? null)
        setScheduled(!!r.data.schedule_enabled)
      })
      .catch(() => {})
    if (canManage) {
      api.get('/job-leads/settings').then((r) => setSettings(r.data)).catch(() => {})
    }
  }, [canManage])

  const scan = async () => {
    setScanning(true)
    try {
      const r = await api.post('/job-leads/scan')
      const { found, new_count, scan: record } = r.data
      setLastScan(record)
      toast.success(
        new_count > 0
          ? `${new_count} new opening${new_count === 1 ? '' : 's'} found.`
          : found > 0
            ? 'Nothing new — everything the search found is already on your list.'
            : 'No openings matched in the last 24 hours.',
      )
      if (status !== 'new') setStatus('new')
      else load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'The scan could not be completed.')
    } finally {
      setScanning(false)
    }
  }

  const replace = (updated: JobLead) =>
    setLeads((prev) => prev.filter((l) => l.id !== updated.id))

  const dismiss = async (lead: JobLead) => {
    const ok = await confirm({
      title: 'Dismiss this opening?',
      message: `${lead.company_name} — ${lead.role_title || 'role not stated'} will leave your queue. A later scan will not bring it back, and you can restore it from the Dismissed tab.`,
      confirmLabel: 'Dismiss',
      tone: 'warning',
    })
    if (!ok) return
    try {
      const r = await api.post(`/job-leads/${lead.id}/dismiss`, {})
      replace(r.data)
      toast.success('Dismissed.')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not dismiss this one.')
    }
  }

  const restore = async (lead: JobLead) => {
    try {
      const r = await api.post(`/job-leads/${lead.id}/restore`)
      replace(r.data)
      toast.success('Back in the queue.')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not restore this one.')
    }
  }

  const emptyMessage =
    status === 'new'
      ? lastScan && !lastScan.finished_at && lastScan.status !== 'stalled'
        ? 'A scan is out searching right now. Openings will appear here as it finishes.'
        : lastScan
          ? 'Nothing waiting. The last scan found no openings you have not already seen.'
          : scheduled
            ? 'No scan has run yet. The first one runs tomorrow morning, or run one now.'
            : 'The daily scan is stopped, so nothing has been collected yet. Run one now to see what is out there.'
      : status === 'added'
        ? 'Nothing has been added to your companies from here yet.'
        : 'Nothing dismissed.'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Radar className="w-5 h-5 text-primary-600" aria-hidden="true" />
            Opportunity radar
          </h2>
          <p className="text-sm text-gray-500">
            {canManage
              ? 'Fresher and internship openings posted across India in the last 24 hours. Add the ones worth chasing to your companies, and hand them to an officer.'
              : 'Fresher and internship openings posted across India in the last 24 hours. Leadership decides which of these become companies.'}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {scanText(lastScan)}
            {!scheduled && (
              <span className="ml-1.5 inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-600">
                <PauseCircle className="w-3 h-3" aria-hidden="true" />
                daily scan stopped
              </span>
            )}
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
              Settings
            </button>
            <button
              type="button"
              onClick={scan}
              disabled={scanning}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25"
            >
              {scanning ? (
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              )}
              {scanning ? 'Searching the web…' : 'Scan now'}
            </button>
          </div>
        )}
      </div>

      {/* A scan runs a live web search, so it takes a while. Say so, rather than
          leaving a spinner that looks like a hang. */}
      {scanning && (
        <div role="status" className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">
          Searching career pages and job boards across India for openings posted in the last
          24 hours. This takes a few minutes — leave this page open and it will fill in.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatus(tab.value)}
              aria-pressed={status === tab.value}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                status === tab.value
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:text-gray-900',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              aria-pressed={type === option.value}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                type === option.value
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:text-gray-900',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {!loading && <span className="text-xs text-gray-400">{leads.length} shown</span>}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <Radar className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              canManage={canManage}
              onAdd={setAdding}
              onDismiss={dismiss}
              onRestore={restore}
            />
          ))}
        </div>
      )}

      {adding && (
        <AddCompanyModal
          lead={adding}
          onClose={() => setAdding(null)}
          onAdded={(updated) => replace(updated)}
        />
      )}
      {showSettings && settings && (
        <ScanSettingsModal
          current={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(next) => {
            setSettings(next)
            setScheduled(next.schedule_enabled)
          }}
        />
      )}
    </div>
  )
}
