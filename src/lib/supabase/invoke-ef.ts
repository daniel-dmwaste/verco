/**
 * Direct fetch helper for invoking Supabase Edge Functions from Next.js.
 *
 * Per CLAUDE.md §11: `supabase.functions.invoke()` is unreliable in SSR — use
 * direct fetch with explicit URL and headers instead.
 *
 * Uses the public anon key as the Authorization bearer. Edge Functions that
 * require user-level auth (e.g. `send-notification`) should not use this
 * helper — they need the user session token. See `lib/notifications/invoke.ts`
 * for that pattern.
 *
 * Throws on non-2xx responses or network failures. Callers should catch and
 * handle as appropriate for their context.
 */
export async function invokeEdgeFunction<T>(
  name: string,
  payload: unknown
): Promise<T> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      '[invokeEdgeFunction] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set'
    )
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)')
    throw new Error(
      `[invokeEdgeFunction] ${name} returned ${res.status}: ${body}`
    )
  }

  return (await res.json()) as T
}
