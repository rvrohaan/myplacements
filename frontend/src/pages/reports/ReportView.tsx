import type { ReportDoc } from '@/types'
import { formatDateTime } from '@/lib/utils'

/**
 * Renders whatever the API described, rather than knowing about any particular
 * report: a meta block, the sections as tables, then the caveats.
 *
 * The caveats are not decoration and are not collapsible. A placement figure
 * quoted without its basis — which denominator, which students, offers or
 * people — is how these numbers end up wrong in a meeting, and the .xlsx
 * carries the same text for the same reason.
 */
export default function ReportView({ report }: { report: ReportDoc }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900">{report.title}</h2>
        {report.subtitle && <p className="text-sm text-gray-500 mt-0.5">{report.subtitle}</p>}
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
          {report.meta.map((m) => (
            <div key={m.label}>
              <dt className="text-xs text-gray-400">{m.label}</dt>
              <dd className="text-sm text-gray-800">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {report.sections.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center bg-white rounded-xl border border-gray-200">
          Nothing to report for this selection yet.
        </p>
      )}

      {/* Prose above the tables, where a report has any. The note underneath says
          who wrote it and when — or, when there is no prose, why not. Both this
          and the workbook render it as paragraphs, so the downloaded copy is the
          same document that was on screen. */}
      {(report.narrative.length > 0 || report.narrative_note) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {report.narrative.map((p, i) => (
            <p key={i} className="text-sm text-gray-700 leading-relaxed mb-2 last:mb-0">
              {p}
            </p>
          ))}
          {report.narrative_note && (
            <p className="text-xs text-gray-400 mt-2">{report.narrative_note}</p>
          )}
        </div>
      )}

      {report.sections.map((section) => (
        <div key={section.heading} className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800">{section.heading}</h3>
          {section.note && <p className="text-xs text-gray-500 mt-1">{section.note}</p>}
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {section.columns.map((c, i) => (
                    <th
                      key={c}
                      scope="col"
                      className={`px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide ${
                        i === 0 ? 'text-left' : 'text-right'
                      }`}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {section.rows.length === 0 ? (
                  <tr>
                    <td colSpan={section.columns.length} className="text-center py-6 text-gray-400">
                      No rows
                    </td>
                  </tr>
                ) : (
                  section.rows.map((row, r) => (
                    <tr key={r} className="hover:bg-gray-50 transition-colors">
                      {row.map((cell, i) => (
                        <Cell key={i} value={cell} first={i === 0} />
                      ))}
                    </tr>
                  ))
                )}
                {section.total_row && (
                  <tr className="border-t-2 border-gray-200 font-semibold">
                    {section.total_row.map((cell, i) => (
                      <Cell key={i} value={cell} first={i === 0} />
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {report.caveats.length > 0 && (
        <div className="bg-amber-50/60 rounded-xl border border-amber-200 p-5">
          <h3 className="font-semibold text-amber-900 text-sm">How to read this</h3>
          <ul className="mt-2 space-y-1.5 list-disc pl-5">
            {report.caveats.map((c) => (
              <li key={c} className="text-sm text-amber-900/90 leading-snug">{c}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Generated {formatDateTime(report.generated_at)} · the downloaded workbook carries these
        same figures
      </p>
    </div>
  )
}

/** `null` means "not recorded", which is not zero and must not print as one. */
function Cell({ value, first }: { value: string | number | null; first: boolean }) {
  return (
    <td
      className={`px-3 py-2 ${
        first ? 'font-medium text-gray-900' : 'text-right text-gray-600 tabular-nums'
      }`}
    >
      {value === null || value === '' ? <span className="text-gray-300">—</span> : String(value)}
    </td>
  )
}
