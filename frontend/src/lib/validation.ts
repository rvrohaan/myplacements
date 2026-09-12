/**
 * Tiny form-validation helpers. Forms declare a rule per field, run them on
 * submit, and render the message under the field — so the browser's native
 * validation bubbles (which we suppress with `noValidate`) are never needed.
 *
 * Messages should say what is wrong AND how to fix it: "Enter a CGPA between 0
 * and 10" beats "Invalid input".
 */

export type Rule<T> = (value: string, form: T) => string | undefined
export type Rules<T> = Partial<Record<keyof T, Rule<T>>>
export type FieldErrors<T> = Partial<Record<keyof T, string>>

export const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === ''

/** Runs every rule; key order follows the declaration order of `rules`. */
export function runRules<T extends object>(rules: Rules<T>, form: T): FieldErrors<T> {
  const errors: FieldErrors<T> = {}
  for (const key of Object.keys(rules) as (keyof T)[]) {
    const rule = rules[key]
    if (!rule) continue
    const raw = (form as Record<string, unknown>)[key as string]
    const message = rule(raw == null ? '' : String(raw), form)
    if (message) errors[key] = message
  }
  return errors
}

/** Fails when the field is empty or whitespace only. */
export function required<T>(message: string): Rule<T> {
  return (value) => (isBlank(value) ? message : undefined)
}

/**
 * Numeric bounds check. Empty passes unless `required` is set, so optional
 * numbers can be left blank without a complaint.
 */
export function numberBetween<T>(
  min: number,
  max: number,
  message: string,
  opts: { required?: string; integer?: boolean } = {},
): Rule<T> {
  return (value) => {
    if (isBlank(value)) return opts.required
    const n = Number(value)
    if (!Number.isFinite(n)) return message
    if (opts.integer && !Number.isInteger(n)) return message
    return n < min || n > max ? message : undefined
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Optional by default — pass `requiredMessage` to make the field mandatory. */
export function email<T>(message: string, requiredMessage?: string): Rule<T> {
  return (value) => {
    if (isBlank(value)) return requiredMessage
    return EMAIL_RE.test(value.trim()) ? undefined : message
  }
}

/** Chains rules, reporting the first failure. */
export function all<T>(...rules: Rule<T>[]): Rule<T> {
  return (value, form) => {
    for (const rule of rules) {
      const message = rule(value, form)
      if (message) return message
    }
    return undefined
  }
}
