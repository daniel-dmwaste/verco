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

const DEBUG_PROXY =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROXY === '1'

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
  if (DEBUG_PROXY) {
    console.log(`[proxy] hostname="${hostname}" NODE_ENV="${process.env.NODE_ENV}"`)
  }


  // Local dev bypass: resolve tenant from LOCAL_DEV_CLIENT_SLUG env var,
  // falling back to first active client by created_at.
  const isLocalDev =
    process.env.NODE_ENV === 'development' &&
    (hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1'))

  let clientQuery = supabase
    .from('client')
    .select('id, slug, contractor_id')
    .eq('is_active', true)

  if (isLocalDev) {
    const devSlug = process.env.LOCAL_DEV_CLIENT_SLUG
    if (devSlug) {
      clientQuery = clientQuery.eq('slug', devSlug)
    } else {
      clientQuery = clientQuery.order('created_at', { ascending: true }).limit(1)
    }
  } else {
    clientQuery = clientQuery.or(
      `slug.eq.${hostname.split('.')[0]},custom_domain.eq.${hostname}`
    )
  }

  const { data: client, error: clientError } = await clientQuery.single()

  if (clientError) {
    console.error(`[proxy] tenant query failed: ${clientError.message} (code=${clientError.code})`)
  }
  if (DEBUG_PROXY) {
    console.log(`[proxy] tenant resolution: isLocalDev=${isLocalDev} client=${client ? client.slug : 'null'}`)
  }

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

    // Multi-role users (e.g. admin + field) may have multiple active rows in
    // `user_roles`. Pull all active roles and check if ANY qualifies for the
    // /admin guard — `.single()` would crash when N > 1.
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)

    const roles = userRoles?.map((r) => r.role) ?? []
    if (!roles.some((r) => ADMIN_ROLES.includes(r))) {
      return NextResponse.redirect(new URL('/auth', request.url))
    }
  } else if (path.startsWith('/field')) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth', request.url))
    }

    // Multi-role users (e.g. field + resident) may have multiple active rows
    // in `user_roles`. Pull all active roles and check if ANY qualifies for
    // the /field guard — `.single()` would crash when N > 1.
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)

    const roles = userRoles?.map((r) => r.role) ?? []
    if (!roles.some((r) => FIELD_ROLES.includes(r))) {
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
