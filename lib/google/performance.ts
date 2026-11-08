// ─────────────────────────────────────────────────────────────────────────────
// Search Console feedback loop — joins what was published to what it did
//
// The engine could produce pages forever without ever learning whether one of
// them ranked. This module is the missing return path: it reads the rows
// lib/google/sync.ts stores in `gsc_performance`, joins them to the URLs the
// publisher wrote in `generations.published_url`, and turns the result into
// decisions the next cycle can act on.
//
// Everything here degrades to "no signal" rather than to a wrong signal. A site
// with no Google connection, a table that has never been synced and a page that
// genuinely got zero impressions are three different situations, and confusing
// the first two with the third would make the planner abandon subjects for the
// wrong reason. `available: false` therefore means "draw no conclusion", never
// "it failed".
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { brandForms, claimOf, foldQuery, isBrandQuery, pageClaim, queryTokens } from './query-match'

// ─── Tunables ────────────────────────────────────────────────────────────────

/** A page is judged on its first 30 days live: below that, absence of data means nothing. */
export const DEFAULT_MEASUREMENT_WINDOW_DAYS = 30

/** History the planner looks back over. Wider than a measurement window: trends need volume. */
export const DEFAULT_PLANNING_WINDOW_DAYS = 90

/** Positions 5 to 20 — a page already exists and ranks; pushing it up is the cheapest traffic on the site. */
export const STRIKING_DISTANCE_MIN_POSITION = 5
export const STRIKING_DISTANCE_MAX_POSITION = 20

/**
 * PostgREST caps a response at 1000 rows by default, so a single select silently
 * truncates. Reads here paginate explicitly and stop at a bound: 20 000 rows is
 * far more than a personal site produces in 90 days, and keeps a runaway query
 * from turning a plan into a memory incident.
 */
const GSC_PAGE_SIZE = 1000
const GSC_MAX_ROWS = 20000

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GscRawRow {
  date: string
  page_url: string
  query: string
  clicks: number
  impressions: number
  position: number
}

/** One (page, query) couple, aggregated over the window. */
export interface QueryPageStat {
  pageUrl: string
  query: string
  clicks: number
  impressions: number
  /** Impressions-weighted average position — averaging daily positions unweighted overstates quiet days. */
  position: number
  /** clicks / impressions, recomputed rather than averaged from the stored ratio. */
  ctr: number
}

export interface StrikingDistanceOpportunity {
  query: string
  pageUrl: string
  position: number
  impressions: number
  clicks: number
}

export interface LowCtrPage {
  pageUrl: string
  impressions: number
  clicks: number
  ctr: number
  position: number
  topQuery: string
}

export interface CannibalizedQuery {
  query: string
  impressions: number
  clicks: number
  /** Every page of the site competing on this query, best first. */
  pages: Array<{ pageUrl: string; impressions: number; clicks: number; position: number }>
  /** The page to consolidate onto: most clicks, then most impressions, then best position. */
  winner: string
  losers: string[]
}

export interface DeadPage {
  generationId: string
  pageUrl: string
  title: string | null
  focusKeyword: string | null
  publishedAt: string
  daysLive: number
}

export type PagePerformanceVerdict =
  | 'winning'            // top 5, getting clicks — the format works, reproduce it
  | 'striking_distance'  // ranks 5-20 — reinforce this page rather than write another
  | 'low_ctr'            // seen but not clicked — title/meta problem, not a content problem
  | 'buried'             // indexed beyond page 2 — the subject is contested
  | 'dead'               // zero impression after 30 days — the subject does not exist

export interface PublishedPagePerformance {
  generationId: string
  pageUrl: string
  title: string | null
  focusKeyword: string | null
  publishedAt: string
  daysLive: number
  windowStart: string
  windowEnd: string
  clicks: number
  impressions: number
  ctr: number
  /** null when the page was never displayed: there is no position to report, and 0 would read as "first". */
  position: number | null
  topQueries: QueryPageStat[]
  verdict: PagePerformanceVerdict
}

export interface PublishedPerformanceReport {
  siteId: string
  measuredAt: string
  windowDays: number
  minDaysLive: number
  /**
   * false when the site has no usable Search Console history at all — not
   * connected, never synced, or the table is unreachable. No verdict in `pages`
   * may be trusted in that case, and the list is empty.
   */
  gscAvailable: boolean
  pagesMeasured: number
  pages: PublishedPagePerformance[]
}

