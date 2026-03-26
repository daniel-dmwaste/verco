'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E }

export async function sendOtp(email: string): Promise<Result<void>> {
  if (!email || typeof email !== 'string') {
    return { ok: false, error: 'Email is required.' }
  }

  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id')

  if (!clientId) {
    return { ok: false, error: 'Unable to resolve tenant.' }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: {
        client_id: clientId,
      },
    },
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, data: undefined }
}
