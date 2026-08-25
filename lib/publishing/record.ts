// ─────────────────────────────────────────────────────────────────────────────
// What happens after the push
// SEO Engine - Written once, because three copies had already drifted.
// ─────────────────────────────────────────────────────────────────────────────
//
// The same sequence existed in three places — the HTTP route, the deferred
// publishing job, and the campaign job — and they had already diverged. One
// stamped `published_at`, another did not; one fed the vector index, another
// skipped it; one stored the GitHub blob URL where the live page URL belongs.
//
// The rule this consolidates, and which none of the three had:
//
//   INDEXING FOLLOWS `live`, NOT SUCCESS.
//
// A page committed to a branch nobody deploys is a successful publication and
// an unreachable URL. So is a WordPress draft at `?page_id=123`. Both were being
// stamped with a publication date and handed to IndexNow and to Google's
// Indexing API. Asking a search engine to index a 404 is not a neutral mistake:
// it spends crawl budget and teaches the engine that this site advertises pages
// that are not there.
//
// The same rule now governs a second write. A live page is inserted into
// `site_pages` on the spot instead of waiting for the next crawl: without it the
// generator works for days against an inventory that ignores what the engine has
// just put online, and proposes again the very slug it already occupies.

import { CONTENT_EXCERPT_MAX_CHARS } from '@/lib/analyzer/crawler'
import { updateGeneration, upsertSitePages } from '@/lib/db'
import { countHtmlWords, indexPublishedPage } from '@/lib/pipeline'
import { censusHeadings } from '@/lib/pipeline/structure'
import { submitForIndexing } from '@/lib/seo/indexing'
import { normalizeInventoryPath } from '@/src/core/domain/existing/inventory'
import { stripHtmlToText } from '@/src/core/domain/text/text-utils'
import type { GeneratedPage } from '@/lib/ai/openai'
import type { CreateSitePagePayload, PageType, Site } from '@/lib/types'
import type { PublishOutcome } from './outcome'

export interface RecordOptions {
  site: Site
  page: GeneratedPage
  pageType?: PageType
  generationId?: string
  outcome: PublishOutcome
}

export interface RecordReport {
  /**
   * The `generations` row was updated. False when there is no row to update.
   *
   * Answers about that row and NOTHING else. It used to be computed from
   * `problems.length === 0`, so an unrelated failure — indexing, the vector
   * store, the inventory — reported that the row had not been written when it
   * had. A caller reading that lie republishes a page that is already online.
   */
  stored: boolean
  /** Search engines were told. False whenever the page is not live. */
  indexed: boolean
  /** Anything that went wrong here, which never fails the publication. */
  problems: string[]
}

/**
 * Close the generation row, then — only if the page is actually reachable —
 * tell the search engines and the vector index about it.
 *
 * Never throws. By the time this runs the content is at the other end; turning
 * a bookkeeping failure into a publication failure is how a caller decides to
 * push a second time.
 */
