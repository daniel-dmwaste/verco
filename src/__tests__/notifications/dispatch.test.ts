import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dispatch } from '@/lib/notifications/dispatch'
import {
  createMockDispatchDeps,
  makeMockBooking,
} from './fixtures'

describe('dispatch', () => {
  // Silence the structured console.log emitted by dispatch during tests —
  // the log output itself is verified in a dedicated test below.
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  describe('idempotency', () => {
    it('short-circuits with {ok:true,skipped:true} when a sent row already exists', async () => {
      const booking = makeMockBooking({ id: 'b1' })
      const deps = createMockDispatchDeps({
        bookings: { b1: booking },
        existingLog: [
          {
            booking_id: 'b1',
            notification_type: 'booking_created',
            status: 'sent',
          },
        ],
      })

      const result = await dispatch(deps, {
        type: 'booking_created',
        booking_id: 'b1',
      })

      expect(result).toEqual({ ok: true, skipped: true })
      expect(deps.sendEmailMock).not.toHaveBeenCalled()
      expect(deps.writtenLogs).toHaveLength(0)
    })

    it('does NOT skip when a prior failed row exists for the same booking+type', async () => {
      const booking = makeMockBooking({ id: 'b2' })
      const deps = createMockDispatchDeps({
        bookings: { b2: booking },
        existingLog: [
          {
            booking_id: 'b2',
            notification_type: 'booking_created',
            status: 'failed',
          },
        ],
      })

      const result = await dispatch(deps, {
        type: 'booking_created',
        booking_id: 'b2',
      })

      expect(result.ok).toBe(true)
      expect(deps.sendEmailMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('booking-not-found short-circuit', () => {
    it('returns a clean error without writing to notification_log', async () => {
      const deps = createMockDispatchDeps({ bookings: {} })

      const result = await dispatch(deps, {
        type: 'booking_created',
        booking_id: 'does-not-exist',
      })

      expect(result.ok).toBe(false)
      if (result.ok === false) {
        expect(result.error).toContain('does-not-exist')
      }
      expect(deps.writtenLogs).toHaveLength(0)
      expect(deps.sendEmailMock).not.toHaveBeenCalled()
    })
  })

  describe('missing contact email', () => {
    it('writes a failed log row and does not call sendEmail', async () => {
      const booking = makeMockBooking({ id: 'b3', contact: null })
      const deps = createMockDispatchDeps({ bookings: { b3: booking } })

      const result = await dispatch(deps, {
        type: 'booking_created',
        booking_id: 'b3',
      })

      expect(result.ok).toBe(false)
      expect(deps.sendEmailMock).not.toHaveBeenCalled()
      expect(deps.writtenLogs).toHaveLength(1)
      expect(deps.writtenLogs[0]!.status).toBe('failed')
      expect(deps.writtenLogs[0]!.client_id).toBe(booking.client_id)
    })
  })

  describe('happy path', () => {
    it('renders template, sends email, writes sent log row, returns ok+sent', async () => {
      const booking = makeMockBooking({ id: 'b4', ref: 'VV-HAPPY' })
      const deps = createMockDispatchDeps({ bookings: { b4: booking } })

      const result = await dispatch(deps, {
        type: 'booking_created',
        booking_id: 'b4',
      })

      expect(result.ok).toBe(true)
      if (result.ok === true && 'sent' in result) {
        expect(result.sent).toBe(true)
      }
      expect(deps.sendEmailMock).toHaveBeenCalledTimes(1)
      const call = deps.sendEmailMock.mock.calls[0]![0]
      expect(call.to.email).toBe(booking.contact!.email)
      expect(call.subject).toContain('VV-HAPPY')
      expect(call.htmlBody).toContain('VV-HAPPY')
      expect(deps.writtenLogs).toHaveLength(1)
      expect(deps.writtenLogs[0]!.status).toBe('sent')
    })

    it('uses client reply_to_email and email_from_name when set', async () => {
      const booking = makeMockBooking({
        id: 'b5',
        client: {
          slug: 'kwn',
          name: 'City of Kwinana',
          logo_light_url: null,
          primary_colour: null,
          email_footer_html: null,
          reply_to_email: 'verge@kwinana.wa.gov.au',
          email_from_name: 'City of Kwinana — Verge Collection',
        },
      })
      const deps = createMockDispatchDeps({ bookings: { b5: booking } })

      await dispatch(deps, { type: 'booking_created', booking_id: 'b5' })

      const call = deps.sendEmailMock.mock.calls[0]![0]
      expect(call.from.email).toBe('verge@kwinana.wa.gov.au')
      expect(call.from.name).toBe('City of Kwinana — Verge Collection')
    })

    it('falls back to defaultFromEmail and client name when the client has no reply_to_email', async () => {
      const booking = makeMockBooking({
        id: 'b6',
        client: {
          slug: 'bare',
          name: 'Bare Council',
          logo_light_url: null,
          primary_colour: null,
          email_footer_html: null,
          reply_to_email: null,
          email_from_name: null,
        },
      })
      const deps = createMockDispatchDeps({ bookings: { b6: booking } })

      await dispatch(deps, { type: 'booking_created', booking_id: 'b6' })

      const call = deps.sendEmailMock.mock.calls[0]![0]
      expect(call.from.email).toBe('noreply@verco.test')
      expect(call.from.name).toBe('Bare Council')
    })
  })

  describe('sendEmail failure', () => {
    it('writes a failed log row and returns {ok:false,error}', async () => {
      const booking = makeMockBooking({ id: 'b7' })
      const deps = createMockDispatchDeps({
        bookings: { b7: booking },
        sendResult: { ok: false, error: 'SendGrid 502', status: 502 },
      })

      const result = await dispatch(deps, {
        type: 'booking_created',
        booking_id: 'b7',
      })

      expect(result.ok).toBe(false)
      if (result.ok === false) {
        expect(result.error).toBe('SendGrid 502')
      }
      expect(deps.writtenLogs).toHaveLength(1)
      expect(deps.writtenLogs[0]!.status).toBe('failed')
      expect(deps.writtenLogs[0]!.error_message).toBe('SendGrid 502')
    })
  })

  describe('booking_cancelled', () => {
    it('dispatches via the booking-cancelled template with the reason passed through', async () => {
      const booking = makeMockBooking({ id: 'b8' })
      const deps = createMockDispatchDeps({ bookings: { b8: booking } })

      await dispatch(deps, {
        type: 'booking_cancelled',
        booking_id: 'b8',
        reason: 'Contractor broke down',
      })

      expect(deps.sendEmailMock).toHaveBeenCalledTimes(1)
      const call = deps.sendEmailMock.mock.calls[0]![0]
      expect(call.subject).toContain('Booking cancelled')
      expect(call.htmlBody).toContain('Contractor broke down')
    })

    it('forwards refund_status to booking_cancelled template', async () => {
      const booking = makeMockBooking({ id: 'b-refund', total_charge_cents: 5500 })
      const deps = createMockDispatchDeps({ bookings: { 'b-refund': booking } })

      const result = await dispatch(deps, {
        type: 'booking_cancelled',
        booking_id: 'b-refund',
        refund_status: 'pending_review',
      })

      expect(result).toMatchObject({ ok: true, sent: true })
      // Verify the email body contains the "pending review" copy
      const emailCall = deps.sendEmailMock.mock.calls[0]?.[0] as { htmlBody: string } | undefined
      expect(emailCall?.htmlBody).toContain('reviewed by our team')
      expect(emailCall?.htmlBody).not.toContain('has been processed')
    })
  })

  describe('resume-by-log-id variant', () => {
    it('returns an error stub for the Phase 4 resume path', async () => {
      const deps = createMockDispatchDeps()
      const result = await dispatch(deps, { notification_log_id: 'log-1' })
      expect(result.ok).toBe(false)
      if (result.ok === false) {
        expect(result.error).toContain('Phase 4')
      }
    })
  })

  describe('structured logging contract', () => {
    it('emits one JSON log line per dispatch with the required fields', async () => {
      const logSpy = vi.spyOn(console, 'log')
      const booking = makeMockBooking({ id: 'b9' })
      const deps = createMockDispatchDeps({ bookings: { b9: booking } })

      await dispatch(deps, { type: 'booking_created', booking_id: 'b9' })

      expect(logSpy).toHaveBeenCalledTimes(1)
      const [line] = logSpy.mock.calls[0]!
      const parsed = JSON.parse(line as string)
      expect(parsed).toMatchObject({
        event: 'notification_dispatch',
        booking_id: 'b9',
        type: 'booking_created',
        status: 'sent',
        sendgrid_status: 202,
      })
      expect(typeof parsed.duration_ms).toBe('number')
    })
  })
})
