import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { corsHeaders, jsonResponse, optionsResponse, errorResponse } from '../_shared/cors.ts'

// ── Input validation ─────────────────────────────────────────────────────────

const ContactInput = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().max(320),
  mobile_e164: z.string().regex(/^\+614\d{8}$/).optional(),
})

const CreateTicketRequest = z.object({
  subject: z.string().min(5).max(150),
  category: z.enum(['general', 'booking', 'billing', 'service', 'complaint', 'other']),
  message: z.string().min(20).max(2000),
  booking_id: z.string().uuid().optional(),
  client_id: z.string().uuid(),
  contact: ContactInput,
})

// ── Display ID generation ────────────────────────────────────────────────────

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function generateDisplayId(): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)]
  }
  return `TKT-${code}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return optionsResponse()
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return errorResponse('Unauthorized', 401)
  }

  // Service-role client for writes (contact upsert + ticket insert)
  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // ── 1. Parse + validate input ──────────────────────────────────────────

    const body = await req.json()

    // Back-compat shim — see create-booking for context. Remove once main
    // is on the first_name+last_name shape.
    if (body?.contact?.full_name && !body.contact.first_name) {
      const trimmed = String(body.contact.full_name).trim()
      const idx = trimmed.indexOf(' ')
      body.contact.first_name = idx === -1 ? trimmed : trimmed.slice(0, idx)
      body.contact.last_name = idx === -1 ? '-' : (trimmed.slice(idx + 1).trim() || '-')
      delete body.contact.full_name
    }

    const parsed = CreateTicketRequest.safeParse(body)

    if (!parsed.success) {
      return errorResponse(parsed.error.message, 400)
    }

    const { subject, category, message, booking_id, client_id, contact } = parsed.data

    // ── 2. Verify client exists ────────────────────────────────────────────

    const { data: clientRow, error: clientError } = await supabaseService
      .from('client')
      .select('id')
      .eq('id', client_id)
      .single()

    if (clientError || !clientRow) {
      return errorResponse('Client not found', 404)
    }

    // ── 3. Verify booking if provided ──────────────────────────────────────

    if (booking_id) {
      const { data: bookingRow, error: bookingError } = await supabaseService
        .from('booking')
        .select('id')
        .eq('id', booking_id)
        .single()

      if (bookingError || !bookingRow) {
        return errorResponse('Booking not found', 404)
      }
    }

    // ── 4. Upsert contact (by email) ───────────────────────────────────────

    const { data: existingContact } = await supabaseService
      .from('contacts')
      .select('id')
      .eq('email', contact.email)
      .maybeSingle()

    let contactId: string

    if (existingContact) {
      // full_name is a generated column — must write first/last_name.
      const updateData: Record<string, string> = {
        first_name: contact.first_name,
        last_name: contact.last_name,
      }
      if (contact.mobile_e164) {
        updateData.mobile_e164 = contact.mobile_e164
      }

      const { error: updateError } = await supabaseService
        .from('contacts')
        .update(updateData)
        .eq('id', existingContact.id)

      if (updateError) {
        console.error('Contact update error:', updateError)
        return errorResponse('Failed to update contact', 500)
      }

      contactId = existingContact.id
    } else {
      const insertData: Record<string, string> = {
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
      }
      if (contact.mobile_e164) {
        insertData.mobile_e164 = contact.mobile_e164
      }

      const { data: newContact, error: insertError } = await supabaseService
        .from('contacts')
        .insert(insertData)
        .select('id')
        .single()

      if (insertError || !newContact) {
        console.error('Contact insert error:', insertError)
        return errorResponse('Failed to create contact', 500)
      }

      contactId = newContact.id
    }

    // ── 5. Generate display_id with collision retry ────────────────────────

    let displayId = ''
    const MAX_RETRIES = 5

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const candidate = generateDisplayId()
      const { data: collision } = await supabaseService
        .from('service_ticket')
        .select('id')
        .eq('display_id', candidate)
        .maybeSingle()

      if (!collision) {
        displayId = candidate
        break
      }
    }

    if (!displayId) {
      return errorResponse('Failed to generate unique ticket ID', 500)
    }

    // ── 6. Insert service_ticket ───────────────────────────────────────────

    const { data: ticketRow, error: ticketError } = await supabaseService
      .from('service_ticket')
      .insert({
        display_id: displayId,
        client_id,
        booking_id: booking_id ?? null,
        contact_id: contactId,
        subject,
        message,
        status: 'open',
        priority: 'normal',
        category,
        channel: 'portal',
      })
      .select('id')
      .single()

    if (ticketError || !ticketRow) {
      console.error('Ticket insert error:', ticketError)
      return errorResponse(`Failed to create ticket: ${ticketError?.message ?? 'unknown'}`, 500)
    }

    // Audit logging handled by audit_trigger on service_ticket table

    // ── 7. Return result ───────────────────────────────────────────────────

    return jsonResponse({ display_id: displayId })
  } catch (err) {
    console.error('create-ticket error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
