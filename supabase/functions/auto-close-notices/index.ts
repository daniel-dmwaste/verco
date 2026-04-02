import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'

// Service-role only — triggered by pg_cron daily.
// Closes NCN and NP notices that have been in 'Issued' status for 14+ days
// with no resident dispute.

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 14)
  const cutoff = cutoffDate.toISOString()

  try {
    // Close NCN notices older than 14 days in 'Issued' status
    const { data: ncnClosed, error: ncnError } = await supabase
      .from('non_conformance_notice')
      .update({
        status: 'Closed',
        resolved_at: new Date().toISOString(),
        resolution_notes: 'Auto-closed — no dispute within 14 days',
      })
      .eq('status', 'Issued')
      .lt('reported_at', cutoff)
      .select('id')

    if (ncnError) {
      console.error('NCN auto-close error:', ncnError.message)
    }

    // Close NP notices older than 14 days in 'Issued' status
    const { data: npClosed, error: npError } = await supabase
      .from('nothing_presented')
      .update({
        status: 'Closed',
        resolved_at: new Date().toISOString(),
        resolution_notes: 'Auto-closed — no dispute within 14 days',
      })
      .eq('status', 'Issued')
      .lt('reported_at', cutoff)
      .select('id')

    if (npError) {
      console.error('NP auto-close error:', npError.message)
    }

    const ncnCount = ncnClosed?.length ?? 0
    const npCount = npClosed?.length ?? 0

    console.log(`Auto-close complete: ${ncnCount} NCN, ${npCount} NP`)

    return new Response(
      JSON.stringify({
        ok: true,
        ncn_closed: ncnCount,
        np_closed: npCount,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    console.error('Auto-close error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
})
