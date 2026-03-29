import { test, expect, type Page, type Route } from '@playwright/test'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'

/** Mock Supabase REST + Auth for tenant resolution (proxy needs a client) */
async function setupBaseMocks(page: Page) {
  // Client table lookup (used by proxy for tenant resolution)
  await page.route(`${supabaseUrl}/rest/v1/client**`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 'client-1',
        slug: 'kwn',
        name: 'City of Kwinana',
        is_active: true,
        contractor_id: 'contractor-1',
        contractor: { id: 'contractor-1', name: 'D&M Waste Management' },
      }]),
    })
  })
}

/** Mock auth to return no session (unauthenticated) */
async function mockNoSession(page: Page) {
  await page.route(`${supabaseUrl}/auth/v1/user`, async (route: Route) => {
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'No session' }),
    })
  })

  await page.route(`${supabaseUrl}/auth/v1/token**`, async (route: Route) => {
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant' }),
    })
  })
}

test.describe('Auth', () => {
  test('OTP login flow — email entry → verify → dashboard', async ({ page }) => {
    await setupBaseMocks(page)

    // Mock OTP send
    await page.route(`${supabaseUrl}/auth/v1/otp`, async (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message_id: 'msg-1' }),
      })
    })

    // Mock OTP verify
    await page.route(`${supabaseUrl}/auth/v1/verify`, async (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh',
          user: { id: 'user-1', email: 'admin@kwinana.wa.gov.au' },
        }),
      })
    })

    // Go to auth page
    await page.goto('/auth')
    await expect(page.getByText('Verge Collection')).toBeVisible()

    // Enter email
    const emailInput = page.getByPlaceholder('you@example.com')
    await emailInput.fill('admin@kwinana.wa.gov.au')

    // Click Send Code
    await page.getByRole('button', { name: /Send Code/ }).click()

    // Should redirect to verify page
    await expect(page).toHaveURL(/\/auth\/verify/)
    await expect(page.getByText('Check your email')).toBeVisible()

    // Enter 6-digit OTP
    const otpCells = page.locator('input[inputmode="numeric"]')
    for (let i = 0; i < 6; i++) {
      await otpCells.nth(i).fill(String(i + 1))
    }

    // Should redirect to dashboard on success
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })
  })

  test('unauthenticated access to /admin redirects to /auth', async ({ page }) => {
    await setupBaseMocks(page)
    await mockNoSession(page)

    await page.goto('/admin')

    // Should be redirected to /auth
    await expect(page).toHaveURL(/\/auth/)
  })

  test('unauthenticated access to /field/run-sheet redirects to /auth', async ({ page }) => {
    await setupBaseMocks(page)
    await mockNoSession(page)

    await page.goto('/field/run-sheet')

    // Should be redirected to /auth
    await expect(page).toHaveURL(/\/auth/)
  })

  test('public /book page is accessible without auth', async ({ page }) => {
    await setupBaseMocks(page)
    await mockNoSession(page)

    // Mock the rest API calls the address form makes
    await page.route(`${supabaseUrl}/rest/v1/**`, async (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.goto('/book')

    // Should not redirect — booking page is public
    await expect(page).toHaveURL(/\/book/)
    await expect(page.getByText('Book a Collection')).toBeVisible()
  })
})
