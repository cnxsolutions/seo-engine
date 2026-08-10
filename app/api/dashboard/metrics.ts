// ─────────────────────────────────────────────────────────────────────────────
// Dashboard metrics — every number the tabbed dashboard displays
//
// Two families of measurement live here, and the whole point of this module is
// that they NEVER get mixed in the same tile grid:
//
//   PRODUCTION   what the engine manufactured. Sources: `generations`,
//                `editorial_calendar`, `job_executions`.
//   PERFORMANCE  what Google did with it. Source: `gsc_performance`, nothing else.
//
// A page generated and an average position are not the same kind of fact; put
// side by side they read as one score and mean nothing.
//
// Nothing here is invented. Every counter is derived from rows actually read
// back: a metric with no row behind it returns `null` or an explicit
// unavailability state, so the page can say WHY it is empty instead of printing
// a zero that reads like a measurement. `readAll` likewise returns `null` when
// the read itself failed — "could not read" and "read nothing" produce different
// screens.
// ─────────────────────────────────────────────────────────────────────────────

import {
  aggregateRows,
  normalizePageUrl,
  selectStrikingDistance,
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
  type GscRawRow,
  type QueryPageStat,
} from '@/lib/google/performance'
import { createServiceClient } from '@/lib/supabase'

// ─── Window ──────────────────────────────────────────────────────────────────

export const DASHBOARD_PERIODS = [7, 28, 90] as const
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]

/**
 * 90 days by default — the same window `lib/google/performance` plans on.
 *
 * Search Console publishes with two to three days of lag, so a short window
 * also amputates its own tail: a 7-day view of data that stops three days ago
 * shows four days. The striking-distance list in particular needs volume before
 * a position average means anything.
 */
export const DEFAULT_PERIOD: DashboardPeriod = 90

export type DashboardTab = 'production' | 'performance'
export const DASHBOARD_TABS: DashboardTab[] = ['production', 'performance']

export interface DashboardWindow {
  days: number
  /** Inclusive `YYYY-MM-DD` bounds of the REQUESTED window — not of the data found. */
  start: string
  end: string
}

export function resolvePeriod(raw: string | undefined | null): DashboardPeriod {
  const parsed = Number(raw)
  return (DASHBOARD_PERIODS as readonly number[]).includes(parsed)
    ? (parsed as DashboardPeriod)
    : DEFAULT_PERIOD
}

export function resolveTab(raw: string | undefined | null): DashboardTab {
  return raw === 'performance' ? 'performance' : 'production'
}

