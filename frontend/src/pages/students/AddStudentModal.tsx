import { useState } from 'react'
import api from '@/lib/api'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { all, numberBetween, required, type Rules } from '@/lib/validation'

interface NewStudentForm {
  full_name: string
  roll_number: string
  branch: string
  batch_year: string
  cgpa: string
  backlogs: string
  skills: string
}

const THIS_YEAR = new Date().getFullYear()

/** One message per field, each naming the fix rather than just the failure. */
const RULES: Rules<NewStudentForm> = {
  full_name: required('Enter the student’s full name.'),
  roll_number: required('Enter the roll number, e.g. 21CS001.'),
  branch: required('Enter the branch, e.g. Computer Science.'),
  batch_year: all(
    required('Enter the batch year, e.g. 2025.'),
    numberBetween(1980, THIS_YEAR + 10, `Use a four-digit year between 1980 and ${THIS_YEAR + 10}.`, {
      integer: true,
    }),
  ),
  cgpa: numberBetween(0, 10, 'CGPA must be a number between 0 and 10.'),
  backlogs: numberBetween(0, 99, 'Backlogs must be a whole number, 0 or more.', { integer: true }),
}

const EMPTY_FORM: NewStudentForm = {
  full_name: '',
  roll_number: '',
  branch: '',
  batch_year: String(THIS_YEAR),
  cgpa: '',
  backlogs: '0',
  skills: '',
}

export default function AddStudentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<NewStudentForm>(EMPTY_FORM)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<NewStudentForm>()

  // Clearing on edit makes a message disappear as soon as it stops being true,
  // rather than nagging until the next submit.
  const update = (field: keyof NewStudentForm, value: string) => {
    clearError(field)
    setForm((f) => ({ ...f, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(RULES, form)) return
    setLoading(true)
    try {
      await api.post('/students', {
        full_name: form.full_name,
        roll_number: form.roll_number,
        branch: form.branch,
        batch_year: Number(form.batch_year),
        cgpa: form.cgpa === '' ? null : Number(form.cgpa),
        backlogs: form.backlogs === '' ? 0 : Number(form.backlogs),
        skills: form.skills || null,
      })
      onCreated()
      onClose()
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || 'Could not add this student. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={JSON.stringify(form) !== JSON.stringify(EMPTY_FORM)}
      panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
          <ModalTitle>Add student</ModalTitle>
          <ModalClose />
        </div>

        {/* noValidate hands validation to the app, so the browser never shows its
            own tooltip bubbles over our fields. */}
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
          {error && (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}
          <Field label="Full name" name="full_name" required error={errors.full_name}>
            {(p) => (
              <input
                {...p}
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                className={inputClass(!!errors.full_name)}
                placeholder="Jane Doe"
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Roll number" name="roll_number" required error={errors.roll_number}>
              {(p) => (
                <input
                  {...p}
                  value={form.roll_number}
                  onChange={(e) => update('roll_number', e.target.value)}
                  className={inputClass(!!errors.roll_number)}
                  placeholder="21CS001"
                />
              )}
            </Field>
            <Field label="Batch year" name="batch_year" required error={errors.batch_year}>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  value={form.batch_year}
                  onChange={(e) => update('batch_year', e.target.value)}
                  className={inputClass(!!errors.batch_year)}
                  placeholder="2025"
                />
              )}
            </Field>
          </div>
          <Field label="Branch" name="branch" required error={errors.branch}>
            {(p) => (
              <input
                {...p}
                value={form.branch}
                onChange={(e) => update('branch', e.target.value)}
                className={inputClass(!!errors.branch)}
                placeholder="Computer Science"
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CGPA" name="cgpa" optional error={errors.cgpa} hint="0–10 scale">
              {(p) => (
                <input
                  {...p}
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  inputMode="decimal"
                  value={form.cgpa}
                  onChange={(e) => update('cgpa', e.target.value)}
                  className={inputClass(!!errors.cgpa)}
                  placeholder="8.2"
                />
              )}
            </Field>
            <Field label="Backlogs" name="backlogs" error={errors.backlogs}>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.backlogs}
                  onChange={(e) => update('backlogs', e.target.value)}
                  className={inputClass(!!errors.backlogs)}
                  placeholder="0"
                />
              )}
            </Field>
          </div>
          <Field label="Skills" name="skills" optional hint="Separate with commas">
            {(p) => (
              <input
                {...p}
                value={form.skills}
                onChange={(e) => update('skills', e.target.value)}
                className={inputClass()}
                placeholder="Python, React, SQL"
              />
            )}
          </Field>
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {loading ? 'Adding…' : 'Add student'}
          </button>
        </form>
    </Modal>
  )
}
