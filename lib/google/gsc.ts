import type { GoogleFetch } from './client'

const GSC_API = 'https://www.googleapis.com/webmasters/v3'

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

export async function listProperties(googleFetch: GoogleFetch): Promise<GscProperty[]> {
  const res = await googleFetch(`${GSC_API}/sites`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { siteEntry?: GscProperty[] }).siteEntry || []
}

export async function fetchPerformance(
  googleFetch: GoogleFetch,
  siteUrl: string,
  options: { startDate: string; endDate: string; rowLimit?: number }
): Promise<GscPerformanceRow[]> {
  const encodedUrl = encodeURIComponent(siteUrl)
  const res = await googleFetch(`${GSC_API}/sites/${encodedUrl}/searchAnalytics/query`, {
    method: 'POST',
    body: JSON.stringify({
      startDate: options.startDate,
      endDate: options.endDate,
      dimensions: ['date', 'page', 'query'],
      rowLimit: options.rowLimit || 1000,
    }),
  })

  if (!res.ok) return []
  const data = await res.json()
  const rows = (data as { rows?: GscRow[] }).rows || []

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
  options: { startDate: string; endDate: string }
): Promise<Array<{ page_url: string; clicks: number; impressions: number; ctr: number; position: number }>> {
  const encodedUrl = encodeURIComponent(siteUrl)
  const res = await googleFetch(`${GSC_API}/sites/${encodedUrl}/searchAnalytics/query`, {
    method: 'POST',
    body: JSON.stringify({
      startDate: options.startDate,
      endDate: options.endDate,
      dimensions: ['page'],
      rowLimit: 500,
    }),
  })

  if (!res.ok) return []
  const data = await res.json()
  const rows = (data as { rows?: GscRow[] }).rows || []

  return rows.map((row) => ({
    page_url: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 1000) / 1000,
    position: Math.round(row.position * 10) / 10,
  }))
}
