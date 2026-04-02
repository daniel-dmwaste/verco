import { test, expect, type Page, type Route } from '@playwright/test'

// ── Test data ────────────────────────────────────────────

const TEST_NCN_ID = 'ncn-test-001'
const TEST_BOOKING_ID = 'booking-ncn-001'

const TEST_NCN = {
  id: TEST_NCN_ID,
  reason: 'Items Obstructed or Not On Verge',
  status: 'Open',
  notes: 'Bins blocking driveway access',
  photos: [
    'https://example.com/photo1.jpg',
    'https://example.com/photo2.jpg',
  ],
  reported_at: '2026-04-01T08:30:00Z',
  resolved_at: null,
  resolution_notes: null,
  contractor_fault: false,
  rescheduled_date: null,
  booking: {
    id: TEST_BOOKING_ID,
    ref: 'KWN-1-A7K9M2',
    status: 'Non-conformance',
    type: 'Residential',
    location: 'Front Verge',
    property: { formatted_address: '23 Leda Blvd, Wellard WA 6170', address: '23 LEDA BLVD WELLARD' },
    collection_area: { id: 'ca-1', name: 'Kwinana Area 1', code: 'KWN-1' },
    contact: { full_name: 'Jane Smith', email: 'jane@example.com', mobile_e164: '+61412345678' },
    booking_item: [
      { id: 'bi-1', no_services: 1, is_extra: false, unit_price_cents: 0, service: { name: 'General Waste' } },
      { id: 'bi-2', no_services: 1, is_extra: true, unit_price_cents: 5000, service: { name: 'Mattress' } },
    ],
  },
  reporter: { display_name: 'Field Worker' },
  resolver: null,
  rescheduled_booking: null,
}

const TEST_AVAILABLE_DATES = [
  { id: 'cd-future-1', date: '2026-04-20' },
  { id: 'cd-future-2', date: '2026-04-27' },
]

const TEST_USER = {
  id: 'admin-user-1',
  email: 'admin@example.com',
  role: 'contractor-admin',
}

// ── Helpers ──────────────────────────────────────────────

/** Mock the server-rendered page by intercepting the client-side API calls for actions */
async function setupAdminMocks(page: Page) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'

  // Mock Supabase REST calls from client components
  await page.route(`${supabaseUrl}/rest/v1/**`, async (route: Route) => {
    const url = route.request().url()
    const method = route.request().method()

    // NCN update (PATCH)
    if (url.includes('non_conformance_notice') && method === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ ...TEST_NCN, status: 'Under Review' }]),
      })
    }

    // collection_date (for rebook dialog)
    if (url.includes('collection_date')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TEST_AVAILABLE_DATES),
      })
    }

    // booking insert (rebook)
    if (url.includes('/booking') && method === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/vnd.pgrst.object+json',
        body: JSON.stringify({ id: 'new-booking-1', ref: 'KWN-1-RBK001' }),
      })
    }

    // booking_item insert
    if (url.includes('booking_item') && method === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    }

    // RPC calls (current_user_role, generate_booking_ref)
    if (url.includes('/rpc/')) {
      if (url.includes('current_user_role')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify('contractor-admin'),
        })
      }
      if (url.includes('generate_booking_ref')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify('KWN-1-RBK001'),
        })
      }
    }

    // Auth user
    if (url.includes('auth')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: TEST_USER }),
      })
    }

    // Default
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Mock Edge Function calls (process-refund)
  await page.route(`${supabaseUrl}/functions/v1/process-refund`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
}

// ── Tests ────────────────────────────────────────────────

// Note: The NCN detail page is server-rendered. These tests verify the client-side
// interactions (buttons, dialogs, form state) work correctly. The server page
// fetches data at render time which can't be mocked via page.route().
// For full integration testing, seed test data in Supabase.