export interface GscPlanningSignals {
  available: boolean
  windowStart: string
  windowEnd: string
  /** Queries already ranking 5-20: reinforce, do not restart from zero. */
  strikingDistance: StrikingDistanceOpportunity[]
  /** Pages seen and ignored: rewrite the title and the meta, do not write a new page. */
  lowCtrPages: LowCtrPage[]
  /** Published over 30 days ago, still at zero impression: stop insisting on the subject. */
  deadPages: DeadPage[]
  /** Several pages of the site fighting each other on one query. */
  cannibalized: CannibalizedQuery[]
  /** Queries a new page must NOT target: already cannibalized, or already won. */
  blockedQueries: string[]
  /**
   * Measured demand without a page: queries Google already shows the site on,
   * beyond position 20, that no page of the site claims. The only Search
   * Console list that proposes subjects rather than forbidding them. Absent
   * from signals built before 2026-11-08.
   */
  emergingQueries?: EmergingQuery[]
}

export interface EmergingQuery {
  query: string
  /** Every page of the site together, over the window. */
  impressions: number
  /** The best position any page reached — beyond 20 by construction. */
  position: number
  /** The page Google showed most for it, which was not written for it. */
  pageUrl: string
}

/** Below this, a query is one person's search, not a demand. */
export const EMERGING_MIN_IMPRESSIONS = 5

// ─── Public API ──────────────────────────────────────────────────────────────

export interface MeasurePublishedPagesOptions {
  /** Days of Search Console data counted from the publication date. Default 30. */
  windowDays?: number
  /** Only pages published at least this long ago are judged. Default 30. */
  minDaysLive?: number
  /** Most recent publications first. Default 200. */
  limit?: number
}

/**
 * Joins each page published at least `minDaysLive` days ago to its Search
 * Console data over the `windowDays` that followed its publication.
 *
 * This is the function the planner is meant to call before building the next
 * cycle. It is deliberately NOT wired into the scheduler here.
 */
export async function measurePublishedPages(
  siteId: string,
  options: MeasurePublishedPagesOptions = {}
): Promise<PublishedPerformanceReport> {
  const windowDays = options.windowDays ?? DEFAULT_MEASUREMENT_WINDOW_DAYS
  const minDaysLive = options.minDaysLive ?? DEFAULT_MEASUREMENT_WINDOW_DAYS
  const limit = options.limit ?? 200
  const now = new Date()

  const empty: PublishedPerformanceReport = {
    siteId,
    measuredAt: now.toISOString(),
    windowDays,
    minDaysLive,
    gscAvailable: false,
    pagesMeasured: 0,
    pages: [],
  }

  const generations = await fetchPublishedGenerations(siteId, limit)
  if (generations.length === 0) return empty

  const mature = generations
    .map((generation) => ({ generation, publishedAt: publicationDate(generation) }))
    .filter((entry): entry is { generation: PublishedGeneration; publishedAt: Date } => entry.publishedAt !== null)
    .filter((entry) => daysBetween(entry.publishedAt, now) >= minDaysLive)

  if (mature.length === 0) return empty

  // One read covering every window at once: from the oldest publication to today.
  const oldest = mature.reduce((min, entry) => (entry.publishedAt < min ? entry.publishedAt : min), mature[0].publishedAt)
  const rows = await fetchGscRows(siteId, formatDate(oldest), formatDate(now))
  if (rows === null || rows.length === 0) return empty

  const rowsByPage = groupRowsByNormalizedUrl(rows)

  const pages = mature.map(({ generation, publishedAt }) => {
    const windowEnd = new Date(publishedAt)
    windowEnd.setDate(windowEnd.getDate() + windowDays)
    const end = windowEnd > now ? now : windowEnd

    const startStr = formatDate(publishedAt)
    const endStr = formatDate(end)

    const pageRows = (rowsByPage.get(normalizePageUrl(generation.published_url)) || []).filter(
      (row) => row.date >= startStr && row.date <= endStr
    )

    const stats = aggregateRows(pageRows)
    const clicks = stats.reduce((sum, stat) => sum + stat.clicks, 0)
    const impressions = stats.reduce((sum, stat) => sum + stat.impressions, 0)
    const position = weightedPosition(pageRows)

    return {
      generationId: generation.id,
      pageUrl: generation.published_url,
      title: generation.title ?? null,
      focusKeyword: generation.focus_keyword ?? null,
      publishedAt: publishedAt.toISOString(),
      daysLive: daysBetween(publishedAt, now),
      windowStart: startStr,
      windowEnd: endStr,
      clicks,
      impressions,
      ctr: impressions > 0 ? round(clicks / impressions, 4) : 0,
      position,
      topQueries: stats.sort((a, b) => b.impressions - a.impressions).slice(0, 10),
      verdict: verdictFor({ clicks, impressions, position }),
    }
  })

  return {
    ...empty,
    gscAvailable: true,
    pagesMeasured: pages.length,
    pages: pages.sort((a, b) => b.impressions - a.impressions),
  }
}

