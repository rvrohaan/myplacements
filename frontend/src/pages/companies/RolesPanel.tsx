import { useState } from 'react'
import {
  Briefcase,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  GraduationCap,
  IndianRupee,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm'
import StatusSelect, { type StatusOption } from '@/components/StatusSelect'
import { cn, formatDate, STATUS_COLORS } from '@/lib/utils'
import type { CompanyRole, CompanyRoleStatus } from '@/types'
import RoleModal, { ROLE_STATUS_LABELS, ROLE_TYPE_LABELS } from './RoleModal'

const STATUS_OPTIONS: StatusOption<CompanyRoleStatus>[] = (
  Object.keys(ROLE_STATUS_LABELS) as CompanyRoleStatus[]
).map((value) => ({ value, label: ROLE_STATUS_LABELS[value] }))

// Open roles are what anyone opening a company is looking for; closed ones are
// history. Within a bucket the newest role comes first.
const STATUS_RANK: Record<CompanyRoleStatus, number> = { open: 0, on_hold: 1, filled: 2, closed: 3 }

function sortRoles(roles: CompanyRole[]): CompanyRole[] {
  return [...roles].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.id - a.id,
  )
}

/** The compensation line, in whichever unit this kind of role is paid in. */
function pay(role: CompanyRole): string | null {
  if (role.stipend) return `₹${role.stipend.toLocaleString('en-IN')}/month`
  if (role.ctc_min && role.ctc_max && role.ctc_min !== role.ctc_max) {
    return `₹${role.ctc_min} – ${role.ctc_max} LPA`
  }
  const fixed = role.ctc_max ?? role.ctc_min
  return fixed ? `₹${fixed} LPA` : null
}

/** "CSE, ECE · 7.0+ CGPA · ≤ 1 backlog" — whichever parts were filled in. */
function eligibility(role: CompanyRole): string | null {
  const parts = [
    role.eligible_branches,
    role.min_cgpa != null ? `${role.min_cgpa}+ CGPA` : null,
    role.max_backlogs != null
      ? role.max_backlogs === 0
        ? 'No backlogs'
        : `≤ ${role.max_backlogs} backlog${role.max_backlogs === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function Meta({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-xs text-gray-600">
      <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      {children}
    </span>
  )
}

function RoleCard({
  role,
  canManage,
  onEdit,
  onDelete,
  onStatusChange,
  onInterviewQs,
}: {
  role: CompanyRole
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
  onStatusChange: (status: CompanyRoleStatus) => void
  onInterviewQs: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const compensation = pay(role)
  const eligible = eligibility(role)
  const skills = role.skills?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  const details = role.job_description || role.notes || skills.length > 0
  // A deadline only matters while the role is still taking applications.
  const deadlineSoon =
    role.status === 'open' && role.apply_deadline && new Date(role.apply_deadline) >= new Date()

  return (
    <div
      className={cn(
        'border rounded-xl p-4 transition-colors',
        role.status === 'open' ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-gray-900 text-sm">{role.title}</h4>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
              {ROLE_TYPE_LABELS[role.role_type]}
            </span>
            {canManage ? (
              <StatusSelect value={role.status} options={STATUS_OPTIONS} onChange={onStatusChange} />
            ) : (
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[role.status])}>
                {ROLE_STATUS_LABELS[role.status]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2">
            {compensation && (
              <Meta icon={IndianRupee}>
                <span className="font-medium text-gray-900">{compensation}</span>
              </Meta>
            )}
            {role.openings != null && (
              <Meta icon={Users}>{role.openings} opening{role.openings === 1 ? '' : 's'}</Meta>
            )}
            {role.location && (
              <Meta icon={MapPin}>
                {role.location}
                {role.work_mode ? ` · ${role.work_mode}` : ''}
              </Meta>
            )}
            {role.apply_deadline && (
              <Meta icon={CalendarClock}>
                <span className={cn(deadlineSoon && 'text-orange-600 font-medium')}>
                  Apply by {formatDate(role.apply_deadline)}
                </span>
              </Meta>
            )}
          </div>
          {eligible && (
            <div className="mt-1.5">
              <Meta icon={GraduationCap}>{eligible}</Meta>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onInterviewQs}
            title="Generate interview questions for this role"
            className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          {role.posting_url && (
            <a
              href={role.posting_url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the job posting"
              className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {canManage && (
            <>
              <button
                onClick={onEdit}
                title="Edit this role"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={onDelete}
                title="Delete this role"
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {details && (
        <>
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="flex items-center gap-1 mt-3 text-xs font-medium text-primary-600 hover:text-primary-700"
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'Hide details' : 'Details'}
          </button>
          {expanded && (
            <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((skill) => (
                    <span key={skill} className="px-2 py-0.5 rounded-md text-xs bg-gray-100 text-gray-700">
                      {skill}
                    </span>
                  ))}
                </div>
              )}
              {role.job_description && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Job description</p>
                  <p className="text-sm text-gray-700 whitespace-pre-line">{role.job_description}</p>
                </div>
              )}
              {role.notes && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Internal notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-line">{role.notes}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The roles a company recruits for: what the job actually is, what it pays, who
 * is eligible and whether it's still open. Sits alongside the HR contacts —
 * contacts are who you talk to, roles are what you're talking about.
 */
export default function RolesPanel({
  companyId,
  roles,
  canManage,
  onChanged,
  onInterviewQs,
}: {
  companyId: number
  roles: CompanyRole[]
  canManage: boolean
  /** Re-fetch the company so the list reflects the server. */
  onChanged: () => Promise<unknown> | void
  /** Opens the interview/exam question generator prefilled with a role title. */
  onInterviewQs: (roleTitle: string) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<CompanyRole | null>(null)

  const sorted = sortRoles(roles)
  const openCount = roles.filter((r) => r.status === 'open').length

  const updateStatus = async (role: CompanyRole, status: CompanyRoleStatus) => {
    try {
      await api.put(`/companies/${companyId}/roles/${role.id}`, { status })
      await onChanged()
    } catch {
      toast.error('Could not update this role’s status. Please try again.')
    }
  }

  const remove = async (role: CompanyRole) => {
    const ok = await confirm({
      title: `Delete “${role.title}”?`,
      message: 'This removes the role and everything recorded about it. It cannot be undone.',
      confirmLabel: 'Delete role',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/companies/${companyId}/roles/${role.id}`)
      await onChanged()
      toast.success(`“${role.title}” deleted.`)
    } catch {
      toast.error('Could not delete this role. Please try again.')
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-gray-800">Job Roles &amp; Openings ({roles.length})</h3>
          {openCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
              {openCount} open
            </span>
          )}
        </div>
        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Add role
          </button>
        )}
      </div>

      {roles.length === 0 ? (
        <div className="text-center py-8">
          <Briefcase className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No roles recorded for this company yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Add the positions they hire for — package, eligibility and deadline — so drives can be
            planned against them.
          </p>
          {canManage && (
            <button
              onClick={() => setShowAdd(true)}
              className="mt-3 inline-flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add the first role
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sorted.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              canManage={canManage}
              onEdit={() => setEditing(role)}
              onDelete={() => remove(role)}
              onStatusChange={(status) => updateStatus(role, status)}
              onInterviewQs={() => onInterviewQs(role.title)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <RoleModal companyId={companyId} onClose={() => setShowAdd(false)} onSaved={onChanged} />
      )}
      {editing && (
        <RoleModal
          companyId={companyId}
          role={editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  )
}