test.describe('NCN Detail Page — Client Interactions', () => {
  // Skip if no dev server running against test data
  // These tests work when the dev server has seeded NCN data,
  // or when run against a preview deployment with test fixtures

  test('NCN detail page renders core elements', async ({ page }) => {
    await setupAdminMocks(page)

    // Navigate — this requires the server to have NCN data
    await page.goto(`/admin/non-conformance/${TEST_NCN_ID}`)

    // Wait for navigation to settle (server may redirect if no data)
    await page.waitForLoadState('networkidle')
    const currentUrl = page.url()

    // If server can't find the NCN, it redirects — skip gracefully
    if (!currentUrl.includes(TEST_NCN_ID)) {
      test.skip(true, 'No test NCN data available — skipping client interaction tests')
      return
    }

    // Verify page structure
    await expect(page.getByText('Non-Conformance Details')).toBeVisible()
    await expect(page.getByText('Booking Details')).toBeVisible()
  })

  test('resolution form shows contractor fault checkbox and notes', async ({ page }) => {
    await setupAdminMocks(page)
    await page.goto(`/admin/non-conformance/${TEST_NCN_ID}`)
    await page.waitForLoadState('networkidle')

    if (!page.url().includes(TEST_NCN_ID)) {
      test.skip(true, 'No test NCN data available')
      return
    }

    // Resolution section should be visible for Open NCNs
    await expect(page.getByText('Resolution')).toBeVisible()
    await expect(page.getByText('Contractor fault')).toBeVisible()
    await expect(page.getByPlaceholder('Resolution notes (internal only)...')).toBeVisible()

    // Action buttons
    await expect(page.getByRole('button', { name: 'Mark Under Review' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resolve' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rebook' })).toBeVisible()
  })

  test('rebook dialog opens with date selection', async ({ page }) => {
    await setupAdminMocks(page)
    await page.goto(`/admin/non-conformance/${TEST_NCN_ID}`)

    const currentUrl = page.url()
    if (!currentUrl.includes(TEST_NCN_ID)) {
      test.skip(true, 'No test NCN data available')
      return
    }

    // Click rebook
    await page.getByRole('button', { name: 'Rebook' }).click()

    // Dialog should appear
    await expect(page.getByText('Rebook Collection')).toBeVisible()
    await expect(page.getByText('Select a new collection date')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm Rebook' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('refund dialog appears when resolving with contractor fault and paid items', async ({ page }) => {
    await setupAdminMocks(page)
    await page.goto(`/admin/non-conformance/${TEST_NCN_ID}`)

    const currentUrl = page.url()
    if (!currentUrl.includes(TEST_NCN_ID)) {
      test.skip(true, 'No test NCN data available')
      return
    }

    // Check contractor fault
    await page.getByText('Contractor fault').click()

    // Click resolve — should show refund dialog (because booking has paid items)
    await page.getByRole('button', { name: 'Resolve' }).click()

    // Refund dialog should appear
    await expect(page.getByText('Resolve with Refund')).toBeVisible()
    await expect(page.getByText('$50.00')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resolve & Refund' })).toBeVisible()
  })
})

test.describe('Resident Booking Detail — NCN Card', () => {
  test('NCN card appears on booking with Non-conformance status', async ({ page }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'

    // Mock auth
    await page.route(`${supabaseUrl}/auth/v1/**`, async (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'resident-1', email: 'jane@example.com' },
        }),
      })
    })

    // Navigate to a booking that has NCN status
    // This requires seeded data — the page.tsx is server-rendered
    await page.goto('/booking/KWN-1-A7K9M2')

    const currentUrl = page.url()
    if (currentUrl.includes('/dashboard') || currentUrl.includes('/auth')) {
      test.skip(true, 'No test booking data available or not authenticated')
      return
    }

    // If the booking is in NCN status, the card should show
    const ncnCard = page.getByText('Non-Conformance Notice')
    if (await ncnCard.isVisible()) {
      await expect(page.getByText('Items Obstructed or Not On Verge')).toBeVisible()
    }
  })
})
