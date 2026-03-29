import { test, expect, type Page, type Route } from '@playwright/test'

// ── Test data ────────────────────────────────────────────

const TEST_PROPERTY = {
  id: '11111111-1111-1111-1111-111111111111',
  collection_area_id: '22222222-2222-2222-2222-222222222222',
  address: '23 Leda Blvd',
  formatted_address: '23 Leda Blvd, Wellard WA 6170',
  has_geocode: false,
  latitude: null,
  longitude: null,
}

const TEST_FY = { id: 'fy-2025-26', label: '2025-26', is_current: true }

const TEST_SERVICES = [
  { id: 'svc-general', name: 'General Waste', category: { name: 'Bulk Collection', code: 'bulk' } },
  { id: 'svc-green', name: 'Green Waste', category: { name: 'Bulk Collection', code: 'bulk' } },
  { id: 'svc-mattress', name: 'Mattress', category: { name: 'Ancillary', code: 'anc' } },
]

const TEST_ALLOCATION_RULES = [
  { max_collections: 3, category: { name: 'Bulk Collection', code: 'bulk' } },
  { max_collections: 2, category: { name: 'Ancillary', code: 'anc' } },
]

const TEST_SERVICE_RULES = [
  { service_id: 'svc-general', max_collections: 3, extra_unit_price: 50 },
  { service_id: 'svc-green', max_collections: 3, extra_unit_price: 40 },
  { service_id: 'svc-mattress', max_collections: 2, extra_unit_price: 60 },
]

const TEST_COLLECTION_DATE = {
  id: 'cd-1',
  date: '2026-04-15',
  is_open: true,
  for_mud: false,
  bulk_is_closed: false,
  anc_is_closed: false,
  bulk_units_booked: 5,
  bulk_capacity_limit: 100,
  anc_units_booked: 2,
  anc_capacity_limit: 50,
  collection_area_id: TEST_PROPERTY.collection_area_id,
}

// ── Helpers ──────────────────────────────────────────────

