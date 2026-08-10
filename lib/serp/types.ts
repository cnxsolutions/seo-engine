// ─────────────────────────────────────────────────────────────────────────────
// SERP types
// SEO Engine - What a search result page yields, and what we make of it.
// ─────────────────────────────────────────────────────────────────────────────

export interface SerpOrganicResult {
  /** 1-based rank among organic results, after Google's own surfaces are dropped. */
  position: number
  url: string
  host: string
  title: string
}

export interface SerpParseResult {
  organic: SerpOrganicResult[]
  peopleAlsoAsk: string[]
  relatedSearches: string[]
  /**
   * Non-null when the page was served but is not a result page. Distinct from an
   * empty `organic` array, which means the markup changed underneath us.
   */
  blocked: 'captcha' | 'consent' | null
}

export interface SerpSnapshot extends SerpParseResult {
  query: string
  /** ISO date of the fetch. Drives cache expiry. */
  fetchedAt: string
  /** True when this came from the cache rather than from a live fetch. */
  fromCache: boolean
}

/**
 * A ranking page, measured rather than guessed.
 *
 * Google supplies the LIST of competitors; these numbers come from crawling
 * those public pages with the site crawler. That second step is where a brief
 * stops being an opinion about length and structure.
 */
export interface RankingPageMeasurement {
  url: string
  host: string
  position: number
  wordCount: number
  title: string
  h1: string
  h2s: string[]
  hasFaq: boolean
  hasSchema: boolean
}

/**
 * Everything the planner learns from one query. Every field is optional-by-value
 * (empty array, null) because the whole module degrades rather than fails.
 */
export interface SerpEvidence {
  query: string
  fetchedAt: string
  competitors: RankingPageMeasurement[]
  peopleAlsoAsk: string[]
  relatedSearches: string[]
  /** Median word count of the pages that actually rank. Null when none could be measured. */
  medianWordCount: number | null
  /** H2 wordings shared by at least two ranking pages: the sections the SERP expects. */
  commonSections: string[]
  /** Share of ranking pages carrying a FAQ block, 0 to 1. */
  faqShare: number
}
