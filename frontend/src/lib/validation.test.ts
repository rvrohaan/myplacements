/**
 * lib/validation.ts - the form rules.
 *
 * Every form in the app runs on these, with `noValidate` set so the browser's
 * own bubbles never appear. That makes a gap here invisible rather than noisy:
 * a rule that silently passes lets bad data through to the API instead of
 * showing the user what to fix.
 */
import { describe, expect, it } from 'vitest'

import { all, email, isBlank, numberBetween, required, runRules } from '@/lib/validation'

type Form = { name: string; cgpa: string; contact: string }

const form: Form = { name: '', cgpa: '', contact: '' }

describe('isBlank', () => {
  it.each([
    ['', true],
    ['   ', true],
    ['\t\n', true],
    ['a', false],
    ['  a  ', false],
  ])('treats %o as blank=%s', (value, expected) => {
    expect(isBlank(value)).toBe(expected)
  })

  it('treats a non-string as blank', () => {
    // Values arrive from form state, which can hold undefined or a number.
    expect(isBlank(undefined)).toBe(true)
    expect(isBlank(null)).toBe(true)
    expect(isBlank(12)).toBe(true)
  })
})

describe('required', () => {
  it('complains when the field is empty', () => {
    expect(required<Form>('Enter a name')('', form)).toBe('Enter a name')
  })

  it('complains when the field is only whitespace', () => {
    // Otherwise a field of spaces submits as an empty name.
    expect(required<Form>('Enter a name')('   ', form)).toBe('Enter a name')
  })

  it('passes a real value', () => {
    expect(required<Form>('Enter a name')('Asha', form)).toBeUndefined()
  })
})

describe('numberBetween', () => {
  const cgpa = numberBetween<Form>(0, 10, 'Enter a CGPA between 0 and 10')

  it('accepts a value inside the range', () => {
    expect(cgpa('7.5', form)).toBeUndefined()
  })

  it.each(['0', '10'])('accepts the boundary value %s', (value) => {
    // Inclusive at both ends: a perfect 10 is a real CGPA.
    expect(cgpa(value, form)).toBeUndefined()
  })

  it.each(['-1', '10.1', '100'])('rejects %s as out of range', (value) => {
    expect(cgpa(value, form)).toBe('Enter a CGPA between 0 and 10')
  })

  it.each(['abc', '7.5.1', 'NaN'])('rejects %s as not a number', (value) => {
    expect(cgpa(value, form)).toBe('Enter a CGPA between 0 and 10')
  })

  it('rejects Infinity', () => {
    // Number('Infinity') is finite-looking to a naive check but not to
    // Number.isFinite, which is what the rule uses.
    expect(cgpa('Infinity', form)).toBe('Enter a CGPA between 0 and 10')
  })

  it('leaves an optional number blank without complaint', () => {
    // CGPA is genuinely unknown for some students, and demanding it would block
    // the whole form over a field the college may not hold.
    expect(cgpa('', form)).toBeUndefined()
  })

  it('can be made mandatory', () => {
    const withRequired = numberBetween<Form>(0, 10, 'bad', { required: 'Enter a CGPA' })
    expect(withRequired('', form)).toBe('Enter a CGPA')
  })

  it('rejects a fraction when whole numbers are demanded', () => {
    const year = numberBetween<Form>(2000, 2100, 'Enter a year', { integer: true })
    expect(year('2026.5', form)).toBe('Enter a year')
    expect(year('2026', form)).toBeUndefined()
  })
})

describe('email', () => {
  const rule = email<Form>('Enter a valid email address')

  it.each([
    'head@rit.edu',
    'first.last@sub.domain.co.in',
    'a+tag@example.com',
  ])('accepts %s', (value) => {
    expect(rule(value, form)).toBeUndefined()
  })

  it.each([
    'not-an-email',
    'missing@tld',
    '@example.com',
    'spaces in@example.com',
    'two@@example.com',
    'trailing@example.',
  ])('rejects %s', (value) => {
    expect(rule(value, form)).toBe('Enter a valid email address')
  })

  it('trims before checking', () => {
    // A pasted address routinely carries a trailing space.
    expect(rule('  head@rit.edu  ', form)).toBeUndefined()
  })

  it('is optional by default', () => {
    expect(rule('', form)).toBeUndefined()
  })

  it('can be made mandatory', () => {
    const mandatory = email<Form>('Enter a valid email address', 'Enter an email address')
    expect(mandatory('', form)).toBe('Enter an email address')
  })
})

describe('all', () => {
  it('reports the first failure and stops', () => {
    // Showing "Enter a name" and "Name is too long" at once would be noise.
    const rule = all<Form>(required('Enter a name'), () => 'second failure')
    expect(rule('', form)).toBe('Enter a name')
  })

  it('falls through to the later rule once the first passes', () => {
    const rule = all<Form>(required('Enter a name'), () => 'second failure')
    expect(rule('Asha', form)).toBe('second failure')
  })

  it('passes when every rule passes', () => {
    const rule = all<Form>(required('Enter a name'), () => undefined)
    expect(rule('Asha', form)).toBeUndefined()
  })
})

describe('runRules', () => {
  it('collects one message per failing field', () => {
    const errors = runRules<Form>(
      { name: required('Enter a name'), cgpa: numberBetween(0, 10, 'Enter a CGPA 0-10') },
      { name: '', cgpa: '99', contact: '' },
    )
    expect(errors).toEqual({ name: 'Enter a name', cgpa: 'Enter a CGPA 0-10' })
  })

  it('returns nothing for a valid form', () => {
    const errors = runRules<Form>(
      { name: required('Enter a name') },
      { name: 'Asha', cgpa: '', contact: '' },
    )
    expect(errors).toEqual({})
  })

  it('reports fields in declaration order', () => {
    // Forms focus the first error, so this decides which field the cursor
    // lands in - it should be the topmost one, not an arbitrary one.
    const errors = runRules<Form>(
      {
        name: required('Enter a name'),
        cgpa: required('Enter a CGPA'),
        contact: required('Enter a contact'),
      },
      { name: '', cgpa: '', contact: '' },
    )
    expect(Object.keys(errors)).toEqual(['name', 'cgpa', 'contact'])
  })

  it('ignores fields with no rule', () => {
    const errors = runRules<Form>({ name: required('Enter a name') }, { ...form, cgpa: 'junk' })
    expect(errors).toEqual({ name: 'Enter a name' })
  })

  it('passes a missing value to the rule as an empty string', () => {
    // Form state holds undefined before a field is touched; a rule must see ''
    // rather than the string "undefined", which would pass a required check.
    const errors = runRules<Form>({ name: required('Enter a name') }, {} as Form)
    expect(errors).toEqual({ name: 'Enter a name' })
  })

  it('gives a rule access to the whole form', () => {
    // For cross-field checks, e.g. a maximum that depends on a minimum.
    const errors = runRules<Form>(
      { cgpa: (value, f) => (value > f.name ? 'cgpa must not exceed name' : undefined) },
      { name: '5', cgpa: '9', contact: '' },
    )
    expect(errors.cgpa).toBe('cgpa must not exceed name')
  })
})