export async function recordPublication(opts: RecordOptions): Promise<RecordReport> {
  const { site, page, pageType, generationId, outcome } = opts
  const problems: string[] = []
  let generationStored = false

  if (generationId) {
    try {
      await updateGeneration(generationId, {
        status: 'published',
        published_url: outcome.pageUrl,
        published_page_id: toNumericId(outcome.remoteId),
        // Persisted rather than logged and lost: this is how the operator sees,
        // on the publication list, that a page went out as a bare `<article>`
        // or that WordPress stripped its structured data.
        publish_mode: outcome.mode ?? null,
        publish_live: outcome.live,
        publish_notes: outcome.notes.length > 0 ? outcome.notes : null,
        // Cleared: a page that just went out is no longer refused, and a stale
        // badge is worse than none.
        refusal_kind: null,
        // Stamped once, and ONLY when the page is reachable. The J+30 Search
        // Console measurement joins a page to the thirty days that followed its
        // publication; dating it from a commit that is not deployed measures a
        // period during which nobody could visit it.
        ...(outcome.live ? { published_at: new Date().toISOString() } : {}),
      })
      generationStored = true
    } catch (error) {
      problems.push(`statut non enregistre : ${message(error)}`)
    }
  }

  if (!outcome.live || !outcome.pageUrl) {
    return { stored: generationStored, indexed: false, problems }
  }

  // The inventory learns about this page NOW, before any external call.
  //
  // Gated on `live` for the same reason indexing is: a draft or a commit on an
  // unpromoted branch would reserve a path nobody serves and mark its topic as
  // covered, so the engine would refuse to write the page it never published.
  //
  // Failing here never fails a publication that succeeded — the row is a cache
  // of what the crawler would have found anyway, and the next crawl catches up.
  await recordInInventory(site.id, page, outcome.pageUrl, generationId).catch((error) => {
    problems.push(`inventaire non alimente : ${message(error)}`)
    return null
  })

  await submitForIndexing({ pageUrl: outcome.pageUrl, siteUrl: site.url }).catch((error) => {
    problems.push(`indexation non soumise : ${message(error)}`)
    return null
  })

  if (generationId) {
    // The vector index is what lets the generator's retrieval see an already
    // published page. Skipping it leaves the page online and invisible to every
    // semantic search the engine runs afterwards — including its own
    // internal-link suggestions.
    await indexPublishedPage({
      siteId: site.id,
      generationId,
      pageType: pageType ?? 'child',
      title: page.title,
      html: page.htmlContent,
      url: outcome.pageUrl,
      focusKeyword: page.focusKeyword,
      wordCount: countHtmlWords(page.htmlContent),
      publishedAt: new Date().toISOString(),
    }).catch((error) => {
      problems.push(`index vectoriel non alimente : ${message(error)}`)
      return null
    })
  }

  return { stored: generationStored, indexed: true, problems }
}

/**
 * Write the `site_pages` row for a page a visitor can reach.
 *
 * Idempotent by construction: `upsertSitePages` conflicts on `(site_id, path)`,
 * which `idx_site_pages_url` already enforces, so republishing the same path
 * updates the one row instead of adding a second entry for the same page.
 */
async function recordInInventory(
  siteId: string,
  page: GeneratedPage,
  pageUrl: string,
  generationId: string | undefined,
): Promise<void> {
  // Normalised by the domain's own function, never by a local variant. Three
  // writers must land on the same string — the SQL seeding of migration 018, the
  // crawler, and this call — or the same page holds two inventory entries and
  // neither of them sees the other.
  const path = normalizeInventoryPath(new URL(pageUrl).pathname)

  const payload: CreateSitePagePayload = {
    site_id: siteId,
    url: pageUrl,
    path,
    title: page.title,
    meta_description: page.metaDescription,
    // The H1 the page actually carries, not the title. They diverge often enough
    // that reading the title here would hide the divergence from the operator.
    h1: censusHeadings(page.htmlContent).h1Texts[0],
    focus_keyword: page.focusKeyword,
    word_count: countHtmlWords(page.htmlContent),
    // TEXT, not HTML, and capped like the crawler caps its own excerpt. The
    // column feeds the lexical duplicate comparison: markup left in would make
    // every page produced by the same template look like a duplicate of the
    // others, and none of them like the page it really duplicates.
    content_excerpt: stripHtmlToText(page.htmlContent).slice(0, CONTENT_EXCERPT_MAX_CHARS),
    origin: 'engine',
    generation_id: generationId,
    crawled_at: new Date().toISOString(),
    // Below: what only a crawler visit can observe. Left neutral rather than
    // guessed. The inventory reads title, meta, focus keyword and body and
    // nothing else, so a fabricated heading list or schema flag would buy
    // nothing and would sit in the column where the next crawl writes the truth.
    h2s: [],
    keywords: [],
    internal_links: [],
    external_links: [],
    has_schema: false,
    schema_types: [],
    has_faq: false,
    has_local_business: false,
    geo_signals: [],
  }

  await upsertSitePages(siteId, [payload])
}

/** `published_page_id` is an integer column; a commit SHA is not one. */
function toNumericId(remoteId: string | undefined): number | undefined {
  if (!remoteId) return undefined
  return /^\d+$/.test(remoteId) ? Number(remoteId) : undefined
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
