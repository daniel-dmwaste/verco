import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { calculatePrice } from '../_shared/pricing.ts'

/**
 * Fire-and-forget POST to the send-notification Edge Function. Returns
 * nothing — failures are logged to the Supabase console but never thrown
 * back to the caller, so the booking creation always completes.
 */
async function invokeSendNotification(payload: {
  type: 'booking_created'
  booking_id: string
}): Promise<void> {
  try {
    const url = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/send-notification`
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      console.error(
        `[notifications] send-notification returned ${res.status} for ${payload.type} ${payload.booking_id}: ${body}`
      )
    }
  } catch (err) {
    console.error(
      `[notifications] Failed to invoke send-notification for ${payload.type} ${payload.booking_id}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Input validation ─────────────────────────────────────────────────────────

const ContactInput = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().max(320),
  mobile_e164: z.string().regex(/^\+614\d{8}$/, 'Must be a valid AU mobile in E.164 format'),
})

const BookingItemInput = z.object({
  service_id: z.string().uuid(),
  no_services: z.number().int().min(1).max(10),
})

const CreateBookingRequest = z.object({
  property_id: z.string().uuid(),
  collection_area_id: z.string().uuid(),
  collection_date_id: z.string().uuid(),
  location: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
  contact: ContactInput,
  items: z.array(BookingItemInput).min(1).max(20),
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  // Anon-key client for reads (respects RLS public SELECT policies)
  const supabaseAnon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  // Service-role client for writes (booking, booking_item, contacts inserts)
  // Required because INSERT policies on these tables require auth, but guest
  // bookings are allowed from public routes with only the anon key.
  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // ── 1. Parse + validate input ────────────────────────────────────────────

    const body = await req.json()

    // Back-compat shim: prior to the contacts.full_name -> first_name+last_name
    // split, callers sent {contact: {full_name: 'Jane Smith'}}. The deployed
    // Verco app on `main` still does this until the split-contact-name PR
    // merges and Coolify redeploys. Split the legacy name server-side so
    // those callers keep working in the gap. Safe to remove once main is on
    // the new shape.
    if (body?.contact?.full_name && !body.contact.first_name) {
      const trimmed = String(body.contact.full_name).trim()
      const idx = trimmed.indexOf(' ')
      body.contact.first_name = idx === -1 ? trimmed : trimmed.slice(0, idx)
      body.contact.last_name = idx === -1 ? '-' : (trimmed.slice(idx + 1).trim() || '-')
      delete body.contact.full_name
    }

    const parsed = CreateBookingRequest.safeParse(body)

    if (!parsed.success) {
      return jsonResponse({ error: parsed.error.message }, 400)
    }

    const { property_id, collection_area_id, collection_date_id, location, notes, contact, items } = parsed.data

    // ── 2. Resolve collection area → client_id, contractor_id, area code ─────

    const { data: area, error: areaError } = await supabaseAnon
      .from('collection_area')
      .select('id, client_id, contractor_id, code')
      .eq('id', collection_area_id)
      .single()

    if (areaError || !area) {
      return jsonResponse({ error: 'Collection area not found' }, 404)
    }

    // ── 3. Verify property belongs to this collection area ───────────────────

    const { data: property, error: propError } = await supabaseAnon
      .from('eligible_properties')
      .select('id, collection_area_id')
      .eq('id', property_id)
      .single()

    if (propError || !property) {
      return jsonResponse({ error: 'Property not found' }, 404)
    }

    if (property.collection_area_id !== collection_area_id) {
      return jsonResponse({ error: 'Property does not belong to this collection area' }, 400)
    }

    // ── 4. Look up current financial year ────────────────────────────────────

    const { data: fy, error: fyError } = await supabaseAnon
      .from('financial_year')
      .select('id')
      .eq('is_current', true)
      .single()

    if (fyError || !fy) {
      return jsonResponse({ error: 'No active financial year found' }, 500)
    }

    // ── 5. Verify collection date exists and is open ─────────────────────────

    const { data: collDate, error: collDateError } = await supabaseAnon
      .from('collection_date')
      .select('id, is_open')
      .eq('id', collection_date_id)
      .single()

    if (collDateError || !collDate) {
      return jsonResponse({ error: 'Collection date not found' }, 404)
    }

    if (!collDate.is_open) {
      return jsonResponse({ error: 'Collection date is no longer open for bookings' }, 400)
    }

    // ── 6. Re-run pricing engine server-side (NEVER trust client prices) ─────

    const pricingItems = items.map((i) => ({
      service_id: i.service_id,
      quantity: i.no_services,
    }))

    const priceResult = await calculatePrice(
      supabaseAnon,
      property_id,
      collection_area_id,
      fy.id,
      pricingItems,
    )

    // ── 7. Upsert contact (by email) ────────────────────────────────────────

    const { data: existingContact } = await supabaseService
      .from('contacts')
      .select('id')
      .eq('email', contact.email)
      .maybeSingle()

    let contactId: string

    if (existingContact) {
      // Update name and mobile if they've changed.
      // full_name is a generated column — must write first/last_name.
      const { error: updateError } = await supabaseService
        .from('contacts')
        .update({
          first_name: contact.first_name,
          last_name: contact.last_name,
          mobile_e164: contact.mobile_e164,
        })
        .eq('id', existingContact.id)

      if (updateError) {
        console.error('Contact update error:', updateError)
        return jsonResponse({ error: 'Failed to update contact' }, 500)
      }

      contactId = existingContact.id
    } else {
      const { data: newContact, error: insertError } = await supabaseService
        .from('contacts')
        .insert({
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email,
          mobile_e164: contact.mobile_e164,
        })
        .select('id')
        .single()

      if (insertError || !newContact) {
        console.error('Contact insert error:', insertError)
        return jsonResponse({ error: 'Failed to create contact' }, 500)
      }

      contactId = newContact.id
    }

    // ── 8. Determine initial status ──────────────────────────────────────────

    const requiresPayment = priceResult.total_cents > 0
    const initialStatus = requiresPayment ? 'Pending Payment' : 'Submitted'

    // ── 9. Build items payload for RPC ───────────────────────────────────────
    // Split line items with both free and paid units into separate booking_item
    // rows so the detail page can display "2 Included + 1 Paid" correctly.

    const rpcItems: Array<{
      service_id: string
      no_services: number
      unit_price_cents: number
      is_extra: boolean
      category_code: string
    }> = []

    for (const li of priceResult.line_items) {
      if (li.free_units > 0) {
        rpcItems.push({
          service_id: li.service_id,
          no_services: li.free_units,
          unit_price_cents: 0,
          is_extra: false,
          category_code: li.category_code,
        })
      }
      if (li.paid_units > 0) {
        rpcItems.push({
          service_id: li.service_id,
          no_services: li.paid_units,
          unit_price_cents: li.unit_price_cents,
          is_extra: true,
          category_code: li.category_code,
        })
      }
    }

    // ── 10. Call capacity-safe RPC (advisory lock + insert) ──────────────────

    const { data: rpcResult, error: rpcError } = await supabaseService
      .rpc('create_booking_with_capacity_check', {
        p_collection_date_id: collection_date_id,
        p_property_id: property_id,
        p_contact_id: contactId,
        p_collection_area_id: collection_area_id,
        p_client_id: area.client_id,
        p_contractor_id: area.contractor_id,
        p_fy_id: fy.id,
        p_area_code: area.code,
        p_location: location,
        p_notes: notes ?? null,
        p_status: initialStatus,
        p_items: rpcItems,
      })

    if (rpcError) {
      console.error('RPC error:', rpcError)

      if (rpcError.message?.includes('Insufficient')) {
        return jsonResponse({ error: rpcError.message }, 409)
      }

      return jsonResponse({ error: `Failed to create booking: ${rpcError.message}` }, 500)
    }

    const bookingId = rpcResult.booking_id
    const ref = rpcResult.ref

    // ── 11. Fire booking_created notification (free path only) ──────────────
    // Paid bookings land in 'Pending Payment' and get notified via
    // stripe-webhook on the Pending Payment → Submitted transition.
    // Fire-and-forget — failure never breaks the booking creation.
    if (!requiresPayment) {
      void invokeSendNotification({
        type: 'booking_created',
        booking_id: bookingId,
      })
    }

    // ── 12. Return result ────────────────────────────────────────────────────

    return jsonResponse({
      booking_id: bookingId,
      ref,
      requires_payment: requiresPayment,
      total_cents: priceResult.total_cents,
    })
  } catch (err) {
    console.error('create-booking error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
