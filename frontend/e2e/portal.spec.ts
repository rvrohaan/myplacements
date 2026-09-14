import { expect, test } from '@playwright/test'

import { SEED, portal, signInAsStudent } from './helpers'

/**
 * The student portal, and the wall between it and the staff app.
 *
 * Students hold real accounts on their college's subdomain - the same door,
 * different key. That is exactly why this is worth walking through a browser:
 * the separation is not a different host or a different app, it is a role check
 * on every request and a redirect in the router.
 */
test.describe('the student portal', () => {
  test('a student signs in with their roll number', async ({ page }) => {
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStudent(page, SEED.studentRoll)

    await expect(page).toHaveURL(/\/portal/)
  })

  test('the portal is theirs, and says so', async ({ page }) => {
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStudent(page, SEED.studentRoll)
    await expect(page).toHaveURL(/\/portal/)

    await expect(page.getByText('Asha Rao').first()).toBeVisible()
  })

  test('a student cannot walk into the staff app', async ({ page }) => {
    // The row of every classmate's marks, backlogs and risk band is one URL
    // away, and a role check is all that stands between.
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStudent(page, SEED.studentRoll)
    await expect(page).toHaveURL(/\/portal/)

    await page.goto(portal(SEED.tenant, '/students'))

    await expect(page).not.toHaveURL(/\/students/)
    await expect(page).toHaveURL(/\/portal/)
  })

  test('a student cannot reach the company list either', async ({ page }) => {
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStudent(page, SEED.studentRoll)
    await expect(page).toHaveURL(/\/portal/)

    await page.goto(portal(SEED.tenant, '/companies'))

    await expect(page).toHaveURL(/\/portal/)
  })

  test('a roll number from another college is refused', async ({ page }) => {
    // Roll numbers are unique per college, not globally, so the subdomain is
    // what decides whose E2E001 is being asked for.
    await page.goto(portal(SEED.rival, '/login'))
    await signInAsStudent(page, SEED.studentRoll)

    await expect(page.getByRole('alert')).toContainText(/don’t match/i)
  })

  test('a student whose login was never enabled is refused', async ({ page }) => {
    // Most student rows exist for records only. The refusal has to look like
    // any other, or it enumerates which roll numbers can sign in.
    await page.goto(portal(SEED.tenant, '/login'))
    await signInAsStudent(page, 'E2E002')

    await expect(page.getByRole('alert')).toContainText(/don’t match/i)
  })

  test('staff are sent to the staff app, not the portal', async ({ page }) => {
    // The mirror of the rule above.
    await page.goto(portal(SEED.tenant, '/login'))
    await page.getByLabel('Email address').fill(SEED.head)
    await page.getByLabel(/^Password/).fill(SEED.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    await page.goto(portal(SEED.tenant, '/portal'))

    await expect(page).not.toHaveURL(/\/portal$/)
  })
})
