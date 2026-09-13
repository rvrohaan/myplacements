import { useEffect, useState } from 'react'
import { Sparkles, Users, AlertCircle, Info } from 'lucide-react'
import api from '@/lib/api'
import type { Company, MatchResult } from '@/types'
import { cn } from '@/lib/utils'
import { Modal, ModalCancelButton, ModalClose, ModalTitle } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'

const selectClass =
  'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500'

/**
 * Module 6 — who to put in front of this company.
 *
 * The screen is built to be argued with. Eligibility is shown as the rule it
 * is, with a tally of who it excluded and why; every score comes with the
 * components that produced it; and where the model weighted the skills, those
 * weights are printed before the ranking that used them. A shortlist a
 * placement head cannot defend to a student's parent is not worth having.
 */
export default function MatchStudentsModal({
  company,
  onClose,
}: {
  company: Company
  onClose: () => void
}) {
  const toast = useToast()
  const [roleId, setRoleId] = useState('')
  const [batchYear, setBatchYear] = useState('')
  const [batchYears, setBatchYears] = useState<number[]>([])
  const [includePlaced, setIncludePlaced] = useState(false)
  const [useAi, setUseAi] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MatchResult | null>(null)

  useEffect(() => {
    api.get<{ batch_years: number[] }>('/students/filter-options')
      .then((r) => setBatchYears(r.data.batch_years))
      .catch(() => {})
  }, [])

  const run = async () => {
    setRunning(true)
    try {
      const { data } = await api.post<MatchResult>(`/companies/${company.id}/match`, {
        ...(roleId ? { role_id: Number(roleId) } : {}),
        ...(batchYear ? { batch_year: Number(batchYear) } : {}),
        include_placed: includePlaced,
        use_ai: useAi,
        limit: 25,
      })
      setResult(data)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not build a shortlist.')
    } finally {
      setRunning(false)
    }
  }

  const openRoles = (company.roles ?? []).filter((r) => r.status === 'open')

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-5xl max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl z-10">
        <ModalTitle>Suggest students — {company.name}</ModalTitle>
        <ModalClose />
      </div>

      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}
                  aria-label="Role" className={selectClass}>
            <option value="">Company-wide criteria</option>
            {(company.roles ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}{r.status !== 'open' ? ` (${r.status})` : ''}
              </option>
            ))}
          </select>
          <select value={batchYear} onChange={(e) => setBatchYear(e.target.value)}
                  aria-label="Batch year" className={selectClass}>
            <option value="">All batches</option>
            {batchYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={includePlaced}
                   onChange={(e) => setIncludePlaced(e.target.checked)}
                   className="rounded border-gray-300" />
            Include placed students
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600"
                 title="One model call weights the skills for this role. The ranking itself is the same arithmetic either way.">
            <input type="checkbox" checked={useAi}
                   onChange={(e) => setUseAi(e.target.checked)}
                   className="rounded border-gray-300" />
            Let AI weight the skills
          </label>
          <button
            onClick={run}
            disabled={running}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors ml-auto"
          >
            <Users className="w-4 h-4" />
            {running ? 'Matching…' : 'Suggest students'}
          </button>
        </div>

        {openRoles.length === 0 && (company.roles ?? []).length === 0 && (
          <p className="text-xs text-gray-500">
            No roles recorded for this company, so the company's own branch and CGPA
            preferences are used. Adding a role with its skills sharpens the ranking.
          </p>
        )}

        {result && (
          <div className="space-y-4">
            <Criteria result={result} />

            {result.ai_error && (
              <p className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {result.ai_error}
              </p>
            )}
            {result.ai_summary && (
              <div className="bg-primary-50/60 border border-primary-200 rounded-lg px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-medium text-primary-900">
                  <Sparkles className="w-4 h-4" /> How the model read this role
                </p>
                <p className="text-sm text-primary-900/90 mt-1">{result.ai_summary}</p>
                <p className="text-xs text-primary-900/70 mt-2">
                  These weights were applied to the skill component below. Everything
                  else — who is eligible, and the arithmetic — is unchanged by it.
                </p>
              </div>
            )}

            {result.skills_used.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-500 mr-1">Skills scored:</span>
                {result.skills_used.map((s) => (
                  <span key={s.skill}
                        className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">
                    {s.skill}
                    <span className="text-gray-400"> ×{s.weight}</span>
                  </span>
                ))}
              </div>
            )}

            <Shortlist result={result} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Who was left out">
                {result.excluded.length === 0 ? (
                  <p className="text-sm text-gray-400">Nobody — every student considered was eligible.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {result.excluded.map((e) => (
                      <li key={e.reason} className="flex justify-between gap-4">
                        <span className="text-gray-600">{e.label}</span>
                        <span className="text-gray-900 font-medium tabular-nums">{e.students}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  Counted against the first rule each student failed, so these add up to
                  the {result.considered - result.eligible} not shortlisted.
                </p>
              </Panel>

              <Panel title="Where the shortlist is weak">
                {result.training_gaps.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No gaps — or no skills recorded to compare against.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {result.training_gaps.map((g) => (
                      <li key={g.skill} className="flex justify-between gap-4">
                        <span className="text-gray-600">{g.skill}</span>
                        <span className="text-gray-900 tabular-nums">
                          {g.students_missing} missing ({g.share_missing}%)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-400 mt-2">A training list, not a rejection list.</p>
              </Panel>
            </div>

            {result.past_pattern.hires > 0 && (
              <Panel title={`What ${company.name} took before`}>
                <p className="text-sm text-gray-600">
                  {result.past_pattern.hires} student{result.past_pattern.hires === 1 ? '' : 's'} hired
                  {result.past_pattern.median_cgpa != null &&
                    ` · median CGPA ${result.past_pattern.median_cgpa}`}
                  {result.past_pattern.min_cgpa != null &&
                    ` · lowest ${result.past_pattern.min_cgpa}`}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  {result.past_pattern.branches.map((b) => `${b.branch} (${b.students})`).join(' · ')}
                </p>
                {result.past_pattern.common_skills.length > 0 && (
                  <p className="text-sm text-gray-600 mt-1">
                    Commonly listed: {result.past_pattern.common_skills
                      .map((s) => `${s.skill} (${s.students})`).join(', ')}
                  </p>
                )}
              </Panel>
            )}
          </div>
        )}

        {!result && !running && (
          <p className="text-sm text-gray-400 py-8 text-center">
            Pick a role and press Suggest students.
          </p>
        )}

        <div className="flex justify-end pt-2">
          <ModalCancelButton>Close</ModalCancelButton>
        </div>
      </div>
    </Modal>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h4 className="font-semibold text-gray-800 text-sm mb-2">{title}</h4>
      {children}
    </div>
  )
}

/** The bar, and where each part of it came from — so an empty shortlist can be
    traced to the criterion that emptied it rather than guessed at. */
function Criteria({ result }: { result: MatchResult }) {
  const c = result.criteria
  const from = (key: string) =>
    c.source[key] === 'role' ? 'from the role'
      : c.source[key] === 'company' ? 'from the company'
      : 'not set'
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-gray-800">
        <Info className="w-4 h-4 text-gray-400" />
        {result.eligible} of {result.considered} students are eligible
        {result.role_title ? ` for ${result.role_title}` : ''}
      </p>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 mt-2 text-xs">
        <Item label="Branches" value={c.branches.length ? c.branches.join(', ').toUpperCase() : 'Any'} hint={from('branches')} />
        <Item label="Min CGPA" value={c.min_cgpa ?? 'Any'} hint={from('min_cgpa')} />
        <Item label="Max backlogs" value={c.max_backlogs ?? 'Any'} hint={from('max_backlogs')} />
        <Item label="Batch" value={c.batch_year ?? 'All'} hint="" />
      </dl>
    </div>
  )
}

function Item({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div>
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-gray-800">
        {value} {hint && <span className="text-gray-400">({hint})</span>}
      </dd>
    </div>
  )
}

/** Where a matched skill's evidence came from. A skill the college taught and
    marked complete is stronger evidence than one a student typed into a form,
    and an officer defending a shortlist needs to see which it was. */
const EVIDENCE_STYLE: Record<string, string> = {
  training: 'bg-green-50 text-green-700',
  certification: 'bg-blue-50 text-blue-700',
  declared: 'bg-gray-100 text-gray-600',
}

const EVIDENCE_SHORT: Record<string, string> = {
  training: 'trained',
  certification: 'certified',
  declared: '',
}

const EVIDENCE_HINT: Record<string, string> = {
  training: 'Completed a training module that teaches this',
  certification: 'Named in a certification on their profile',
  declared: 'Listed on their profile — not independently verified',
}

const COMPONENT_LABELS: Record<string, string> = {
  skills: 'Skills',
  academics: 'Academics',
  clean_record: 'Clean record',
  readiness: 'Readiness',
  training: 'Training',
  affinity: 'Fits past hires',
}

function Shortlist({ result }: { result: MatchResult }) {
  if (result.shortlist.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-6 text-center bg-white rounded-xl border border-gray-200">
        No student clears this bar. The criteria above say which one to relax.
      </p>
    )
  }
  const weighted = Object.entries(result.weights).filter(([, w]) => w > 0)
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm min-w-[820px]">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {['#', 'Student', 'Branch', 'CGPA', 'Backlogs', 'Fit', 'Why', 'Has', 'Missing'].map((h) => (
              <th key={h} scope="col"
                  className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {result.shortlist.map((s, i) => (
            <tr key={s.student_id} className="hover:bg-gray-50 transition-colors align-top">
              <td className="px-3 py-2 text-gray-400 tabular-nums">{i + 1}</td>
              <td className="px-3 py-2">
                <p className="font-medium text-gray-900">{s.name || s.roll_number}</p>
                <p className="text-xs text-gray-500">{s.roll_number}</p>
              </td>
              <td className="px-3 py-2 text-gray-600">{s.branch}</td>
              <td className="px-3 py-2 text-gray-600 tabular-nums">{s.cgpa ?? '—'}</td>
              <td className="px-3 py-2 text-gray-600 tabular-nums">{s.backlogs}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full" style={{ width: `${s.score}%` }} />
                  </div>
                  <span className="font-medium text-gray-900 tabular-nums">{s.score}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {weighted.map(([key]) => (
                    <span key={key}
                          title={`${COMPONENT_LABELS[key] ?? key}: ${s.components[key]} of 100, weighted ${result.weights[key]}`}
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[11px]',
                            s.components[key] >= 60 ? 'bg-green-50 text-green-700'
                              : s.components[key] > 0 ? 'bg-gray-100 text-gray-600'
                              : 'bg-gray-50 text-gray-400',
                          )}>
                      {COMPONENT_LABELS[key] ?? key} {s.components[key]}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2 max-w-[190px]">
                {s.matched_skills.length === 0 ? (
                  <span className="text-xs text-gray-400">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {s.matched_skills.map((skill) => {
                      const source = s.skill_evidence?.[skill] ?? 'declared'
                      return (
                        <span
                          key={skill}
                          title={EVIDENCE_HINT[source] ?? source}
                          className={cn('px-1.5 py-0.5 rounded text-[11px]', EVIDENCE_STYLE[source])}
                        >
                          {skill}
                          {source !== 'declared' && (
                            <span className="opacity-70"> · {EVIDENCE_SHORT[source]}</span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-gray-500 max-w-[160px]">
                {s.missing_skills.length ? s.missing_skills.join(', ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
