// ─────────────────────────────────────────────────────────────────────────────
// A client's Google results (L2b — ESP-5)
// ─────────────────────────────────────────────────────────────────────────────
//
// One call to the SQL function client_search_summary (migration 023), which
// aggregates in the database. When there is nothing to show, one narrow read of
// the site's Google connection tells « not linked yet » from « linked, data on
// its way » — never `*` on google_connections, which holds the OAuth tokens.
//
// Takes the ClientSiteDto that lib/client-space/scope.ts hands out, never an id.

import { createServiceClient } from '@/lib/supabase'
import { summarizeResults, type SearchResults } from '@/src/core/domain/client-space/results'
import type { ClientSiteDto } from './dto'

/** The window the client reads: four weeks, against the four before. */
export const RESULTS_DAYS = 28
const TOP = 5

export type ResultsView =
  | { kind: 'results'; results: SearchResults }
  /** Search Console is linked; its first data has not arrived yet. */
  | { kind: 'waiting' }
  /** No Search Console for this site yet: CNX's move, not the client's. */
  | { kind: 'not_linked' }

export async function readSearchResults(site: ClientSiteDto): Promise<ResultsView> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('client_search_summary', { p_site_id: site.id, p_days: RESULTS_DAYS, p_top: TOP })
  if (error) throw new Error(`[espace] resultats Google : ${error.message}`)

  const results = summarizeResults(data)
  if (results) return { kind: 'results', results }

  const { data: connection, error: connectionError } = await supabase
    .from('google_connections')
    .select('gsc_site_url')
    .eq('site_id', site.id)
    .maybeSingle()
  if (connectionError) throw new Error(`[espace] connexion Google : ${connectionError.message}`)
  return connection?.gsc_site_url ? { kind: 'waiting' } : { kind: 'not_linked' }
}
