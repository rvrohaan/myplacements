import { useEffect, useState } from 'react'
import { Plus, GraduationCap, Users, Trophy, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import fetchAll from '@/lib/fetchAll'
import type { TrainingModule, TrainingRecord, Student } from '@/types'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm'
import { useToast } from '@/components/ui/toast'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { required, type Rules } from '@/lib/validation'

const CATEGORIES = ['aptitude', 'coding', 'communication', 'mock_interview', 'other']
const STATUSES = ['enrolled', 'in_progress', 'completed', 'dropped']

export default function Training() {
  const [modules, setModules] = useState<TrainingModule[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<TrainingModule | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const fetchModules = () => {
    setLoading(true)
    api.get('/training/modules').then((r) => setModules(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { fetchModules() }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{modules.length} training module{modules.length === 1 ? '' : 's'}</p>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors">
          <Plus className="w-4 h-4" /> New Module
        </button>
      </div>

      {showAdd && <AddModuleForm onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); fetchModules() }} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 text-center py-10 text-gray-400">Loading modules…</div>
        ) : modules.length === 0 ? (
          <div className="col-span-3 text-center py-10 text-gray-400">No training modules yet.</div>
        ) : (
          modules.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className={cn(
                'text-left bg-white rounded-xl border p-4 space-y-3 transition hover:border-primary-300 hover:shadow-sm',
                selected?.id === m.id ? 'border-primary-400 ring-1 ring-primary-200' : 'border-gray-200'
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{m.name}</p>
                  {m.category && <p className="text-xs text-gray-500 capitalize">{m.category.replace('_', ' ')}</p>}
                </div>
                <GraduationCap className="w-5 h-5 text-primary-500" />
              </div>
              {m.description && <p className="text-xs text-gray-500 line-clamp-2">{m.description}</p>}
              <div className="flex items-center justify-between text-xs text-gray-500 border-t border-gray-100 pt-2">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{m.enrolled_count} enrolled</span>
                <span>{m.completed_count} done</span>
                {m.avg_score != null && <span className="flex items-center gap-1"><Trophy className="w-3.5 h-3.5" />{m.avg_score} avg</span>}
              </div>
            </button>
          ))
        )}
      </div>

      {selected && (
        <ProgressPanel
          module={selected}
          onChanged={fetchModules}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

type ModuleForm = { name: string; category: string; description: string }

const EMPTY_MODULE_FORM: ModuleForm = { name: '', category: 'aptitude', description: '' }

const MODULE_RULES: Rules<ModuleForm> = {
  name: required('Name the module, e.g. Quantitative Aptitude.'),
}

function AddModuleForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ModuleForm>(EMPTY_MODULE_FORM)
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const { formRef, errors, clearError, validate } = useFieldErrors<ModuleForm>()

  const set = (field: keyof ModuleForm, value: string) => {
    clearError(field)
    setForm((p) => ({ ...p, [field]: value }))
  }
  /** Inline panels get the same unsaved-changes guard as the modal forms. */
  const cancel = async () => {
    const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_MODULE_FORM)
    if (dirty) {
      const discard = await confirm({
        title: 'Discard your changes?',
        message: 'You haven’t saved what you typed yet. Closing this form now will lose it.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        tone: 'warning',
      })
      if (!discard) return
    }
    onClose()
  }


  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate(MODULE_RULES, form)) return
    setSubmitting(true)
    try {
      await api.post('/training/modules', { name: form.name, category: form.category, description: form.description || null })
      toast.success(`${form.name} created`)
      onSaved()
    } catch (err: any) {
      // This used to fail silently — the panel just sat there looking idle.
      toast.error(err?.response?.data?.detail ?? 'Could not create this module. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">New Training Module</h3>
      {/* noValidate hands validation to the app, so the browser never shows its
          own tooltip bubbles over our fields. */}
      <form ref={formRef} onSubmit={submit} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field compact label="Name" name="name" required error={errors.name}>
          {(p) => (
            <input
              {...p}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputClass(!!errors.name, 'px-3 py-2')}
              placeholder="e.g. Quantitative Aptitude"
            />
          )}
        </Field>
        <Field compact label="Category" name="category">
          {(p) => (
            <select
              {...p}
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              className={inputClass(false, 'px-3 py-2 capitalize')}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
          )}
        </Field>
        <Field compact className="sm:col-span-2" label="Description" name="description" optional>
          {(p) => (
            <textarea
              {...p}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              className={inputClass(false, 'px-3 py-2')}
            />
          )}
        </Field>
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <button type="button" onClick={cancel} className="min-h-[44px] px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2">Cancel</button>
          <button type="submit" disabled={submitting} className="min-h-[44px] px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
            {submitting ? 'Saving…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ProgressPanel({ module, onChanged, onClose }: { module: TrainingModule; onChanged: () => void; onClose: () => void }) {
  const [records, setRecords] = useState<TrainingRecord[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [studentId, setStudentId] = useState('')
  const confirm = useConfirm()
  const toast = useToast()

  const fetchRecords = () => {
    setLoading(true)
    api.get(`/training/modules/${module.id}/students`).then((r) => setRecords(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchRecords()
    fetchAll<Student>('/students').then(setStudents).catch(() => {})
  }, [module.id])

  const enrolledIds = new Set(records.map((r) => r.student_id))
  const available = students.filter((s) => !enrolledIds.has(s.id))

  const enroll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!studentId) return
    await api.post(`/training/modules/${module.id}/students`, { student_id: parseInt(studentId) })
    setStudentId('')
    fetchRecords()
    onChanged()
  }

  const save = async (rec: TrainingRecord, patch: Partial<TrainingRecord>) => {
    await api.put(`/training/records/${rec.id}`, patch)
    fetchRecords()
    onChanged()
  }

  const remove = async (rec: TrainingRecord) => {
    const ok = await confirm({
      title: 'Remove this student from the module?',
      message: (
        <>
          <span className="font-medium text-gray-800">{rec.student_name ?? rec.roll_number ?? 'This student'}</span>{' '}
          will be unenrolled from <span className="font-medium text-gray-800">{module.name}</span>, and their
          recorded scores and attendance for it will be deleted. This can’t be undone.
        </>
      ),
      confirmLabel: 'Remove student',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/training/records/${rec.id}`)
      toast.success('Student removed from the module')
      fetchRecords()
      onChanged()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not remove this student. Try again.')
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">{module.name} — student progress</h3>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">Close</button>
      </div>

      <form onSubmit={enroll} className="flex items-end gap-2">
        <div className="flex-1 max-w-md">
          <label className="block text-xs font-medium text-gray-600 mb-1">Enroll a student</label>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="" disabled>Select a student…</option>
            {available.map((s) => <option key={s.id} value={s.id}>{s.roll_number} · {s.full_name ?? '—'} ({s.branch})</option>)}
          </select>
        </div>
        <button type="submit" disabled={!studentId} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors">
          <Plus className="w-4 h-4" /> Enroll
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-400 py-4">Loading…</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No students enrolled yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 px-2">Score</th>
                <th className="py-2 px-2">Attendance %</th>
                <th className="py-2 px-2">Mock score</th>
                <th className="py-2 px-2">Status</th>
                <th className="py-2 pl-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map((r) => <ProgressRow key={r.id} rec={r} onSave={save} onRemove={remove} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ProgressRow({
  rec,
  onSave,
  onRemove,
}: {
  rec: TrainingRecord
  onSave: (rec: TrainingRecord, patch: Partial<TrainingRecord>) => void
  onRemove: (rec: TrainingRecord) => void
}) {
  const [score, setScore] = useState(rec.score?.toString() ?? '')
  const [attendance, setAttendance] = useState(rec.attendance_percent?.toString() ?? '')
  const [mock, setMock] = useState(rec.mock_test_score?.toString() ?? '')

  const dirty =
    score !== (rec.score?.toString() ?? '') ||
    attendance !== (rec.attendance_percent?.toString() ?? '') ||
    mock !== (rec.mock_test_score?.toString() ?? '')

  const num = (s: string) => (s === '' ? undefined : parseFloat(s))

  return (
    <tr>
      <td className="py-2 pr-3">
        <p className="font-medium text-gray-900">{rec.student_name ?? '—'}</p>
        <p className="text-xs text-gray-500">{rec.roll_number} · {rec.branch}</p>
      </td>
      <td className="py-2 px-2"><input type="number" step="0.1" value={score} onChange={(e) => setScore(e.target.value)} className="w-20 px-2 py-1 border border-gray-300 rounded text-sm" /></td>
      <td className="py-2 px-2"><input type="number" step="0.1" value={attendance} onChange={(e) => setAttendance(e.target.value)} className="w-20 px-2 py-1 border border-gray-300 rounded text-sm" /></td>
      <td className="py-2 px-2"><input type="number" step="0.1" value={mock} onChange={(e) => setMock(e.target.value)} className="w-20 px-2 py-1 border border-gray-300 rounded text-sm" /></td>
      <td className="py-2 px-2">
        <select
          value={rec.status}
          onChange={(e) => onSave(rec, { status: e.target.value })}
          className={cn('px-2 py-1 rounded text-xs font-medium capitalize border-0', STATUS_COLORS[rec.status] ?? 'bg-gray-100 text-gray-700')}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </td>
      <td className="py-2 pl-2">
        <div className="flex items-center gap-2 justify-end">
          {dirty && (
            <button
              onClick={() => onSave(rec, { score: num(score), attendance_percent: num(attendance), mock_test_score: num(mock) })}
              className="text-xs text-primary-600 hover:text-primary-800 font-medium"
            >
              Save
            </button>
          )}
          <button onClick={() => onRemove(rec)} title="Remove" className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
        </div>
      </td>
    </tr>
  )
}