function buildWindow(days: number): DashboardWindow {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  return { days, start: isoDate(start), end: isoDate(end) }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// ─── Paginated reads ─────────────────────────────────────────────────────────

/**
 * PostgREST answers 1000 rows at most and says nothing about the rest, so a
 * plain select silently truncates. Every read below paginates to a stated bound.
 */
const PAGE_SIZE = 1000
const MAX_ROWS = 20000

type PageQuery<T> = (
  from: number,
  to: number
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** All rows, or `null` if the read itself failed — never a silent empty array. */
async function readAll<T>(query: PageQuery<T>, max = MAX_ROWS): Promise<T[] | null> {
  const rows: T[] = []

  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await query(from, Math.min(from + PAGE_SIZE, max) - 1)
    if (error) return null
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  return rows
}

// ─── Sites ───────────────────────────────────────────────────────────────────

export interface DashboardSite {
  id: string
  name: string
  url: string
  type: string
  isActive: boolean
  /** A `google_connections` row exists — OAuth was completed for this site. */
  googleConnected: boolean
  /** …and a Search Console property was actually picked. Connected ≠ measurable. */
  gscProperty: string | null
}

export async function listDashboardSites(): Promise<DashboardSite[]> {
  const supabase = createServiceClient()

  // Explicit columns: `sites` carries `wp_app_password` and `github_token`, and
  // a `*` here would walk them into an HTTP response.
  const [sitesResult, connectionsResult] = await Promise.all([
    supabase.from('sites').select('id,name,url,type,is_active').order('name', { ascending: true }),
    supabase.from('google_connections').select('site_id,gsc_site_url'),
  ])

  if (sitesResult.error) throw new Error(sitesResult.error.message)

  const properties = new Map<string, string | null>()
  for (const row of connectionsResult.data ?? []) {
    properties.set(row.site_id, row.gsc_site_url ?? null)
  }

  return (sitesResult.data ?? []).map((site) => ({
    id: site.id,
    name: site.name,
    url: site.url,
    type: site.type,
    isActive: Boolean(site.is_active),
    googleConnected: properties.has(site.id),
    gscProperty: properties.get(site.id) ?? null,
  }))
}

/** Campaign ids of a site — `editorial_calendar` and `job_executions` carry no `site_id`. */
async function campaignIdsForSite(siteId: string): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.from('campaigns').select('id').eq('site_id', siteId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.id as string)
}

// ─── Production ──────────────────────────────────────────────────────────────

export interface UpcomingSlot {
  id: string
  scheduledDate: string
  pageType: string
  targetKeyword: string
  targetCity: string | null
  status: string
  attemptCount: number
  errorMessage: string | null
}

export interface JobRun {
  jobType: string
  status: string
  durationMs: number | null
  executedAt: string
  errorMessage: string | null
}

export interface JobFamilyStats {
  jobType: string
  total: number
  failed: number
  averageMs: number | null
}

export interface RecentGeneration {
  id: string
  title: string | null
  city: string | null
  pageType: string
  status: string
  createdAt: string
  publishedUrl: string | null
  errorMessage: string | null
}

export interface ProductionMetrics {
  window: DashboardWindow
  /** True when the site has produced at all, ever — tells "never started" from "quiet month". */
  hasHistory: boolean
  counts: {
    attempted: number
    produced: number
    published: number
    rejected: number
    failed: number
    inProgress: number
  }
  allTime: { produced: number; published: number }
  /** `null` when nothing was attempted: 0 % would read as "flawless". */
  failureRate: number | null
  /** Mean of the successful generation runs, in ms. `null` when none was timed. */
  averageGenerationMs: number | null
  plannedSlots: number
  upcomingSlots: UpcomingSlot[]
  perDay: Array<{ date: string; produced: number; published: number }>
  /** Days in the window carrying at least one generation — decides whether a curve is honest. */
  activeDays: number
  runs: JobRun[]
  runStats: JobFamilyStats[]
  recent: RecentGeneration[]
  /** A table could not be read (missing/renamed). Displayed, never swallowed. */
  unreadable: string[]
}

interface GenerationRow {
  id: string
  status: string
  page_type: string | null
  title: string | null
  city: string | null
  published_url: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  published_at: string | null
}

interface SlotRow {
  id: string
  scheduled_date: string
  page_type: string
  target_keyword: string
  target_city: string | null
  status: string
  attempt_count: number | null
  error_message: string | null
}

interface RunRow {
  job_type: string
  job_id: string | null
  campaign_id: string | null
  generation_id: string | null
  status: string
  /** `bigint` in Postgres, so PostgREST may hand it back as a string. */
  duration_ms: number | string | null
  executed_at: string
  error_message: string | null
}

/**
 * `cleanupOldLogs()` in lib/scheduler/cron.ts deletes anything older than this,
 * so a 90-day window still only ever shows a week of runs. The tab says so
 * rather than letting the gap read as "the engine stopped".
 */
export const JOB_HISTORY_DAYS = 7

const PRODUCED_STATUSES = new Set(['generated', 'publishing', 'published'])
const IN_PROGRESS_STATUSES = new Set(['pending', 'generating'])

export async function getProductionMetrics(siteId: string | null, days: number): Promise<ProductionMetrics> {
  const supabase = createServiceClient()
  const window = buildWindow(days)
  const unreadable: string[] = []

  // `editorial_calendar` carries a campaign, never a site, so scoping it to a
  // site goes through that site's campaigns. A site with no campaign has no
  // slot — that is a fact about the site, not a failed read.
  const campaignIds = siteId ? await campaignIdsForSite(siteId) : null
  const scopedToNoCampaign = campaignIds !== null && campaignIds.length === 0

  // Every generation row, not just the window's: the all-time totals and the
  // "published during the window but created before it" case both need them.
  // `content` is deliberately absent from the projection — it is the one heavy
  // column, and nothing here counts words.
  const generations = await readAll<GenerationRow>((from, to) => {
    let query = supabase
      .from('generations')
      .select('id,status,page_type,title,city,published_url,error_message,created_at,updated_at,published_at')
    if (siteId) query = query.eq('site_id', siteId)
    return query.order('created_at', { ascending: false }).range(from, to)
  })

  if (generations === null) unreadable.push('generations')

  const slots: SlotRow[] | null = scopedToNoCampaign
    ? []
    : await readAll<SlotRow>((from, to) => {
        let query = supabase
          .from('editorial_calendar')
          .select('id,scheduled_date,page_type,target_keyword,target_city,status,attempt_count,error_message')
        if (campaignIds) query = query.in('campaign_id', campaignIds)
        return query.order('scheduled_date', { ascending: true }).range(from, to)
      })

  if (slots === null) unreadable.push('editorial_calendar')

  // Scoped in JS rather than in the query, on purpose. `logJobExecution()` fills
  // `campaign_id` for the slot and publish jobs but NOT for the generation job,
  // which puts the campaign in `job_id` instead — an `.eq('campaign_id', …)`
  // therefore silently drops every generation timing as soon as a site is
  // picked, and "durée moyenne de génération" would read "—" per site while the
  // aggregate view showed a figure. Three keys are tried instead of one.
  const runs: RunRow[] | null = await readAll<RunRow>((from, to) =>
    supabase
      .from('job_executions')
      .select('job_type,job_id,campaign_id,generation_id,status,duration_ms,executed_at,error_message')
      .gte('executed_at', `${window.start}T00:00:00.000Z`)
      .order('executed_at', { ascending: false })
      .range(from, to)
  )

  if (runs === null) unreadable.push('job_executions')

  // ── Generation counters ──
  const rows = generations ?? []
  const inWindow = rows.filter((row) => row.created_at >= window.start)

  const counts = {
    attempted: inWindow.length,
    produced: inWindow.filter((row) => PRODUCED_STATUSES.has(row.status)).length,
    published: rows.filter((row) => row.status === 'published' && publicationDay(row) >= window.start).length,
    rejected: inWindow.filter((row) => row.status === 'rejected').length,
    failed: inWindow.filter((row) => row.status === 'failed').length,
    inProgress: inWindow.filter((row) => IN_PROGRESS_STATUSES.has(row.status)).length,
  }

  const perDayMap = new Map<string, { produced: number; published: number }>()
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(`${window.end}T00:00:00.000Z`)
    day.setUTCDate(day.getUTCDate() - offset)
    perDayMap.set(isoDate(day), { produced: 0, published: 0 })
  }
  for (const row of inWindow) {
    const bucket = perDayMap.get(row.created_at.slice(0, 10))
    if (bucket) bucket.produced += 1
  }
  for (const row of rows) {
    if (row.status !== 'published') continue
    const bucket = perDayMap.get(publicationDay(row))
    if (bucket) bucket.published += 1
  }
  const perDay = [...perDayMap.entries()]
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // ── Engine runs ──
  const generationIds = new Set(rows.map((row) => row.id))
  const campaignIdSet = campaignIds ? new Set(campaignIds) : null
  const runRows = (runs ?? []).filter((run) => {
    if (!campaignIdSet) return true
    if (run.campaign_id && campaignIdSet.has(run.campaign_id)) return true
    if (run.job_id && campaignIdSet.has(run.job_id)) return true
    if (run.generation_id && generationIds.has(run.generation_id)) return true
    return false
  })

  const statsByFamily = new Map<string, { total: number; failed: number; msSum: number; msCount: number }>()
  for (const run of runRows) {
    const family = statsByFamily.get(run.job_type) ?? { total: 0, failed: 0, msSum: 0, msCount: 0 }
    family.total += 1
    if (run.status === 'failed') family.failed += 1
    const ms = run.duration_ms === null ? null : Number(run.duration_ms)
    if (ms !== null && Number.isFinite(ms) && run.status !== 'failed') {
      family.msSum += ms
      family.msCount += 1
    }
    statsByFamily.set(run.job_type, family)
  }

  const runStats: JobFamilyStats[] = [...statsByFamily.entries()]
    .map(([jobType, value]) => ({
      jobType,
      total: value.total,
      failed: value.failed,
      averageMs: value.msCount > 0 ? Math.round(value.msSum / value.msCount) : null,
    }))
    .sort((a, b) => b.total - a.total)

  // The generation job proper. `editorial_slot` wraps it and `publish` follows
  // it, so timing anything else would measure a different thing under the same
  // label.
  const generationFamily = statsByFamily.get('campaign')

  const today = isoDate(new Date())
  const slotRows = slots ?? []
  const upcomingSlots = slotRows
    .filter((slot) => slot.status === 'planned' && slot.scheduled_date.slice(0, 10) >= today)
    .slice(0, 8)
    .map((slot) => ({
      id: slot.id,
      scheduledDate: slot.scheduled_date.slice(0, 10),
      pageType: slot.page_type,
      targetKeyword: slot.target_keyword,
      targetCity: slot.target_city,
      status: slot.status,
      attemptCount: slot.attempt_count ?? 0,
      errorMessage: slot.error_message,
    }))

  return {
    window,
    hasHistory: rows.length > 0,
    counts,
    allTime: {
      produced: rows.filter((row) => PRODUCED_STATUSES.has(row.status)).length,
      published: rows.filter((row) => row.status === 'published').length,
    },
    failureRate: counts.attempted > 0 ? counts.failed / counts.attempted : null,
    averageGenerationMs: generationFamily && generationFamily.msCount > 0
      ? Math.round(generationFamily.msSum / generationFamily.msCount)
      : null,
    plannedSlots: slotRows.filter((slot) => slot.status === 'planned' && slot.scheduled_date.slice(0, 10) >= today).length,
    upcomingSlots,
    perDay,
    activeDays: perDay.filter((day) => day.produced > 0).length,
    runs: runRows.slice(0, 8).map((run) => ({
      jobType: run.job_type,
      status: run.status,
      durationMs: run.duration_ms === null ? null : Number(run.duration_ms),
      executedAt: run.executed_at,
      errorMessage: run.error_message,
    })),
    runStats,
    recent: inWindow.slice(0, 8).map((row) => ({
      id: row.id,
      title: row.title,
      city: row.city,
      pageType: row.page_type ?? 'unknown',
      status: row.status,
      createdAt: row.created_at,
      publishedUrl: row.published_url,
      errorMessage: row.error_message,
    })),
    unreadable,
  }
}

