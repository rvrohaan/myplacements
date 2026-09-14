import { expect, test } from '@playwright/test'

import { SEED, portal, signInAsStaff } from './helpers'

/**
 * The platform console at admin.localhost.
 *
 * A reserved subdomain that is not a college, serving the same bundle as every
 * tenant portal. Which app you get is decided entirely by the address bar, so
 * this is another thing only a browser can check.
 */
test.describe('the platform console', () => {
  test('the owner signs in on the console', async ({ page }) => {
    await page.goto(portal('admin', '/login'))
    await expect(page.getByText('Platform Console').first()).toBeVisible()

    await signInAsStaff(page, SEED.owner)

    await expect(page).toHaveURL(/\/colleges/)
  })

  test('the console lists every college', async ({ page }) => {
    // The one place the tenant boundary is meant to be crossed.
    await page.goto(portal('admin', '/login'))
    await signInAsStaff(page, SEED.owner)
    await expect(page).toHaveURL(/\/colleges/)

    await expect(page.getByText('E2E Institute of Technology')).toBeVisible()
    await expect(page.getByText('Rival College')).toBeVisible()
  })

  test('a college head cannot sign in on the console', async ({ page }) => {
    // Their credentials are real; this is simply not their door.
    await page.goto(portal('admin', '/login'))
    await signInAsStaff(page, SEED.head)

    await expect(page.getByRole('alert')).toContainText(/don’t match/i)
    await expect(page).toHaveURL(/\/login/)
  })

  test('the owner cannot sign in on a college portal', async ({ page }) => {
    // super_admin crosses tenants once signed in, but has exactly one place to
    // sign in - so a leaked console password is not usable from a subdomain a
    // customer can reach.
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStaff(page, SEED.owner)

    await expect(page.getByRole('alert')).toContainText(/don’t match/i)
  })

  test('the console does not offer college-data pages', async ({ page }) => {
    // There is no tenant here, so a students or drives page would be querying
    // a college that does not exist.
    await page.goto(portal('admin', '/login'))
    await signInAsStaff(page, SEED.owner)
    await expect(page).toHaveURL(/\/colleges/)

    await page.goto(portal('admin', '/students'))

    await expect(page).not.toHaveURL(/\/students/)
  })

  test('a college portal does not offer the console pages', async ({ page }) => {
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStaff(page, SEED.head)
    await expect(page).toHaveURL(/\/dashboard/)

    await page.goto(portal(SEED.tenant, '/colleges'))

    await expect(page).not.toHaveURL(/\/colleges/)
  })
})
