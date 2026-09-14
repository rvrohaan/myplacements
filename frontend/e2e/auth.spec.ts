import { expect, test } from '@playwright/test'

import { SEED, apex, portal, signInAsStaff } from './helpers'

/**
 * Signing in, and the rule that the host decides who may.
 *
 * This is the seam nothing below the browser reaches. In development Vite's
 * proxy rewrites Host to localhost, so the backend cannot read the tenant from
 * it - the frontend has to derive it from the address bar and send X-Tenant
 * instead. Every request in every other spec depends on that working, and only
 * a real browser on a real subdomain exercises it.
 */
test.describe('staff sign-in', () => {
  test('a head signs in on their own college portal', async ({ page }) => {
    await page.goto(portal(SEED.tenant, '/login'))
    await expect(page.getByRole('heading', { name: /E2E Institute/ })).toBeVisible()

    await signInAsStaff(page, SEED.head)

    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('the college is branded from the subdomain, before anyone signs in', async ({ page }) => {
    // The whole tenant-resolution chain in one assertion: address bar ->
    // getSubdomain -> X-Tenant -> Host-based lookup -> this college's name.
    await page.goto(portal(SEED.tenant, '/login'))
    await expect(page.getByRole('heading', { name: /E2E Institute/ })).toBeVisible()
  })

  test('the same credentials are refused on another college portal', async ({ page }) => {
    // The tenant boundary, walked into rather than asserted about.
    await page.goto(portal(SEED.rival, '/login'))
    await signInAsStaff(page, SEED.head)

    await expect(page.getByRole('alert')).toContainText(/don’t match/i)
    await expect(page).toHaveURL(/\/login/)
  })

  test('a wrong password says nothing about whether the account exists', async ({ page }) => {
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStaff(page, SEED.head, 'not-the-password')

    const alert = page.getByRole('alert')
    await expect(alert).toContainText(/don’t match/i)
    await expect(alert).not.toContainText(/no account|not found|unknown/i)
  })

  test('the session survives a page reload', async ({ page }) => {
    // The token is persisted and re-read by the axios interceptor on the next
    // page load. A component test can only simulate that.
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStaff(page, SEED.head)
    await expect(page).toHaveURL(/\/dashboard/)

    await page.reload()

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('signing out ends the session for good', async ({ page }) => {
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStaff(page, SEED.head)
    await expect(page).toHaveURL(/\/dashboard/)

    // Sign out lives behind the account menu in the sidebar, which is where a
    // user would look for it - so the test goes the same way.
    await page.getByRole('button', { name: /^Account:/ }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)

    // Going back must not restore a dead session.
    await page.goto(portal(SEED.tenant, '/dashboard'))
    await expect(page).toHaveURL(/\/login/)
  })

  test('an unknown subdomain says the portal could not be found', async ({ page }) => {
    // A mistyped college code is a far more likely mistake than a wrong
    // password, and "check the address" is the only useful answer.
    await page.goto(portal('nosuchcollege', '/login'))
    await expect(page.getByText(/could not be found/i)).toBeVisible()
  })

  test('the apex serves the marketing site, not the app', async ({ page }) => {
    await page.goto(apex('/'))
    await expect(page).not.toHaveURL(/\/dashboard/)
  })
})
