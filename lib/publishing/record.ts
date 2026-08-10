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

import { updateGeneration } from '@/lib/db'
import { countHtmlWords, indexPublishedPage } from '@/lib/pipeline'
import { submitForIndexing } from '@/lib/seo/indexing'
import type { GeneratedPage } from '@/lib/ai/openai'
import type { PageType, Site } from '@/lib/types'
import type { PublishOutcome } from './outcome'

export interface RecordOptions {
  site: Site
  page: GeneratedPage
  pageType?: PageType
  generationId?: string
  outcome: PublishOutcome
}

export interface RecordReport {
  /** The row was updated. False when there is no row to update. */
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
    } catch (error) {
      problems.push(`statut non enregistre : ${message(error)}`)
    }
  }

  if (!outcome.live || !outcome.pageUrl) {
    return { stored: Boolean(generationId) && problems.length === 0, indexed: false, problems }
  }

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

  return { stored: Boolean(generationId) && problems.length === 0, indexed: true, problems }
}

/** `published_page_id` is an integer column; a commit SHA is not one. */
function toNumericId(remoteId: string | undefined): number | undefined {
  if (!remoteId) return undefined
  return /^\d+$/.test(remoteId) ? Number(remoteId) : undefined
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
