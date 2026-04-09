import { describe, it } from 'vitest'

/**
 * PII regression test — activated in Phase 1 (VER-119) when `dispatch.ts`
 * is implemented.
 *
 * ## Purpose
 *
 * Asserts that for any booking dispatched as a `field` or `ranger` user,
 * the rendered template HTML does NOT contain `contacts.full_name`,
 * `contacts.email`, or `contacts.mobile_e164` strings from the fixture.
 *
 * This is defence in depth against someone adding a contact field to a
 * field-accessible template path six months from now and silently breaking
 * the absolute PII contract from CLAUDE.md §4.
 *
 * ## Why skipped in Phase 0
 *
 * Cannot run yet because `dispatch.ts` is a throwing skeleton. When VER-119
 * implements the real dispatcher, remove the `.skip` below and wire up the
 * assertion per the tech review note on VER-118.
 *
 * ## Activation checklist (Phase 1)
 *
 * 1. Remove the `.skip` below
 * 2. Import `dispatch` from `@/lib/notifications/dispatch`
 * 3. Build a fixture booking with contact `{ full_name: 'Jane PII', email: 'jane@pii.test', mobile_e164: '+61412345678' }`
 * 4. Dispatch `{ type: 'ncn_raised', booking_id, ncn_id }` (field-triggered path)
 * 5. Assert the returned HTML contains none of the 3 PII strings
 */
describe.skip('PII leak regression — activated in VER-119 Phase 1', () => {
  it('ncn_raised template does not contain contact PII when rendered', () => {
    // TODO VER-119: implement once dispatch.ts has real logic
  })
})
