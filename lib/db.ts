import type {
  Article,
  AnalysisRun,
  Backlink,
  Campaign,
  CreateAnalysisRunPayload,
  CreateArticlePayload,
  CreateBacklinkPayload,
  CreateCampaignPayload,
  CreateCyclePlanPayload,
  CreateGenerationPayload,
  CreateSitePagePayload,
  CreateSitePayload,
  CyclePlan,
  Generation,
  PlanItemBrief,
  Site,
  SitePage,
} from '@/lib/types'
import { createServiceClient } from '@/lib/supabase'

function requireSupabase() {
  return createServiceClient()
}

export async function listSites() {
  const supabase = requireSupabase()
  const { data: sites, error } = await supabase.from('sites').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const siteIds = (sites ?? []).map((s) => s.id)
  let connectedSiteIds = new Set<string>()
  let schemaSiteIds = new Set<string>()

  if (siteIds.length > 0) {
    const [connections, schemas] = await Promise.all([
      supabase.from('google_connections').select('site_id').in('site_id', siteIds),
      supabase.from('content_schemas').select('federated_site_id').in('federated_site_id', siteIds),
    ])
    connectedSiteIds = new Set((connections.data ?? []).map((c) => c.site_id))
    schemaSiteIds = new Set((schemas.data ?? []).map((s) => s.federated_site_id))
  }

  return (sites ?? []).map((site) => ({
    ...site,
    google_connected: connectedSiteIds.has(site.id),
    has_schema: schemaSiteIds.has(site.id),
  })) as Site[]
}

export async function createSite(payload: CreateSitePayload) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('sites').insert(payload).select('*').single()
  if (error) throw new Error(error.message)
  return data as Site
}

export async function getSiteById(id: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('sites').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as Site | null
}

export async function updateSite(id: string, values: Partial<Site>) {
  const supabase = requireSupabase()
  const { error } = await supabase.from('sites').update(values).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listCampaigns() {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*, site:sites(*)')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as Campaign[]
}

export async function createCampaign(payload: CreateCampaignPayload) {
  const supabase = requireSupabase()
  const schedule = payload.frequency_hours > 0
    ? new Date(Date.now() + payload.frequency_hours * 60 * 60 * 1000).toISOString()
    : null

  const { data, error } = await supabase
    .from('campaigns')
    .insert({ ...payload, next_run_at: schedule })
    .select('*, site:sites(*)')
    .single()

  if (error) throw new Error(error.message)
  return data as Campaign
}

export async function getCampaignById(id: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*, site:sites(*)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as Campaign | null
}

export async function updateCampaignSchedule(id: string, values: Partial<Campaign>) {
  const supabase = requireSupabase()
  const { error } = await supabase.from('campaigns').update(values).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listDueCampaigns(now = new Date().toISOString()) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*, site:sites(*)')
    .eq('is_active', true)
    .not('next_run_at', 'is', null)
    .lte('next_run_at', now)

  if (error) throw new Error(error.message)
  return (data ?? []) as Campaign[]
}

export async function createGeneration(payload: CreateGenerationPayload) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('generations').insert(payload).select('*').single()
  if (error) throw new Error(error.message)
  return data as Generation
}

export async function updateGeneration(id: string, values: Partial<Generation>) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('generations').update(values).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as Generation
}

export async function listPublishedGenerations() {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('generations')
    .select('*, site:sites(*)')
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as Generation[]
}

export async function listPendingPublishGenerations() {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('generations')
    .select('*, site:sites(*), campaign:campaigns(*)')
    .eq('status', 'generated')
    .not('content', 'is', null)
    .not('site_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) throw new Error(error.message)
  return (data ?? []) as (Generation & { site: import('./types').Site | null; campaign: import('./types').Campaign | null })[]
}

export async function listArticles() {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('articles').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Article[]
}

export async function createArticle(payload: CreateArticlePayload) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('articles').insert(payload).select('*').single()
  if (error) throw new Error(error.message)
  return data as Article
}

export async function listBacklinks() {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('backlinks').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Backlink[]
}

export async function createBacklink(payload: CreateBacklinkPayload) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('backlinks').insert(payload).select('*').single()
  if (error) throw new Error(error.message)
  return data as Backlink
}

// ── Site Pages (crawled data) ──────────────────────────────────────────

export async function upsertSitePages(siteId: string, pages: CreateSitePagePayload[]) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('site_pages')
    .upsert(pages.map(p => ({ ...p, site_id: siteId })), { onConflict: 'site_id,path' })
    .select('*')

  if (error) throw new Error(error.message)
  return (data ?? []) as SitePage[]
}

export async function listSitePages(siteId: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('site_pages')
    .select('*')
    .eq('site_id', siteId)
    .order('path')

  if (error) throw new Error(error.message)
  return (data ?? []) as SitePage[]
}

