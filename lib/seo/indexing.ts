/**
 * Automatic indexing module — notifies search engines immediately after publication.
 * Works for both WordPress and Next.js sites.
 *
 * Supports:
 * - IndexNow (Bing, Yandex, Seznam, Naver)
 * - Google Ping (sitemap notification)
 * - Google Indexing API (optional, requires service account)
 */

export interface IndexingResult {
  indexNow: { success: boolean; error?: string }
  googlePing: { success: boolean; error?: string }
  googleIndexingApi?: { success: boolean; error?: string }
}

export interface IndexingOptions {
  pageUrl: string
  siteUrl: string
  sitemapUrl?: string
  indexNowKey?: string
}

/**
 * Submit a newly published URL to all search engines.
 * Call this immediately after a successful publish.
 */
export async function submitForIndexing(opts: IndexingOptions): Promise<IndexingResult> {
  const { pageUrl, siteUrl, sitemapUrl, indexNowKey } = opts

  const sitemap = sitemapUrl || `${siteUrl.replace(/\/$/, '')}/sitemap.xml`
  const key = indexNowKey || process.env.INDEXNOW_KEY || ''

  const [indexNowResult, googlePingResult] = await Promise.all([
    key ? submitIndexNow({ pageUrl, siteUrl, key }) : Promise.resolve({ success: false, error: 'No IndexNow key configured' }),
    submitGooglePing(sitemap),
  ])

  let googleApiResult: IndexingResult['googleIndexingApi']
  if (process.env.GOOGLE_INDEXING_CREDENTIALS) {
    googleApiResult = await submitGoogleIndexingApi(pageUrl)
  }

  return {
    indexNow: indexNowResult,
    googlePing: googlePingResult,
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
  const sitemap = `${siteUrl.replace(/\/$/, '')}/sitemap.xml`

  // IndexNow supports batch (up to 10,000 URLs per request)
  let indexNowBatch: { success: boolean; error?: string } = { success: false, error: 'No key' }
  if (key) {
    indexNowBatch = await submitIndexNowBatch({ urls, siteUrl, key })
  }

  // Google ping once (it re-crawls the whole sitemap)
  const googlePing = await submitGooglePing(sitemap)

  // Google Indexing API per URL if configured
  let googleApiResults: Array<{ success: boolean; error?: string }> = []
  if (process.env.GOOGLE_INDEXING_CREDENTIALS) {
    googleApiResults = await Promise.all(urls.map((url) => submitGoogleIndexingApi(url)))
  }

  const results: IndexingResult[] = urls.map((_, i) => ({
    indexNow: indexNowBatch,
    googlePing,
    googleIndexingApi: googleApiResults[i],
  }))

  const failed = results.filter((r) => !r.indexNow.success && !r.googlePing.success).length

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

// --- Google Sitemap Ping ---

async function submitGooglePing(sitemapUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`
    const response = await fetch(pingUrl, { method: 'GET' })

    if (response.ok) {
      return { success: true }
    }
    return { success: false, error: `Google ping HTTP ${response.status}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// --- Google Indexing API (optional — requires GOOGLE_INDEXING_CREDENTIALS env) ---

async function submitGoogleIndexingApi(pageUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const credentials = process.env.GOOGLE_INDEXING_CREDENTIALS
    if (!credentials) return { success: false, error: 'No credentials' }

    const { client_email, private_key } = JSON.parse(credentials)
    const token = await getGoogleAccessToken(client_email, private_key)

    const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url: pageUrl,
        type: 'URL_UPDATED',
      }),
    })

    if (response.ok) {
      return { success: true }
    }
    const err = await response.json().catch(() => ({}))
    return { success: false, error: `Google API ${response.status}: ${(err as { error?: { message?: string } }).error?.message || ''}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Google API error' }
  }
}

async function getGoogleAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))

  const signInput = `${header}.${payload}`

  // Use Web Crypto API for RS256 signing
  const keyData = privateKey.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signInput)
  )

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const jwt = `${header}.${payload}.${sig}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  const tokenData = await tokenRes.json()
  return (tokenData as { access_token: string }).access_token
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
