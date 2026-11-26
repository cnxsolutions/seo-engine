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

import { readSitePeriod } from '@/lib/period'
import { createServiceClient } from '@/lib/supabase'
import {
  clientPageState,
  parisDay,
  type ClientPageState,
  type PeriodSummary,
} from '@/src/core/domain/client-space/overview'
import type { ClientSiteDto } from './dto'

function fail(action: string, message: string): never {
  throw new Error(`[espace] ${action} : ${message}`)
}

export const ONLINE_PAGES_PER_SCREEN = 20

/**
 * The period in progress, for a site of the member's (ESP-2). The reading
 * itself is shared with the console's site header (lib/period.ts); this door
 * only takes the ClientSiteDto that lib/client-space/scope.ts hands out.
 */
export async function readPeriod(site: ClientSiteDto, today: string = parisDay(new Date())): Promise<PeriodSummary | null> {
  return readSitePeriod(site.id, today)
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
