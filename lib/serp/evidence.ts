// ─────────────────────────────────────────────────────────────────────────────
// SERP evidence
// SEO Engine - Turn a result page into measurements a brief can be built on.
// ─────────────────────────────────────────────────────────────────────────────
//
// Google supplies the LIST of pages that rank. The numbers come from crawling
// those public pages with the site's own crawler — same extractor, so a
// competitor and one of our pages are measured on the same ruler.
//
// That split matters: the list is cheap and fragile, the measurements are the
// part a brief actually needs. "Write 1 500 words because the pages ranking for
// this query average 1 500" is a decision; "write 1 500 words" alone is a guess.

import { crawlPage } from '@/lib/analyzer/crawler'
import { getSerpSnapshot, type GetSerpOptions } from './cache'
import type { RankingPageMeasurement, SerpEvidence, SerpSnapshot } from './types'

/**
 * Ranking pages measured per query.
 *
 * The first few results carry the pattern; positions 8 to 10 mostly add crawl
 * time. Five keeps a 30-brief plan at 150 page fetches spread over its run.
 */
export const MEASURED_RESULTS = 5

/** Pages crawled at once. Distinct hosts, so this is polite to each of them. */
const CRAWL_CONCURRENCY = 3

/** An H2 wording shared by at least this many ranking pages is an expected section. */
const COMMON_SECTION_MIN_OCCURRENCES = 2

export interface BuildSerpEvidenceOptions extends GetSerpOptions {
  /** Never measure our own site: it would compare the plan against itself. */
  excludeHost?: string
  measuredResults?: number
}

/**
 * Evidence for one query, or null when the SERP could not be read.
 *
 * Null is a first-class outcome, not an error: the caller plans without SERP
 * evidence exactly as it did before this module existed.
 */
export async function buildSerpEvidence(
  query: string,
  opts: BuildSerpEvidenceOptions = {}
): Promise<SerpEvidence | null> {
  const snapshot = await getSerpSnapshot(query, opts)
  if (!snapshot || snapshot.organic.length === 0) return null

  const measured = Math.min(snapshot.organic.length, opts.measuredResults ?? MEASURED_RESULTS)
  console.log(`[serp]     ${snapshot.organic.length} resultats — crawl des ${measured} premiers pour les mesurer`)

  const competitors = await measureRankingPages(snapshot, opts)

  return {
    query: snapshot.query,
    fetchedAt: snapshot.fetchedAt,
    competitors,
    peopleAlsoAsk: snapshot.peopleAlsoAsk,
    relatedSearches: snapshot.relatedSearches,
    medianWordCount: median(competitors.map((c) => c.wordCount).filter((n) => n > 0)),
    commonSections: findCommonSections(competitors),
    faqShare: competitors.length ? competitors.filter((c) => c.hasFaq).length / competitors.length : 0,
  }
}

async function measureRankingPages(
  snapshot: SerpSnapshot,
  opts: BuildSerpEvidenceOptions
): Promise<RankingPageMeasurement[]> {
  const exclude = opts.excludeHost ? normalizeHost(opts.excludeHost) : null
  const limit = opts.measuredResults ?? MEASURED_RESULTS

  const targets = snapshot.organic
    .filter((r) => !exclude || !normalizeHost(r.host).endsWith(exclude))
    .slice(0, limit)

  const measured: RankingPageMeasurement[] = []

  for (let i = 0; i < targets.length; i += CRAWL_CONCURRENCY) {
    const batch = targets.slice(i, i + CRAWL_CONCURRENCY)
    const pages = await Promise.all(
      batch.map(async (result) => {
        const origin = originOf(result.url)
        if (!origin) return null

        const page = await crawlPage(result.url, origin)
        if (!page) return null

        return {
          url: result.url,
          host: result.host,
          position: result.position,
          wordCount: page.wordCount,
          title: page.title || result.title,
          h1: page.h1,
          h2s: page.h2s,
          hasFaq: page.hasFaq,
          hasSchema: page.hasSchema,
        } satisfies RankingPageMeasurement
      })
    )

    measured.push(...pages.filter((p): p is RankingPageMeasurement => p !== null))
  }

  return measured
}

// ─── Aggregation ────────────────────────────────────────────────────────────────

/**
 * Median, not mean: one 6 000-word pillar among four 900-word pages would drag a
 * mean to a target no one on that SERP actually meets.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

/**
 * H2 wordings several ranking pages share.
 *
 * Compared on a normalised form (lowercase, no accents, no punctuation) so
 * "Combien ça coûte ?" and "Combien ca coute" count as the same section, while
 * the most readable original wording is what gets returned.
 */
export function findCommonSections(pages: RankingPageMeasurement[]): string[] {
  const groups = new Map<string, { count: number; label: string }>()

  for (const page of pages) {
    // Per page, not per occurrence: a page repeating a heading must not on its
    // own make that heading look common to the SERP.
    for (const heading of new Set(page.h2s.map(normalizeHeading).filter(Boolean))) {
      const original = page.h2s.find((h) => normalizeHeading(h) === heading) ?? heading
      const existing = groups.get(heading)
      if (existing) existing.count += 1
      else groups.set(heading, { count: 1, label: original.trim() })
    }
  }

  return [...groups.values()]
    .filter((g) => g.count >= COMMON_SECTION_MIN_OCCURRENCES)
    .sort((a, b) => b.count - a.count)
    .map((g) => g.label)
    .slice(0, 12)
}

export function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