/** Set up network interceptors for Supabase REST and Edge Functions */
async function setupMocks(page: Page, options?: {
  priorUsage?: Array<{ service_id: string; no_services: number }>
  createBookingResult?: Record<string, unknown>
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'

  // Intercept Supabase REST API calls
  await page.route(`${supabaseUrl}/rest/v1/**`, async (route: Route) => {
    const url = route.request().url()

    // eligible_properties
    if (url.includes('eligible_properties')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([TEST_PROPERTY]),
      })
    }

    // financial_year
    if (url.includes('financial_year')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TEST_FY),
        headers: { 'Content-Profile': 'public', 'Content-Range': '0-0/1' },
      })
    }

    // allocation_rules
    if (url.includes('allocation_rules')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TEST_ALLOCATION_RULES),
      })
    }

    // service_rules
    if (url.includes('service_rules')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TEST_SERVICE_RULES),
      })
    }

    // service (without _rules)
    if (url.includes('/service?') || url.includes('/service&')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TEST_SERVICES),
      })
    }

    // booking_item (usage)
    if (url.includes('booking_item')) {
      const usageData = (options?.priorUsage ?? []).map((u) => ({
        ...u,
        service: TEST_SERVICES.find((s) => s.id === u.service_id) ?? TEST_SERVICES[0],
        booking: { property_id: TEST_PROPERTY.id, fy_id: TEST_FY.id, status: 'Submitted' },
      }))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(usageData),
      })
    }

    // collection_date
    if (url.includes('collection_date')) {
      // Single fetch vs. list
      if (url.includes(`id=eq.${TEST_COLLECTION_DATE.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ date: TEST_COLLECTION_DATE.date }),
          headers: { 'Content-Range': '0-0/1' },
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([TEST_COLLECTION_DATE]),
      })
    }

    // booking (history)
    if (url.includes('/booking?') || url.includes('/booking&')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    }

    // profiles
    if (url.includes('profiles')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ contact_id: null }),
        headers: { 'Content-Range': '0-0/1' },
      })
    }

    // contacts
    if (url.includes('contacts')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(null),
      })
    }

    // Default passthrough
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Intercept Supabase Auth API
  await page.route(`${supabaseUrl}/auth/v1/**`, async (route: Route) => {
    const url = route.request().url()

    if (url.includes('/user')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: null }),
      })
    }

    if (url.includes('/otp') || url.includes('/token')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh',
          user: { id: 'user-1', email: 'jane@example.com' },
        }),
      })
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  // Intercept Edge Functions
  await page.route(`${supabaseUrl}/functions/v1/create-booking`, async (route: Route) => {
    const result = options?.createBookingResult ?? {
      booking_id: 'booking-1',
      ref: 'KWN-1-A7K9M2',
      requires_payment: false,
      total_cents: 0,
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })

  await page.route(`${supabaseUrl}/functions/v1/create-checkout`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ checkout_url: 'https://checkout.stripe.com/mock-session' }),
    })
  })

  // Google Places proxy
  await page.route(`${supabaseUrl}/functions/v1/google-places-proxy**`, async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        predictions: [
          {
            place_id: 'place-1',
            description: '23 Leda Blvd, Wellard WA 6170',
          },
        ],
      }),
    })
  })
}

// ── Tests ────────────────────────────────────────────────

test.describe('Booking Flow', () => {
  test('free booking — full wizard flow', async ({ page }) => {
    await setupMocks(page)

    // Step 1: Address
    await page.goto('/book')
    await expect(page.getByText('Book a Collection')).toBeVisible()

    // Type address and select from autocomplete
    const addressInput = page.getByPlaceholder('Start typing your address...')
    await addressInput.fill('23 Leda')
    // Wait for autocomplete suggestion and click it
    await page.getByText('23 Leda Blvd, Wellard WA 6170').click()

    // Wait for property found banner
    await expect(page.getByText('Property found!')).toBeVisible()

    // Click continue
    await page.getByRole('button', { name: /Book New Collection/ }).click()

    // Step 2: Services
    await expect(page).toHaveURL(/\/book\/services/)
    await expect(page.getByText('Select Services')).toBeVisible()

    // Increment General Waste to 1
    const incrementButtons = page.locator('button:has-text("+")').first()
    await incrementButtons.click()

    // Click Next Step
    await page.getByRole('button', { name: /Next Step/ }).click()

    // Step 3: Date
    await expect(page).toHaveURL(/\/book\/date/)

    // Select the first available date
    const dateButton = page.getByText(/spots/).first()
    await dateButton.click()

    await page.getByRole('button', { name: /Next Step/ }).click()

    // Step 4: Details
    await expect(page).toHaveURL(/\/book\/details/)

    // Front Verge should be default, just click Next
    await page.getByRole('button', { name: /Next Step/ }).click()

    // Step 5: Confirm
    await expect(page).toHaveURL(/\/book\/confirm/)
    await expect(page.getByText('Confirm Your Booking')).toBeVisible()

    // Fill contact details
    await page.getByPlaceholder('Full name').fill('Jane Smith')
    await page.getByPlaceholder('Email address').fill('jane@example.com')
    await page.getByPlaceholder(/Mobile number/).fill('0412345678')

    // Verify total shows "Free"
    await expect(page.getByText('Free')).toBeVisible()

    // Verify button says "Confirm Booking"
    const confirmButton = page.getByRole('button', { name: 'Confirm Booking' })
    await expect(confirmButton).toBeVisible()

    // Submit
    await confirmButton.click()

    // OTP step should appear for guest
    await expect(page.getByText('Verify Email')).toBeVisible()

    // Enter OTP digits
    const otpCells = page.locator('input[inputmode="numeric"]')
    for (let i = 0; i < 6; i++) {
      await otpCells.nth(i).fill(String(i + 1))
    }

    // Should auto-verify and redirect to booking detail
    await expect(page).toHaveURL(/\/booking\/KWN-1-A7K9M2/, { timeout: 10000 })
  })

  test('paid booking — shows payment button and calls create-checkout', async ({ page }) => {
    let createBookingCalled = false
    let createCheckoutCalled = false

    await setupMocks(page, {
      createBookingResult: {
        booking_id: 'booking-2',
        ref: 'KWN-1-B8L0N3',
        requires_payment: true,
        total_cents: 5000,
      },
    })

    // Track Edge Function calls
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'
    page.on('request', (req) => {
      if (req.url().includes('create-booking')) createBookingCalled = true
      if (req.url().includes('create-checkout')) createCheckoutCalled = true
    })

    // Navigate directly to confirm step with paid total
    const params = new URLSearchParams({
      property_id: TEST_PROPERTY.id,
      collection_area_id: TEST_PROPERTY.collection_area_id,
      address: TEST_PROPERTY.formatted_address,
      items: 'svc-general:4',
      total_cents: '5000',
      collection_date_id: TEST_COLLECTION_DATE.id,
      location: 'Front Verge',
    })
    await page.goto(`/book/confirm?${params.toString()}`)

    await expect(page.getByText('Confirm Your Booking')).toBeVisible()

    // Fill contact
    await page.getByPlaceholder('Full name').fill('Jane Smith')
    await page.getByPlaceholder('Email address').fill('jane@example.com')
    await page.getByPlaceholder(/Mobile number/).fill('0412345678')

    // Verify total shows $50.00
    await expect(page.getByText('$50.00')).toBeVisible()

    // Verify button says "Proceed to Payment"
    const payButton = page.getByRole('button', { name: 'Proceed to Payment' })
    await expect(payButton).toBeVisible()
    await payButton.click()

    // OTP step
    await expect(page.getByText('Verify Email')).toBeVisible()
    const otpCells = page.locator('input[inputmode="numeric"]')
    for (let i = 0; i < 6; i++) {
      await otpCells.nth(i).fill(String(i + 1))
    }

    // Wait for the Stripe redirect (intercepted)
    await page.waitForTimeout(2000)
    expect(createBookingCalled).toBe(true)
    expect(createCheckoutCalled).toBe(true)
  })
})