/** `published_at` was added after the fact; older rows only ever had `updated_at`. */
function publicationDay(row: GenerationRow): string {
  return (row.published_at ?? row.updated_at).slice(0, 10)
}

// ─── Performance (Search Console) ────────────────────────────────────────────

/**
 * Four situations that all render as "no chart" and must never render as the
 * same message — a site with no Google connection needs a connect button, not a
 * row of zeros.
 */
export type GscAvailability =
  | 'no-site'            // nothing has been connected to the engine at all
  | 'not-connected'      // the site exists, Google was never authorised
  | 'no-property'        // OAuth done, but no Search Console property was picked
  | 'connected-no-data'  // property picked, nothing synced into gsc_performance yet
  | 'no-data-in-window'  // rows exist, none inside the selected period
  | 'unreadable'         // the read failed — say so rather than show zeros
  | 'ok'

export interface PositionBand {
  id: string
  label: string
  hint: string
  impressions: number
  clicks: number
  /** Distinct (page, query) couples ranking in this band. */
  couples: number
}

export interface StrikingQuery {
  query: string
  pageUrl: string
  position: number
  impressions: number
  clicks: number
}

export interface ZeroClickPage {
  pageUrl: string
  impressions: number
  position: number
  topQuery: string
}

export interface PerformanceMetrics {
  window: DashboardWindow
  availability: GscAvailability
  /** Sites in scope that have no usable Search Console link, so the page can offer to fix it. */
  disconnected: DashboardSite[]
  connectedCount: number
  /** The Search Console property the figures come from, when the scope is a single site. */
  property: string | null
  coverage: {
    rows: number
    pages: number
    queries: number
    /** Actual data bounds — Search Console lags 2–3 days, and the page must say so. */
    firstDate: string | null
    lastDate: string | null
  }
  totals: {
    clicks: number
    impressions: number
    /** Recomputed from the totals; a mean of daily ratios is not the site's CTR. */
    ctr: number
    /** Impressions-weighted; an unweighted mean lets a 1-impression day count as much as a 1000. */
    position: number
  }
  perDay: Array<{ date: string; clicks: number; impressions: number }>
  bands: PositionBand[]
  striking: {
    queries: StrikingQuery[]
    total: number
    impressions: number
    clicks: number
    /** Clicks these queries would win at the site's own top-3 CTR. Stated as a hypothesis, never as a fact. */
    minPosition: number
    maxPosition: number
  }
  zeroClickPages: ZeroClickPage[]
  zeroClickImpressions: number
}

