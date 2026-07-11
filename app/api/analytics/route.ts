// ─────────────────────────────────────────────────────────────────────────────
// Analytics API - Dashboard KPIs
// SEO Engine - Analytics endpoints
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import type { NextRequest } from 'next/server'
import type { Generation, Campaign } from '@/lib/types'

// ─── KPI Types ───────────────────────────────────────────────────────────────

export interface DashboardKpis {
  // Overview
  totalSites: number
  totalCampaigns: number
  activeCampaigns: number

  // Generations
  totalGenerations: number
  generationsThisMonth: number
  generationsTrend: number // percentage

  // Publications
  totalPublished: number
  publishedThisMonth: number
  publishedTrend: number

  // Success rates
  successRate: number
  failureRate: number
  averageGenerationTime: number

  // Performance
  averagePosition: number
  totalClicks: number
  totalImpressions: number
  averageCtr: number

  // Page types distribution
  pageTypesDistribution: Record<string, number>

  // Recent activity
  recentGenerations: RecentGeneration[]
  recentPublications: RecentPublication[]
}

export interface RecentGeneration {
  id: string
  title: string
  city: string
  pageType: string
  status: string
  createdAt: string
  campaignName?: string
  siteName?: string
}

export interface RecentPublication {
  id: string
  title: string
  city: string
  publishedUrl?: string
  publishedAt: string
  clicks: number
  impressions: number
  position: number
  siteName?: string
}

export interface PerformanceMetrics {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface CampaignPerformance {
  campaignId: string
  campaignName: string
  siteId: string
  siteName: string
  totalGenerated: number
  totalPublished: number
  successRate: number
  averagePosition: number
  totalClicks: number
  totalImpressions: number
  topKeywords: Array<{ keyword: string; clicks: number; position: number }>
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
  trend: 'up' | 'down' | 'stable'
}

// ─── Dashboard KPIs ─────────────────────────────────────────────────────────

export async function getDashboardKpis(siteId?: string): Promise<DashboardKpis> {
  const supabase = createServiceClient()

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString()

  // Parallel queries for performance
  const [
    sitesResult,
    campaignsResult,
    activeCampaignsResult,
    generationsResult,
    generationsThisMonthResult,
    generationsLastMonthResult,
    publishedResult,
    publishedThisMonthResult,
    publishedLastMonthResult,
    gscResult,
  ] = await Promise.all([
    // Sites count
    supabase.from('sites').select('*', { count: 'exact', head: true }),

    // Campaigns count
    supabase.from('campaigns').select('*', { count: 'exact', head: true }),

    // Active campaigns
    supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('is_active', true),

    // Total generations
    siteId
      ? supabase.from('generations').select('*', { count: 'exact', head: true }).eq('site_id', siteId)
      : supabase.from('generations').select('*', { count: 'exact', head: true }),

    // Generations this month
    siteId
      ? supabase.from('generations').select('*', { count: 'exact', head: true }).eq('site_id', siteId).gte('created_at', startOfMonth)
      : supabase.from('generations').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonth),

    // Generations last month (for trend)
    siteId
      ? supabase.from('generations').select('*', { count: 'exact', head: true }).eq('site_id', siteId).gte('created_at', startOfLastMonth).lte('created_at', endOfLastMonth)
      : supabase.from('generations').select('*', { count: 'exact', head: true }).gte('created_at', startOfLastMonth).lte('created_at', endOfLastMonth),

    // Total published
    siteId
      ? supabase.from('generations').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'published')
      : supabase.from('generations').select('*', { count: 'exact', head: true }).eq('status', 'published'),

    // Published this month
    siteId
      ? supabase.from('generations').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'published').gte('updated_at', startOfMonth)
      : supabase.from('generations').select('*', { count: 'exact', head: true }).eq('status', 'published').gte('updated_at', startOfMonth),

