import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { Database } from '@/lib/supabase/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface HealthOk {
  status: 'ok'
  sha: string
  time: string
}

interface HealthDegraded {
  status: 'degraded'
  sha: string
  time: string
  error: string
}

export async function GET(): Promise<NextResponse<HealthOk | HealthDegraded>> {
  const sha = process.env.NEXT_PUBLIC_GIT_SHA ?? 'unknown'
  const time = new Date().toISOString()

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  )

  const { error } = await supabase
    .from('client')
    .select('id', { head: true, count: 'exact' })
    .limit(1)

  if (error) {
    return NextResponse.json(
      { status: 'degraded', sha, time, error: error.message },
      { status: 503 }
    )
  }

  return NextResponse.json({ status: 'ok', sha, time }, { status: 200 })
}