export async function getSiteContext(siteId: string): Promise<{
  existingPages: SitePage[]
  generatedPages: Generation[]
  usedSlugs: string[]
  usedKeywords: string[]
  usedTitles: string[]
}> {
  const supabase = requireSupabase()

  const [pagesResult, gensResult] = await Promise.all([
    supabase.from('site_pages').select('*').eq('site_id', siteId),
    supabase.from('generations').select('*').eq('site_id', siteId).neq('status', 'failed'),
  ])

  if (pagesResult.error) throw new Error(pagesResult.error.message)
  if (gensResult.error) throw new Error(gensResult.error.message)

  const existingPages = (pagesResult.data ?? []) as SitePage[]
  const generatedPages = (gensResult.data ?? []) as Generation[]

  const usedSlugs = [
    ...existingPages.map(p => p.path.replace(/^\//, '').replace(/\/$/, '')),
    ...generatedPages.filter(g => g.slug).map(g => g.slug!),
  ]

  const usedKeywords = [
    ...existingPages.flatMap(p => p.keywords),
    ...existingPages.filter(p => p.focus_keyword).map(p => p.focus_keyword!),
    ...generatedPages.filter(g => g.focus_keyword).map(g => g.focus_keyword!),
  ]

  const usedTitles = [
    ...existingPages.filter(p => p.title).map(p => p.title!),
    ...generatedPages.filter(g => g.title).map(g => g.title!),
  ]

  return {
    existingPages,
    generatedPages,
    usedSlugs: [...new Set(usedSlugs)],
    usedKeywords: [...new Set(usedKeywords.map(k => k.toLowerCase()))],
    usedTitles: [...new Set(usedTitles.map(t => t.toLowerCase()))],
  }
}

export async function checkDuplicates(siteId: string, proposals: Array<{ slug?: string; focusKeyword?: string; title?: string }>) {
  const context = await getSiteContext(siteId)

  return proposals.map(p => {
    const slugConflict = p.slug && context.usedSlugs.includes(p.slug.replace(/^\//, ''))
    const keywordConflict = p.focusKeyword && context.usedKeywords.includes(p.focusKeyword.toLowerCase())
    const titleConflict = p.title && context.usedTitles.includes(p.title.toLowerCase())

    return {
      ...p,
      isDuplicate: !!(slugConflict || keywordConflict),
      conflicts: {
        slug: slugConflict || false,
        keyword: keywordConflict || false,
        title: titleConflict || false,
      },
    }
  })
}

// -- Analysis Runs -----------------------------------------------------------

export async function createAnalysisRun(payload: CreateAnalysisRunPayload) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('analysis_runs').insert(payload).select('*').single()
  if (error) throw new Error(error.message)
  return data as AnalysisRun
}

export async function getAnalysisRunById(id: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('analysis_runs')
    .select('*, site:sites(*)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as AnalysisRun | null
}

export async function updateAnalysisRun(id: string, values: Partial<AnalysisRun>) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('analysis_runs').update(values).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as AnalysisRun
}

// ── Cycle Plans ───────────────────────────────────────────────────────

export async function createCyclePlan(payload: CreateCyclePlanPayload) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('cycle_plans').insert(payload).select('*').single()
  if (error) throw new Error(error.message)
  return data as CyclePlan
}

export async function updateCyclePlan(id: string, values: Partial<CyclePlan>) {
  const supabase = requireSupabase()
  const { error } = await supabase.from('cycle_plans').update(values).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getActiveCyclePlan(campaignId: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('cycle_plans')
    .select('*')
    .eq('campaign_id', campaignId)
    .in('status', ['draft', 'confirmed', 'executing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as CyclePlan | null
}

export async function getCyclePlanById(id: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('cycle_plans')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as CyclePlan | null
}

export async function getLatestCyclePlan(campaignId: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('cycle_plans')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('cycle_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as CyclePlan | null
}

export async function getPlanItemBrief(campaignId: string, planItemId?: string, cyclePlanId?: string) {
  if (!planItemId) return null

  const plan = cyclePlanId
    ? await getCyclePlanById(cyclePlanId)
    : await getActiveCyclePlan(campaignId)

  if (!plan) return null
  return (plan.plan_data as PlanItemBrief[]).find((item) => item.id === planItemId) ?? null
}

export async function getCampaignsWithExpiringCycles(now: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('cycle_plans')
    .select('*, campaign:campaigns(*, site:sites(*))')
    .eq('status', 'executing')
    .lte('cycle_ends_at', now)

  if (error) throw new Error(error.message)
  return (data ?? []) as (CyclePlan & { campaign: Campaign })[]
}

export async function updateCampaign(id: string, values: Partial<Campaign>) {
  const supabase = requireSupabase()
  const { error } = await supabase.from('campaigns').update(values).eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Dashboard Stats ───────────────────────────────────────────────────

export async function getDashboardStats() {
  const supabase = requireSupabase()
  const [sitesResult, activeCampaignsResult, generatedPagesResult, publishedPagesResult] = await Promise.all([
    supabase.from('sites').select('*', { count: 'exact', head: true }),
    supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('generations').select('*', { count: 'exact', head: true }),
    supabase.from('generations').select('*', { count: 'exact', head: true }).eq('status', 'published'),
  ])

  for (const result of [sitesResult, activeCampaignsResult, generatedPagesResult, publishedPagesResult]) {
    if (result.error) throw new Error(result.error.message)
  }

  return {
    sites: sitesResult.count ?? 0,
    activeCampaigns: activeCampaignsResult.count ?? 0,
    generatedPages: generatedPagesResult.count ?? 0,
    publishedPages: publishedPagesResult.count ?? 0,
  }
}
