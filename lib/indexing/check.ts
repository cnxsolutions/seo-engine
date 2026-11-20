// ─────────────────────────────────────────────────────────────────────────────
// The daily index check — is every known page of a site indexed by Google?
// SEO Engine - Inspect, classify, resend what resending can help.
// ─────────────────────────────────────────────────────────────────────────────
//
// For each site connected to Search Console:
//
//   1. Seed — every page the engine published and every page the crawl found
//      (`site_pages`) gets a row in `page_indexing`; pages gone from both lose
//      theirs. Engine pages come first and wait two days after publication:
//      they were already submitted when they went live.
//   2. Inspect — the rows due today, through the URL Inspection API, within a
//      budget well under Google's 2 000 inspections a day per property.
//   3. Resend — for pages Google has NOT CRAWLED yet only: the property's
//      sitemaps go back to Search Console and the URLs to IndexNow. Not the
//      Indexing API: the owner chose on 2026-11-17 to stay within what Google
//      supports for ordinary pages. A page in noindex, in 404, canonicalised
//      elsewhere or crawled and left out is reported, not resent — resending
//      cannot change what the site itself says.
//
// Runs in this process only, like every job of lib/scheduler/cron.ts: the
// « already running » guard below is a Set in memory (see CLAUDE.md).

import { getAuthenticatedClient, listConnectedSiteIds, type GoogleFetch } from '@/lib/google/client'
import { normalizePageUrl } from '@/lib/google/performance'
import { inspectUrl, stopsTheRun, type InspectionFailure, type InspectionOutcome } from '@/lib/google/url-inspection'
import { submitIndexNowUrls } from '@/lib/seo/indexing'
import { resubmitSitemaps, type SitemapSubmission } from '@/lib/seo/sitemap-submit'
import {
  ACTION_REQUIRED_RECHECK_DAYS,
  ERROR_RETRY_DAYS,
  FIRST_CHECK_DELAY_DAYS,
  addDays,
  belongsToProperty,
  classifyIndexStatus,
  isResubmittable,
  nextCheckAt,
  nextMissStreak,
  type IndexState,
} from '@/src/core/domain/indexing/status'
import {
  supabaseIndexingStore,
  type IndexingResult,
  type IndexingSources,
  type IndexingStore,
  type NewIndexingRow,
  type PageIndexingRow,
} from './store'

// ─── Tunables ────────────────────────────────────────────────────────────────

/**
 * Inspections per site and per run. A site of 200 pages is covered on day one,
 * and the daily quota of 2 000 keeps room for the « Vérifier maintenant »
 * button and for the owner's own use of Search Console.
 */
export const INSPECTIONS_PER_RUN = 300

/** « Vérifier maintenant » skips pages inspected this recently: a click must not burn the quota. */
export const FORCED_RECHECK_MIN_HOURS = 6

/**
 * The token is captured once for the whole loop, which lasts minutes: it must
 * outlive the run, not just the first call.
 */
const TOKEN_MARGIN_RUN_MS = 20 * 60 * 1000

const HOUR_MS = 3_600_000

// ─── Types ───────────────────────────────────────────────────────────────────

export type IndexCheckStatus = 'success' | 'partial' | 'skipped' | 'failed'
export type IndexCheckSkip = 'no_connection' | 'no_property' | 'already_running'

export interface IndexCheckReport {
  siteId: string
  status: IndexCheckStatus
  skipReason: IndexCheckSkip | null
  property: string | null
  /** Pages Google answered for in this run. */
  inspected: number
  /** States found in this run, by count. */
  states: Partial<Record<IndexState, number>>
  /** Pages resent (sitemap and/or IndexNow) in this run. */
  resubmitted: number
  sitemaps: string[]
  /** The failure that stopped the loop early — quota, access, token. */
  stoppedBy: InspectionFailure | null
  problems: string[]
  error: string | null
  durationMs: number
}

export interface IndexCheckDeps {
  store: IndexingStore
  connect(siteId: string): Promise<{ fetch: GoogleFetch; property: string | null }>
  inspect(googleFetch: GoogleFetch, property: string, url: string): Promise<InspectionOutcome>
  resubmitSitemaps(siteId: string): Promise<SitemapSubmission>
  submitIndexNow(urls: readonly string[]): Promise<{ submitted: string[]; error?: string }>
  now(): Date
}

