import { useCallback, useEffect, useState } from 'react'
import { BadgeCheck, GraduationCap, Pencil, User } from 'lucide-react'
import api from '@/lib/api'
import type { SkillWithSources, Student } from '@/types'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

/**
 * A student's skills, with what backs each one — and the first place a student
 * can edit their own.
 *
 * The sources are shown, not merged. A skill earned by completing a training
 * module is evidence; one the student typed is a claim. Presenting them
 * identically would tell a student their own word carries the same weight with
 * a recruiter as a module they passed, which is not true and not kind.
 *
 * Editing only ever replaces the student's own claims. A trained or
 * officer-entered skill is shown here but cannot be removed from this screen,
 * which is why the input is seeded with the self-declared ones alone.
 */

const SOURCE = {
  training: {
    label: 'Trained',
    icon: GraduationCap,
    cls: 'bg-green-50 text-green-700 border-green-200',
  },
  officer: {
    label: 'Added by the placement office',
    icon: BadgeCheck,
    cls: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  student: {
    label: 'Your own',
    icon: User,
    cls: 'bg-gray-100 text-gray-600 border-gray-200',
  },
} as const

type SourceKey = keyof typeof SOURCE

export default function MySkillsCard({ onSaved }: { onSaved?: (s: Student) => void }) {
  const toast = useToast()
  const [skills, setSkills] = useState<SkillWithSources[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    api
      .get<{ skills: SkillWithSources[] }>('/portal/me/skills')
      .then((r) => setSkills(r.data.skills))
      .catch(() => setSkills([]))
  }, [])

  useEffect(load, [load])

  const mine = skills
    .filter((s) => s.sources.some((x) => x.source === 'student'))
    .map((s) => s.label)

  const startEditing = () => {
    setDraft(mine.join(', '))
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.put<Student>('/portal/me', { skills: draft })
      onSaved?.(r.data)
      load()
      setEditing(false)
      toast.success('Skills updated.')
    } catch {
      toast.error('Could not save your skills.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="font-semibold text-gray-800">My skills</h2>
        {!editing && (
          <button
            onClick={startEditing}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit mine
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Skills you earned in training are marked as such. You can add your own — they stay
        labelled as your own, and you cannot remove one the placement office or a training
        module added.
      </p>

      {editing ? (
        <div className="space-y-2">
          <label htmlFor="my-skills" className="block text-sm font-medium text-gray-700">
            Your own skills, separated by commas
          </label>
          <textarea
            id="my-skills"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Figma, Public speaking, Rust"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : skills.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {skills.map((s) => {
            // The strongest source leads — the API returns them in that order.
            const key = (s.sources[0]?.source ?? 'student') as SourceKey
            const meta = SOURCE[key] ?? SOURCE.student
            const Icon = meta.icon
            return (
              <li
                key={s.skill}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                  meta.cls,
                )}
                title={s.sources.map((x) => x.evidence || SOURCE[x.source as SourceKey]?.label).join(' · ')}
              >
                <Icon className="w-3 h-3" aria-hidden="true" />
                {s.label}
                <span className="sr-only"> — {meta.label}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">
          Nothing recorded yet. Add your own with “Edit mine”, and anything you earn in
          training will appear here automatically.
        </p>
      )}
    </div>
  )
}
