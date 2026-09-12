/**
 * New openings, on the dashboard.
 *
 * The radar page is where leads get worked. But an opening posted this morning
 * is only worth anything while it is still open, so the fact that there *are*
 * new ones has to reach the chancellor on the page they already land on -
 * otherwise the list is a page nobody remembers to visit.
 *
 * Deliberately just the headline and a few names: the actions live on the page,
 * one click away, because adding a company is not a decision to take from a
 * one-line summary.
 */

import { Link } from 'react-router-dom'
import { ArrowRight, Radar } from 'lucide-react'
import type { JobLeadSummary } from '@/types'
import { ConfidenceChip, LeadTypeBadge, postedText, scanText } from '@/pages/opportunities/leadParts'
import { Panel } from './StatCard'

export default function OpportunitiesPanel({ summary }: { summary: JobLeadSummary }) {
  const { new_24h, new_total, top } = summary

  return (
    <Panel
      title="New openings"
      action={
        <Link
          to="/opportunities"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50"
        >
          Open radar
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-sm text-sky-800">
          <Radar className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="font-semibold tabular-nums">{new_24h}</span>
          found in the last 24h
        </span>
        {new_total > new_24h && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-600">
            <span className="font-semibold tabular-nums">{new_total}</span>
            waiting in total
          </span>
        )}
      </div>

      <ul className="mt-4 divide-y divide-gray-100">
        {top.map((lead) => (
          <li key={lead.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 first:pt-0">
            <span className="text-sm font-medium text-gray-900">{lead.company_name}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-gray-600">
              {lead.role_title || 'Role not stated'}
              {lead.location ? ` · ${lead.location}` : ''}
            </span>
            <LeadTypeBadge type={lead.lead_type} />
            <ConfidenceChip level={lead.confidence} />
            <span className="text-xs text-gray-400">{postedText(lead)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-gray-400">{scanText(summary.last_scan)}</p>
    </Panel>
  )
}