/**
 * Everything the planner needs from Search Console, in one call.
 *
 * `available: false` is the first-cycle case — a brand new site, or one that was
 * never connected. Callers must keep their blind behaviour then, not invent a
 * verdict from an empty table.
 */
export async function getGscPlanningSignals(
  siteId: string,
  options: { windowDays?: number } = {}
): Promise<GscPlanningSignals> {
  const windowDays = options.windowDays ?? DEFAULT_PLANNING_WINDOW_DAYS
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - windowDays)

  const windowStart = formatDate(start)
  const windowEnd = formatDate(now)

  const unavailable: GscPlanningSignals = {
    available: false,
    windowStart,
    windowEnd,
    strikingDistance: [],
    lowCtrPages: [],
    deadPages: [],
    cannibalized: [],
    blockedQueries: [],
    emergingQueries: [],
  }

  const rows = await fetchGscRows(siteId, windowStart, windowEnd)
  if (rows === null || rows.length === 0) return unavailable

  const stats = aggregateRows(rows)
  const cannibalized = detectCannibalization(stats)
  const strikingDistance = selectStrikingDistance(stats)
  const lowCtrPages = selectLowCtrPages(stats)
  const [generations, site] = await Promise.all([fetchPublishedGenerations(siteId, 300), fetchSiteIdentity(siteId)])
  const deadPages = findDeadPages(generations, rows, now, windowStart)
  const blockedQueries = blockedQueriesFrom(stats, cannibalized)

  return {
    available: true,
    windowStart,
    windowEnd,
    strikingDistance,
    lowCtrPages,
    deadPages,
    cannibalized,
    blockedQueries,
    emergingQueries: selectEmergingQueries(stats, {
      brands: site ? brandForms(site) : [],
      pages: generations.map((generation) => ({
        url: generation.published_url,
        focusKeyword: generation.focus_keyword,
        title: generation.title,
      })),
      blocked: blockedQueries,
    }),
  }
}

/**
 * Queries several pages of the site compete on. Standalone entry point for the
 * dashboard; the planner gets the same list through getGscPlanningSignals.
 */
export async function detectQueryCannibalization(
  siteId: string,
  options: { windowDays?: number } = {}
): Promise<{ available: boolean; queries: CannibalizedQuery[] }> {
  const windowDays = options.windowDays ?? DEFAULT_PLANNING_WINDOW_DAYS
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - windowDays)

  const rows = await fetchGscRows(siteId, formatDate(start), formatDate(now))
  if (rows === null || rows.length === 0) return { available: false, queries: [] }

  return { available: true, queries: detectCannibalization(aggregateRows(rows)) }
}

// ─── Stored coverage ─────────────────────────────────────────────────────────

export interface GscCoverage {
  /**
   * false when `gsc_performance` could not be read at all. Distinct from
   * `rowCount === 0`, which is a fact about the site; this one is a fact about
   * the database, and the interface must not report it as "aucune donnée".
   */
  readable: boolean
  rowCount: number
  /** Oldest and newest day stored for this site, null when nothing is stored. */
  firstDate: string | null
  lastDate: string | null
}

/**
 * What Search Console history this site actually holds, independently of whether
 * a sync ever ran.
 *
 * The sync status on `google_connections` says what the last run did; this says
 * what is on disk. Shown together they separate "the sync failed" from "the sync
 * worked and the site has no impressions" — two situations that rendered
 * identically until now.
 *
 * Counted with a HEAD request so the row count never loads the rows.
 */
