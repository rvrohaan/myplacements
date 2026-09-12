/**
 * Pieces shared between the opportunities page and its dashboard panel.
 *
 * Both surfaces show the same thing at different sizes - the panel is the
 * headline, the page is the workspace - so the badges and the recency wording
 * live here rather than being written twice and drifting apart.
 */

import { AlertTriangle, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JobLead, JobScan } from '@/types'

const TYPE_STYLES = {
  job: 'bg-sky-50 text-sky-700 border-sky-200',
  internship: 'bg-violet-50 text-violet-700 border-violet-200',
} as const

const CONFIDENCE_STYLES = {
  high: 'bg-teal-50 text-teal-700 border-teal-200',
  medium: 'bg-gray-50 text-gray-600 border-gray-200',
  low: 'bg-amber-50 text-amber-700 border-amber-200',
} as const

export function LeadTypeBadge({ type }: { type: JobLead['lead_type'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
        TYPE_STYLES[type] ?? TYPE_STYLES.job,
      )}
    >
      {type}
    </span>
  )
}

/**
 * How sure the scan was that this posting is current. Worth showing: "low" is
 * usually a careers page that states no date at all, which is a different thing
 * from a weak lead, and the chancellor should be able to tell them apart.
 */
export function ConfidenceChip({ level }: { level?: JobLead['confidence'] }) {
  if (!level) return null
  const hint =
    level === 'high'
      ? 'The source gave a date inside the last 24 hours'
      : level === 'low'
        ? 'The source gave no clear posting date'
        : 'Recent, but the date was not stated precisely'
  return (
    <span
      title={hint}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]',
        CONFIDENCE_STYLES[level] ?? CONFIDENCE_STYLES.medium,
      )}
    >
      {level} confidence
    </span>
  )
}

/** What the source said about when this went up, in the source's own words. */
export function postedText(lead: JobLead): string {
  if (lead.posted_label) return lead.posted_label
  if (lead.posted_at) return new Date(lead.posted_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
  return 'date not stated'
}

/**
 * The link out to the posting. Flagged when the scan could not confirm the URL
 * came back from a search - the one way a made-up posting could reach a company
 * record, so it is called out rather than quietly trusted.
 */
export function SourceLink({ lead, className }: { lead: JobLead; className?: string }) {
  if (!lead.source_url) {
    return <span className="text-xs text-gray-400">No link on this one</span>
  }
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <a
        href={lead.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline"
      >
        {lead.source_name || 'View posting'}
        <ExternalLink className="w-3 h-3" aria-hidden="true" />
      </a>
      {!lead.verified && (
        <span
          title="The scan could not confirm this link came from a search result. Check it before acting on it."
          className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700"
        >
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          unconfirmed link
        </span>
      )}
    </span>
  )
}

/** One-line summary of the last scan, for the page header and the panel footer. */
export function scanText(scan?: JobScan | null): string {
  if (!scan) return 'No scan has run yet.'
  // The scheduled scan is queued by the cron tick and searches in the background,
  // so a row with no finish time is one that is still out there looking - unless
  // the server has given up on it, in which case it says so.
  if (scan.status === 'stalled') return 'The last scan stopped before it finished.'
  if (!scan.finished_at) return 'A scan is running now — results appear as it finishes.'
  const when = scan.finished_at || scan.started_at
  const stamp = when
    ? new Date(`${when}${when.endsWith('Z') ? '' : 'Z'}`).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'recently'
  if (scan.status === 'failed') return `Last scan failed at ${stamp}.`
  return `Last scan ${stamp} · ${scan.found} found, ${scan.new_count} new`
}
