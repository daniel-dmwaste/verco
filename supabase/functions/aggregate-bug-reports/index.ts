import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0'

// Cron-only EF: clusters new bug_report rows via Claude, files one Linear
// ticket per cluster, then marks the originating rows as triaged with
// linear_issue_id/linear_issue_url populated. Service-role bearer required.

const LINEAR_TEAM_ID = 'c38e6cfa-c993-4147-993f-bd3fdbc800d2'    // VER
const LINEAR_PROJECT_ID = '1502e086-bc95-4ed1-ab4e-9e2d113c302c' // UAT Bugs
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const ANTHROPIC_VERSION = '2023-06-01'
const BATCH_LIMIT = 100

interface BugRow {
  id: string
  display_id: string
  title: string
  description: string | null
  category: string | null
  priority: string
  page_url: string | null
  browser_info: string | null
  source_app: string
  created_at: string
  reporter_role: string | null
  client_slug: string | null
}

interface ClusterOutput {
  report_ids: string[]
  title: string
  body: string
  priority: 'low' | 'medium' | 'high' | 'critical'
}

serve(async (req) => {
  const t0 = Date.now()

  // Env validation up front (CLAUDE.md §11 — fail loud)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const linearKey = Deno.env.get('LINEAR_API_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'Server misconfiguration: missing Supabase env vars' })
  }
  if (!anthropicKey || !linearKey) {
    return json(500, { error: 'Server misconfiguration: ANTHROPIC_API_KEY and LINEAR_API_KEY required' })
  }

  // Auth: service-role bearer only.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })
  const bearer = authHeader.replace(/^Bearer\s+/i, '')
  if (bearer !== serviceRoleKey) {
    return new Response('Forbidden: service-role bearer required', { status: 403 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Pull queue.
  const { data: rawBugs, error: queryError } = await supabase
    .from('bug_report')
    .select(
      `id, display_id, title, description, category, priority, page_url,
       browser_info, source_app, created_at, reporter_id, client_id`
    )
    .eq('status', 'new')
    .is('linear_issue_id', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (queryError) {
    return json(500, { error: `Queue query failed: ${queryError.message}` })
  }

  if (!rawBugs || rawBugs.length === 0) {
    console.log(`cron_run | aggregate-bug-reports | processed=0 clusters=0 latency_ms=${Date.now() - t0}`)
    return json(200, { processed: 0, clusters: 0 })
  }

  // Enrich with reporter role + tenant slug.
  const reporterIds = Array.from(new Set(rawBugs.map((b) => b.reporter_id).filter(Boolean))) as string[]
  const clientIds = Array.from(new Set(rawBugs.map((b) => b.client_id).filter(Boolean))) as string[]

  const [rolesResult, clientsResult] = await Promise.all([
    reporterIds.length > 0
      ? supabase.from('user_roles').select('user_id, role').in('user_id', reporterIds).eq('is_active', true)
      : Promise.resolve({ data: [] as Array<{ user_id: string; role: string }> }),
    clientIds.length > 0
      ? supabase.from('client').select('id, slug').in('id', clientIds)
      : Promise.resolve({ data: [] as Array<{ id: string; slug: string }> }),
  ])

  const roleByUserId = new Map<string, string>(
    (rolesResult.data ?? []).map((r) => [r.user_id, r.role])
  )
  const slugByClientId = new Map<string, string>(
    (clientsResult.data ?? []).map((c) => [c.id, c.slug])
  )

  const bugs: BugRow[] = rawBugs.map((b) => ({
    id: b.id,
    display_id: b.display_id,
    title: b.title,
    description: b.description,
    category: b.category,
    priority: b.priority,
    page_url: b.page_url,
    browser_info: b.browser_info,
    source_app: b.source_app,
    created_at: b.created_at,
    reporter_role: b.reporter_id ? roleByUserId.get(b.reporter_id) ?? null : null,
    client_slug: b.client_id ? slugByClientId.get(b.client_id) ?? null : null,
  }))

  // Cluster + author via Claude.
  const clusters = await clusterAndPropose(bugs, anthropicKey)

  // File each cluster in Linear + update bug_report rows.
  let filed = 0
  const failures: Array<{ cluster_title: string; error: string }> = []

  for (const cluster of clusters) {
    try {
      const { issueId, issueUrl } = await createLinearIssue(linearKey, cluster)
      const { error: updateError } = await supabase
        .from('bug_report')
        .update({ linear_issue_id: issueId, linear_issue_url: issueUrl, status: 'triaged' })
        .in('id', cluster.report_ids)
      if (updateError) {
        failures.push({ cluster_title: cluster.title, error: `DB update failed: ${updateError.message}` })
      } else {
        filed++
      }
    } catch (err) {
      failures.push({ cluster_title: cluster.title, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const status = failures.length > 0 ? 500 : 200
  console.log(
    `cron_run | aggregate-bug-reports | processed=${bugs.length} clusters=${clusters.length} ` +
    `filed=${filed} failed=${failures.length} latency_ms=${Date.now() - t0}`
  )

  return json(status, {
    processed: bugs.length,
    clusters: clusters.length,
    filed,
    failed: failures.length,
    failures: failures.length > 0 ? failures.slice(0, 5) : undefined,
  })
})

async function clusterAndPropose(bugs: BugRow[], anthropicKey: string): Promise<ClusterOutput[]> {
  const systemPrompt = `You triage UAT bug reports for the Verco SaaS booking platform.

You receive a list of bug reports submitted by council and admin staff during UAT. Your job:

1. Cluster reports that share a root cause (same component, same flow, same error). A single, unique report is its own cluster of size 1.
2. For each cluster, author a Linear ticket with:
   - title: concise, action-oriented (e.g. "Fix branding form silent revert", not "Branding doesn't save")
   - body: Markdown with sections:
       ## Reports
       <bulleted list of "BR-XXXX: <title>" from the cluster>

       ## Likely root cause
       <one paragraph hypothesis>

       ## Proposed fix
       <step-by-step approach, mentioning likely file paths in the Verco codebase if you can infer them from URL/category — be specific, e.g. "src/app/(admin)/admin/clients/actions.ts updateClient">

       ## Acceptance criteria
       <bulleted checklist>

   - priority: one of low|medium|high|critical, weighted by cluster size and worst priority in the cluster
3. Return ONLY a JSON object with shape: {"clusters":[{"report_ids":["uuid",...],"title":"...","body":"...","priority":"medium"}]}
4. NO commentary outside the JSON. NO markdown fence around the JSON.

Codebase hints (use when inferring files):
- Admin pages: src/app/(admin)/admin/<route>/
- Public booking: src/app/(public)/book/
- Edge Functions: supabase/functions/<name>/index.ts
- RLS policies: supabase/migrations/*.sql
- Tailwind v4, Next.js 16, Supabase, Stripe.
- Booking state machine: src/lib/booking/state-machine.ts
- Pricing: supabase/functions/_shared/pricing.ts`

  const userPrompt = JSON.stringify(bugs, null, 2)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`)
  }

  const data = await res.json() as { content: Array<{ type: string; text?: string }> }
  const text = data.content?.find((c) => c.type === 'text')?.text ?? ''

  // Strip any incidental wrapping (defensive against the model deviating).
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude response had no JSON object')

  const parsed = JSON.parse(jsonMatch[0]) as { clusters: ClusterOutput[] }
  if (!Array.isArray(parsed.clusters)) {
    throw new Error('Claude response missing clusters array')
  }

  // Sanity: filter clusters that reference unknown ids.
  const knownIds = new Set(bugs.map((b) => b.id))
  return parsed.clusters
    .map((c) => ({
      ...c,
      report_ids: c.report_ids.filter((id) => knownIds.has(id)),
    }))
    .filter((c) => c.report_ids.length > 0)
}

const PRIORITY_TO_LINEAR: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
}

async function createLinearIssue(
  linearKey: string,
  cluster: ClusterOutput,
): Promise<{ issueId: string; issueUrl: string }> {
  const mutation = `mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier url }
    }
  }`

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: linearKey,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        input: {
          teamId: LINEAR_TEAM_ID,
          projectId: LINEAR_PROJECT_ID,
          title: cluster.title,
          description: cluster.body,
          priority: PRIORITY_TO_LINEAR[cluster.priority] ?? 3,
        },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Linear API ${res.status}: ${body.slice(0, 500)}`)
  }

  const data = await res.json() as {
    data?: { issueCreate?: { success: boolean; issue?: { id: string; identifier: string; url: string } } }
    errors?: Array<{ message: string }>
  }

  if (data.errors && data.errors.length > 0) {
    throw new Error(`Linear GraphQL: ${data.errors.map((e) => e.message).join('; ')}`)
  }
  if (!data.data?.issueCreate?.success || !data.data.issueCreate.issue) {
    throw new Error('Linear issueCreate did not return success')
  }

  const issue = data.data.issueCreate.issue
  return { issueId: issue.identifier, issueUrl: issue.url }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