export async function getGscCoverage(siteId: string): Promise<GscCoverage> {
  const unreadable: GscCoverage = { readable: false, rowCount: 0, firstDate: null, lastDate: null }

  try {
    const supabase = createServiceClient()

    const [count, oldest, newest] = await Promise.all([
      supabase.from('gsc_performance').select('id', { count: 'exact', head: true }).eq('site_id', siteId),
      supabase.from('gsc_performance').select('date').eq('site_id', siteId).order('date', { ascending: true }).limit(1),
      supabase.from('gsc_performance').select('date').eq('site_id', siteId).order('date', { ascending: false }).limit(1),
    ])

    if (count.error) return unreadable

    return {
      readable: true,
      rowCount: count.count ?? 0,
      firstDate: (oldest.data?.[0]?.date as string | undefined) ?? null,
      lastDate: (newest.data?.[0]?.date as string | undefined) ?? null,
    }
  } catch {
    return unreadable
  }
}

// ─── Pure derivations (exported for tests) ───────────────────────────────────

/** Collapses raw daily rows into one entry per (page, query). */
export function aggregateRows(rows: GscRawRow[]): QueryPageStat[] {
  const buckets = new Map<string, { pageUrl: string; query: string; clicks: number; impressions: number; positionWeight: number; positionSum: number; days: number }>()

  for (const row of rows) {
    const key = `${row.page_url}\u0000${row.query}`
    const bucket = buckets.get(key) || {
      pageUrl: row.page_url,
      query: row.query,
      clicks: 0,
      impressions: 0,
      positionWeight: 0,
      positionSum: 0,
      days: 0,
    }
    bucket.clicks += row.clicks || 0
    bucket.impressions += row.impressions || 0
    bucket.positionWeight += (row.position || 0) * (row.impressions || 0)
    bucket.positionSum += row.position || 0
    bucket.days += 1
    buckets.set(key, bucket)
  }

  return [...buckets.values()].map((bucket) => ({
    pageUrl: bucket.pageUrl,
    query: bucket.query,
    clicks: bucket.clicks,
    impressions: bucket.impressions,
    position: bucket.impressions > 0
      ? round(bucket.positionWeight / bucket.impressions, 1)
      : round(bucket.positionSum / Math.max(bucket.days, 1), 1),
    ctr: bucket.impressions > 0 ? round(bucket.clicks / bucket.impressions, 4) : 0,
  }))
}

export interface StrikingDistanceOptions {
  minPosition?: number
  maxPosition?: number
  minImpressions?: number
  limit?: number
}

/**
 * Queries where a page of the site already ranks 5-20. The content exists and
 * Google already shows it: a few places gained here cost far less than a new
 * page that starts at nothing.
 */
export function selectStrikingDistance(
  stats: QueryPageStat[],
  options: StrikingDistanceOptions = {}
): StrikingDistanceOpportunity[] {
  const minPosition = options.minPosition ?? STRIKING_DISTANCE_MIN_POSITION
  const maxPosition = options.maxPosition ?? STRIKING_DISTANCE_MAX_POSITION
  const minImpressions = options.minImpressions ?? 10
  const limit = options.limit ?? 25

  const best = new Map<string, StrikingDistanceOpportunity>()

  for (const stat of stats) {
    if (stat.impressions < minImpressions) continue
    if (stat.position < minPosition || stat.position > maxPosition) continue

    const current = best.get(stat.query)
    if (!current || stat.impressions > current.impressions) {
      best.set(stat.query, {
        query: stat.query,
        pageUrl: stat.pageUrl,
        position: stat.position,
        impressions: stat.impressions,
        clicks: stat.clicks,
      })
    }
  }

  return [...best.values()].sort((a, b) => b.impressions - a.impressions).slice(0, limit)
}

export interface LowCtrOptions {
  minImpressions?: number
  maxPosition?: number
  maxCtr?: number
  limit?: number
}

/**
 * Pages Google displays and users skip. Capped at position 10 on purpose: below
 * that a low CTR is the normal consequence of the rank, not of the wording, and
 * calling it a title problem would send the next cycle chasing a phantom.
 */
