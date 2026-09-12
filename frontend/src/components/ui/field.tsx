import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { runRules, type FieldErrors, type Rules } from '@/lib/validation'

/** Props <Field> hands to the control so labelling and errors stay wired up. */
export interface FieldControlProps {
  id: string
  required?: boolean
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

const CONTROL_BASE =
  'w-full px-4 py-2.5 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-2'

/**
 * Shared control styling, including the invalid state. A red ring alone would
 * be colour-only signalling, so an error always ships with the message below.
 */
export function inputClass(hasError?: boolean, extra?: string) {
  return cn(
    CONTROL_BASE,
    hasError
      ? 'border-red-400 bg-red-50/40 text-red-900 placeholder:text-red-300 focus:border-red-500 focus:ring-red-500'
      : 'border-gray-300 bg-white focus:border-primary-500 focus:ring-primary-500',
    extra,
  )
}

/**
 * Label + control + helper/error, with htmlFor, aria-describedby, aria-invalid
 * and role="alert" wired for you.
 *
 *   <Field label="Roll number" name="roll_number" required error={errors.roll_number}>
 *     {(p) => <input {...p} className={inputClass(!!errors.roll_number)} … />}
 *   </Field>
 */
export function Field<T extends string = string>({
  label,
  name,
  children,
  error,
  hint,
  required,
  optional,
  className,
  compact = false,
}: {
  label: ReactNode
  /** Matches the form-state key; lets validation scroll to and focus this field. */
  name: T
  children: (props: FieldControlProps) => ReactNode
  error?: string
  /** Persistent guidance, e.g. a format example. Replaced by the error when one shows. */
  hint?: ReactNode
  required?: boolean
  optional?: boolean
  className?: string
  /** Smaller label, for the denser grid forms (drives, companies). */
  compact?: boolean
}) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const showHint = !!hint && !error

  return (
    <div className={className} data-field={name}>
      <label
        htmlFor={id}
        className={cn(
          'block font-medium mb-1',
          compact ? 'text-xs text-gray-600' : 'text-sm text-gray-700',
        )}
      >
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-red-500 ml-0.5">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
        {optional && <span className="text-gray-400 font-normal"> (optional)</span>}
      </label>
      {children({
        id,
        required,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : showHint ? hintId : undefined,
      })}
      {showHint && (
        <p id={hintId} className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle aria-hidden="true" className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

const FOCUSABLE = 'input,select,textarea,[contenteditable="true"]'

/**
 * Per-field error state for a form.
 *
 * Put `noValidate` and `ref={formRef}` on the <form>, call `validate(RULES,
 * form)` at the top of submit, and `clearError(field)` as the user edits — so a
 * message disappears the moment it stops being true rather than nagging until
 * the next submit.
 */
export function useFieldErrors<T extends object>() {
  const formRef = useRef<HTMLFormElement>(null)
  const [errors, setErrors] = useState<FieldErrors<T>>({})

  const clearError = useCallback((field: keyof T) => {
    setErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  /** Moves focus to the first field that failed, so the fix is one keystroke away. */
  const focusFirst = useCallback((found: FieldErrors<T>) => {
    const first = (Object.keys(found) as (keyof T)[])[0]
    if (first == null) return
    const wrapper = formRef.current?.querySelector<HTMLElement>(`[data-field="${String(first)}"]`)
    const control = wrapper?.querySelector<HTMLElement>(FOCUSABLE) ?? wrapper
    control?.focus({ preventScroll: true })
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    control?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [])

  /** Returns true when the form is clean; otherwise shows and focuses the errors. */
  const validate = useCallback(
    (rules: Rules<T>, form: T) => {
      const found = runRules(rules, form)
      setErrors(found)
      if (Object.keys(found).length === 0) return true
      focusFirst(found)
      return false
    },
    [focusFirst],
  )

  return { formRef, errors, setErrors, clearError, validate }
}
