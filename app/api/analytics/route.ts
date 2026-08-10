// ─────────────────────────────────────────────────────────────────────────────
// Analytics API — per-site Search Console analysis
//
// Scope, after the dashboard refactor: this route answers the DEEP, per-site
// questions — a page's daily series, what each published page did, which queries
// several pages fight over. The headline counters the dashboard displays live in
// `app/api/dashboard/metrics.ts` and are read there, not here.
//
// That split is deliberate. Two implementations of "position moyenne" drift
// apart, and a figure whose definition depends on which endpoint you asked is
// worse than no figure. `getDashboardKpis()` and `getCampaignPerformance()` used
// to live here, recomputing the same aggregates for a page that no longer
// exists; they were removed rather than left to rot beside their replacement.
//
// No UI consumes this route today: it is an inspection surface, and the place
// where a suspicious number gets checked against the database by hand.
// ─────────────────────────────────────────────────────────────────────────────

import {
  aggregateRows,
  detectQueryCannibalization,
  measurePublishedPages,
  normalizePageUrl,
  type GscRawRow,
} from '@/lib/google/performance'
import { createServiceClient } from '@/lib/supabase'
import type { NextRequest } from 'next/server'

// ─── Search Console reads ───────────────────────────────────────────────────

/**
 * PostgREST answers 1000 rows at most and says nothing about the rest. Every
 * aggregate below used to be computed on that silent first page, so a site with
 * more than 1000 (day, page, query) rows — a few weeks of a normal site —
 * displayed totals that were simply a truncation.
 */
const GSC_PAGE_SIZE = 1000
const GSC_MAX_ROWS = 20000

/** Window the aggregates cover when the caller does not state one. */
const DEFAULT_WINDOW_DAYS = 90

interface GscRowWithSite extends GscRawRow {
  site_id: string
}

async function loadGscRows(opts: { siteId?: string; sinceDays?: number }): Promise<GscRowWithSite[]> {
  const supabase = createServiceClient()
  const since = new Date()
  since.setDate(since.getDate() - (opts.sinceDays ?? DEFAULT_WINDOW_DAYS))
  const sinceStr = since.toISOString().split('T')[0]

  const rows: GscRowWithSite[] = []

  for (let from = 0; from < GSC_MAX_ROWS; from += GSC_PAGE_SIZE) {
    let filtered = supabase
      .from('gsc_performance')
      .select('site_id, date, page_url, query, clicks, impressions, position')
      .gte('date', sinceStr)

    if (opts.siteId) filtered = filtered.eq('site_id', opts.siteId)

    const { data, error } = await filtered
      .order('impressions', { ascending: false })
      .order('date', { ascending: true })
      .range(from, from + GSC_PAGE_SIZE - 1)

    // A missing gsc_performance table surfaces as `error`, not a throw, so the
    // payload degrades to empty rather than breaking the whole response.
    if (error) return rows
    if (!data || data.length === 0) break

    rows.push(...(data as GscRowWithSite[]))
    if (data.length < GSC_PAGE_SIZE) break
  }

  return rows
}

interface UrlTotals {
  clicks: number
  impressions: number
  ctr: number
  position: number
  topQueries: Array<{ query: string; clicks: number; position: number }>
}

/**
 * Totals per published URL, keyed on a normalized URL so a trailing slash or a
 * `www.` does not hide a page's own data from it.
 */
function totalsByUrl(rows: GscRowWithSite[]): Map<string, UrlTotals> {
  const grouped = new Map<string, GscRowWithSite[]>()
  for (const row of rows) {
    const key = normalizePageUrl(row.page_url)
    const list = grouped.get(key) || []
    list.push(row)
    grouped.set(key, list)
  }

  const totals = new Map<string, UrlTotals>()
  for (const [key, pageRows] of grouped) {
    const stats = aggregateRows(pageRows)
    const clicks = stats.reduce((sum, stat) => sum + stat.clicks, 0)
    const impressions = stats.reduce((sum, stat) => sum + stat.impressions, 0)

    totals.set(key, {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      // Impressions-weighted: averaging daily positions unweighted lets a day
      // with one impression count as much as a day with a thousand.
      position: impressions > 0
        ? stats.reduce((sum, stat) => sum + stat.position * stat.impressions, 0) / impressions
        : 0,
      topQueries: stats
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, 5)
        .map((stat) => ({ query: stat.query, clicks: stat.clicks, position: stat.position })),
    })
  }

  return totals
}

