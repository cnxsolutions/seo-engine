import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const days = Number(req.nextUrl.searchParams.get('days')) || 28
  const page = req.nextUrl.searchParams.get('page') || null

  const supabase = createServiceClient()
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().split('T')[0]

  try {
    // Per-page aggregated performance
    let pageQuery = supabase
      .from('gsc_performance')
      .select('page_url, clicks, impressions, ctr, position')
      .eq('site_id', id)
      .gte('date', sinceStr)

    if (page) {
      pageQuery = pageQuery.eq('page_url', page)
    }

    const { data: rows } = await pageQuery.order('clicks', { ascending: false }).limit(500)

    if (!rows || rows.length === 0) {
      return NextResponse.json({ pages: [], queries: [], totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 } })
    }

    // Aggregate by page
    const pageMap = new Map<string, { clicks: number; impressions: number; ctrSum: number; posSum: number; count: number }>()
    for (const row of rows) {
      const key = row.page_url
      const existing = pageMap.get(key) || { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, count: 0 }
      existing.clicks += row.clicks
      existing.impressions += row.impressions
      existing.ctrSum += row.ctr
      existing.posSum += row.position
      existing.count++
      pageMap.set(key, existing)
    }

    const pages = [...pageMap.entries()]
      .map(([url, d]) => ({
        page_url: url,
        clicks: d.clicks,
        impressions: d.impressions,
        ctr: Math.round((d.ctrSum / d.count) * 1000) / 1000,
        position: Math.round((d.posSum / d.count) * 10) / 10,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 50)

    // Top queries
    const { data: queryRows } = await supabase
      .from('gsc_performance')
      .select('query, clicks, impressions, position')
      .eq('site_id', id)
      .gte('date', sinceStr)
      .order('clicks', { ascending: false })
      .limit(200)

    const queryMap = new Map<string, { clicks: number; impressions: number; posSum: number; count: number }>()
    for (const row of queryRows || []) {
      const key = row.query
      const existing = queryMap.get(key) || { clicks: 0, impressions: 0, posSum: 0, count: 0 }
      existing.clicks += row.clicks
      existing.impressions += row.impressions
      existing.posSum += row.position
      existing.count++
      queryMap.set(key, existing)
    }

    const queries = [...queryMap.entries()]
      .map(([query, d]) => ({
        query,
        clicks: d.clicks,
        impressions: d.impressions,
        position: Math.round((d.posSum / d.count) * 10) / 10,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 30)

    const totals = {
      clicks: pages.reduce((s, p) => s + p.clicks, 0),
      impressions: pages.reduce((s, p) => s + p.impressions, 0),
      ctr: pages.length ? Math.round((pages.reduce((s, p) => s + p.ctr, 0) / pages.length) * 1000) / 1000 : 0,
      position: pages.length ? Math.round((pages.reduce((s, p) => s + p.position, 0) / pages.length) * 10) / 10 : 0,
    }

    return NextResponse.json({ pages, queries, totals })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur' },
      { status: 500 }
    )
  }
}
