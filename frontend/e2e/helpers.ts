import { expect, type Page } from '@playwright/test'

/** Everything seed_e2e.py creates, named the same way it is there. */
export const SEED = {
  password: 'e2e-password-123',
  tenant: 'e2e',
  rival: 'rival',
  owner: 'owner@myplacements.in',
  head: 'head@e2e.example.com',
  officer: 'officer@e2e.example.com',
  rivalHead: 'head@rival.example.com',
  studentRoll: 'E2E001',
  allocatedCompany: 'Allocated Corp',
  unallocatedCompany: 'Unallocated Corp',
  rivalCompany: 'Rival Secret Corp',
} as const

const PORT = 5173

/**
 * The password input, and not the reveal toggle beside it.
 *
 * `Field` appends an sr-only " (required)" to its label, so the accessible name
 * is "Password (required)" - exact matching misses it. Matching loosely instead
 * catches the toggle, whose aria-label is "Show password". Anchoring at the
 * start is the one form that means the field and only the field.
 */
const PASSWORD_FIELD = /^Password/

/** A tenant portal. *.localhost resolves to 127.0.0.1 with no hosts edit. */
export function portal(subdomain: string, pathname = '/') {
  return `http://${subdomain}.localhost:${PORT}${pathname}`
}

/** The apex, which carries no tenant and serves the marketing site. */
export function apex(pathname = '/') {
  return `http://localhost:${PORT}${pathname}`
}

/** Fill and submit the staff form. Does not assert the outcome - callers differ. */
export async function signInAsStaff(page: Page, email: string, password = SEED.password) {
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel(PASSWORD_FIELD).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** The student door on the same page, reached by the staff/student toggle. */
export async function signInAsStudent(page: Page, roll: string, password = SEED.password) {
  await page.getByRole('button', { name: 'student', exact: true }).click()
  await page.getByLabel('Roll number').fill(roll)
  await page.getByLabel(PASSWORD_FIELD).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Sign in and wait until the app has actually navigated away from /login. */
export async function signedInAs(page: Page, subdomain: string, email: string) {
  await page.goto(portal(subdomain, '/login'))
  await signInAsStaff(page, email)
  await expect(page).not.toHaveURL(/\/login/)
}
