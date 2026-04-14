import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/supabase/types'

type AppRole = Database['public']['Enums']['app_role']

const ADMIN_ROLES: AppRole[] = [
  'client-admin',
  'client-staff',
  'contractor-admin',
  'contractor-staff',
]

const FIELD_ROLES: AppRole[] = ['field', 'ranger']

export async function proxy(request: NextRequest) {
  // Healthcheck bypass: Docker HEALTHCHECK hits /api/health from the container's
  // internal network, so there is no tenant-resolving hostname to match. Skip
  // the tenant lookup, auth refresh, and route guard so the probe stays cheap
  // and immune to tenant-config drift.
  if (request.nextUrl.pathname === '/api/health') {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // --- 1. Resolve tenant from hostname ---
  const hostname = request.headers.get('host') ?? ''
  console.log(`[proxy] hostname="${hostname}" NODE_ENV="${process.env.NODE_ENV}"`)


  // Local dev bypass: use first active client when running on localhost
  const isLocalDev =
    process.env.NODE_ENV === 'development' &&
    (hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1'))

  const { data: client } = isLocalDev
    ? await supabase
        .from('client')
        .select('id, slug, contractor_id')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()
    : await supabase
        .from('client')
        .select('id, slug, contractor_id')
        .or(`slug.eq.${hostname.split('.')[0]},custom_domain.eq.${hostname}`)
        .eq('is_active', true)
        .single()

  console.log(`[proxy] tenant resolution: isLocalDev=${isLocalDev} client=${client ? client.slug : 'null'}`)

  if (!client) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // --- 2. Refresh Supabase auth session ---
  const { data: { user } } = await supabase.auth.getUser()

  // --- 3. Route guards ---
  const path = request.nextUrl.pathname

  if (path.startsWith('/admin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth', request.url))
    }

    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!userRole || !ADMIN_ROLES.includes(userRole.role)) {
      return NextResponse.redirect(new URL('/auth', request.url))
    }
  } else if (path.startsWith('/field')) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth', request.url))
    }

    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!userRole || !FIELD_ROLES.includes(userRole.role)) {
      return NextResponse.redirect(new URL('/auth', request.url))
    }
  } else if (path.startsWith('/dashboard') || path.startsWith('/booking')) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth', request.url))
    }
  }
  // /book/* and /survey/* are public — no guard

  // --- 4. Forward tenant info as request headers for server components/actions ---
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-client-id', client.id)
  requestHeaders.set('x-client-slug', client.slug)
  requestHeaders.set('x-contractor-id', client.contractor_id)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // Transfer supabase auth cookies to the final response
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie)
  })

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