export function selectLowCtrPages(stats: QueryPageStat[], options: LowCtrOptions = {}): LowCtrPage[] {
  const minImpressions = options.minImpressions ?? 100
  const maxPosition = options.maxPosition ?? 10
  const maxCtr = options.maxCtr ?? 0.02
  const limit = options.limit ?? 15

  const byPage = new Map<string, { clicks: number; impressions: number; positionWeight: number; topQuery: string; topImpressions: number }>()

  for (const stat of stats) {
    const bucket = byPage.get(stat.pageUrl) || { clicks: 0, impressions: 0, positionWeight: 0, topQuery: '', topImpressions: 0 }
    bucket.clicks += stat.clicks
    bucket.impressions += stat.impressions
    bucket.positionWeight += stat.position * stat.impressions
    if (stat.impressions > bucket.topImpressions) {
      bucket.topQuery = stat.query
      bucket.topImpressions = stat.impressions
    }
    byPage.set(stat.pageUrl, bucket)
  }

  const pages: LowCtrPage[] = []

  for (const [pageUrl, bucket] of byPage) {
    if (bucket.impressions < minImpressions) continue
    const position = round(bucket.positionWeight / bucket.impressions, 1)
    if (position > maxPosition) continue
    const ctr = round(bucket.clicks / bucket.impressions, 4)
    if (ctr > maxCtr) continue

    pages.push({ pageUrl, impressions: bucket.impressions, clicks: bucket.clicks, ctr, position, topQuery: bucket.topQuery })
  }

  return pages.sort((a, b) => b.impressions - a.impressions).slice(0, limit)
}

export interface CannibalizationOptions {
  /** Below this, the query is too rare for the split to cost anything. */
  minImpressions?: number
  /** A page counts as a contender above this share of the query's impressions. */
  minShare?: number
  /** Absolute floor, so a share threshold cannot promote a single-impression page. */
  minPageImpressions?: number
  limit?: number
}

/**
 * Queries on which SEVERAL pages of the site are shown. Google picks one result
 * per site per query in most cases: the others split the signals — links,
 * relevance, click history — without ever winning. The fix is to consolidate,
 * which is precisely the opposite of adding one more page on the subject.
 *
 * Exact-string duplicate detection cannot see this: the competing pages have
 * different slugs, different titles and different focus keywords. Only the
 * queries they are actually shown on reveal the collision.
 */
export function detectCannibalization(stats: QueryPageStat[], options: CannibalizationOptions = {}): CannibalizedQuery[] {
  const minImpressions = options.minImpressions ?? 30
  const minShare = options.minShare ?? 0.15
  const minPageImpressions = options.minPageImpressions ?? 3
  const limit = options.limit ?? 20

  const byQuery = new Map<string, QueryPageStat[]>()
  for (const stat of stats) {
    const list = byQuery.get(stat.query) || []
    list.push(stat)
    byQuery.set(stat.query, list)
  }

  const cannibalized: CannibalizedQuery[] = []

  for (const [query, entries] of byQuery) {
    const distinctPages = new Set(entries.map((entry) => entry.pageUrl))
    if (distinctPages.size < 2) continue

    const impressions = entries.reduce((sum, entry) => sum + entry.impressions, 0)
    if (impressions < minImpressions) continue

    const contenders = entries
      .filter((entry) => entry.impressions >= Math.max(minPageImpressions, impressions * minShare))
      .sort(comparePages)

    if (contenders.length < 2) continue

    cannibalized.push({
      query,
      impressions,
      clicks: entries.reduce((sum, entry) => sum + entry.clicks, 0),
      pages: contenders.map((entry) => ({
        pageUrl: entry.pageUrl,
        impressions: entry.impressions,
        clicks: entry.clicks,
        position: entry.position,
      })),
      winner: contenders[0].pageUrl,
      losers: contenders.slice(1).map((entry) => entry.pageUrl),
    })
  }

  return cannibalized.sort((a, b) => b.impressions - a.impressions).slice(0, limit)
}

export interface EmergingQueryOptions {
  /** Compacted brand forms (query-match `brandForms`): someone typing the name is not a subject. */
  brands?: readonly string[]
  /** The pages the engine knows the subject of. Every URL of `stats` is added, claimed by its address. */
  pages?: ReadonlyArray<{ url: string; focusKeyword?: string | null; title?: string | null }>
  /** Already refused as targets (cannibalized, already won). */
  blocked?: readonly string[]
  minImpressions?: number
  limit?: number
}

/**
 * Queries the site is shown on that no page of it was written for.
 *
 * The planner only ever saw what NOT to target. This is the other half: real
 * searches, measured, on which Google already associates the site — but
 * beyond position 20, through a page that does not treat them. A page written
 * for one of them competes with nothing.
 *
 * Every condition is a way of refusing a false candidate:
 *   - ranked 20 or better anywhere: a page carries it already (striking distance);
 *   - claimed by any known page, by its keyword, title or address: that page
 *     is the dedicated one, merely buried — a second page would compete;
 *   - a brand query, a blocked query, or under five impressions.
 */