const EMPTY_TOTALS: UrlTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0, topQueries: [] }

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PerformanceMetrics {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface ContentPerformance {
  id: string
  title: string
  slug: string
  pageType: string
  focusKeyword: string
  wordCount: number
  publishedUrl?: string
  publishedAt?: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

// ─── Performance Metrics ────────────────────────────────────────────────────

/**
 * One point per DAY, which is what a time series needs.
 *
 * The previous version returned the raw table: `gsc_performance` holds one row
 * per (day, page, query), so a single day came back dozens of times and the
 * chart plotted one query, not the site. The read was also unpaginated, so it
 * stopped at the first 1000 rows — often less than a week of a normal site.
 */
export async function getPerformanceMetrics(
  siteId: string,
  days = 30
): Promise<PerformanceMetrics[]> {
  const rows = await loadGscRows({ siteId, sinceDays: days })

  const byDate = new Map<string, { clicks: number; impressions: number; positionWeight: number }>()
  for (const row of rows) {
    const bucket = byDate.get(row.date) || { clicks: 0, impressions: 0, positionWeight: 0 }
    bucket.clicks += row.clicks || 0
    bucket.impressions += row.impressions || 0
    bucket.positionWeight += (row.position || 0) * (row.impressions || 0)
    byDate.set(row.date, bucket)
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, bucket]) => ({
      date,
      clicks: bucket.clicks,
      impressions: bucket.impressions,
      ctr: bucket.impressions > 0 ? Math.round((bucket.clicks / bucket.impressions) * 10000) / 10000 : 0,
      position: bucket.impressions > 0 ? Math.round((bucket.positionWeight / bucket.impressions) * 10) / 10 : 0,
    }))
}

// ─── Content Performance ──────────────────────────────────────────────────

export async function getContentPerformance(
  siteId: string,
  limit = 20,
  sortBy: 'clicks' | 'position' | 'published' = 'clicks'
): Promise<ContentPerformance[]> {
  const supabase = createServiceClient()

  const { data: generations, error } = await supabase
    .from('generations')
    .select('id, title, slug, page_type, focus_keyword, content, published_url, updated_at')
    .eq('site_id', siteId)
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit * 2) // Fetch more for filtering

  if (error) throw new Error(error.message)
  if (!generations) return []

  // Search Console data for these pages.
  //
  // Two defects here: the lookup keyed on the raw URL, so a stored
  // `…/page` never matched a Search Console `…/page/`; and `position` was never
  // accumulated, so every page reported position 0 — which also made
  // `sortBy: 'position'` sort a column of zeros.
  const performanceByUrl = totalsByUrl(await loadGscRows({ siteId }))

  const contentPerformance: ContentPerformance[] = generations.map(g => {
    const gsc = performanceByUrl.get(normalizePageUrl(g.published_url || '')) ?? EMPTY_TOTALS
    const wordCount = g.content?.split(/\s+/).length || 0

    return {
      id: g.id,
      title: g.title || 'Untitled',
      slug: g.slug || '',
      pageType: g.page_type || 'unknown',
      focusKeyword: g.focus_keyword || '',
      wordCount,
      publishedUrl: g.published_url,
      publishedAt: g.updated_at,
      clicks: gsc.clicks,
      impressions: gsc.impressions,
      ctr: Math.round(gsc.ctr * 10000) / 100,
      position: Math.round(gsc.position * 10) / 10,
    }
  })

  switch (sortBy) {
    case 'clicks':
      contentPerformance.sort((a, b) => b.clicks - a.clicks)
      break
    case 'position':
      // A page with no impression has no position; 0 would rank it first, ahead
      // of the pages actually holding the top of the results.
      contentPerformance.sort((a, b) => {
        if (a.impressions === 0) return b.impressions === 0 ? 0 : 1
        if (b.impressions === 0) return -1
        return a.position - b.position
      })
      break
    case 'published':
      contentPerformance.sort((a, b) =>
        new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()
      )
      break
  }

  return contentPerformance.slice(0, limit)
}

// ─── API Route Handlers ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('siteId') || undefined
  const days = parseInt(searchParams.get('days') || '30', 10)
  const type = searchParams.get('type') || 'performance'

  try {
    switch (type) {
      case 'performance':
        if (!siteId) {
          return Response.json({ error: 'siteId required for performance' }, { status: 400 })
        }
        return Response.json(await getPerformanceMetrics(siteId, days))

      case 'content': {
        if (!siteId) {
          return Response.json({ error: 'siteId required for content performance' }, { status: 400 })
        }
        const limit = parseInt(searchParams.get('limit') || '20', 10)
        const sortBy = searchParams.get('sortBy') as 'clicks' | 'position' | 'published' || 'clicks'
        return Response.json(await getContentPerformance(siteId, limit, sortBy))
      }

      // What each published page did over the 30 days that followed its
      // publication, with a verdict per page. This is the measurement loop the
      // planner is meant to consume.
      case 'loop': {
        if (!siteId) {
          return Response.json({ error: 'siteId required for loop' }, { status: 400 })
        }
        const windowDays = parseInt(searchParams.get('windowDays') || '30', 10)
        return Response.json(await measurePublishedPages(siteId, { windowDays }))
      }

      // Queries several pages of the site compete on.
      case 'cannibalization': {
        if (!siteId) {
          return Response.json({ error: 'siteId required for cannibalization' }, { status: 400 })
        }
        const windowDays = parseInt(searchParams.get('windowDays') || '90', 10)
        return Response.json(await detectQueryCannibalization(siteId, { windowDays }))
      }

      // The dashboard counters moved to /api/dashboard; say so rather than 400.
      case 'kpis':
      case 'campaigns':
        return Response.json(
          { error: `type=${type} a été remplacé par /api/dashboard?view=production|performance` },
          { status: 410 }
        )

      default:
        return Response.json({ error: 'Unknown type' }, { status: 400 })
    }
  } catch (error) {
    console.error('[Analytics API]', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    )
  }
}
