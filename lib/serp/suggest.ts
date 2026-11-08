// ─────────────────────────────────────────────────────────────────────────────
// Search suggestions — what Google and Bing propose while someone types
// SEO Engine - The phrasing people actually use, before they press Enter.
// ─────────────────────────────────────────────────────────────────────────────
//
// The planner wrote target keywords from the campaign's seeds and its own
// intuition: « réparation urgente de toiture à Châlons-en-Champagne » where
// Google proposes « couvreur châlons-en-champagne » and « couvreur près de
// châlons en champagne ». Autocomplete is the cheapest measure of phrasing
// there is — free, instant, no key — and it is what the person sees under the
// search box.
//
// Both endpoints are the ones the browsers' own search boxes call. Neither is
// a documented API (Bing retired its Search APIs in August 2025), so this
// module treats them as enrichment and NEVER throws: a changed response, a
// block or a timeout yields an empty list, and the plan is written without it.

const GOOGLE_ENDPOINT = 'https://suggestqueries.google.com/complete/search'
const BING_ENDPOINT = 'https://api.bing.com/osjson.aspx'

/** Suggestions answer in a few hundred milliseconds; past this, something is wrong. */
const REQUEST_TIMEOUT_MS = 5000

/** Beyond eight words a suggestion is a business name with its address and « avis ». */
const MAX_SUGGESTION_WORDS = 8

/** The same seed asked twice in a day gets the same answer. */
const CACHE_TTL_MS = 24 * 60 * 60_000

export interface QuerySuggestions {
  query: string
  google: string[]
  bing: string[]
  fetchedAt: string
}

export interface SuggestOptions {
  hl?: string
  gl?: string
  market?: string
}

const cache = new Map<string, { at: number; value: QuerySuggestions }>()

/** Tests only. */
export function clearSuggestionCache(): void {
  cache.clear()
}

/**
 * Google and Bing suggestions for one query.
 *
 * Google is asked twice — the query, then the query followed by a space,
 * which is how its box proposes the NEXT word (« logiciel réservation barber »
 * alone gives two suggestions, with the space three). Bing once.
 */
export async function fetchSuggestions(query: string, opts: SuggestOptions = {}): Promise<QuerySuggestions> {
  const trimmed = query.trim().replace(/\s+/g, ' ')
  const hl = opts.hl ?? 'fr'
  const gl = opts.gl ?? 'fr'
  const market = opts.market ?? 'fr-FR'
  const key = `${hl}|${gl}|${market}|${trimmed.toLowerCase()}`

  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value

  if (!trimmed) return { query: trimmed, google: [], bing: [], fetchedAt: new Date().toISOString() }

  const [direct, nextWord, bing] = await Promise.all([
    askGoogle(trimmed, hl, gl),
    askGoogle(`${trimmed} `, hl, gl),
    askBing(trimmed, market),
  ])

  const value: QuerySuggestions = {
    query: trimmed,
    google: cleanSuggestions(trimmed, [...direct, ...nextWord]),
    bing: cleanSuggestions(trimmed, bing),
    fetchedAt: new Date().toISOString(),
  }

  // An empty answer is not cached: it is more often a hiccup than a fact.
  if (value.google.length > 0 || value.bing.length > 0) cache.set(key, { at: Date.now(), value })
  return value
}

/** Several queries, one after the other — two search boxes are not a load test. */
export async function fetchSuggestionsFor(queries: readonly string[], opts: SuggestOptions = {}): Promise<QuerySuggestions[]> {
  const results: QuerySuggestions[] = []
  for (const query of queries) {
    results.push(await fetchSuggestions(query, opts))
  }
  return results
}

/**
 * Deduplicated (case and accents folded), the query itself removed, the
 * overlong ones dropped.
 */
export function cleanSuggestions(query: string, suggestions: readonly string[]): string[] {
  const seen = new Set<string>([fold(query)])
  const kept: string[] = []

  for (const raw of suggestions) {
    const suggestion = raw.trim().replace(/\s+/g, ' ')
    if (!suggestion || suggestion.split(' ').length > MAX_SUGGESTION_WORDS) continue
    const key = fold(suggestion)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(suggestion)
  }

  return kept
}

/** Reads the OpenSearch shape both endpoints answer with: `[query, [suggestions], …]`. */
export function parseOpenSearch(payload: unknown): string[] {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return []
  return payload[1].filter((entry): entry is string => typeof entry === 'string')
}

async function askGoogle(query: string, hl: string, gl: string): Promise<string[]> {
  const url = new URL(GOOGLE_ENDPOINT)
  url.searchParams.set('client', 'firefox')
  url.searchParams.set('hl', hl)
  url.searchParams.set('gl', gl)
  url.searchParams.set('ie', 'UTF-8')
  url.searchParams.set('oe', 'UTF-8')
  url.searchParams.set('q', query)
  return ask(url, 'google')
}

async function askBing(query: string, market: string): Promise<string[]> {
  const url = new URL(BING_ENDPOINT)
  url.searchParams.set('market', market)
  url.searchParams.set('query', query)
  return ask(url, 'bing')
}

async function ask(url: URL, source: 'google' | 'bing'): Promise<string[]> {
  try {
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) {
      console.warn(`[suggest] ${source} HTTP ${response.status}`)
      return []
    }
    return parseOpenSearch(await response.json())
  } catch (error) {
    console.warn(`[suggest] ${source} indisponible : ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}