export function selectEmergingQueries(stats: QueryPageStat[], options: EmergingQueryOptions = {}): EmergingQuery[] {
  const minImpressions = options.minImpressions ?? EMERGING_MIN_IMPRESSIONS
  const limit = options.limit ?? 15
  const brands = options.brands ?? []
  const blocked = new Set((options.blocked ?? []).map(foldQuery))

  const known = new Map<string, { url: string; focusKeyword?: string | null; title?: string | null }>()
  for (const stat of stats) known.set(normalizePageUrl(stat.pageUrl), { url: stat.pageUrl })
  for (const page of options.pages ?? []) known.set(normalizePageUrl(page.url), page)
  const claims = [...known.values()].map(pageClaim)

  const byQuery = new Map<string, { query: string; impressions: number; position: number; pageUrl: string; pageImpressions: number }>()
  for (const stat of stats) {
    const key = foldQuery(stat.query)
    const entry = byQuery.get(key) ?? { query: stat.query, impressions: 0, position: stat.position, pageUrl: stat.pageUrl, pageImpressions: 0 }
    entry.impressions += stat.impressions
    entry.position = Math.min(entry.position, stat.position)
    if (stat.impressions > entry.pageImpressions) {
      entry.pageUrl = stat.pageUrl
      entry.pageImpressions = stat.impressions
    }
    byQuery.set(key, entry)
  }

  const emerging: EmergingQuery[] = []
  for (const [key, entry] of byQuery) {
    if (entry.impressions < minImpressions) continue
    if (entry.position <= STRIKING_DISTANCE_MAX_POSITION) continue
    if (blocked.has(key) || isBrandQuery(entry.query, brands)) continue

    const tokens = queryTokens(entry.query)
    if (tokens.length === 0 || claims.some((claim) => claimOf(tokens, claim) !== 'unexpected')) continue

    emerging.push({ query: entry.query, impressions: entry.impressions, position: entry.position, pageUrl: entry.pageUrl })
  }

  return emerging.sort((a, b) => b.impressions - a.impressions || a.position - b.position).slice(0, limit)
}

