import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, FileText, Target, Briefcase, Award, AlertTriangle, Sparkles, ArrowRight } from 'lucide-react'
import api from '@/lib/api'
import type { Student } from '@/types'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { useDriveAlerts } from '@/store/driveAlerts'
import ResumeCard from './ResumeCard'

const QUICK_LINKS = [
  { to: '/portal/practice', label: 'Practice interview & exam', icon: MessageSquare, desc: 'AI mock interviews and screening MCQs' },
  { to: '/portal/skills', label: 'See my skill gaps', icon: Target, desc: 'Personalised improvement plan' },
  { to: '/portal/resume', label: 'Review my resume', icon: FileText, desc: 'AI feedback on your profile' },
  { to: '/portal/drives', label: 'Browse jobs & drives', icon: Briefcase, desc: 'Apply to eligible drives' },
]

export default function StudentDashboard() {
  const [student, setStudent] = useState<Student | null>(null)
  const [loading, setLoading] = useState(true)
  const newDrives = useDriveAlerts((s) => s.newCount)

  useEffect(() => {
    api.get('/portal/me').then((r) => setStudent(r.data)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>
  if (!student) return <div className="text-center py-20 text-gray-500">Profile not found</div>

  const readiness = student.readiness_score != null ? Math.round(student.readiness_score) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Hi, {student.full_name?.split(' ')[0] || student.roll_number} 👋</h1>
        <p className="text-sm text-gray-500">{student.branch} · {student.roll_number} · Batch {student.batch_year}</p>
      </div>

      {newDrives > 0 && (
        <Link
          to="/portal/drives"
          className="flex items-center gap-3 px-4 py-3 bg-primary-50 border border-primary-200 rounded-xl hover:bg-primary-100 transition"
        >
          <Sparkles className="w-5 h-5 text-primary-600 shrink-0" />
          <span className="text-sm font-medium text-primary-800 flex-1">
            {newDrives} new {newDrives === 1 ? 'drive is' : 'drives are'} open for you to apply
          </span>
          <ArrowRight className="w-4 h-4 text-primary-600" />
        </Link>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Readiness"
          value={readiness != null ? `${readiness}` : '—'}
          suffix={readiness != null ? '/100' : ''}
          icon={<Award className="w-4 h-4" />}
        />
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Risk level</p>
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', STATUS_COLORS[student.risk_category])}>
            {student.risk_category}
          </span>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Placement</p>
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', STATUS_COLORS[student.placement_status])}>
            {student.placement_status.replace('_', ' ')}
          </span>
        </div>
        <StatCard label="CGPA" value={student.cgpa != null ? `${student.cgpa}` : '—'} />
      </div>

      {student.backlogs > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          You have {student.backlogs} active backlog{student.backlogs > 1 ? 's' : ''} — clearing these widens the drives you're eligible for.
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">What do you want to do?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_LINKS.map(({ to, label, icon: Icon, desc }) => (
            <Link
              key={to}
              to={to}
              className="flex items-start gap-3 bg-white rounded-xl border border-gray-200 p-4 hover:border-primary-300 hover:shadow-sm transition"
            >
              <div className="w-9 h-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-gray-900 text-sm">{label}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <ResumeCard resumeUrl={student.resume_url} onUploaded={setStudent} />

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">My skills</h2>
        {student.skills ? (
          <div className="flex flex-wrap gap-2">
            {student.skills.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (
              <span key={s} className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">{s}</span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No skills listed yet. Ask your placement office to update your profile.</p>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, suffix, icon }: { label: string; value: string; suffix?: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">{icon}{label}</p>
      <p className="text-2xl font-bold text-gray-900">
        {value}
        {suffix && <span className="text-sm font-normal text-gray-400">{suffix}</span>}
      </p>
    </div>
  )
}
