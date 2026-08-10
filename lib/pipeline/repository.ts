// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Repository
// SEO Engine - Post-generation pipeline
// Every database read the pipeline needs, and nothing else
// ─────────────────────────────────────────────────────────────────────────────
//
// Isolated here so the rest of the module stays pure and testable without a
// database. It lives in lib/pipeline rather than lib/db.ts for the same reason
// the scheduler keeps its own claims in lib/scheduler/editorial.ts: this is
// pipeline-internal data access, and lib/db.ts is a shared surface.

import { createServiceClient } from '@/lib/supabase'
import type { Generation, PageType } from '@/lib/types'
import { buildKnownPathSet } from './internal-links'
import type { InternalLinkTarget } from '@/lib/seo/internal-linking'

/**
 * How many published pages may be offered to the linker as candidates.
 *
 * The linker only injects an anchor when its text already appears in the page,
 * so a long list costs a few regex passes and nothing else — but it is still a
 * list that gets rendered into a navigation block, and a hundred "see also"
 * entries is not internal linking, it is a sitemap.
 */
const MAX_LINK_CANDIDATES = 40

export interface SiteLinkContext {
  /**
   * Normalised paths of every page that really exists on the site: crawled
   * pages plus already published generations.
   */
  knownPaths: Set<string>
  /** Published generations, enough of each row for `buildLinkGraph`. */
  publishedGenerations: Generation[]
  /** Real, existing destinations the linker may propose. */
  candidates: InternalLinkTarget[]
  counts: { crawledPages: number; publishedGenerations: number }
}

/**
 * Read what exists on the site, once, before any link is validated.
 *
 * `site_pages` is the crawl of the client's own site; `generations` in
 * `published` are the pages this engine put online. Anything outside those two
 * sets does not exist as far as this site is concerned, whatever the model
 * believed when it wrote the href.
 */
export async function loadSiteLinkContext(siteId: string): Promise<SiteLinkContext> {
  const supabase = createServiceClient()

  const [pagesResult, generationsResult] = await Promise.all([
    supabase.from('site_pages').select('path,title,updated_at').eq('site_id', siteId),
    supabase
      .from('generations')
      .select('id,slug,title,focus_keyword,page_type,parent_generation_id,updated_at')
      .eq('site_id', siteId)
      .eq('status', 'published')
      .not('slug', 'is', null)
      .order('updated_at', { ascending: false }),
  ])

  if (pagesResult.error) throw new Error(pagesResult.error.message)
  if (generationsResult.error) throw new Error(generationsResult.error.message)

  const crawled = (pagesResult.data ?? []) as Array<{ path: string; title?: string | null }>
  const published = (generationsResult.data ?? []) as Array<{
    id: string
    slug: string
    title?: string | null
    focus_keyword?: string | null
    page_type?: PageType | null
    parent_generation_id?: string | null
  }>

  const knownPaths = buildKnownPathSet([
    ...crawled.map(page => page.path),
    ...published.map(generation => generation.slug),
  ])

  const candidates: InternalLinkTarget[] = []
  const seenHrefs = new Set<string>()

  const pushCandidate = (anchor: string | null | undefined, href: string) => {
    const text = (anchor || '').trim()
    // An anchor shorter than this matches half the page by accident; the linker
    // would turn a stray "eau" into a link.
    if (text.length < 8) return
    if (seenHrefs.has(href)) return
    seenHrefs.add(href)
    candidates.push({ anchor: text, href })
  }

  for (const generation of published) {
    pushCandidate(generation.title || generation.focus_keyword, `/${generation.slug.replace(/^\//, '')}`)
  }
  for (const page of crawled) {
    pushCandidate(page.title, page.path.startsWith('/') ? page.path : `/${page.path}`)
  }

  return {
    knownPaths,
    publishedGenerations: published as unknown as Generation[],
    candidates: candidates.slice(0, MAX_LINK_CANDIDATES),
    counts: { crawledPages: crawled.length, publishedGenerations: published.length },
  }
}

// ─── Rejection ──────────────────────────────────────────────────────────────

/** Longest reason string persisted, matching `failEditorialSlot`. */
const MAX_ERROR_MESSAGE = 2000

export interface RejectionOutcome {
  status: 'rejected' | 'failed'
  message: string
}

/**
 * Park a generation the gate refused, without ever losing it.
 *
 * `rejected` is a real member of `GenerationStatus`, but the `generations` table
 * was created by hand and its CHECK constraint is not in this repository (see
 * migration 008, which widens it). If the write is refused the row falls back to
 * `failed`: a status the table has accepted since day one. Both are terminal and
 * both carry the reasons — what must never happen is a generated, paid-for page
 * silently staying in `generated` where the publishing job would pick it up
 * again and publish exactly what the gate just refused.
 */
export async function markGenerationRejected(
  generationId: string,
  reasons: string[]
): Promise<RejectionOutcome> {
  const supabase = createServiceClient()
  const message = `Rejete par le pipeline : ${reasons.join(' | ')}`.slice(0, MAX_ERROR_MESSAGE)

  const { error } = await supabase
    .from('generations')
    .update({ status: 'rejected', error_message: message, updated_at: new Date().toISOString() })
    .eq('id', generationId)

  if (!error) return { status: 'rejected', message }

  const { error: fallbackError } = await supabase
    .from('generations')
    .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
    .eq('id', generationId)

  if (fallbackError) throw new Error(fallbackError.message)
  return { status: 'failed', message }
}
