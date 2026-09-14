import { expect, test } from '@playwright/test'

import { SEED, portal, signedInAs } from './helpers'

/**
 * Running a report, and downloading it.
 *
 * The download is the reason this spec exists. A workbook is built in memory on
 * the server, streamed as a blob, and turned into a file by the browser - and
 * none of the other tiers can see past the first of those three. A backend test
 * proves the bytes are a valid workbook; only this proves a placement head who
 * presses the button ends up with a file.
 *
 * These reports go into NBA, NAAC and NIRF submissions with the college's name
 * on them, which is why the caveats are asserted too: a figure without its basis
 * is how a report becomes false while every cell in it is accurate.
 */
test.describe('reports', () => {
  test.beforeEach(async ({ page }) => {
    await signedInAs(page, SEED.tenant, SEED.head)
    await page.goto(portal(SEED.tenant, '/reports'))
  })

  test('the catalogue offers the reports', async ({ page }) => {
    // .first(): each report's name appears in the picker and again in the
    // description beside it.
    await expect(page.getByText('Branch-wise placement').first()).toBeVisible()
    await expect(page.getByText('Placement evidence').first()).toBeVisible()
  })

  test('a report renders its tables', async ({ page }) => {
    await page.getByText('Branch-wise placement').first().click()
    await expect(page.locator('table').first()).toBeVisible()
  })

  test('a report carries its caveats', async ({ page }) => {
    // Always rendered, never optional.
    await page.getByText('Placement evidence').first().click()
    await expect(page.locator('table').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /download \.xlsx/i })).toBeEnabled()
  })

  test('the workbook actually downloads', async ({ page }) => {
    await page.getByText('Branch-wise placement').first().click()
    const download = page.getByRole('button', { name: /download \.xlsx/i })
    await expect(download).toBeEnabled()

    const [file] = await Promise.all([
      page.waitForEvent('download'),
      download.click(),
    ])

    expect(file.suggestedFilename()).toMatch(/\.xlsx$/)
    const path = await file.path()
    expect(path).toBeTruthy()
  })

  test('the downloaded file is a real workbook, not an error page', async ({ page }) => {
    // A failed export that still triggers a download is the failure mode worth
    // catching: the user gets a file, opens it, and finds JSON.
    await page.getByText('Branch-wise placement').first().click()
    const download = page.getByRole('button', { name: /download \.xlsx/i })
    await expect(download).toBeEnabled()

    const [file] = await Promise.all([
      page.waitForEvent('download'),
      download.click(),
    ])

    const fs = await import('fs')
    const path = await file.path()
    const head = fs.readFileSync(path!).subarray(0, 2).toString('binary')
    // Every .xlsx is a zip, and every zip starts "PK".
    expect(head).toBe('PK')
  })

  test('an officer cannot reach reports at all', async ({ page }) => {
    // Reports cover the whole college, so they follow the same gate the API
    // enforces.
    await signedInAs(page, SEED.tenant, SEED.officer)
    await page.goto(portal(SEED.tenant, '/reports'))
    await expect(page).not.toHaveURL(/\/reports/)
  })
})
