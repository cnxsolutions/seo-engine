// ─────────────────────────────────────────────────────────────────────────────
// SERP fetching — SerpApi
// SEO Engine - Read the result page through an API, not by scraping it.
// ─────────────────────────────────────────────────────────────────────────────
//
// Scraping google.com/search directly no longer returns anything to parse: it
// answers HTTP 200 with a JavaScript-only shell whose <noscript> redirects to
// `/httpservice/retry/enablejs`. No <h3>, no result links, no JSON payload —
// there is nothing a selector could match, so the parser was replaced rather
// than repaired.
//
// This module keeps failing LOUDLY. The default failure of a SERP source is to
// return an empty result set that reads exactly like "this query has no
// competition", and a brief built on that would be presented as measured while
// being invention. Every failure raises instead, and the caller degrades to
// planning without SERP evidence — visibly.

import type { SerpOrganicResult, SerpParseResult } from './types'

const ENDPOINT = 'https://serpapi.com/search.json'

/**
 * The provider queries Google live, so a response is not a cache read: 2 to 10
 * seconds is normal and spikes past 20 happen under load. A 20s ceiling turned
 * those spikes into permanently blind briefs, which is a poor trade for an
 * enrichment step that runs a handful of times per plan.
 */
const REQUEST_TIMEOUT_MS = 60000

/**
 * One retry, for transport failures only.
 *
 * A timeout or a dropped connection says nothing about the query; a refused key
 * or an unexpected payload says everything, and retrying those just doubles the
 * wait before the same verdict. Hence the narrow scope.
 */
const NETWORK_RETRIES = 1
const RETRY_DELAY_MS = 2000

// ─── Errors ─────────────────────────────────────────────────────────────────────

export class SerpUnavailableError extends Error {
  constructor(message: string, readonly kind: 'config' | 'network' | 'status' | 'quota' | 'empty') {
    super(message)
    this.name = 'SerpUnavailableError'
  }
}

// ─── Serialisation ──────────────────────────────────────────────────────────────
//
// One request at a time, process-wide. A plan resolving its queries with
// `Promise.all` would otherwise fire five simultaneous searches and trip the
// provider's concurrency limit — the artificial delay the scraper needed is gone,
// but the ordering guarantee is still worth keeping.

let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  // The chain must survive a rejected task, or one failed query poisons the rest.
  queue = run.catch(() => undefined)
  return run
}

// ─── Fetch ──────────────────────────────────────────────────────────────────────

export interface FetchSerpOptions {
  /** Interface language and country. French market by default. */
  hl?: string
  gl?: string
  signal?: AbortSignal
}

interface SerpApiOrganic {
  position?: number
  title?: string
  link?: string
}

export async function fetchSerp(query: string, opts: FetchSerpOptions = {}): Promise<SerpParseResult> {
  const trimmed = query.trim()
  if (!trimmed) throw new SerpUnavailableError('Empty query', 'network')

  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) {
    throw new SerpUnavailableError(
      'SERPAPI_KEY absente : les briefs seront construits sans preuve SERP.',
      'config'
    )
  }

  return enqueue(async () => {
    const url = new URL(ENDPOINT)
    url.searchParams.set('engine', 'google')
    url.searchParams.set('q', trimmed)
    url.searchParams.set('hl', opts.hl ?? 'fr')
    url.searchParams.set('gl', opts.gl ?? 'fr')
    url.searchParams.set('num', '10')
    url.searchParams.set('api_key', apiKey)

    let response: Response | undefined
    let lastError: unknown

    for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
      try {
        response = await fetch(url.toString(), {
          signal: opts.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        // A caller-supplied abort is a decision, not a hiccup: honour it.
        if (opts.signal?.aborted) break
        if (attempt < NETWORK_RETRIES) {
          console.warn(`[serp]     tentative ${attempt + 1} echouee, nouvelle tentative...`)
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        }
      }
    }

    if (!response) {
      throw new SerpUnavailableError(
        `SERP fetch failed: ${lastError instanceof Error ? lastError.message : 'unknown'}`,
        'network'
      )
    }

    const data = await response.json().catch(() => null)

    if (response.status === 401 || response.status === 403) {
      throw new SerpUnavailableError('Cle SerpApi refusee (401/403) — verifier SERPAPI_KEY.', 'config')
    }
    if (response.status === 429) {
      throw new SerpUnavailableError('Quota SerpApi epuise (429).', 'quota')
    }
    if (!response.ok || !data) {
      const detail = (data as { error?: string } | null)?.error ?? `HTTP ${response.status}`
      throw new SerpUnavailableError(`SerpApi: ${detail}`, 'status')
    }
    // SerpApi reports request-level problems in the body, with a 200 status.
    if (typeof (data as { error?: string }).error === 'string') {
      throw new SerpUnavailableError(`SerpApi: ${(data as { error: string }).error}`, 'status')
    }

    const payload = data as {
      organic_results?: SerpApiOrganic[]
      related_questions?: Array<{ question?: string }>
      related_searches?: Array<{ query?: string }>
    }

    const organic = mapOrganic(payload.organic_results ?? [])

    // A query the whole web ignores is not a normal outcome for a commercial
    // keyword: far more often it means the response shape moved. Raising keeps
    // it from being read as "no competition".
    if (organic.length === 0) {
      throw new SerpUnavailableError(
        `Aucun resultat organique pour "${trimmed}" — reponse SerpApi vide ou de forme inattendue.`,
        'empty'
      )
    }

    return {
      organic,
      peopleAlsoAsk: (payload.related_questions ?? [])
        .map((item) => item.question?.trim())
        .filter((q): q is string => Boolean(q)),
      relatedSearches: (payload.related_searches ?? [])
        .map((item) => item.query?.trim())
        .filter((q): q is string => Boolean(q)),
      blocked: null,
    }
  })
}

/**
 * Map SerpApi's organic block onto our shape.
 *
 * Positions are renumbered from the surviving entries rather than trusted: an
 * entry without a usable link is dropped, and keeping the provider's original
 * numbering would leave gaps that later read as "ranked 4th" for a page that is
 * in fact third among those we could measure.
 */
function mapOrganic(results: SerpApiOrganic[]): SerpOrganicResult[] {
  const seen = new Set<string>()
  const mapped: SerpOrganicResult[] = []

  for (const item of results) {
    const url = cleanUrl(item.link)
    if (!url) continue

    const host = hostOf(url)
    if (!host || seen.has(url)) continue
    seen.add(url)

    const title = (item.title ?? '').trim()
    if (!title) continue

    mapped.push({ position: mapped.length + 1, url, host, title })
  }

  return mapped
}

/** Strip tracking parameters and the fragment so the same page is one entry. */
function cleanUrl(raw: string | undefined): string | null {
  if (!raw || !/^https?:\/\//i.test(raw)) return null
  try {
    const url = new URL(raw)
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|msclkid|ref)/i.test(key)) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}
