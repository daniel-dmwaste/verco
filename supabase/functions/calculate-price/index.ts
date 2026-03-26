import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'
import { z } from 'https://esm.sh/zod@3.23.8'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BookingItemInput = z.object({
  service_id: z.string().uuid(),
  collection_date_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
})

const PriceCalculationRequest = z.object({
  property_id: z.string().uuid(),
  fy_id: z.string().uuid(),
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  try {
    const body = await req.json()
    const parsed = PriceCalculationRequest.safeParse(body)

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { property_id, fy_id, items } = parsed.data

    // 1. Get property → collection_area_id
    const { data: property, error: propError } = await supabase
      .from('eligible_properties')
      .select('collection_area_id')
      .eq('id', property_id)
      .single()

    if (propError || !property) {
      return new Response(
        JSON.stringify({ error: 'Property not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const collectionAreaId = property.collection_area_id

    // 2. Get service rules for this collection area
    const serviceIds = items.map((i) => i.service_id)
    const { data: rules } = await supabase
      .from('service_rules')
      .select('service_id, max_collections, extra_unit_price')
      .eq('collection_area_id', collectionAreaId)
      .in('service_id', serviceIds)

    const rulesMap = new Map(
      (rules ?? []).map((r) => [r.service_id, r])
    )

    // 3. Get allocation rules at category level
    const { data: allocRules } = await supabase
      .from('allocation_rules')
      .select('max_collections, category!inner(code)')
      .eq('collection_area_id', collectionAreaId)

    const categoryMaxMap = new Map<string, number>()
    if (allocRules) {
      for (const rule of allocRules) {
        const cat = rule.category as unknown as { code: string }
        categoryMaxMap.set(cat.code, rule.max_collections)
      }
    }

    // 4. Get services with their category codes
    const { data: services } = await supabase
      .from('service')
      .select('id, category!inner(code)')
      .in('id', serviceIds)

    const serviceCategoryMap = new Map<string, string>()
    if (services) {
      for (const svc of services) {
        const cat = svc.category as unknown as { code: string }
        serviceCategoryMap.set(svc.id, cat.code)
      }
    }

    // 5. Get FY usage per service for this property
    const { data: usageItems } = await supabase
      .from('booking_item')
      .select('service_id, no_services, booking!inner(property_id, fy_id, status)')
      .eq('booking.property_id', property_id)
      .eq('booking.fy_id', fy_id)
      .not('booking.status', 'in', '("Cancelled","Pending Payment")')

    // Per-service usage
    const serviceUsageMap = new Map<string, number>()
    // Per-category usage
    const categoryUsageMap = new Map<string, number>()

    if (usageItems) {
      for (const item of usageItems) {
        // Service-level
        serviceUsageMap.set(
          item.service_id,
          (serviceUsageMap.get(item.service_id) ?? 0) + item.no_services
        )
        // Category-level
        const catCode = serviceCategoryMap.get(item.service_id)
        if (catCode) {
          categoryUsageMap.set(
            catCode,
            (categoryUsageMap.get(catCode) ?? 0) + item.no_services
          )
        }
      }
    }

    // 6. Calculate per item with dual-limit check
    // Track category consumption across items in this request
    const categoryFormUsed = new Map<string, number>()

    const lineItems = items.map((item) => {
      const rule = rulesMap.get(item.service_id)
      const catCode = serviceCategoryMap.get(item.service_id) ?? ''

      // Service-level remaining
      const serviceUsed = serviceUsageMap.get(item.service_id) ?? 0
      const serviceMax = rule?.max_collections ?? 0
      const serviceRemaining = Math.max(0, serviceMax - serviceUsed)

      // Category-level remaining (minus what earlier items consumed)
      const catMax = categoryMaxMap.get(catCode) ?? 0
      const catFyUsed = categoryUsageMap.get(catCode) ?? 0
      const catAlreadyConsumedByForm = categoryFormUsed.get(catCode) ?? 0
      const categoryRemaining = Math.max(0, catMax - catFyUsed - catAlreadyConsumedByForm)

      // Dual-limit: free_units = MIN(quantity, category_remaining, service_remaining)
      const freeUnits = Math.min(item.quantity, categoryRemaining, serviceRemaining)
      const paidUnits = item.quantity - freeUnits

      // Track this item's free consumption against the category budget
      categoryFormUsed.set(catCode, catAlreadyConsumedByForm + freeUnits)

      const unitPriceCents = Math.round((rule?.extra_unit_price ?? 0) * 100)
      const lineChargeCents = paidUnits * unitPriceCents

      return {
        service_id: item.service_id,
        collection_date_id: item.collection_date_id,
        quantity: item.quantity,
        free_units: freeUnits,
        paid_units: paidUnits,
        unit_price_cents: unitPriceCents,
        line_charge_cents: lineChargeCents,
        is_extra: paidUnits > 0,
      }
    })

    const totalCents = lineItems.reduce((sum, l) => sum + l.line_charge_cents, 0)

    return new Response(
      JSON.stringify({ line_items: lineItems, total_cents: totalCents }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('calculate-price error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