export const defaultIndexCheckDeps: IndexCheckDeps = {
  store: supabaseIndexingStore,
  async connect(siteId) {
    const { fetch, connection } = await getAuthenticatedClient(siteId, { minRemainingMs: TOKEN_MARGIN_RUN_MS })
    return { fetch, property: connection.gsc_site_url }
  },
  inspect: inspectUrl,
  resubmitSitemaps: (siteId) => resubmitSitemaps({ siteId, sitemaps: [] }),
  submitIndexNow: submitIndexNowUrls,
  now: () => new Date(),
}

// ─── Pure steps ──────────────────────────────────────────────────────────────

export interface SeedPlan {
  insert: NewIndexingRow[]
  /** Rows the crawl created that turn out to be engine pages. */
  link: Array<Pick<NewIndexingRow, 'site_id' | 'url' | 'url_key' | 'generation_id' | 'priority'>>
  /** Keys of rows whose page is in neither source any more. */
  remove: string[]
}

export function planIndexingSeed(input: {
  siteId: string
  property: string
  sources: IndexingSources
  existing: ReadonlyArray<{ url_key: string; generation_id: string | null }>
  now: Date
}): SeedPlan {
  const { siteId, property, sources, now } = input
  const candidates = new Map<string, { url: string; generationId: string | null; priority: number; dueAt: Date }>()

  for (const page of sources.engine) {
    const key = normalizePageUrl(page.url)
    if (!key || candidates.has(key) || !belongsToProperty(page.url, property)) continue
    const published = page.publishedAt ? new Date(page.publishedAt) : null
    const dueAt = published && !Number.isNaN(published.getTime()) ? addDays(published, FIRST_CHECK_DELAY_DAYS) : now
    candidates.set(key, { url: page.url, generationId: page.generationId, priority: 0, dueAt })
  }

  for (const url of sources.inventory) {
    const key = normalizePageUrl(url)
    if (!key || candidates.has(key) || !belongsToProperty(url, property)) continue
    candidates.set(key, { url, generationId: null, priority: 1, dueAt: now })
  }

  const existing = new Map(input.existing.map((row) => [row.url_key, row]))
  const plan: SeedPlan = { insert: [], link: [], remove: [] }

  for (const [key, page] of candidates) {
    const row = existing.get(key)
    if (!row) {
      plan.insert.push({
        site_id: siteId,
        url: page.url,
        url_key: key,
        generation_id: page.generationId,
        priority: page.priority,
        next_check_at: page.dueAt.toISOString(),
      })
    } else if (page.generationId && !row.generation_id) {
      plan.link.push({ site_id: siteId, url: page.url, url_key: key, generation_id: page.generationId, priority: 0 })
    }
  }

  for (const key of existing.keys()) {
    if (!candidates.has(key)) plan.remove.push(key)
  }

  return plan
}

/** What one inspection — or its failure — writes on the page's row. */
export function applyInspection(row: PageIndexingRow, outcome: InspectionOutcome, now: Date): IndexingResult {
  const current = writableColumns(row)

  if (!outcome.ok) {
    // A failed call says nothing about the page: its state stays what it was.
    const retryDays = outcome.failure === 'invalid' ? ACTION_REQUIRED_RECHECK_DAYS : ERROR_RETRY_DAYS
    return { ...current, last_error: outcome.error, next_check_at: addDays(now, retryDays).toISOString() }
  }

  const { inspection } = outcome
  const state = classifyIndexStatus(inspection, row.url, normalizePageUrl)
  const missStreak = nextMissStreak(state, row.miss_streak)

  return {
    ...current,
    state,
    verdict: inspection.verdict,
    coverage_state: inspection.coverageState,
    indexing_state: inspection.indexingState,
    robots_txt_state: inspection.robotsTxtState,
    page_fetch_state: inspection.pageFetchState,
    google_canonical: inspection.googleCanonical,
    user_canonical: inspection.userCanonical,
    inspection_link: inspection.inspectionLink,
    last_crawl_at: inspection.lastCrawlTime,
    inspected_at: now.toISOString(),
    next_check_at: nextCheckAt(state, missStreak, now).toISOString(),
    miss_streak: missStreak,
    last_error: null,
  }
}

