'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { BookingStepper } from '@/components/booking/booking-stepper'
import { decodeItems } from '@/lib/booking/search-params'
import {
  ContactSchema,
  type ContactFormData,
  formatAuMobileDisplay,
  normaliseAuMobile,
} from '@/lib/booking/schemas'

export function ConfirmForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const propertyId = searchParams.get('property_id') ?? ''
  const collectionAreaId = searchParams.get('collection_area_id') ?? ''
  const address = searchParams.get('address') ?? ''
  const itemsParam = searchParams.get('items') ?? ''
  const totalCents = parseInt(searchParams.get('total_cents') ?? '0', 10)
  const collectionDateId = searchParams.get('collection_date_id') ?? ''
  const location = searchParams.get('location') ?? ''
  const notes = searchParams.get('notes') ?? ''

  const selectedItems = decodeItems(itemsParam)
  const supabase = createClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [mobileDisplay, setMobileDisplay] = useState('')

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(ContactSchema),
  })

  // Pre-fill contact fields if user is logged in
  useEffect(() => {
    async function prefill() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('contact_id')
        .eq('id', user.id)
        .single()

      if (!profile?.contact_id) return

      const { data: contact } = await supabase
        .from('contacts')
        .select('full_name, email, mobile_e164')
        .eq('id', profile.contact_id)
        .single()

      if (!contact) return

      if (contact.full_name) setValue('full_name', contact.full_name)
      if (contact.email) setValue('email', contact.email)
      if (contact.mobile_e164) {
        setValue('mobile', contact.mobile_e164)
        setMobileDisplay(formatAuMobileDisplay(contact.mobile_e164))
      }
    }

    void prefill()
  }, [supabase, setValue])

  // Handle mobile input with auto-formatting
  function handleMobileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    // Strip to digits and leading +
    const cleaned = raw.replace(/[^\d+]/g, '')

    // Try to normalise and format for display
    const e164 = normaliseAuMobile(cleaned)
    if (e164) {
      setMobileDisplay(formatAuMobileDisplay(e164))
      setValue('mobile', e164, { shouldValidate: false })
    } else {
      // Show raw input while typing, store cleaned for validation
      setMobileDisplay(raw)
      setValue('mobile', cleaned, { shouldValidate: false })
    }
  }

  // Fetch service details + collection date for display
  const { data: summaryData } = useQuery({
    queryKey: ['booking-summary', itemsParam, collectionDateId],
    enabled: selectedItems.size > 0 && !!collectionDateId,
    queryFn: async () => {
      const serviceIds = Array.from(selectedItems.keys())

      const [servicesResult, dateResult, fyResult] = await Promise.all([
        supabase
          .from('service')
          .select('id, name, category!inner(name, code)')
          .in('id', serviceIds),
        supabase
          .from('collection_date')
          .select('date')
          .eq('id', collectionDateId)
          .single(),
        supabase
          .from('financial_year')
          .select('id')
          .eq('is_current', true)
          .single(),
      ])

      // Get FY usage to determine free vs paid
      const usage = new Map<string, number>()
      if (fyResult.data) {
        const { data: items } = await supabase
          .from('booking_item')
          .select(
            'no_services, service_id, booking!inner(property_id, fy_id, status)'
          )
          .eq('booking.property_id', propertyId)
          .eq('booking.fy_id', fyResult.data.id)
          .not('booking.status', 'in', '("Cancelled","Pending Payment")')

        if (items) {
          for (const item of items) {
            usage.set(
              item.service_id,
              (usage.get(item.service_id) ?? 0) + item.no_services
            )
          }
        }
      }

      // Get service rules for pricing
      const { data: rules } = await supabase
        .from('service_rules')
        .select('service_id, max_collections, extra_unit_price')
        .eq('collection_area_id', collectionAreaId)
        .in('service_id', serviceIds)

      const rulesMap = new Map(
        (rules ?? []).map((r) => [r.service_id, r])
      )

      // Build line items with free/paid breakdown
      type ServiceWithCategory = {
        id: string
        name: string
        category: { name: string; code: string }
      }

      const included: Array<{ name: string; qty: number }> = []
      const extras: Array<{
        name: string
        qty: number
        unitPrice: number
        lineTotal: number
      }> = []

      if (servicesResult.data) {
        for (const st of servicesResult.data as unknown as ServiceWithCategory[]) {
          const qty = selectedItems.get(st.id) ?? 0
          const rule = rulesMap.get(st.id)
          const used = usage.get(st.id) ?? 0
          const maxFree = rule?.max_collections ?? 0
          const remainingFree = Math.max(0, maxFree - used)
          const freeQty = Math.min(qty, remainingFree)
          const paidQty = qty - freeQty

          if (freeQty > 0) {
            included.push({ name: st.name, qty: freeQty })
          }
          if (paidQty > 0 && rule) {
            const unitPrice = rule.extra_unit_price
            extras.push({
              name: st.name,
              qty: paidQty,
              unitPrice,
              lineTotal: paidQty * unitPrice,
            })
          }
        }
      }

      return {
        collectionDate: dateResult.data?.date ?? '',
        included,
        extras,
      }
    },
  })

  async function onSubmit(contact: ContactFormData) {
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const items = Array.from(selectedItems.entries()).map(
        ([service_id, no_services]) => ({
          service_id,
          no_services,
        })
      )

      const { data, error } = await supabase.functions.invoke(
        'create-booking',
        {
          body: {
            property_id: propertyId,
            collection_area_id: collectionAreaId,
            collection_date_id: collectionDateId,
            location,
            notes: notes || undefined,
            contact: {
              full_name: contact.full_name,
              email: contact.email,
              mobile_e164: contact.mobile,
            },
            items,
          },
        }
      )

      if (error) {
        setSubmitError(error.message)
        setIsSubmitting(false)
        return
      }

      const result = data as {
        booking_id: string
        ref: string
        requires_payment: boolean
      }

      if (result.requires_payment) {
        // Call create-checkout to get the Stripe Checkout Session URL
        const origin = window.location.origin
        const { data: checkoutData, error: checkoutError } =
          await supabase.functions.invoke('create-checkout', {
            body: {
              booking_id: result.booking_id,
              success_url: `${origin}/booking/${result.ref}?success=true`,
              cancel_url: `${origin}/booking/${result.ref}?cancelled=true`,
            },
          })

        if (checkoutError || !checkoutData?.checkout_url) {
          setSubmitError(
            checkoutError?.message ?? 'Failed to create payment session'
          )
          setIsSubmitting(false)
          return
        }

        window.location.href = checkoutData.checkout_url
      } else {
        router.push(`/booking/${result.ref}?success=true`)
      }
    } catch {
      setSubmitError('An unexpected error occurred. Please try again.')
      setIsSubmitting(false)
    }
  }

  function handleBack() {
    const params = new URLSearchParams({
      property_id: propertyId,
      collection_area_id: collectionAreaId,
      address,
      items: itemsParam,
      total_cents: totalCents.toString(),
      collection_date_id: collectionDateId,
    })
    router.push(`/book/details?${params.toString()}`)
  }

  const collectionDateFormatted = summaryData?.collectionDate
    ? format(
        new Date(summaryData.collectionDate + 'T00:00:00'),
        'EEEE, d MMMM yyyy'
      )
    : ''

  return (
    <div className="flex flex-col">
      <BookingStepper currentStep={5} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-24 pt-6">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-bold leading-tight text-[#293F52]">
            Confirm Your Booking
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
            Review your booking details and provide contact information.
          </p>
        </div>

        {/* Contact Information */}
        <form
          id="confirm-form"
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-xl bg-white p-6 shadow-sm"
        >
          <h2 className="mb-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]">
            Contact Information
          </h2>
          <div className="flex flex-col gap-2.5">
            <div>
              <input
                type="text"
                placeholder="Full name"
                {...register('full_name')}
                className="w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-[#293F52] focus:bg-white"
              />
              {errors.full_name && (
                <p className="mt-1 text-[11px] text-red-500">
                  {errors.full_name.message}
                </p>
              )}
            </div>
            <div>
              <input
                type="email"
                placeholder="Email address"
                {...register('email')}
                className="w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-[#293F52] focus:bg-white"
              />
              {errors.email && (
                <p className="mt-1 text-[11px] text-red-500">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div>
              <input
                type="tel"
                placeholder="Mobile number (e.g. 0412 345 678)"
                value={mobileDisplay}
                onChange={handleMobileChange}
                className="w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-[#293F52] focus:bg-white"
              />
              {/* Hidden field for react-hook-form */}
              <input type="hidden" {...register('mobile')} />
              {errors.mobile && (
                <p className="mt-1 text-[11px] text-red-500">
                  {errors.mobile.message}
                </p>
              )}
            </div>
          </div>
        </form>

        {/* Booking Summary */}
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]">
            Booking Summary
          </h2>
          <div className="flex flex-col">
            <div className="flex border-b border-gray-100 py-3">
              <span className="w-[90px] shrink-0 text-xs font-medium text-gray-500">
                Address
              </span>
              <span className="text-[13px] text-gray-900">{address}</span>
            </div>
            <div className="flex border-b border-gray-100 py-3">
              <span className="w-[90px] shrink-0 text-xs font-medium text-gray-500">
                Date
              </span>
              <span className="text-[13px] text-gray-900">
                {collectionDateFormatted}
              </span>
            </div>
            <div className="flex py-3">
              <span className="w-[90px] shrink-0 text-xs font-medium text-gray-500">
                Location
              </span>
              <span className="text-[13px] text-gray-900">{location}</span>
            </div>
          </div>
        </div>

        {/* Services breakdown */}
        {summaryData && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]">
              Services
            </h2>

            {summaryData.included.length > 0 && (
              <>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  Included in Allocation
                </div>
                {summaryData.included.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between py-1.5 text-[13px]"
                  >
                    <span className="text-gray-900">
                      {item.name} &times; {item.qty}
                    </span>
                    <span className="font-medium text-[#006A38]">
                      Included
                    </span>
                  </div>
                ))}
              </>
            )}

            {summaryData.extras.length > 0 && (
              <>
                {summaryData.included.length > 0 && (
                  <div className="my-2.5 h-px bg-gray-100" />
                )}
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  Extra Services
                </div>
                {summaryData.extras.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between py-1.5 text-[13px]"
                  >
                    <span className="text-gray-900">
                      {item.name} &times; {item.qty} @ $
                      {item.unitPrice.toFixed(2)}
                    </span>
                    <span className="font-semibold text-[#293F52]">
                      ${item.lineTotal.toFixed(2)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Total block */}
        <div className="flex items-center justify-between rounded-xl bg-[#293F52] px-5 py-4">
          <span className="font-[family-name:var(--font-heading)] text-base font-semibold text-white">
            Total
          </span>
          <span className="font-[family-name:var(--font-heading)] text-2xl font-bold text-[#00E47C]">
            {totalCents > 0
              ? `$${(totalCents / 100).toFixed(2)}`
              : 'Free'}
          </span>
        </div>

        {totalCents > 0 && (
          <p className="text-center text-[11px] text-gray-500">
            Payment will be collected via Stripe before your booking is
            confirmed.
          </p>
        )}

        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {submitError}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="sticky bottom-0 flex gap-2.5 pb-5 pt-3">
        <button
          type="button"
          onClick={handleBack}
          className="flex h-[52px] flex-1 items-center justify-center rounded-xl border-[1.5px] border-gray-100 bg-white font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52] transition-opacity hover:opacity-90"
        >
          &larr; Back
        </button>
        <button
          type="submit"
          form="confirm-form"
          disabled={isSubmitting}
          className={`flex h-[52px] flex-1 items-center justify-center rounded-xl font-[family-name:var(--font-heading)] text-[15px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${
            totalCents > 0
              ? 'bg-[#00E47C] text-[#293F52]'
              : 'bg-[#293F52] text-white'
          }`}
        >
          {isSubmitting
            ? 'Submitting...'
            : totalCents > 0
              ? 'Proceed to Payment'
              : 'Confirm Booking'}
        </button>
      </div>
    </div>
  )
}