/** Positions read as four bands: the podium, the rest of page 1, page 2, and beyond. */
const POSITION_BANDS: Array<{ id: string; label: string; hint: string; min: number; max: number }> = [
  { id: 'podium', label: 'Positions 1-3', hint: 'Le podium : la quasi-totalité des clics', min: 0, max: 3.5 },
  { id: 'page1', label: 'Positions 4-10', hint: 'Bas de première page', min: 3.5, max: 10.5 },
  { id: 'page2', label: 'Positions 11-20', hint: 'Deuxième page : vu, jamais cliqué', min: 10.5, max: 20.5 },
  { id: 'beyond', label: 'Position 21+', hint: 'Au-delà : hors de portée immédiate', min: 20.5, max: Infinity },
]

export async function getPerformanceMetrics(
  siteId: string | null,
  days: number,
  sites: DashboardSite[]
): Promise<PerformanceMetrics> {
  const window = buildWindow(days)
  const scoped = siteId ? sites.filter((site) => site.id === siteId) : sites
  const usable = scoped.filter((site) => site.googleConnected && site.gscProperty)
  const disconnected = scoped.filter((site) => !site.googleConnected || !site.gscProperty)

  const empty = (availability: GscAvailability): PerformanceMetrics => ({
    window,
    availability,
    disconnected,
    connectedCount: usable.length,
    property: scoped.length === 1 ? scoped[0].gscProperty : null,
    coverage: { rows: 0, pages: 0, queries: 0, firstDate: null, lastDate: null },
    totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    perDay: [],
    bands: POSITION_BANDS.map((band) => ({
      id: band.id,
      label: band.label,
      hint: band.hint,
      impressions: 0,
      clicks: 0,
      couples: 0,
    })),
    striking: {
      queries: [],
      total: 0,
      impressions: 0,
      clicks: 0,
      minPosition: STRIKING_DISTANCE_MIN_POSITION,
      maxPosition: STRIKING_DISTANCE_MAX_POSITION,
    },
    zeroClickPages: [],
    zeroClickImpressions: 0,
  })

  if (sites.length === 0) return empty('no-site')
  if (usable.length === 0) {
    const anyOauth = scoped.some((site) => site.googleConnected)
    return empty(anyOauth ? 'no-property' : 'not-connected')
  }

  const supabase = createServiceClient()
  const siteIds = usable.map((site) => site.id)

  const rows = await readAll<GscRawRow>((from, to) =>
    supabase
      .from('gsc_performance')
      .select('date,page_url,query,clicks,impressions,position')
      .in('site_id', siteIds)
      .gte('date', window.start)
      .order('date', { ascending: true })
      .range(from, to)
  )

  if (rows === null) return empty('unreadable')
  if (rows.length === 0) {
    // Distinguish "never synced" from "synced, but nothing in this period".
    const { count } = await supabase
      .from('gsc_performance')
      .select('id', { count: 'exact', head: true })
      .in('site_id', siteIds)
    return empty((count ?? 0) > 0 ? 'no-data-in-window' : 'connected-no-data')
  }

  const clicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0)
  const impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0)
  const positionWeight = rows.reduce((sum, row) => sum + (row.position || 0) * (row.impressions || 0), 0)

  const perDayMap = new Map<string, { clicks: number; impressions: number }>()
  const dates: string[] = []
  for (const row of rows) {
    const day = row.date.slice(0, 10)
    const bucket = perDayMap.get(day)
    if (bucket) {
      bucket.clicks += row.clicks || 0
      bucket.impressions += row.impressions || 0
    } else {
      perDayMap.set(day, { clicks: row.clicks || 0, impressions: row.impressions || 0 })
      dates.push(day)
    }
  }

  const stats = aggregateRows(rows)

  const bands = POSITION_BANDS.map((band) => {
    const inBand = stats.filter((stat) => stat.position >= band.min && stat.position < band.max)
    return {
      id: band.id,
      label: band.label,
      hint: band.hint,
      impressions: inBand.reduce((sum, stat) => sum + stat.impressions, 0),
      clicks: inBand.reduce((sum, stat) => sum + stat.clicks, 0),
      couples: inBand.length,
    }
  })

  // A generous limit on purpose: the hero figure counts these, and a cap of 50
  // would quietly turn "how many queries sit in striking distance" into "50".
  const striking = selectStrikingDistance(stats, { limit: 1000 })
  const zeroClickPages = selectZeroClickPages(stats)

  return {
    window,
    availability: 'ok',
    disconnected,
    connectedCount: usable.length,
    property: usable.length === 1 ? usable[0].gscProperty : null,
    coverage: {
      rows: rows.length,
      pages: new Set(stats.map((stat) => normalizePageUrl(stat.pageUrl))).size,
      queries: new Set(stats.map((stat) => stat.query)).size,
      firstDate: dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null,
      lastDate: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null,
    },
    totals: {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position: impressions > 0 ? positionWeight / impressions : 0,
    },
    perDay: [...perDayMap.entries()]
      .map(([date, value]) => ({ date, ...value }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    bands,
    striking: {
      queries: striking.slice(0, 12),
      total: striking.length,
      impressions: striking.reduce((sum, item) => sum + item.impressions, 0),
      clicks: striking.reduce((sum, item) => sum + item.clicks, 0),
      minPosition: STRIKING_DISTANCE_MIN_POSITION,
      maxPosition: STRIKING_DISTANCE_MAX_POSITION,
    },
    zeroClickPages: zeroClickPages.slice(0, 10),
    zeroClickImpressions: zeroClickPages.reduce((sum, page) => sum + page.impressions, 0),
  }
}

/**
 * Pages Google displayed and nobody ever clicked.
 *
 * A ten-impression page with no click is noise; the floor keeps the list to
 * pages that were genuinely offered to users and refused.
 */
const ZERO_CLICK_MIN_IMPRESSIONS = 10

function selectZeroClickPages(stats: QueryPageStat[]): ZeroClickPage[] {
  const byPage = new Map<
    string,
    { clicks: number; impressions: number; positionWeight: number; topQuery: string; topImpressions: number }
  >()

  for (const stat of stats) {
    const key = normalizePageUrl(stat.pageUrl)
    const bucket = byPage.get(key) ?? {
      clicks: 0,
      impressions: 0,
      positionWeight: 0,
      topQuery: '',
      topImpressions: 0,
    }
    bucket.clicks += stat.clicks
    bucket.impressions += stat.impressions
    bucket.positionWeight += stat.position * stat.impressions
    if (stat.impressions > bucket.topImpressions) {
      bucket.topQuery = stat.query
      bucket.topImpressions = stat.impressions
    }
    byPage.set(key, bucket)
  }

  const pages: ZeroClickPage[] = []
  for (const [pageUrl, bucket] of byPage) {
    if (bucket.clicks > 0) continue
    if (bucket.impressions < ZERO_CLICK_MIN_IMPRESSIONS) continue
    pages.push({
      pageUrl,
      impressions: bucket.impressions,
      position: bucket.impressions > 0 ? Math.round((bucket.positionWeight / bucket.impressions) * 10) / 10 : 0,
      topQuery: bucket.topQuery,
    })
  }

  return pages.sort((a, b) => b.impressions - a.impressions)
}
