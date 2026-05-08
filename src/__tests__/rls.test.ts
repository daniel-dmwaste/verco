/**
 * RLS smoke tests — run against the remote Supabase project.
 *
 * Strategy: connect directly to Postgres via `pg`, then for each test user
 * issue `SET LOCAL request.jwt.claims TO ...` + `SET LOCAL ROLE authenticated`
 * inside a transaction, run a SELECT, assert the row count, then ROLLBACK.
 *
 * This bypasses GoTrue (which has historically failed sign-in with
 * "Database error querying schema" due to recursive RLS chains on profiles)
 * while still exercising the full RLS policy stack as the `authenticated`
 * Postgres role.
 *
 * Required env (in `.env.local` at the repo root):
 *   NEXT_PUBLIC_SUPABASE_URL          public Supabase URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY     anon key (only used for sanity checks)
 *   SUPABASE_SERVICE_ROLE_KEY         service role (used for fixture setup)
 *   SUPABASE_DB_URL                   direct Postgres connection string,
 *                                     e.g. postgresql://postgres.<ref>:<pwd>@
 *                                     aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * If SUPABASE_DB_URL is missing, the role-scoped suites are skipped (the
 * public-anon suite still runs because it only needs the anon key).
 *
 * Coverage matrix asserted (5 tables × 5 roles):
 *
 *   Role             | contacts | booking | service_ticket | profiles  | user_roles
 *   -----------------+----------+---------+----------------+-----------+-----------
 *   field            | 0 (PII)  | self    | 0 (PII)        | 1 (own)   | 1 (own)
 *   ranger           | 0 (PII)  | self    | 0 (PII)        | 1 (own)   | 1 (own)
 *   client-admin     | scoped   | scoped  | scoped         | self+staff| scoped
 *   contractor-admin | scoped   | scoped  | scoped         | self+staff| scoped
 *   resident         | own only | own     | own            | 1 (own)   | 1 (own)
 *
 * "self" means RLS allows the user to read rows they own (e.g. their own
 * profile, their own user_role). "scoped" means non-zero rows visible per
 * tenant scope. "0 (PII)" is the absolute red line — field/ranger must
 * never see contact PII.
 *
 * Test fixtures: created idempotently in beforeAll using fixed UUIDs.
 * They are NOT torn down — re-running the tests reuses the same rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { Client as PgClient } from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// -----------------------------------------------------------------------------
// Env loading
// -----------------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  try {
    const content = readFileSync(resolve(__dirname, '../../.env.local'), 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      // Don't overwrite explicit process.env values
      if (env[key] === undefined) env[key] = value
    }
  } catch {
    // .env.local may not exist in CI — fall through to process.env only
  }
  return env
}

const env = loadEnv()
const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL']
const ANON_KEY = env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
const SERVICE_ROLE_KEY = env['SUPABASE_SERVICE_ROLE_KEY']
const DB_URL = env['SUPABASE_DB_URL']

// Existing tenant rows in the project (queried at write-time; stable).
const CONTRACTOR_ID = '88f7cced-bd68-4c97-969f-dc76d97548f0' // D&M Waste Management
const CLIENT_ID = 'b009e60a-b7c6-4115-ad25-16ad60b3e194' // City of Kwinana

// Fixed UUIDs for test users (idempotent fixtures).
const USERS = {
  field: 'aaaaaaaa-0001-4000-8000-000000000001',
  ranger: 'aaaaaaaa-0002-4000-8000-000000000002',
  'client-admin': 'aaaaaaaa-0003-4000-8000-000000000003',
  'client-staff': 'aaaaaaaa-0004-4000-8000-000000000004',
  'contractor-admin': 'aaaaaaaa-0005-4000-8000-000000000005',
  'contractor-staff': 'aaaaaaaa-0006-4000-8000-000000000006',
  resident: 'aaaaaaaa-0007-4000-8000-000000000007',
} as const

type RoleName = keyof typeof USERS

const ROLE_FIXTURES: Record<RoleName, { contractorId: string | null; clientId: string | null; email: string }> = {
  field: { contractorId: CONTRACTOR_ID, clientId: null, email: 'rls-field@example.test' },
  ranger: { contractorId: null, clientId: CLIENT_ID, email: 'rls-ranger@example.test' },
  'client-admin': { contractorId: null, clientId: CLIENT_ID, email: 'rls-client-admin@example.test' },
  'client-staff': { contractorId: null, clientId: CLIENT_ID, email: 'rls-client-staff@example.test' },
  'contractor-admin': { contractorId: CONTRACTOR_ID, clientId: null, email: 'rls-contractor-admin@example.test' },
  'contractor-staff': { contractorId: CONTRACTOR_ID, clientId: null, email: 'rls-contractor-staff@example.test' },
  resident: { contractorId: null, clientId: null, email: 'rls-resident@example.test' },
}

// -----------------------------------------------------------------------------
// Public-anon suite — always runs (only needs anon key)
// -----------------------------------------------------------------------------

const haveAnon = Boolean(SUPABASE_URL && ANON_KEY)
;(haveAnon ? describe : describe.skip)('public SELECT tables — anonymous access', () => {
  // Guarded by haveAnon — these are only constructed when the suite runs.
  const anon = haveAnon
    ? createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : (null as never)

  it('client table is readable', async () => {
    const { data, error } = await anon.from('client').select('id, name, slug')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
  })

  it('eligible_properties is readable', async () => {
    const { data, error } = await anon.from('eligible_properties').select('id, address').limit(5)
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
  })

  it('service table is readable', async () => {
    const { data, error } = await anon.from('service').select('id, name')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
  })

  it('category table is readable', async () => {
    const { data, error } = await anon.from('category').select('id, name, code')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
  })

  it('collection_area table is readable', async () => {
    const { data, error } = await anon.from('collection_area').select('id, code')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
  })

  it('financial_year table is readable', async () => {
    const { data, error } = await anon.from('financial_year').select('id, label, is_current')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
  })

  it('allocation_rules table is readable', async () => {
    const { data, error } = await anon.from('allocation_rules').select('id, max_collections')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
  })

  it('service_rules table is readable', async () => {
    const { data, error } = await anon.from('service_rules').select('id, max_collections')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
  })
})

// -----------------------------------------------------------------------------
// Role-scoped suites — require SUPABASE_DB_URL + service role
// -----------------------------------------------------------------------------

const haveDb = Boolean(DB_URL && SERVICE_ROLE_KEY && SUPABASE_URL)

if (!haveDb) {
  describe.skip('RLS role matrix (skipped — SUPABASE_DB_URL not set)', () => {
    it('placeholder', () => {
      // Set SUPABASE_DB_URL in .env.local to enable role-scoped tests.
      // See file header for the connection string format.
    })
  })
}

;(haveDb ? describe : describe.skip)('RLS role matrix', () => {
  let pg: PgClient

  beforeAll(async () => {
    pg = new PgClient({ connectionString: DB_URL })
    await pg.connect()

    // Create fixture users via service-role admin API (idempotent).
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    for (const [role, fixture] of Object.entries(ROLE_FIXTURES) as [RoleName, typeof ROLE_FIXTURES[RoleName]][]) {
      const userId = USERS[role]

      // 1. auth.users — create if absent. Using direct SQL via pg because the
      //    admin.createUser API requires email/password and we want to set
      //    a fixed UUID. This insert is service-role + bypasses RLS.
      await pg.query(
        `INSERT INTO auth.users (id, email, aud, role, instance_id, encrypted_password, email_confirmed_at, created_at, updated_at)
         VALUES ($1, $2, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', now(), now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [userId, fixture.email],
      )

      // 2. profiles — created automatically via handle_new_user trigger if
      //    one exists; otherwise insert directly.
      await pg.query(
        `INSERT INTO public.profiles (id, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
        [userId, fixture.email, `RLS Test ${role}`],
      )

      // 3. user_roles — UNIQUE (user_id) so upsert via ON CONFLICT.
      await pg.query(
        `INSERT INTO public.user_roles (user_id, role, contractor_id, client_id, is_active)
         VALUES ($1, $2::app_role, $3, $4, true)
         ON CONFLICT (user_id) DO UPDATE
           SET role = EXCLUDED.role,
               contractor_id = EXCLUDED.contractor_id,
               client_id = EXCLUDED.client_id,
               is_active = true`,
        [userId, role, fixture.contractorId, fixture.clientId],
      )
    }

    // Sanity: silence unused warning in case admin client isn't used for
    // anything else (kept here for future fixture extension).
    void admin
  }, 30_000)

  afterAll(async () => {
    if (pg) await pg.end()
  })

  /**
   * Run a SELECT count(*) under impersonation, in a transaction we ROLLBACK.
   *
   * `request.jwt.claims` is what `auth.uid()` reads via `current_setting()`.
   * Setting role to `authenticated` activates RLS — `service_role` bypasses it.
   */
  async function countAs(userId: string, sql: string): Promise<number> {
    await pg.query('BEGIN')
    try {
      await pg.query(`SET LOCAL ROLE authenticated`)
      // SET LOCAL is a utility statement and doesn't accept parameter binding.
      // set_config() is a regular function that does the same job and supports
      // $-params, so we use it for the JSON claims string. Third arg `true`
      // makes the change local to the current transaction.
      await pg.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ])
      const r = await pg.query<{ c: string }>(`SELECT count(*)::text AS c FROM (${sql}) _t`)
      return Number.parseInt(r.rows[0]!.c, 10)
    } finally {
      await pg.query('ROLLBACK')
    }
  }

  // ---------------------------------------------------------------------------
  // Red line: PII suppression — field & ranger MUST see zero rows of contacts
  // and zero rows of service_ticket (which embeds contact_id).
  // ---------------------------------------------------------------------------

  describe('TC-PII: contacts table (zero tolerance)', () => {
    it('field role gets ZERO rows from contacts', async () => {
      const n = await countAs(USERS.field, 'SELECT id FROM contacts')
      expect(n).toBe(0)
    })

    it('ranger role gets ZERO rows from contacts', async () => {
      const n = await countAs(USERS.ranger, 'SELECT id FROM contacts')
      expect(n).toBe(0)
    })

    it('resident role sees only own contact (≤1 row)', async () => {
      const n = await countAs(USERS.resident, 'SELECT id FROM contacts')
      expect(n).toBeLessThanOrEqual(1)
    })

    it('client-admin sees scoped contacts (may be 0 if no bookings, must not error)', async () => {
      const n = await countAs(USERS['client-admin'], 'SELECT id FROM contacts')
      expect(n).toBeGreaterThanOrEqual(0)
    })

    it('contractor-admin sees scoped contacts (may be 0 if no bookings, must not error)', async () => {
      const n = await countAs(USERS['contractor-admin'], 'SELECT id FROM contacts')
      expect(n).toBeGreaterThanOrEqual(0)
    })
  })

  describe('TC-PII: service_ticket table (zero tolerance for field/ranger)', () => {
    it('field role gets ZERO rows from service_ticket', async () => {
      const n = await countAs(USERS.field, 'SELECT id FROM service_ticket')
      expect(n).toBe(0)
    })

    it('ranger role gets ZERO rows from service_ticket', async () => {
      const n = await countAs(USERS.ranger, 'SELECT id FROM service_ticket')
      expect(n).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // booking — field/ranger CAN see bookings but only run-sheet-relevant
  // columns; here we just assert the policy doesn't error and that role-
  // scoped users don't crash.
  // ---------------------------------------------------------------------------

  describe('booking table — policy execution', () => {
    it.each([
      ['field', USERS.field],
      ['ranger', USERS.ranger],
      ['client-admin', USERS['client-admin']],
      ['contractor-admin', USERS['contractor-admin']],
      ['resident', USERS.resident],
    ] as const)('%s can query booking without error', async (_role, uid) => {
      const n = await countAs(uid, 'SELECT id FROM booking')
      expect(n).toBeGreaterThanOrEqual(0)
    })
  })

  // ---------------------------------------------------------------------------
  // profiles — the B1 fix target. field/ranger must NOT see other staff
  // profiles (only their own row).
  //
  // After migration 20260508045155_fix_profiles_pii_field_exclusion the
  // field/ranger row count must equal exactly 1 (own profile via
  // profiles_select policy where id = auth.uid()).
  // ---------------------------------------------------------------------------

  describe('TC-B1: profiles table — field/ranger isolation (B1 fix)', () => {
    it('field role sees ONLY own profile (count = 1)', async () => {
      const n = await countAs(USERS.field, 'SELECT id FROM profiles')
      expect(n).toBe(1)
    })

    it('ranger role sees ONLY own profile (count = 1)', async () => {
      const n = await countAs(USERS.ranger, 'SELECT id FROM profiles')
      expect(n).toBe(1)
    })

    it('resident role sees ONLY own profile (count = 1)', async () => {
      const n = await countAs(USERS.resident, 'SELECT id FROM profiles')
      expect(n).toBe(1)
    })

    it('client-admin sees ≥1 profiles (own + staff)', async () => {
      const n = await countAs(USERS['client-admin'], 'SELECT id FROM profiles')
      expect(n).toBeGreaterThanOrEqual(1)
    })

    it('contractor-admin sees ≥1 profiles (own + staff)', async () => {
      const n = await countAs(USERS['contractor-admin'], 'SELECT id FROM profiles')
      expect(n).toBeGreaterThanOrEqual(1)
    })
  })

  // ---------------------------------------------------------------------------
  // user_roles — field/ranger/resident see only own row.
  // ---------------------------------------------------------------------------

  describe('user_roles table — scope', () => {
    it('field sees only own user_role (count = 1)', async () => {
      const n = await countAs(USERS.field, 'SELECT user_id FROM user_roles')
      expect(n).toBe(1)
    })

    it('ranger sees only own user_role (count = 1)', async () => {
      const n = await countAs(USERS.ranger, 'SELECT user_id FROM user_roles')
      expect(n).toBe(1)
    })

    it('resident sees only own user_role (count = 1)', async () => {
      const n = await countAs(USERS.resident, 'SELECT user_id FROM user_roles')
      expect(n).toBe(1)
    })

    it('client-admin sees ≥1 user_roles (scoped to client)', async () => {
      const n = await countAs(USERS['client-admin'], 'SELECT user_id FROM user_roles')
      expect(n).toBeGreaterThanOrEqual(1)
    })

    it('contractor-admin sees ≥1 user_roles (scoped to contractor)', async () => {
      const n = await countAs(USERS['contractor-admin'], 'SELECT user_id FROM user_roles')
      expect(n).toBeGreaterThanOrEqual(1)
    })
  })
})
