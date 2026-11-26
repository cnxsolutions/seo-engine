// ─────────────────────────────────────────────────────────────────────────────
// What a client reads about one of their sites (L2 — ESP-1 to ESP-3)
// ─────────────────────────────────────────────────────────────────────────────
//
// Every function takes a ClientSiteDto, which only lib/client-space/scope.ts
// hands out — never a bare id from the URL. That is how these reads stay inside
// the member's client without each one re-checking it.
//
// Narrow on purpose. The operator's helpers (getActiveCyclePlan,
// listEditorialSlots, fetchPublishedGenerations…) select `*` or join campaigns,
// which carry prompts, model names, page types and error messages: none of it
// may reach a client. Each query below names its columns, is bounded, and its
// result is turned into the client's words by src/core/domain/client-space.

import { createServiceClient } from '@/lib/supabase'
import {
  clientPageState,
  parisDay,
  planTitles,
  summarizePeriod,
  type ClientPageState,
  type CycleRow,
  type PeriodSummary,
  type SlotRow,
} from '@/src/core/domain/client-space/overview'
import type { ClientSiteDto } from './dto'

/** A site with more campaigns than this is not a client site; it is a test bench. */
const CAMPAIGNS_PER_SITE_MAX = 20
/** A period holds a few dozen pages at most. */
const SLOTS_PER_PERIOD_MAX = 200

export const ONLINE_PAGES_PER_SCREEN = 20

function fail(action: string, message: string): never {
  throw new Error(`[espace] ${action} : ${message}`)
}

async function campaignIdsOf(siteId: string): Promise<string[]> {
  const { data, error } = await createServiceClient()
    .from('campaigns').select('id').eq('site_id', siteId).limit(CAMPAIGNS_PER_SITE_MAX)
  if (error) fail('campagnes du site', error.message)
  return (data ?? []).map((row) => row.id as string)
}

/**
 * The period in progress: the executing cycles of the site's campaigns, their
 * pages in the calendar (pages only — Business Profile posts live in the same
 * table), and the titles their plans proposed. Three queries, whatever the
 * number of pages.
 */
export async function readPeriod(site: ClientSiteDto, today: string = parisDay(new Date())): Promise<PeriodSummary | null> {
  const campaignIds = await campaignIdsOf(site.id)
  if (campaignIds.length === 0) return null

  const supabase = createServiceClient()
  const { data: cycles, error: cyclesError } = await supabase
    .from('cycle_plans')
    .select('cycle_started_at,cycle_ends_at,plan_data')
    .in('campaign_id', campaignIds)
    .eq('status', 'executing')
    .limit(CAMPAIGNS_PER_SITE_MAX)
  if (cyclesError) fail('periode en cours', cyclesError.message)

  const rows = (cycles ?? []) as Array<CycleRow & { plan_data: unknown }>
  const dated = rows.filter((cycle) => cycle.cycle_started_at && cycle.cycle_ends_at)
  if (dated.length === 0) return null

  const from = dated.map((cycle) => parisDay(cycle.cycle_started_at as string)).sort()[0]
  const to = dated.map((cycle) => parisDay(cycle.cycle_ends_at as string)).sort().at(-1) as string

  const { data: slots, error: slotsError } = await supabase
    .from('editorial_calendar')
    .select('id,scheduled_date,status,target_keyword,target_city,plan_item_id')
    .in('campaign_id', campaignIds)
    .eq('artifact_kind', 'page')
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .order('scheduled_date', { ascending: true })
    .limit(SLOTS_PER_PERIOD_MAX)
  if (slotsError) fail('pages de la periode', slotsError.message)

  const titles = new Map<string, string>()
  for (const cycle of dated) for (const [id, title] of planTitles(cycle.plan_data)) titles.set(id, title)

  return summarizePeriod(dated, (slots ?? []) as SlotRow[], titles, today)
}

export interface OnlinePage {
  id: string
  title: string
  url: string
  publishedDay: string | null
  state: ClientPageState
}

/**
 * The pages the engine published on the site, newest first, with what Google
 * makes of them. Only pages that are live: a page left on an unmerged branch
 * (`publish_live` false) is not « en ligne » for the client.
 */
export async function readOnlinePages(
  site: ClientSiteDto,
  window: { offset: number; limit: number },
): Promise<{ pages: OnlinePage[]; total: number }> {
  const supabase = createServiceClient()
  const { data, error, count } = await supabase
    .from('generations')
    .select('id,title,published_url,published_at', { count: 'exact' })
    .eq('site_id', site.id)
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .or('publish_live.is.null,publish_live.eq.true')
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(window.offset, window.offset + window.limit - 1)
  if (error) fail('pages en ligne', error.message)

  const rows = (data ?? []) as Array<{ id: string; title: string | null; published_url: string; published_at: string | null }>
  const states = new Map<string, string>()
  if (rows.length > 0) {
    const { data: indexing, error: indexingError } = await supabase
      .from('page_indexing')
      .select('generation_id,state')
      .eq('site_id', site.id)
      .in('generation_id', rows.map((row) => row.id))
    if (indexingError) fail('indexation des pages', indexingError.message)
    for (const row of indexing ?? []) states.set(row.generation_id as string, row.state as string)
  }

  return {
    total: count ?? rows.length,
    pages: rows.map((row) => ({
      id: row.id,
      title: row.title?.trim() || row.published_url,
      url: row.published_url,
      publishedDay: row.published_at ? parisDay(row.published_at) : null,
      state: clientPageState(states.get(row.id)),
    })),
  }
}