    // Published last month (for trend)
    siteId
      ? supabase.from('generations').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'published').gte('updated_at', startOfLastMonth).lte('updated_at', endOfLastMonth)
      : supabase.from('generations').select('*', { count: 'exact', head: true }).eq('status', 'published').gte('updated_at', startOfLastMonth).lte('updated_at', endOfLastMonth),

    // GSC data
    siteId
      ? supabase.from('gsc_performance').select('clicks, impressions, ctr, position').eq('site_id', siteId)
      : Promise.resolve({ data: null, error: null }),
  ])

  // Calculate trends
  const generationsTrend = calculateTrend(
    generationsThisMonthResult.count ?? 0,
    generationsLastMonthResult.count ?? 0
  )

  const publishedTrend = calculateTrend(
    publishedThisMonthResult.count ?? 0,
    publishedLastMonthResult.count ?? 0
  )

  // GSC aggregates
  let avgPosition = 0
  let totalClicks = 0
  let totalImpressions = 0
  let avgCtr = 0

  if (gscResult.data && gscResult.data.length > 0) {
    const gscData = gscResult.data
    totalClicks = gscData.reduce((sum, r) => sum + (r.clicks || 0), 0)
    totalImpressions = gscData.reduce((sum, r) => sum + (r.impressions || 0), 0)
    avgCtr = gscData.reduce((sum, r) => sum + (r.ctr || 0), 0) / gscData.length
    avgPosition = gscData.reduce((sum, r) => sum + (r.position || 0), 0) / gscData.length
  }

  // Page types distribution
  const pageTypesQuery = siteId
    ? supabase.from('generations').select('page_type').eq('site_id', siteId).eq('status', 'published')
    : supabase.from('generations').select('page_type').eq('status', 'published')

  const pageTypesResult = await pageTypesQuery
  const pageTypesDistribution: Record<string, number> = {}
  if (pageTypesResult.data) {
    for (const gen of pageTypesResult.data) {
      const type = gen.page_type || 'unknown'
      pageTypesDistribution[type] = (pageTypesDistribution[type] || 0) + 1
    }
  }

  // Success rates
  const totalGens = generationsResult.count ?? 0
  const published = publishedResult.count ?? 0
  const successRate = totalGens > 0 ? Math.round((published / totalGens) * 100) : 0
  const failedResult = siteId
    ? await supabase.from('generations').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'failed')
    : await supabase.from('generations').select('*', { count: 'exact', head: true }).eq('status', 'failed')
  const failureRate = totalGens > 0 ? Math.round(((failedResult.count ?? 0) / totalGens) * 100) : 0

  // Recent generations with campaign and site info
  const recentGensQuery = siteId
    ? supabase
        .from('generations')
        .select('*, campaign:campaigns(name), site:sites(name)')
        .eq('site_id', siteId)
        .order('created_at', { ascending: false })
        .limit(10)
    : supabase
        .from('generations')
        .select('*, campaign:campaigns(name), site:sites(name)')
        .order('created_at', { ascending: false })
        .limit(10)

  const recentGensResult = await recentGensQuery

  // Recent publications with GSC data
  const recentPubsQuery = siteId
    ? supabase
        .from('generations')
        .select('*, site:sites(name)')
        .eq('site_id', siteId)
        .eq('status', 'published')
        .not('published_url', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(10)
    : supabase
        .from('generations')
        .select('*, site:sites(name)')
        .eq('status', 'published')
        .not('published_url', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(10)

  const recentPubsResult = await recentPubsQuery

  return {
    totalSites: sitesResult.count ?? 0,
    totalCampaigns: campaignsResult.count ?? 0,
    activeCampaigns: activeCampaignsResult.count ?? 0,
    totalGenerations: totalGens,
    generationsThisMonth: generationsThisMonthResult.count ?? 0,
    generationsTrend,
    totalPublished: published,
    publishedThisMonth: publishedThisMonthResult.count ?? 0,
    publishedTrend,
    successRate,
    failureRate,
    averageGenerationTime: 0, // Would need to track this
    averagePosition: Math.round(avgPosition * 10) / 10,
    totalClicks,
    totalImpressions,
    averageCtr: Math.round(avgCtr * 1000) / 10,
    pageTypesDistribution,
    recentGenerations: (recentGensResult.data ?? []).map(g => ({
      id: g.id,
      title: g.title || 'Untitled',
      city: g.city,
      pageType: g.page_type || 'unknown',
      status: g.status,
      createdAt: g.created_at,
      campaignName: (g.campaign as { name?: string } | null)?.name,
      siteName: (g.site as { name?: string } | null)?.name,
    })),
    recentPublications: (recentPubsResult.data ?? []).map(g => ({
      id: g.id,
      title: g.title || 'Untitled',
      city: g.city,
      publishedUrl: g.published_url,
      publishedAt: g.updated_at,
      clicks: 0, // Would need to join with GSC
      impressions: 0,
      position: 0,
      siteName: (g.site as { name?: string } | null)?.name,
    })),
  }
}

// ─── Performance Metrics ────────────────────────────────────────────────────

export async function getPerformanceMetrics(
  siteId: string,
  days = 30
): Promise<PerformanceMetrics[]> {
  const supabase = createServiceClient()

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const { data, error } = await supabase
    .from('gsc_performance')
    .select('date, clicks, impressions, ctr, position')
    .eq('site_id', siteId)
    .gte('date', startDate.toISOString().split('T')[0])
    .order('date', { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).map(row => ({
    date: row.date,
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    position: row.position || 0,
  }))
}

// ─── Campaign Performance ──────────────────────────────────────────────────

export async function getCampaignPerformance(siteId?: string): Promise<CampaignPerformance[]> {
  const supabase = createServiceClient()

  let query = supabase
    .from('campaigns')
    .select(`
      id,
      name,
      site_id,
      site:sites(name)
    `)
    .eq('is_active', true)

  if (siteId) {
    query = query.eq('site_id', siteId)
  }

  const { data: campaigns, error } = await query

  if (error) throw new Error(error.message)
  if (!campaigns) return []

  // Get generation stats per campaign
  const campaignIds = campaigns.map(c => c.id)

  const { data: generations, error: genError } = await supabase
    .from('generations')
    .select('campaign_id, status, focus_keyword')
    .in('campaign_id', campaignIds)

  if (genError) throw new Error(genError.message)

  // Group by campaign
  const statsByCampaign: Record<string, { total: number; published: number; failed: number; keywords: string[] }> = {}
  for (const gen of (generations ?? [])) {
    if (!statsByCampaign[gen.campaign_id!]) {
      statsByCampaign[gen.campaign_id!] = { total: 0, published: 0, failed: 0, keywords: [] }
    }
    statsByCampaign[gen.campaign_id!].total++
    if (gen.status === 'published') statsByCampaign[gen.campaign_id!].published++
    if (gen.status === 'failed') statsByCampaign[gen.campaign_id!].failed++
    if (gen.focus_keyword) statsByCampaign[gen.campaign_id!].keywords.push(gen.focus_keyword)
  }

  return campaigns.map(c => {
    const stats = statsByCampaign[c.id] || { total: 0, published: 0, failed: 0, keywords: [] }
    const successRate = stats.total > 0 ? Math.round((stats.published / stats.total) * 100) : 0

    return {
      campaignId: c.id,
      campaignName: c.name,
      siteId: c.site_id || '',
      siteName: (c.site as { name?: string } | null)?.name || 'Unknown',
      totalGenerated: stats.total,
      totalPublished: stats.published,
      successRate,
      averagePosition: 0,
      totalClicks: 0,
      totalImpressions: 0,
      topKeywords: stats.keywords.slice(0, 5).map(k => ({ keyword: k, clicks: 0, position: 0 })),
    }
  })
}

// ─── Content Performance ──────────────────────────────────────────────────

export async function getContentPerformance(
  siteId: string,
  limit = 20,
  sortBy: 'clicks' | 'position' | 'published' = 'clicks'
): Promise<ContentPerformance[]> {
  const supabase = createServiceClient()

  // Get published generations
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

  // Get GSC data for these pages
  const urls = generations.map(g => g.published_url).filter(Boolean) as string[]

  const { data: gscData } = await supabase
    .from('gsc_performance')
    .select('page_url, clicks, impressions, ctr, position')
    .eq('site_id', siteId)
    .in('page_url', urls)

  // Map GSC data by URL
  const gscByUrl: Record<string, { clicks: number; impressions: number; ctr: number; position: number }> = {}
  for (const row of (gscData ?? [])) {
    if (!gscByUrl[row.page_url]) {
      gscByUrl[row.page_url] = { clicks: 0, impressions: 0, ctr: 0, position: 0 }
    }
    gscByUrl[row.page_url].clicks += row.clicks || 0
    gscByUrl[row.page_url].impressions += row.impressions || 0
  }

  // Build content performance list
  const contentPerformance: ContentPerformance[] = generations.map(g => {
    const gsc = gscByUrl[g.published_url!] || { clicks: 0, impressions: 0, ctr: 0, position: 0 }
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
      ctr: gsc.impressions > 0 ? Math.round((gsc.clicks / gsc.impressions) * 10000) / 100 : 0,
      position: Math.round(gsc.position * 10) / 10,
      trend: 'stable' as const,
    }
  })

  // Sort by requested field
  switch (sortBy) {
    case 'clicks':
      contentPerformance.sort((a, b) => b.clicks - a.clicks)
      break
    case 'position':
      contentPerformance.sort((a, b) => a.position - b.position)
      break
    case 'published':
      contentPerformance.sort((a, b) =>
        new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()
      )
      break
  }

  return contentPerformance.slice(0, limit)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function calculateTrend(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

// ─── API Route Handlers ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('siteId') || undefined
  const days = parseInt(searchParams.get('days') || '30', 10)
  const type = searchParams.get('type') || 'kpis'

  try {
    switch (type) {
      case 'kpis':
        return Response.json(await getDashboardKpis(siteId))

      case 'performance':
        if (!siteId) {
          return Response.json({ error: 'siteId required for performance' }, { status: 400 })
        }
        return Response.json(await getPerformanceMetrics(siteId, days))

      case 'campaigns':
        return Response.json(await getCampaignPerformance(siteId))

      case 'content':
        if (!siteId) {
          return Response.json({ error: 'siteId required for content performance' }, { status: 400 })
        }
        const limit = parseInt(searchParams.get('limit') || '20', 10)
        const sortBy = searchParams.get('sortBy') as 'clicks' | 'position' | 'published' || 'clicks'
        return Response.json(await getContentPerformance(siteId, limit, sortBy))

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
