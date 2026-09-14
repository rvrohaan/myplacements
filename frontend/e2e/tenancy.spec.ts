import { expect, test } from '@playwright/test'

import type { Page } from '@playwright/test'

import { SEED, portal, signInAsStaff, signedInAs } from './helpers'

/** A company by name. Exact, or "Unallocated Corp" matches "Allocated Corp". */
function company(page: Page, name: string) {
  return page.getByText(name, { exact: true })
}

/**
 * One college cannot reach another's data - through a real browser.
 *
 * The backend security suite proves this at the API. What it cannot prove is
 * that the browser asks the right question in the first place: in development
 * Vite rewrites Host, so the tenant travels in an X-Tenant header the frontend
 * derives from the address bar. If that broke, every API test would still pass
 * and every college would see the wrong data.
 */
test.describe('the tenant boundary', () => {
  test('a head sees their own college and not the other', async ({ page }) => {
    await signedInAs(page, SEED.tenant, SEED.head)
    await page.goto(portal(SEED.tenant, '/companies'))

    await expect(company(page, SEED.allocatedCompany)).toBeVisible()
    await expect(company(page, SEED.rivalCompany)).toHaveCount(0)
  })

  test('the other college sees only theirs', async ({ page }) => {
    // Both directions, so a filter that happens to be inverted cannot pass.
    await signedInAs(page, SEED.rival, SEED.rivalHead)
    await page.goto(portal(SEED.rival, '/companies'))

    await expect(company(page, SEED.rivalCompany)).toBeVisible()
    await expect(company(page, SEED.allocatedCompany)).toHaveCount(0)
  })

  test('typing another college’s address does not carry the session there', async ({ page }) => {
    // A token is bound to its tenant, so the same browser on another portal is
    // signed out rather than signed in as somebody else.
    await signedInAs(page, SEED.tenant, SEED.head)

    await page.goto(portal(SEED.rival, '/companies'))

    await expect(page).toHaveURL(/\/login/)
  })

  test('two portals in one browser do not bleed into each other', async ({ page }) => {
    // localStorage is per-origin, and a subdomain is its own origin - so this
    // is really a check that the app has not moved the token somewhere shared.
    await signedInAs(page, SEED.tenant, SEED.head)

    await page.goto(portal(SEED.rival, '/login'))
    await signInAsStaff(page, SEED.rivalHead)
    await expect(page).toHaveURL(/\/dashboard/)

    await page.goto(portal(SEED.tenant, '/dashboard'))
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto(portal(SEED.tenant, '/companies'))
    await expect(company(page, SEED.rivalCompany)).toHaveCount(0)
  })
})

test.describe('officer scope', () => {
  test('an officer sees only the companies allocated to them', async ({ page }) => {
    // The access model the whole officer feature rests on.
    await signedInAs(page, SEED.tenant, SEED.officer)
    await page.goto(portal(SEED.tenant, '/companies'))

    await expect(company(page, SEED.allocatedCompany)).toBeVisible()
    await expect(company(page, SEED.unallocatedCompany)).toHaveCount(0)
  })

  test('the head sees both', async ({ page }) => {
    await signedInAs(page, SEED.tenant, SEED.head)
    await page.goto(portal(SEED.tenant, '/companies'))

    await expect(company(page, SEED.allocatedCompany)).toBeVisible()
    await expect(company(page, SEED.unallocatedCompany)).toBeVisible()
  })

  test('an officer is bounced off a leadership page', async ({ page }) => {
    // Asserted by opening the page rather than by looking for a nav link: a
    // missing link only hides the door, and a deep link is how somebody would
    // arrive at it anyway.
    await signedInAs(page, SEED.tenant, SEED.officer)

    await page.goto(portal(SEED.tenant, '/reports'))

    await expect(page).not.toHaveURL(/\/reports/)
  })

  test('the head can open it', async ({ page }) => {
    await signedInAs(page, SEED.tenant, SEED.head)

    await page.goto(portal(SEED.tenant, '/reports'))

    await expect(page).toHaveURL(/\/reports/)
  })
})
