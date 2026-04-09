/**
 * Shared test fixtures for the notifications module.
 *
 * Phase 0: minimal — just enough for `_layout.test.ts` to cover branding
 * variations. Phase 1 (VER-119) will extend these with booking, contact,
 * and mocked Supabase / sendEmail factories as the dispatcher lands.
 */

import type { ClientBranding } from '@/lib/notifications/templates/types'

/**
 * Fully branded tenant — logo, primary colour, custom footer.
 * Use this when verifying the template renders all branding slots.
 */
export const mockClientFull: ClientBranding & { id: string } = {
  id: 'client-fixture-full',
  name: 'City of Mock',
  logo_light_url: 'https://cdn.example.com/mock-logo.png',
  primary_colour: '#0055AA',
  email_footer_html:
    '<p style="margin:0;color:#666;font-size:11px">City of Mock — reply to info@mock.wa.gov.au</p>',
}

/**
 * Unbranded fallback tenant — null logo, null colour, null footer.
 * Use this when verifying the template falls back to defaults cleanly.
 */
export const mockClientMinimal: ClientBranding & { id: string } = {
  id: 'client-fixture-minimal',
  name: 'Bare Council',
  logo_light_url: null,
  primary_colour: null,
  email_footer_html: null,
}

/**
 * Tenant with an un-prefixed hex colour — used to verify the `normaliseHex`
 * helper prepends the `#`.
 */
export const mockClientUnprefixedColour: ClientBranding & { id: string } = {
  id: 'client-fixture-unprefixed',
  name: 'Loose Colour Council',
  logo_light_url: null,
  primary_colour: '00E47C',
  email_footer_html: null,
}
