import { useState } from 'react'
import api from '@/lib/api'
import type { Student } from '@/types'
import { Modal, ModalClose, ModalTitle, useModalClose } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { all, numberBetween, required, type Rules } from '@/lib/validation'

const THIS_YEAR = new Date().getFullYear()

type EditStudentForm = {
  full_name: string
  roll_number: string
  branch: string
  batch_year: string
  cgpa: string
  backlogs: string
  skills: string
  placement_ctc: string
}

const RULES: Rules<EditStudentForm> = {
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
  placement_ctc: numberBetween(0, 1000, 'Enter the package in LPA, e.g. 12.5.'),
}

export default function EditStudentModal({
  student,
  onClose,
  onSaved,
}: {
  student: Student
  onClose: () => void
  onSaved: (s: Student) => void
}) {
  const isPlaced = student.placement_status === 'placed'
  const initialForm: EditStudentForm = {
    full_name: student.full_name ?? '',
    roll_number: student.roll_number,
    branch: student.branch,
    batch_year: String(student.batch_year),
    cgpa: student.cgpa != null ? String(student.cgpa) : '',
    backlogs: String(student.backlogs),
    skills: student.skills ?? '',
    placement_ctc: student.placement_ctc != null ? String(student.placement_ctc) : '',
  }
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<EditStudentForm>()

  const update = (field: keyof EditStudentForm, value: string) => {
    clearError(field)
    setForm((f) => ({ ...f, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    // The package field only exists for a placed student, so don't judge it otherwise.
    const rules = isPlaced ? RULES : { ...RULES, placement_ctc: undefined }
    if (!validate(rules, form)) return
    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        full_name: form.full_name,
        roll_number: form.roll_number,
        branch: form.branch,
        batch_year: Number(form.batch_year),
        cgpa: form.cgpa === '' ? null : Number(form.cgpa),
        backlogs: form.backlogs === '' ? 0 : Number(form.backlogs),
        skills: form.skills || null,
      }
      // CTC only applies to a placed student; let them fix a typo here.
      if (isPlaced) {
        payload.placement_ctc = form.placement_ctc === '' ? null : Number(form.placement_ctc)
      }
      const { data } = await api.put(`/students/${student.id}`, payload)
      onSaved(data)
      onClose()
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || 'Could not save these changes. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={JSON.stringify(form) !== JSON.stringify(initialForm)}
      panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto"
    >
      <EditStudentBody
        formRef={formRef}
        form={form}
        errors={errors}
        error={error}
        loading={loading}
        isPlaced={isPlaced}
        update={update}
        onSubmit={handleSubmit}
      />
    </Modal>
  )
}

/** Split out so Cancel can reach the modal's guarded close via context. */
function EditStudentBody({
  formRef,
  form,
  errors,
  error,
  loading,
  isPlaced,
  update,
  onSubmit,
}: {
  formRef: React.RefObject<HTMLFormElement>
  form: EditStudentForm
  errors: Partial<Record<keyof EditStudentForm, string>>
  error: string
  loading: boolean
  isPlaced: boolean
  update: (field: keyof EditStudentForm, value: string) => void
  onSubmit: (e: React.FormEvent) => void
}) {
  const requestClose = useModalClose()

  return (
    <>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
        <ModalTitle>Edit student</ModalTitle>
        <ModalClose />
      </div>

      {/* noValidate hands validation to the app, so the browser never shows its
          own tooltip bubbles over our fields. */}
      <form ref={formRef} onSubmit={onSubmit} noValidate className="p-6 space-y-4">
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
        {isPlaced && (
          <Field label="Package (LPA)" name="placement_ctc" error={errors.placement_ctc}>
            {(p) => (
              <div className="relative">
                <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                  ₹
                </span>
                <input
                  {...p}
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={form.placement_ctc}
                  onChange={(e) => update('placement_ctc', e.target.value)}
                  className={inputClass(!!errors.placement_ctc, 'pl-7 pr-12')}
                  placeholder="12.5"
                />
                <span aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                  LPA
                </span>
              </div>
            )}
          </Field>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={requestClose}
            className="flex-1 min-h-[44px] border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {loading ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </>
  )
}
