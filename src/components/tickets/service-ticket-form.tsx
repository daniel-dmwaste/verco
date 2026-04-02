'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'

const OTP_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 30

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'booking', label: 'Booking Enquiry' },
  { value: 'billing', label: 'Billing' },
  { value: 'service', label: 'Service Issue' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'other', label: 'Other' },
] as const

const TicketFormSchema = z.object({
  subject: z.string().min(5, 'Subject must be at least 5 characters').max(150),
  category: z.enum(['general', 'booking', 'billing', 'service', 'complaint', 'other']),
  message: z.string().min(20, 'Message must be at least 20 characters').max(2000),
  contact_email: z.string().email('Please enter a valid email').optional(),
  contact_name: z.string().min(1, 'Name is required').optional(),
})

type TicketFormData = z.infer<typeof TicketFormSchema>

interface ServiceTicketFormProps {
  bookingId?: string
  bookingRef?: string
  clientId: string
}

export function ServiceTicketForm({
  bookingId,
  bookingRef,
  clientId,
}: ServiceTicketFormProps) {
  const supabase = createClient()

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successDisplayId, setSuccessDisplayId] = useState<string | null>(null)

  // OTP state
  const [otpStep, setOtpStep] = useState(false)
  const [otpEmail, setOtpEmail] = useState('')
  const [otpDigits, setOtpDigits] = useState<string[]>(
    Array.from({ length: OTP_LENGTH }, () => '')
  )
  const [otpState, setOtpState] = useState<'idle' | 'verifying' | 'error'>('idle')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [isResending, setIsResending] = useState(false)
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const pendingFormRef = useRef<TicketFormData | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TicketFormData>({
    resolver: zodResolver(TicketFormSchema),
    defaultValues: {
      subject: bookingRef ? `Help with booking ${bookingRef}` : '',
      category: bookingRef ? 'booking' : 'general',
      message: '',
    },
  })

  // Check auth state on mount
  useEffect(() => {
    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      setIsAuthenticated(!!session)
    }
    void checkAuth()
  }, [supabase.auth])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  // Focus first OTP cell when shown
  useEffect(() => {
    if (otpStep) {
      otpInputRefs.current[0]?.focus()
    }
  }, [otpStep])

  // Submit the ticket (called after auth confirmed)
  const submitTicket = useCallback(
    async (formData: TicketFormData) => {
      setIsSubmitting(true)
      setSubmitError(null)

      try {
        // Get contact details from session or form
        let contactName = formData.contact_name ?? ''
        let contactEmail = formData.contact_email ?? ''

        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('contact_id, contacts(full_name, email)')
            .eq('id', user.id)
            .single()

          const contact = profile?.contacts as {
            full_name: string
            email: string
          } | null
          if (contact) {
            contactName = contact.full_name
            contactEmail = contact.email
          } else if (user.email) {
            contactEmail = user.email
          }
        }

        if (!contactEmail) {
          setSubmitError('Could not determine contact email.')
          setIsSubmitting(false)
          return
        }

        const requestBody = {
          subject: formData.subject,
          category: formData.category,
          message: formData.message,
          booking_id: bookingId,
          client_id: clientId,
          contact: {
            full_name: contactName || (contactEmail.split('@')[0] ?? ''),
            email: contactEmail,
          },
        }

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-ticket`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify(requestBody),
          }
        )

        if (!res.ok) {
          const errorBody = await res.text()
          console.error('create-ticket error:', res.status, errorBody)
          try {
            const parsed = JSON.parse(errorBody)
            setSubmitError(
              parsed.error ?? `Failed to submit enquiry (${res.status})`
            )
          } catch {
            setSubmitError(`Failed to submit enquiry (${res.status})`)
          }
          setIsSubmitting(false)
          return
        }

        const result = (await res.json()) as { display_id: string }
        setSuccessDisplayId(result.display_id)
      } catch {
        setSubmitError('An unexpected error occurred. Please try again.')
        setIsSubmitting(false)
      }
    },
    [bookingId, clientId, supabase]
  )

  // OTP verification
  const verifyOtp = useCallback(
    async (code: string) => {
      setOtpState('verifying')
      setOtpError(null)

      const { error } = await supabase.auth.verifyOtp({
        email: otpEmail,
        token: code,
        type: 'email',
      })

      if (error) {
        setOtpState('error')
        setOtpError('Invalid code. Please try again or request a new one.')
        return
      }

      setOtpStep(false)
      setIsAuthenticated(true)
      if (pendingFormRef.current) {
        void submitTicket(pendingFormRef.current)
      }
    },
    [otpEmail, supabase.auth, submitTicket]
  )

  function handleOtpDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otpDigits]
    next[index] = digit
    setOtpDigits(next)

    if (otpState === 'error') {
      setOtpState('idle')
      setOtpError(null)
    }

    if (digit && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus()
    }

    if (digit && index === OTP_LENGTH - 1) {
      const code = next.join('')
      if (code.length === OTP_LENGTH) {
        void verifyOtp(code)
      }
    }
  }

  function handleOtpKeyDown(
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus()
      const next = [...otpDigits]
      next[index - 1] = ''
      setOtpDigits(next)
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, OTP_LENGTH)
    if (!pasted) return

    const next = Array.from({ length: OTP_LENGTH }, (_, i) => pasted[i] ?? '')
    setOtpDigits(next)

    if (otpState === 'error') {
      setOtpState('idle')
      setOtpError(null)
    }

    const lastFilledIndex = Math.min(pasted.length, OTP_LENGTH) - 1
    otpInputRefs.current[lastFilledIndex]?.focus()

    if (pasted.length === OTP_LENGTH) {
      void verifyOtp(pasted)
    }
  }

  async function handleOtpResend() {
    if (resendCooldown > 0 || isResending) return
    setIsResending(true)

    const { error } = await supabase.auth.signInWithOtp({
      email: otpEmail,
      options: { shouldCreateUser: true },
    })

    setIsResending(false)
    if (!error) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ''))
      setOtpState('idle')
      setOtpError(null)
      otpInputRefs.current[0]?.focus()
    } else {
      setOtpError('Failed to resend code. Please try again.')
    }
  }

  function getOtpCellClassName(index: number): string {
    const base =
      'flex size-[52px] h-[60px] items-center justify-center rounded-[10px] border-[1.5px] text-center font-[family-name:var(--font-heading)] text-2xl font-bold outline-none transition-colors'

    if (otpState === 'error') {
      return `${base} border-red-500 bg-red-50 text-red-500`
    }
    if (otpDigits[index]) {
      return `${base} border-[var(--brand)] bg-white text-[var(--brand)]`
    }
    return `${base} border-gray-100 bg-gray-50 text-[var(--brand)] focus:border-[var(--brand)] focus:border-2 focus:bg-white`
  }

  // Form submit — check auth, trigger OTP if guest
  async function onSubmit(formData: TicketFormData) {
    setSubmitError(null)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (session) {
      void submitTicket(formData)
      return
    }

    // Guest — require email + name, then OTP
    if (!formData.contact_email) {
      setSubmitError('Please enter your email address.')
      return
    }

    pendingFormRef.current = formData
    setOtpEmail(formData.contact_email)
    setIsSubmitting(true)

    const { error } = await supabase.auth.signInWithOtp({
      email: formData.contact_email,
      options: { shouldCreateUser: true },
    })

    if (error) {
      setSubmitError('Failed to send verification code. Please try again.')
      setIsSubmitting(false)
      return
    }

    setIsSubmitting(false)
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
    setOtpStep(true)
  }

  // ── Success state ──────────────────────────────────────────────────────────

  if (successDisplayId) {
    return (
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-[var(--brand-accent-light)]">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--brand-accent-dark)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3 className="font-[family-name:var(--font-heading)] text-lg font-bold text-[var(--brand)]">
            Enquiry Submitted
          </h3>
          <p className="text-sm text-gray-500">
            Your reference number is
          </p>
          <span className="rounded-lg bg-[#E8EEF2] px-4 py-2 font-[family-name:var(--font-heading)] text-lg font-bold text-[var(--brand)]">
            {successDisplayId}
          </span>
          <p className="text-sm text-gray-500">
            We&apos;ll be in touch within 24 hours.
          </p>
        </div>
      </div>
    )
  }

  // ── Loading auth check ─────────────────────────────────────────────────────

  if (isAuthenticated === null) {
    return (
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-center py-8">
          <div className="size-6 animate-spin rounded-full border-2 border-gray-200 border-t-[var(--brand)]" />
        </div>
      </div>
    )
  }

  // ── OTP verification step ──────────────────────────────────────────────────

  if (otpStep) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div>
          <h3 className="font-[family-name:var(--font-heading)] text-xl font-bold text-[var(--brand)]">
            Verify Email
          </h3>
          <p className="mt-1.5 text-body-sm leading-relaxed text-gray-500">
            We sent a 6-digit code to
            <br />
            <strong className="text-[var(--brand)]">{otpEmail}</strong>
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex justify-center gap-2">
            {otpDigits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  otpInputRefs.current[i] = el
                }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={1}
                value={digit}
                disabled={otpState === 'verifying'}
                onChange={(e) => handleOtpDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(i, e)}
                onPaste={i === 0 ? handleOtpPaste : undefined}
                className={getOtpCellClassName(i)}
              />
            ))}
          </div>

          {otpState === 'error' && otpError && (
            <p className="flex items-center justify-center gap-1 text-[11px] text-red-500">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {otpError}
            </p>
          )}

          {otpState !== 'error' && (
            <p className="text-center text-body-sm text-gray-500">
              Enter the 6-digit code from your email
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={
            otpState === 'verifying' ||
            otpDigits.join('').length < OTP_LENGTH
          }
          onClick={() => {
            const code = otpDigits.join('')
            if (code.length === OTP_LENGTH) void verifyOtp(code)
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-body font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {otpState === 'verifying'
            ? 'Verifying...'
            : otpState === 'error'
              ? 'Try Again'
              : 'Verify Code'}
        </button>

        <div className="text-center text-body-sm text-gray-500">
          {resendCooldown > 0 ? (
            <>
              Code expires in{' '}
              <strong className="text-[var(--brand)]">
                {Math.floor(resendCooldown / 60)}:
                {(resendCooldown % 60).toString().padStart(2, '0')}
              </strong>
              {' · '}
              <span className="text-gray-300">Resend code</span>
            </>
          ) : (
            <button
              type="button"
              onClick={handleOtpResend}
              disabled={isResending}
              className="font-semibold text-[var(--brand-accent-dark)] hover:underline disabled:text-gray-300"
            >
              {isResending ? 'Sending...' : 'Request a new code'}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <h3 className="mb-4 font-[family-name:var(--font-heading)] text-subtitle font-bold text-[var(--brand)]">
        Submit an Enquiry
      </h3>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        {/* Contact fields for unauthenticated users */}
        {!isAuthenticated && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Your Name<span className="ml-0.5 text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Full name"
                {...register('contact_name')}
                className="w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-[var(--brand)] focus:bg-white"
              />
              {errors.contact_name && (
                <p className="mt-1 text-[11px] text-red-500">
                  {errors.contact_name.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Email Address<span className="ml-0.5 text-red-500">*</span>
              </label>
              <input
                type="email"
                placeholder="Email address"
                {...register('contact_email')}
                className="w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-[var(--brand)] focus:bg-white"
              />
              {errors.contact_email && (
                <p className="mt-1 text-[11px] text-red-500">
                  {errors.contact_email.message}
                </p>
              )}
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Subject<span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="Brief description of your enquiry"
            {...register('subject')}
            className="w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-[var(--brand)] focus:bg-white"
          />
          {errors.subject && (
            <p className="mt-1 text-[11px] text-red-500">
              {errors.subject.message}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Category<span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            {...register('category')}
            className="w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none focus:border-[var(--brand)] focus:bg-white"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
          {errors.category && (
            <p className="mt-1 text-[11px] text-red-500">
              {errors.category.message}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Message<span className="ml-0.5 text-red-500">*</span>
          </label>
          <textarea
            placeholder="Please describe your enquiry in detail (minimum 20 characters)"
            rows={5}
            {...register('message')}
            className="w-full resize-none rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-[var(--brand)] focus:bg-white"
          />
          {errors.message && (
            <p className="mt-1 text-[11px] text-red-500">
              {errors.message.message}
            </p>
          )}
        </div>

        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-body-sm text-red-700">
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-body font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? 'Submitting...' : 'Submit Enquiry'}
        </button>
      </form>
    </div>
  )
}
