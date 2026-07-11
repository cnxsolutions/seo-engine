import { createServiceClient } from '@/lib/supabase'

export interface GoogleContext {
  gbp?: {
    businessName: string
    address: string
    phone: string
    hours: string
    averageRating: number
    reviewCount: number
    topReviews: string[]
    services: string[]
  }
  gsc?: {
    topQueries: Array<{ query: string; position: number; clicks: number }>
    topPages: Array<{ page: string; clicks: number; impressions: number }>
    averagePosition: number
  }
}

export async function getGoogleContext(siteId: string): Promise<GoogleContext | null> {
  const supabase = createServiceClient()

  const [gbpResult, gscResult] = await Promise.all([
    supabase.from('gbp_profiles').select('*').eq('site_id', siteId).maybeSingle(),
    fetchGscSummary(siteId),
  ])

  const gbpData = gbpResult.data
  const gscData = gscResult

  if (!gbpData && !gscData) return null

  const context: GoogleContext = {}

  if (gbpData) {
    const address = gbpData.address
      ? `${gbpData.address.street}, ${gbpData.address.postalCode} ${gbpData.address.city}`
      : ''

    const hours = formatHours(gbpData.hours)
    const summary = gbpData.reviews_summary || { average_rating: 0, total_count: 0, recent_positive: [] }
    const categories = gbpData.categories
    const services = categories?.additionalCategories
      ? [categories.primaryCategory?.displayName, ...categories.additionalCategories.map((c: { displayName: string }) => c.displayName)].filter(Boolean)
      : categories?.primaryCategory?.displayName ? [categories.primaryCategory.displayName] : []

    context.gbp = {
      businessName: gbpData.business_name || '',
      address,
      phone: gbpData.phone || '',
      hours,
      averageRating: summary.average_rating || 0,
      reviewCount: summary.total_count || 0,
      topReviews: (summary.recent_positive || []).slice(0, 5),
      services,
    }
  }

  if (gscData) {
    context.gsc = gscData
  }

  return context
}

async function fetchGscSummary(siteId: string) {
  const supabase = createServiceClient()

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const since = thirtyDaysAgo.toISOString().split('T')[0]

  // Top queries by clicks
  const { data: queryRows } = await supabase
    .from('gsc_performance')
    .select('query, clicks, position')
    .eq('site_id', siteId)
    .gte('date', since)
    .order('clicks', { ascending: false })
    .limit(50)

  if (!queryRows || queryRows.length === 0) return null

  // Aggregate queries
  const queryMap = new Map<string, { clicks: number; position: number; count: number }>()
  for (const row of queryRows) {
    const existing = queryMap.get(row.query) || { clicks: 0, position: 0, count: 0 }
    existing.clicks += row.clicks
    existing.position += row.position
    existing.count++
    queryMap.set(row.query, existing)
  }

  const topQueries = [...queryMap.entries()]
    .map(([query, data]) => ({
      query,
      clicks: data.clicks,
      position: Math.round((data.position / data.count) * 10) / 10,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10)

  // Top pages
  const { data: pageRows } = await supabase
    .from('gsc_performance')
    .select('page_url, clicks, impressions')
    .eq('site_id', siteId)
    .gte('date', since)
    .order('clicks', { ascending: false })
    .limit(50)

  const pageMap = new Map<string, { clicks: number; impressions: number }>()
  for (const row of pageRows || []) {
    const existing = pageMap.get(row.page_url) || { clicks: 0, impressions: 0 }
    existing.clicks += row.clicks
    existing.impressions += row.impressions
    pageMap.set(row.page_url, existing)
  }

  const topPages = [...pageMap.entries()]
    .map(([page, data]) => ({ page, ...data }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5)

  const totalPosition = topQueries.reduce((sum, q) => sum + q.position, 0)
  const averagePosition = topQueries.length ? Math.round((totalPosition / topQueries.length) * 10) / 10 : 0

  return { topQueries, topPages, averagePosition }
}

function formatHours(hours: unknown): string {
  if (!hours || typeof hours !== 'object') return ''
  const periods = (hours as { periods?: Array<{ openDay: string; openTime: { hours: number }; closeTime: { hours: number } }> }).periods
  if (!Array.isArray(periods) || periods.length === 0) return ''

  const dayMap: Record<string, string> = {
    MONDAY: 'Lun', TUESDAY: 'Mar', WEDNESDAY: 'Mer',
    THURSDAY: 'Jeu', FRIDAY: 'Ven', SATURDAY: 'Sam', SUNDAY: 'Dim',
  }

  const formatted = periods.slice(0, 7).map((p) => {
    const day = dayMap[p.openDay] || p.openDay
    const open = `${p.openTime?.hours || 0}h`
    const close = `${p.closeTime?.hours || 0}h`
    return `${day} ${open}-${close}`
  })

  return formatted.join(', ')
}