/** The row as it stands, minus what only the seeding step writes. */
function writableColumns(row: PageIndexingRow): IndexingResult {
  return {
    site_id: row.site_id,
    url: row.url,
    url_key: row.url_key,
    state: row.state,
    verdict: row.verdict,
    coverage_state: row.coverage_state,
    indexing_state: row.indexing_state,
    robots_txt_state: row.robots_txt_state,
    page_fetch_state: row.page_fetch_state,
    google_canonical: row.google_canonical,
    user_canonical: row.user_canonical,
    inspection_link: row.inspection_link,
    last_crawl_at: row.last_crawl_at,
    inspected_at: row.inspected_at,
    next_check_at: row.next_check_at,
    miss_streak: row.miss_streak,
    resubmit_count: row.resubmit_count,
    last_resubmitted_at: row.last_resubmitted_at,
    last_error: row.last_error,
  }
}

// ─── The run ─────────────────────────────────────────────────────────────────

const running = new Set<string>()

export async function checkSiteIndexing(
  siteId: string,
  opts: { force?: boolean } = {},
  deps: IndexCheckDeps = defaultIndexCheckDeps
): Promise<IndexCheckReport> {
  const startedAt = Date.now()
  const report: IndexCheckReport = {
    siteId,
    status: 'success',
    skipReason: null,
    property: null,
    inspected: 0,
    states: {},
    resubmitted: 0,
    sitemaps: [],
    stoppedBy: null,
    problems: [],
    error: null,
    durationMs: 0,
  }

  // Two runs on one site would inspect every page twice against the same quota.
  if (running.has(siteId)) return { ...report, status: 'skipped', skipReason: 'already_running' }
  running.add(siteId)

  try {
    await runCheck(siteId, opts.force === true, deps, report)
  } catch (error) {
    report.status = 'failed'
    report.error = error instanceof Error ? error.message : String(error)
  } finally {
    running.delete(siteId)
    report.durationMs = Date.now() - startedAt
  }
  return report
}

async function runCheck(siteId: string, force: boolean, deps: IndexCheckDeps, report: IndexCheckReport): Promise<void> {
  let client: Awaited<ReturnType<IndexCheckDeps['connect']>>
  try {
    client = await deps.connect(siteId)
  } catch (error) {
    report.status = 'skipped'
    report.skipReason = 'no_connection'
    report.error = error instanceof Error ? error.message : String(error)
    return
  }

  const property = client.property
  if (!property) {
    report.status = 'skipped'
    report.skipReason = 'no_property'
    return
  }
  report.property = property
  const now = deps.now()

  // 1. Seed. A failure here leaves the known rows to be inspected; it never
  //    deletes anything, because the plan is only computed from two good reads.
  try {
    const [sources, existing] = await Promise.all([deps.store.loadSources(siteId), deps.store.listKeys(siteId)])
    const plan = planIndexingSeed({ siteId, property, sources, existing, now })
    if (plan.insert.length > 0) await deps.store.insertRows(plan.insert)
    if (plan.link.length > 0) await deps.store.linkRows(plan.link)
    if (plan.remove.length > 0) await deps.store.deleteRows(siteId, plan.remove)
  } catch (error) {
    report.problems.push(`pages connues non relues : ${error instanceof Error ? error.message : String(error)}`)
  }

  // 2. Inspect what is due.
  const due = await deps.store.listDue(siteId, {
    now,
    limit: INSPECTIONS_PER_RUN,
    inspectedBefore: force ? new Date(now.getTime() - FORCED_RECHECK_MIN_HOURS * HOUR_MS) : undefined,
  })

  const results: Array<{ row: PageIndexingRow; result: IndexingResult; answered: boolean }> = []
  for (const row of due) {
    const outcome = await deps.inspect(client.fetch, property, row.url)
    if (!outcome.ok && stopsTheRun(outcome.failure)) {
      report.stoppedBy = outcome.failure
      report.error = outcome.error
      break
    }
    const result = applyInspection(row, outcome, now)
    results.push({ row, result, answered: outcome.ok })
    if (outcome.ok) {
      report.inspected += 1
      report.states[result.state] = (report.states[result.state] ?? 0) + 1
    } else {
      report.problems.push(`${row.url} : ${outcome.error}`)
    }
  }

  // 3. Resend what Google has not crawled yet — one sitemap submission for the
  //    whole site, one IndexNow batch per host. Only on a fresh answer: a failed
  //    call carries the previous state, which is no ground for resending.
  const eligible = results.filter(({ row, result, answered }) =>
    answered && isResubmittable(result.state, row.last_resubmitted_at ? new Date(row.last_resubmitted_at) : null, now)
  )
  if (eligible.length > 0) {
    const urls = eligible.map(({ row }) => row.url)
    const [sitemaps, indexNow] = await Promise.all([deps.resubmitSitemaps(siteId), deps.submitIndexNow(urls)])

    report.sitemaps = sitemaps.submitted
    report.problems.push(...sitemaps.problems.map((problem) => `sitemap : ${problem}`))
    if (indexNow.error) report.problems.push(`IndexNow : ${indexNow.error}`)

    // A sitemap lists the whole site: once one is accepted, every eligible page was resent.
    const resent = new Set(sitemaps.submitted.length > 0 ? urls : indexNow.submitted)
    for (const { row, result } of eligible) {
      if (!resent.has(row.url)) continue
      result.last_resubmitted_at = now.toISOString()
      result.resubmit_count = row.resubmit_count + 1
    }
    report.resubmitted = resent.size
  }

  // 4. Write everything in one batch: no query per page.
  if (results.length > 0) await deps.store.saveResults(results.map(({ result }) => result))

  if (report.stoppedBy) report.status = report.inspected > 0 ? 'partial' : 'failed'
}

