/**
 * Automatic indexing module — notifies search engines immediately after publication.
 * Works for both WordPress and Next.js sites.
 *
 * Supports:
 * - IndexNow (Bing, Yandex, Seznam, Naver)
 * - Google Indexing API (optional, requires service account)
 *
 * WHAT WAS REMOVED, AND WHY
 *
 * `submitGooglePing` hit `https://www.google.com/ping?sitemap=…`. Google removed
 * that endpoint in June 2023; it answers 404. Every publication therefore made
 * one HTTP call that could only fail, and reported the failure as a real
 * indexing signal in `IndexingResult` — a metric of nothing. Sitemap submission
 * now belongs to `submitSitemap()` in @/lib/google/gsc, which uses the Search
 * Console API and needs an authenticated connection this module does not hold.
 *
 * The local `getGoogleAccessToken` was also removed: it base64-encoded the JWT
 * header and payload with `btoa`, i.e. standard base64 with `+`, `/` and `=`
 * padding, where JWT requires base64url. Google rejected every assertion, which
 * read from the outside like a bad service-account key. The working
 * implementation is `submitUrlToIndexingApi()` in @/lib/google/indexing-api,
 * which encodes all three segments correctly and caches the token.
 */

import { submitUrlToIndexingApi } from '@/lib/google/indexing-api'

export interface IndexingResult {
  indexNow: { success: boolean; error?: string }
  googleIndexingApi?: { success: boolean; error?: string }
}

export interface IndexingOptions {
  pageUrl: string
  siteUrl: string
  indexNowKey?: string
}

/**
 * Submit a newly published URL to all search engines.
 * Call this immediately after a successful publish.
 */
export async function submitForIndexing(opts: IndexingOptions): Promise<IndexingResult> {
  const { pageUrl, siteUrl, indexNowKey } = opts

  const key = indexNowKey || process.env.INDEXNOW_KEY || ''

  const indexNowResult = key
    ? await submitIndexNow({ pageUrl, siteUrl, key })
    : { success: false, error: 'No IndexNow key configured' }

  let googleApiResult: IndexingResult['googleIndexingApi']
  if (process.env.GOOGLE_INDEXING_CREDENTIALS) {
    googleApiResult = await submitUrlToIndexingApi(pageUrl)
  }

  return {
    indexNow: indexNowResult,
    googleIndexingApi: googleApiResult,
  }
}

/**
 * What the search engines were told, as lines for the publication's notes.
 *
 * Before these lines the result was discarded: `submitUrlToIndexingApi` never
 * throws, so a refused call — typically a service account that is not an owner
 * of the Search Console property — read exactly like a success, and nobody
 * could say whether the Indexing API worked at all. « non configuree » answers
 * the other question: whether it is even switched on in that environment.
 */
export function describeIndexingResult(result: IndexingResult | null): string[] {
  if (!result) return []

  const google = result.googleIndexingApi
    ? result.googleIndexingApi.success
      ? 'API Indexing Google : notification acceptee'
      : `API Indexing Google : refusee (${result.googleIndexingApi.error ?? 'erreur inconnue'})`
    : 'API Indexing Google : non configuree (GOOGLE_INDEXING_CREDENTIALS absente)'

  const indexNow = result.indexNow.success
    ? 'IndexNow : URL transmise'
    : `IndexNow : non transmise (${result.indexNow.error ?? 'erreur inconnue'})`

  return [google, indexNow]
}

/**
 * Batch submit multiple URLs (e.g., after a cluster publish)
 */
export async function submitBatchForIndexing(urls: string[], siteUrl: string): Promise<{
  submitted: number
  failed: number
  results: IndexingResult[]
}> {
  const key = process.env.INDEXNOW_KEY || ''

  // IndexNow supports batch (up to 10,000 URLs per request)
  let indexNowBatch: { success: boolean; error?: string } = { success: false, error: 'No key' }
  if (key) {
    indexNowBatch = await submitIndexNowBatch({ urls, siteUrl, key })
  }

  // Google Indexing API per URL if configured
  let googleApiResults: Array<{ success: boolean; error?: string }> = []
  if (process.env.GOOGLE_INDEXING_CREDENTIALS) {
    googleApiResults = await Promise.all(urls.map((url) => submitUrlToIndexingApi(url)))
  }

  const results: IndexingResult[] = urls.map((_, i) => ({
    indexNow: indexNowBatch,
    googleIndexingApi: googleApiResults[i],
  }))

  // Counted against the channels that can actually succeed. The dead sitemap
  // ping used to sit in this expression and made `failed` unreadable.
  const failed = results.filter(
    (r) => !r.indexNow.success && !r.googleIndexingApi?.success
  ).length

  return { submitted: urls.length - failed, failed, results }
}

/**
 * IndexNow alone, for pages already live that Google has not crawled yet — the
 * daily index check (lib/indexing/check.ts). Deliberately without the Indexing
 * API: Google reserves it to job postings and live streams.
 *
 * Grouped by origin: IndexNow refuses a batch whose URLs do not all belong to
 * its `host`, and the key file is looked up on that same host.
 */
export async function submitIndexNowUrls(urls: readonly string[]): Promise<{ submitted: string[]; error?: string }> {
  const key = process.env.INDEXNOW_KEY || ''
  if (!key) return { submitted: [], error: 'INDEXNOW_KEY absente' }

  const byOrigin = new Map<string, string[]>()
  for (const url of urls) {
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      continue
    }
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), url])
  }

  const submitted: string[] = []
  const errors: string[] = []
  for (const [origin, group] of byOrigin) {
    const result = await submitIndexNowBatch({ urls: group, siteUrl: origin, key })
    if (result.success) submitted.push(...group)
    else errors.push(`${origin} : ${result.error ?? 'refus'}`)
  }

  return errors.length > 0 ? { submitted, error: errors.join(' ; ') } : { submitted }
}

// --- IndexNow ---

async function submitIndexNow(opts: { pageUrl: string; siteUrl: string; key: string }): Promise<{ success: boolean; error?: string }> {
  const { pageUrl, siteUrl, key } = opts
  const host = new URL(siteUrl).host

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${siteUrl.replace(/\/$/, '')}/${key}.txt`,
        urlList: [pageUrl],
      }),
    })

    if (response.ok || response.status === 202) {
      return { success: true }
    }
    return { success: false, error: `IndexNow HTTP ${response.status}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

async function submitIndexNowBatch(opts: { urls: string[]; siteUrl: string; key: string }): Promise<{ success: boolean; error?: string }> {
  const { urls, siteUrl, key } = opts
  const host = new URL(siteUrl).host

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${siteUrl.replace(/\/$/, '')}/${key}.txt`,
        urlList: urls,
      }),
    })

    if (response.ok || response.status === 202) {
      return { success: true }
    }
    return { success: false, error: `IndexNow batch HTTP ${response.status}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// --- Utility: Generate IndexNow key file content ---

export function generateIndexNowKey(): string {
  const chars = 'abcdef0123456789'
  let key = ''
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)]
  }
  return key
}

/**
 * Returns instructions for setting up IndexNow on a site.
 */
export function getIndexNowSetupInstructions(siteUrl: string, key: string): {
  keyFileContent: string
  keyFilePath: string
  envVar: string
} {
  return {
    keyFileContent: key,
    keyFilePath: `${siteUrl.replace(/\/$/, '')}/${key}.txt`,
    envVar: `INDEXNOW_KEY=${key}`,
  }
}
