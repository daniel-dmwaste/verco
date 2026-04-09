import { describe, it, expect } from 'vitest'
import { renderEmailLayout } from '@/lib/notifications/templates/_layout'
import {
  mockClientFull,
  mockClientMinimal,
  mockClientUnprefixedColour,
} from '../fixtures'

const baseParams = {
  preheader: 'Preview text here',
  heading: 'Hello there',
  bodyHtml: '<p>Body content</p>',
}

describe('renderEmailLayout', () => {
  it('renders the tenant logo image when logo_light_url is set', () => {
    const html = renderEmailLayout({ client: mockClientFull, ...baseParams })
    expect(html).toContain(`src="${mockClientFull.logo_light_url}"`)
    expect(html).toContain(`alt="${mockClientFull.name}"`)
  })

  it('falls back to the tenant name as text when logo_light_url is null', () => {
    const html = renderEmailLayout({ client: mockClientMinimal, ...baseParams })
    expect(html).not.toContain('<img')
    expect(html).toContain('>Bare Council<')
  })

  it('applies the tenant primary_colour to the CTA button and heading', () => {
    const html = renderEmailLayout({
      client: mockClientFull,
      ...baseParams,
      ctaText: 'Continue',
      ctaUrl: 'https://example.test/action',
    })
    expect(html).toContain('#0055AA')
    // Both heading and CTA button should pick up the brand colour
    const brandOccurrences = html.split('#0055AA').length - 1
    expect(brandOccurrences).toBeGreaterThanOrEqual(2)
  })

  it('defaults to #293F52 primary colour when primary_colour is null', () => {
    const html = renderEmailLayout({ client: mockClientMinimal, ...baseParams })
    expect(html).toContain('#293F52')
  })

  it('normalises hex colours missing the # prefix', () => {
    const html = renderEmailLayout({
      client: mockClientUnprefixedColour,
      ...baseParams,
    })
    expect(html).toContain('#00E47C')
    expect(html).not.toContain('color:00E47C')
  })

  it('uses the tenant email_footer_html verbatim when set', () => {
    const html = renderEmailLayout({ client: mockClientFull, ...baseParams })
    expect(html).toContain('City of Mock — reply to info@mock.wa.gov.au')
  })

  it('falls back to a default footer when email_footer_html is null', () => {
    const html = renderEmailLayout({ client: mockClientMinimal, ...baseParams })
    expect(html).toContain('You received this email because you booked')
  })

  it('caps the container at 600px with a mobile-safe media query', () => {
    const html = renderEmailLayout({ client: mockClientFull, ...baseParams })
    expect(html).toContain('width:600px')
    expect(html).toContain('max-width:600px')
    expect(html).toContain('@media (max-width: 600px)')
    // Viewport meta is required for mobile safety
    expect(html).toContain('name="viewport"')
  })
})
