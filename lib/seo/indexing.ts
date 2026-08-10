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
