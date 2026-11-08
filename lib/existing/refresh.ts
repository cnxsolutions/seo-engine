// ─────────────────────────────────────────────────────────────────────────────
// Refreshing a site's inventory
// SEO Engine - Re-read the pages already online, nothing else.
// ─────────────────────────────────────────────────────────────────────────────
//
// The only crawl the interface could start was the one inside a new strategy:
// « Rafraîchir » sent the operator through business type, communes and
// competitors to re-read pages the engine already knew. This is the crawl
// alone — the same steps as the analysis and the cycle renewal: read the site,
// write `site_pages`, date the campaigns, feed the vector index.
//
// A crawl reads up to a few hundred pages one by one, minutes on a real site —
// longer than the proxy in front of the app holds a request open. So it runs as
// a job and the screen polls it. The job table lives in memory, which is sound
// for one reason only, stated in CLAUDE.md: this application runs as a single
// process. A restart forgets a running job; the screen then says so.

import { crawlWebsite } from '@/lib/analyzer/crawler'
import { toSitePagePayloads } from '@/lib/analyzer/to-site-pages'
import { markSiteCampaignsCrawled, upsertSitePages } from '@/lib/db'
import { indexSitePages } from '@/src/adapters/rag/VectorIndexingService'

/** Enough for every site connected today (Flowyne lists 107 URLs, CNX 54 pages). */
export const REFRESH_MAX_PAGES = 200

export interface RefreshJob {
  state: 'running' | 'done' | 'failed'
  startedAt: string
  finishedAt?: string
  /** Pages the crawler read. */
  pagesRead?: number
  /** True when the cap stopped the crawl with pages left to read. */
  truncated?: boolean
  /** Why it failed, in words the operator can act on. */
  error?: string
}

const jobs = new Map<string, RefreshJob>()

export function refreshJobOf(siteId: string): RefreshJob | null {
  return jobs.get(siteId) ?? null
}

/**
 * Start re-reading a site, or return the job already doing it: two clicks, or
 * two tabs, must not crawl the same site twice in parallel.
 */
export function startInventoryRefresh(site: { id: string; url: string }): RefreshJob {
  const current = jobs.get(site.id)
  if (current?.state === 'running') return current

  const job: RefreshJob = { state: 'running', startedAt: new Date().toISOString() }
  jobs.set(site.id, job)

  void runRefresh(site).then(
    (result) => jobs.set(site.id, { ...job, ...result, state: 'done', finishedAt: new Date().toISOString() }),
    (error: unknown) => jobs.set(site.id, {
      ...job,
      state: 'failed',
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    })
  )
  return job
}

async function runRefresh(site: { id: string; url: string }): Promise<Pick<RefreshJob, 'pagesRead' | 'truncated'>> {
  const crawl = await crawlWebsite({ siteUrl: site.url, maxPages: REFRESH_MAX_PAGES, followLinks: true })
  if (crawl.pages.length === 0) {
    throw new Error(
      `Aucune page lue sur ${site.url} : plan de site injoignable, site protégé (Cloudflare, maintenance) ` +
        'ou rendu entièrement côté client. Les pages déjà connues sont conservées.'
    )
  }

  await upsertSitePages(site.id, toSitePagePayloads(site.id, crawl) as Parameters<typeof upsertSitePages>[1])
  await markSiteCampaignsCrawled(site.id)

  // Never fails the refresh: the inventory is written, a stale vector index
  // only delays what retrieval sees (indexSitePages reports, it never throws).
  const indexing = await indexSitePages(site.id, { source: 'crawl' })
  if (indexing.errors.length > 0) {
    console.warn(`[rafraichir] indexation partielle site=${site.id}:`, indexing.errors.join(' | '))
  }

  return { pagesRead: crawl.pages.length, truncated: crawl.truncated === true }
}