/** Reads a Search Console URL and a stored published_url as the same page. */
export function normalizePageUrl(url: string): string {
  const trimmed = (url || '').trim()
  if (!trimmed) return ''

  let value = trimmed
  try {
    value = decodeURI(trimmed)
  } catch {
    // Malformed percent-encoding: compare the raw string rather than give up.
  }

  return value
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

export function verdictFor(page: { clicks: number; impressions: number; position: number | null }): PagePerformanceVerdict {
  if (page.impressions <= 0 || page.position === null) return 'dead'

  // Checked before rank: a page displayed a hundred times in the top 10 and
  // clicked twice has a wording problem, and rewriting its body would fix
  // nothing. Beyond position 10 a low CTR is what the rank predicts, so the
  // test stops there rather than blaming the title for the ranking.
  const ctr = page.clicks / page.impressions
  if (page.position <= 10 && page.impressions >= 100 && ctr < 0.02) return 'low_ctr'

  if (page.position < STRIKING_DISTANCE_MIN_POSITION) return 'winning'
  if (page.position <= STRIKING_DISTANCE_MAX_POSITION) return 'striking_distance'
  return 'buried'
}

// ─── Internals ───────────────────────────────────────────────────────────────

export interface PublishedGeneration {
  id: string
  title: string | null
  focus_keyword: string | null
  published_url: string
  published_at?: string | null
  updated_at: string
}

/**
 * `published_at` is created by migration 010. Selecting a column that does not
 * exist makes PostgREST reject the whole request, so the read falls back to the
 * pre-migration shape instead of reporting "no published page at all".
 */
export async function fetchPublishedGenerations(siteId: string, limit: number): Promise<PublishedGeneration[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('generations')
    .select('id, title, focus_keyword, published_url, published_at, updated_at')
    .eq('site_id', siteId)
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (!error) return (data ?? []) as PublishedGeneration[]

  const fallback = await supabase
    .from('generations')
    .select('id, title, focus_keyword, published_url, updated_at')
    .eq('site_id', siteId)
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (fallback.error) return []
  return (fallback.data ?? []) as PublishedGeneration[]
}

/**
 * Returns null when the rows cannot be read at all (missing table, no
 * credentials), and [] when the site simply has no data. Callers must treat both
 * as "no signal", but only the second is a fact about the site.
 */
export async function fetchGscRows(siteId: string, startDate: string, endDate: string): Promise<GscRawRow[] | null> {
  const supabase = createServiceClient()
  const rows: GscRawRow[] = []

  for (let from = 0; from < GSC_MAX_ROWS; from += GSC_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('gsc_performance')
      .select('date, page_url, query, clicks, impressions, position')
      .eq('site_id', siteId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('impressions', { ascending: false })
      .order('date', { ascending: true })
      .order('page_url', { ascending: true })
      .order('query', { ascending: true })
      .range(from, from + GSC_PAGE_SIZE - 1)

    if (error) return from === 0 ? null : rows
    if (!data || data.length === 0) break

    rows.push(...(data as GscRawRow[]))
    if (data.length < GSC_PAGE_SIZE) break
  }

  return rows
}

/**
 * Pages published long enough ago to be judged, that Search Console has never
 * shown once. Not a failure of the engine — a subject nobody searches for.
 *
 * Restricted to pages published INSIDE the read window: an older page absent
 * from the last 90 days may simply have had its traffic before the window
 * opened, and calling that "never displayed" would be a lie about a page that
 * once worked.
 */
function findDeadPages(generations: PublishedGeneration[], rows: GscRawRow[], now: Date, windowStart: string): DeadPage[] {
  if (generations.length === 0) return []

  const seen = new Set(rows.map((row) => normalizePageUrl(row.page_url)))

  return generations
    .map((generation) => ({ generation, publishedAt: publicationDate(generation) }))
    .filter((entry): entry is { generation: PublishedGeneration; publishedAt: Date } => entry.publishedAt !== null)
    .filter((entry) => daysBetween(entry.publishedAt, now) >= DEFAULT_MEASUREMENT_WINDOW_DAYS)
    .filter((entry) => formatDate(entry.publishedAt) >= windowStart)
    .filter((entry) => !seen.has(normalizePageUrl(entry.generation.published_url)))
    .map((entry) => ({
      generationId: entry.generation.id,
      pageUrl: entry.generation.published_url,
      title: entry.generation.title ?? null,
      focusKeyword: entry.generation.focus_keyword ?? null,
      publishedAt: entry.publishedAt.toISOString(),
      daysLive: daysBetween(entry.publishedAt, now),
    }))
    .slice(0, 30)
}

/** The site's name and address, for brand queries. Null when unreadable: no brand is then recognised. */
async function fetchSiteIdentity(siteId: string): Promise<{ name: string | null; url: string | null } | null> {
  try {
    const { data, error } = await createServiceClient().from('sites').select('name, url').eq('id', siteId).maybeSingle()
    if (error || !data) return null
    return { name: (data.name as string | null) ?? null, url: (data.url as string | null) ?? null }
  } catch {
    return null
  }
}

/**
 * Queries the next cycle must not open a new page on: either the site already
 * has too many pages on them, or it already owns the top of the results.
 */
function blockedQueriesFrom(stats: QueryPageStat[], cannibalized: CannibalizedQuery[]): string[] {
  const blocked = new Set(cannibalized.map((entry) => entry.query.toLowerCase()))

  for (const stat of stats) {
    if (stat.position > 0 && stat.position <= 3 && stat.impressions >= 30) {
      blocked.add(stat.query.toLowerCase())
    }
  }

  return [...blocked]
}

function groupRowsByNormalizedUrl(rows: GscRawRow[]): Map<string, GscRawRow[]> {
  const grouped = new Map<string, GscRawRow[]>()
  for (const row of rows) {
    const key = normalizePageUrl(row.page_url)
    const list = grouped.get(key) || []
    list.push(row)
    grouped.set(key, list)
  }
  return grouped
}

function weightedPosition(rows: GscRawRow[]): number | null {
  const impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0)
  if (impressions <= 0) return null
  const weighted = rows.reduce((sum, row) => sum + (row.position || 0) * (row.impressions || 0), 0)
  return round(weighted / impressions, 1)
}

function comparePages(a: QueryPageStat, b: QueryPageStat): number {
  if (b.clicks !== a.clicks) return b.clicks - a.clicks
  if (b.impressions !== a.impressions) return b.impressions - a.impressions
  return a.position - b.position
}

export function publicationDate(generation: PublishedGeneration): Date | null {
  const raw = generation.published_at || generation.updated_at
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