/** The scheduler's entry point: every connected site, one after the other. */
export async function checkAllSitesIndexing(): Promise<IndexCheckReport[]> {
  const reports: IndexCheckReport[] = []
  for (const siteId of await listConnectedSiteIds()) {
    const report = await trackRun(siteId, false)
    reports.push(report)
    const line = `[indexation] site=${siteId} ${report.status} inspectees=${report.inspected} renvoyees=${report.resubmitted}`
    if (report.status === 'failed') console.error(line, report.error)
    else if (report.problems.length > 0 || report.stoppedBy) console.warn(line, report.error ?? '', report.problems.join(' | '))
    else console.info(line)
  }
  return reports
}

// ─── « Vérifier maintenant » ─────────────────────────────────────────────────
//
// Same shape as lib/existing/refresh.ts: a check lasts minutes, longer than the
// proxy holds a request open, so it runs as a job the screen polls. The last
// report of each site — the button's or the night's — stays readable here
// until the process restarts; the rows themselves are in the database.

export interface IndexCheckJob {
  state: 'running' | 'done'
  startedAt: string
  finishedAt?: string
  report?: IndexCheckReport
}

const jobs = new Map<string, IndexCheckJob>()

export function indexCheckJobOf(siteId: string): IndexCheckJob | null {
  return jobs.get(siteId) ?? null
}

export function startIndexCheck(siteId: string): IndexCheckJob {
  const current = jobs.get(siteId)
  if (current?.state === 'running') return current
  void trackRun(siteId, true)
  return jobs.get(siteId) as IndexCheckJob
}

async function trackRun(siteId: string, force: boolean): Promise<IndexCheckReport> {
  // The night's run meeting a click (or the reverse): the run in progress keeps
  // its job entry, the newcomer gets its « already running » report and leaves.
  if (jobs.get(siteId)?.state === 'running') return checkSiteIndexing(siteId, { force })

  const job: IndexCheckJob = { state: 'running', startedAt: new Date().toISOString() }
  jobs.set(siteId, job)
  // checkSiteIndexing never throws: every failure is a described report.
  const report = await checkSiteIndexing(siteId, { force })
  jobs.set(siteId, { ...job, state: 'done', finishedAt: new Date().toISOString(), report })
  return report
}
