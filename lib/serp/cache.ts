// ─────────────────────────────────────────────────────────────────────────────
// SERP cache
// SEO Engine - One fetch per query per freshness window.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { fetchSerp, SerpUnavailableError, type FetchSerpOptions } from './fetch'
import type { SerpParseResult, SerpSnapshot } from './types'

/**
 * How long a snapshot is considered to still describe the SERP.
 *
 * Rankings drift over weeks, not hours, and the numbers this feeds — expected
 * length, common sections, questions asked — are structural rather than
 * positional. Seven days keeps briefs current while collapsing the many
 * re-plans of a single cycle into one round of fetches.
 */
export const SERP_FRESHNESS_DAYS = 7

/** Snapshots older than this are pruned: they no longer describe anything. */
export const SERP_RETENTION_DAYS = 90

/**
 * Casing and spacing variants of the same query must share one entry, otherwise
 * "Plombier Troyes" and "plombier  troyes" are two fetches for one answer.
 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface GetSerpOptions extends FetchSerpOptions {
  locale?: string
  /** Ignore a fresh cache entry and refetch. */
  force?: boolean
  /** Serve a cached entry only; never fetch. Used to plan without any network. */
  cacheOnly?: boolean
}

/**
 * A snapshot for `query`, from cache when fresh enough, otherwise fetched.
 *
 * Returns null rather than throwing when the SERP cannot be read: this is
 * enrichment, and no plan should fail because Google changed a class name. The
 * reason is logged so a broken parser is visible instead of merely quiet.
 */
export async function getSerpSnapshot(
  query: string,
  opts: GetSerpOptions = {}
): Promise<SerpSnapshot | null> {
  const normalized = normalizeQuery(query)
  if (!normalized) return null

  const locale = opts.locale ?? 'fr-FR'
  const cached = await readCache(normalized, locale)

  if (cached && !opts.force && isFresh(cached.fetchedAt)) {
    console.log(`[serp]     cache (lu le ${cached.fetchedAt.slice(0, 10)}) — aucune requete envoyee`)
    return cached
  }
  if (opts.cacheOnly) return cached

  console.log(`[serp]     requete Google en cours...`)

  let parsed: SerpParseResult
  try {
    parsed = await fetchSerp(normalized, opts)
  } catch (error) {
    if (error instanceof SerpUnavailableError) {
      // `config` and `empty` are the ones worth shouting about: a missing or
      // refused key, or a response whose shape moved, will not fix itself.
      // Network blips and exhausted quota are transient and only warn.
      const loud = error.kind === 'config' || error.kind === 'empty'
      const level = loud ? console.error : console.warn
      level(`[serp] ${error.kind}: ${error.message}`)
    } else {
      console.warn('[serp] unexpected failure', error)
    }

    // A stale snapshot beats no evidence at all — the structure of a SERP is
    // stable enough that last month's measurements still beat guessing.
    return cached
  }

  await writeCache(normalized, locale, parsed)
  return { ...parsed, query: normalized, fetchedAt: new Date().toISOString(), fromCache: false }
}

function isFresh(fetchedAt: string): boolean {
  const age = Date.now() - new Date(fetchedAt).getTime()
  return Number.isFinite(age) && age < SERP_FRESHNESS_DAYS * 86400_000
}

// ─── Storage ────────────────────────────────────────────────────────────────────
//
// Every access is best-effort: the cache is an optimisation, and a database
// hiccup must degrade to a live fetch rather than break planning.

async function readCache(query: string, locale: string): Promise<SerpSnapshot | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('serp_snapshots')
      .select('payload, fetched_at')
      .eq('query', query)
      .eq('locale', locale)
      .maybeSingle()

    if (error || !data?.payload) return null

    const payload = data.payload as SerpParseResult
    return {
      ...payload,
      organic: payload.organic ?? [],
      peopleAlsoAsk: payload.peopleAlsoAsk ?? [],
      relatedSearches: payload.relatedSearches ?? [],
      blocked: payload.blocked ?? null,
      query,
      fetchedAt: data.fetched_at as string,
      fromCache: true,
    }
  } catch {
    return null
  }
}

async function writeCache(query: string, locale: string, payload: SerpParseResult): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase
      .from('serp_snapshots')
      .upsert(
        { query, locale, payload, fetched_at: new Date().toISOString() },
        { onConflict: 'query,locale' }
      )
  } catch (error) {
    console.warn('[serp] cache write failed', error)
  }
}

/** Drop snapshots too old to describe anything. Safe to call from a cron job. */
export async function pruneSerpSnapshots(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - SERP_RETENTION_DAYS * 86400_000).toISOString()
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('serp_snapshots')
      .delete()
      .lt('fetched_at', cutoff)
      .select('id')

    if (error) return 0
    return data?.length ?? 0
  } catch {
    return 0
  }
}
