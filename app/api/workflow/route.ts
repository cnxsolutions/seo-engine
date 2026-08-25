// ─────────────────────────────────────────────────────────────────────────────
// Workflow API - the five-step progress the sidebar renders
// SEO Engine - GET /api/workflow
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { deriveWorkflowState, type WorkflowFacts, type WorkflowSiteFacts } from './state'

/**
 * Never cached. The whole point of this route is to say what changed since the
 * last click — a site just connected, a plan just confirmed — and a cached
 * answer would send the operator back to the dead end this replaces.
 */
export const dynamic = 'force-dynamic'

function rows<T>(result: { data: T[] | null; error: { message: string } | null }, table: string): T[] {
  if (result.error) throw new Error(`${table}: ${result.error.message}`)
  return result.data ?? []
}

function count(result: { count: number | null; error: { message: string } | null }, table: string): number {
  if (result.error) throw new Error(`${table}: ${result.error.message}`)
  return result.count ?? 0
}

/**
 * Statuses that mean a cycle plan was validated by a human.
 *
 * `completed` counts: a cycle that already ran to its end was confirmed at some
 * point, and dropping it would demote the strategy step back to "à faire" the
 * day a cycle ends.
 */
const CONFIRMED_CYCLE_STATUSES = ['confirmed', 'executing', 'completed']

async function readWorkflowFacts(): Promise<WorkflowFacts> {
  const supabase = createServiceClient()

  const [
    sitesResult,
    profiledResult,
    cmsReadableResult,
    googleResult,
    campaignsResult,
    confirmedCyclesResult,
    draftCyclesResult,
    plannedSlotsResult,
    awaitingResult,
    producedResult,
    publishedResult,
  ] = await Promise.all([
    // No credentials and no `repo_profile` here: the sidebar needs a name and a
    // type, and `repo_profile` is a full repository description whose PRESENCE
    // is the only thing that matters — hence the separate id-only read below.
    supabase.from('sites').select('id,name,type,is_active').order('created_at', { ascending: true }),
    supabase.from('sites').select('id').not('repo_profile', 'is', null),
    // WordPress sites whose CMS schema can be READ. It used to be a select on
    // `content_schemas`, which nothing in this repository ever inserts into —
    // the extractor re-reads the WordPress REST API on every call and stores
    // nothing (see app/api/schema/extract/[siteId]/route.ts). That made step 2
    // permanently unfinishable for every WordPress site, and pinned the
    // "prochaine étape" card on "Lire le schéma de X" for good.
    //
    // `wp_app_password` is never selected — only its non-nullness is asked for,
    // server-side, so no credential leaves the database.
    supabase
      .from('sites')
      .select('id')
      .eq('type', 'wordpress')
      .not('wp_username', 'is', null)
      .not('wp_app_password', 'is', null),
    supabase.from('google_connections').select('site_id'),
    supabase.from('campaigns').select('id', { count: 'exact', head: true }),
    supabase.from('cycle_plans').select('id', { count: 'exact', head: true }).in('status', CONFIRMED_CYCLE_STATUSES),
    supabase.from('cycle_plans').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('editorial_calendar').select('id', { count: 'exact', head: true }).eq('status', 'planned'),
    supabase.from('generations').select('id', { count: 'exact', head: true }).eq('status', 'generated'),
    supabase.from('generations').select('id', { count: 'exact', head: true }).in('status', ['generated', 'publishing', 'published']),
    supabase.from('generations').select('id', { count: 'exact', head: true }).eq('status', 'published'),
  ])

  const profiledIds = new Set(rows<{ id: string }>(profiledResult, 'sites').map((site) => site.id))
  const cmsReadableIds = new Set(rows<{ id: string }>(cmsReadableResult, 'sites').map((site) => site.id))
  const googleIds = new Set(
    rows<{ site_id: string }>(googleResult, 'google_connections').map((connection) => connection.site_id)
  )

  const sites: WorkflowSiteFacts[] = rows<{
    id: string
    name: string
    type: string
    is_active: boolean
  }>(sitesResult, 'sites').map((site) => ({
    id: site.id,
    name: site.name,
    type: site.type,
    isActive: Boolean(site.is_active),
    hasRepoProfile: profiledIds.has(site.id),
    hasCmsSchemaAccess: cmsReadableIds.has(site.id),
    googleConnected: googleIds.has(site.id),
  }))

  return {
    sites,
    campaigns: count(campaignsResult, 'campaigns'),
    confirmedCycles: count(confirmedCyclesResult, 'cycle_plans'),
    draftCycles: count(draftCyclesResult, 'cycle_plans'),
    plannedSlots: count(plannedSlotsResult, 'editorial_calendar'),
    awaitingPublication: count(awaitingResult, 'generations'),
    produced: count(producedResult, 'generations'),
    published: count(publishedResult, 'generations'),
  }
}

/**
 * Failing loudly is deliberate: the sidebar falls back to plain, fully
 * navigable links when this route errors. Half-read facts would instead lock
 * steps that are perfectly reachable — a wrong state is worse than no state.
 */
export async function GET() {
  try {
    return Response.json(deriveWorkflowState(await readWorkflowFacts()))
  } catch (error) {
    console.error('[GET /api/workflow]', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 }
    )
  }
}
