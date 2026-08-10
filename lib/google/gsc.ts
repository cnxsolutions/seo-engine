import type { GoogleFetch } from './client'

const GSC_API = 'https://www.googleapis.com/webmasters/v3'

/**
 * Hard ceiling imposed by the Search Analytics API on one response. Anything
 * beyond it is only reachable through `startRow`.
 */
const GSC_MAX_ROWS_PER_REQUEST = 25000

/**
 * Default cap on a full paginated read. A personal site never approaches this
 * over 28 days; the bound exists so a misconfigured property cannot walk a
 * million rows into memory.
 */
const GSC_DEFAULT_MAX_ROWS = 25000

export interface GscProperty {
  siteUrl: string
  permissionLevel: string
}

export interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscPerformanceRow {
  page_url: string
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  date: string
}

export interface GscQueryOptions {
  startDate: string
  endDate: string
  /** Rows per request, capped at the API maximum of 25 000. */
  rowLimit?: number
  /** Total rows to read across all pages. Pagination stops there. */
  maxRows?: number
}

export async function listProperties(googleFetch: GoogleFetch): Promise<GscProperty[]> {
  const res = await googleFetch(`${GSC_API}/sites`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { siteEntry?: GscProperty[] }).siteEntry || []
}

export async function fetchPerformance(
  googleFetch: GoogleFetch,
  siteUrl: string,
  options: GscQueryOptions
): Promise<GscPerformanceRow[]> {
  const rows = await queryAllRows(googleFetch, siteUrl, ['date', 'page', 'query'], options)

  return rows.map((row) => ({
    date: row.keys[0],
    page_url: row.keys[1],
    query: row.keys[2],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 1000) / 1000,
    position: Math.round(row.position * 10) / 10,
  }))
}

export async function fetchPagePerformance(
  googleFetch: GoogleFetch,
  siteUrl: string,
  options: GscQueryOptions
): Promise<Array<{ page_url: string; clicks: number; impressions: number; ctr: number; position: number }>> {
  const rows = await queryAllRows(googleFetch, siteUrl, ['page'], options)

  return rows.map((row) => ({
    page_url: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 1000) / 1000,
    position: Math.round(row.position * 10) / 10,
  }))
}

/**
 * Reads a Search Analytics report to its end.
 *
 * The API answers at most `rowLimit` rows and NEVER says that more exist: a
 * query without `startRow` silently returns the first page and looks complete.
 * With three dimensions over 28 days, a site with a few dozen pages exceeds one
 * page of results immediately — which is how a truncated read became a
 * truncated view of the site's own performance.
 */
async function queryAllRows(
  googleFetch: GoogleFetch,
  siteUrl: string,
  dimensions: string[],
  options: GscQueryOptions
): Promise<GscRow[]> {
  const rowLimit = Math.min(options.rowLimit || 5000, GSC_MAX_ROWS_PER_REQUEST)
  const maxRows = options.maxRows || GSC_DEFAULT_MAX_ROWS
  const encodedUrl = encodeURIComponent(siteUrl)
  const rows: GscRow[] = []

  for (let startRow = 0; startRow < maxRows; startRow += rowLimit) {
    const res = await googleFetch(`${GSC_API}/sites/${encodedUrl}/searchAnalytics/query`, {
      method: 'POST',
      body: JSON.stringify({
        startDate: options.startDate,
        endDate: options.endDate,
        dimensions,
        rowLimit: Math.min(rowLimit, maxRows - startRow),
        startRow,
      }),
    })

    // A failure on the first page means no data at all; on a later page it means
    // a partial read, which is still worth more than nothing.
    if (!res.ok) return startRow === 0 ? [] : rows

    const data = await res.json()
    const batch = (data as { rows?: GscRow[] }).rows || []
    rows.push(...batch)

    // A short page is the only end-of-report marker the API gives.
    if (batch.length < rowLimit) break
  }

  return rows
}

// ─── Sitemap submission ──────────────────────────────────────────────────────

/**
 * Declares a sitemap to Search Console.
 *
 * This replaces the `https://www.google.com/ping?sitemap=` call still made from
 * lib/seo/indexing.ts. Google shut that endpoint down in June 2023: it answers
 * 404, so the ping has been reporting a failure — or worse, being ignored —
 * ever since, and nothing told Google that a freshly published page existed.
 *
 * The Search Console API is the supported replacement. It needs the WRITE scope
 * (`https://www.googleapis.com/auth/webmasters`); a connection authorised
 * before that scope was requested comes back 403 and must be reconnected, which
 * is exactly what the returned error says.
 */
export async function submitSitemap(
  googleFetch: GoogleFetch,
  siteUrl: string,
  sitemapUrl: string
): Promise<{ success: boolean; error?: string }> {
  const encodedSite = encodeURIComponent(siteUrl)
  const encodedSitemap = encodeURIComponent(sitemapUrl)

  const res = await googleFetch(`${GSC_API}/sites/${encodedSite}/sitemaps/${encodedSitemap}`, {
    method: 'PUT',
  })

  if (res.ok) return { success: true }

  if (res.status === 403) {
    return {
      success: false,
      error: 'Search Console a refuse la soumission (403) : la connexion Google de ce site a ete autorisee sans le scope d\'ecriture webmasters. Reconnectez le site.',
    }
  }

  return { success: false, error: `Search Console sitemaps HTTP ${res.status}` }
}
