// Database types matching supabase/schema.sql

export type SiteType = 'wordpress' | 'nextjs'
export type PublishStatus = 'publish' | 'draft' | 'pending'
export type GenerationStatus = 'pending' | 'generating' | 'generated' | 'publishing' | 'published' | 'failed' | 'rejected'
export type ArticleType = 'tutorial' | 'list' | 'case_study' | 'glossary' | 'example'
export type BacklinkType = 'thematic' | 'local' | 'directory' | 'guest_post' | 'social'
export type PageType = 'pillar' | 'child' | 'alternative' | 'comparative' | 'local_pack'
export type AiProvider = 'gpt-4o' | 'gpt-4o-mini' | 'claude-haiku' | 'claude-sonnet'
export type ScheduleFrequency = 'manual' | 'daily' | 'every_2_days' | 'every_3_days' | 'weekly' | 'biweekly' | 'monthly' | 'custom'
export type AnalysisRunStatus = 'running' | 'completed' | 'failed'

export interface Site {
  id: string
  name: string
  type: SiteType
  url: string
  wp_username?: string
  wp_app_password?: string
  wp_page_template?: string
  github_repo?: string
  github_token?: string
  github_mdx_path?: string
  repo_profile?: unknown
  is_active: boolean
  created_at: string
  updated_at: string
  google_connected?: boolean
}

export interface Campaign {
  id: string
  site_id: string
  name: string
  business_type: string
  business_name: string
  keywords: string[]
  department?: string
  communes: string[]
  frequency_hours: number
  schedule_frequency?: ScheduleFrequency
  schedule_days?: number[]
  schedule_time?: string
  ai_model: string
  page_types?: PageType[]
  publish_status: PublishStatus
  auto_publish: boolean
  target_length: number
  system_prompt?: string
  enable_external_links?: boolean
  external_link_count?: number
  enable_images?: boolean
  image_per_page?: number
  is_active: boolean
  last_run_at?: string
  next_run_at?: string
  cycle_duration_days?: number
  current_cycle_id?: string
  cycle_auto_renew?: boolean
  last_crawl_at?: string
  created_at: string
  updated_at: string
  site?: Site
}

export interface Generation {
  id: string
  campaign_id?: string
  site_id?: string
  city: string
  slug?: string
  title?: string
  meta_description?: string
  focus_keyword?: string
  content?: string
  page_type?: PageType
  parent_generation_id?: string
  internal_links_to?: string[]
  external_links?: ExternalLink[]
  image_alts?: string[]
  status: GenerationStatus
  published_url?: string
  published_page_id?: number
  ai_model: string
  tokens_used?: number
  error_message?: string
  scheduled_for?: string
  created_at: string
  updated_at: string
  campaign?: Campaign
  site?: Site
}

export interface ExternalLink {
  url: string
  anchor: string
  domain: string
  relevance: string
}

export interface EditorialSlot {
  id: string
  campaign_id: string
  generation_id?: string
  plan_item_id?: string
  scheduled_date: string
  page_type: PageType
  target_keyword: string
  target_city?: string
  status: 'planned' | 'generating' | 'generated' | 'published' | 'skipped'
  created_at: string
  updated_at: string
  campaign?: Campaign
  generation?: Generation
}

export interface Article {
  id: string
  campaign_id?: string
  site_id?: string
  pillar_page_slug?: string
  article_type: ArticleType
  title: string
  slug: string
  content: string
  status: PublishStatus
  published_url?: string
  created_at: string
  updated_at: string
}

export interface Backlink {
  id: string
  site_id: string
  source_url: string
  anchor_text?: string
  link_type: BacklinkType
  domain_authority?: number
  is_verified: boolean
  obtained_at?: string
  created_at: string
}

export interface SitePage {
  id: string
  site_id: string
  url: string
  path: string
  title?: string
  meta_description?: string
  h1?: string
  h2s: string[]
  word_count: number
  focus_keyword?: string
  keywords: string[]
  internal_links: string[]
  external_links: string[]
  has_schema: boolean
  schema_types: string[]
  has_faq: boolean
  has_local_business: boolean
  geo_signals: string[]
  crawled_at: string
  created_at: string
  updated_at: string
}

export type CreateSitePagePayload = Omit<SitePage, 'id' | 'created_at' | 'updated_at'>

export type CyclePlanStatus = 'draft' | 'confirmed' | 'executing' | 'completed' | 'cancelled'

export interface PlanItemBrief {
  id: string
  scheduled_date: string
  page_type: PageType
  priority: 'high' | 'medium' | 'low'
  target_city: string
  target_keyword: string
  secondary_keywords: string[]
  search_intent: string
  proposed_title: string
  proposed_slug: string
  page_goal: string
  outline: string[]
  seo_rules: string[]
  required_entities: string[]
  internal_link_targets: string[]
  competitor_insights: string[]
  estimated_word_count: number
  rationale: string
}

export type PlanPreviewItem = PlanItemBrief

export interface CyclePlan {
  id: string
  campaign_id: string
  cycle_number: number
  status: CyclePlanStatus
  cycle_duration_days: number
  cycle_started_at?: string
  cycle_ends_at?: string
  plan_data: PlanPreviewItem[]
  total_pages: number
  total_estimated_words: number
  crawl_completed_at?: string
  created_at: string
  updated_at: string
}

export type CreateCyclePlanPayload = Omit<CyclePlan, 'id' | 'created_at' | 'updated_at'>

export interface AnalysisRunData {
  site: {
    url: string
    pagesFound: number
    pagesCrawled: number
    topKeywords: string[]
    pages: Array<{
      path: string
      title: string
      h1: string
      wordCount: number
      keywords: string[]
      hasFaq: boolean
      hasSchema: boolean
      geoSignals: string[]
    }>
  }
  competitors: Array<{
    url: string
    pagesFound: number
    pagesCrawled: number
    topKeywords: string[]
    pages: AnalysisRunData['site']['pages']
    strengths: string[]
    errors?: string[]
  }>
  gapAnalysis: {
    missingKeywords: string[]
    contentPatterns: string[]
    localOpportunities: string[]
    technicalGaps: string[]
    suggestedAngles: string[]
  }
}

export interface AnalysisRun {
  id: string
  site_id?: string
  status: AnalysisRunStatus
  input: {
    siteUrl: string
    businessType?: string
    businessName?: string
    targetCities?: string[]
    competitorUrls: string[]
  }
  analysis_data: AnalysisRunData
  error_message?: string
  created_at: string
  updated_at: string
  site?: Site
}

export type CreateSitePayload = Omit<Site, 'id' | 'created_at' | 'updated_at'>
export type CreateCampaignPayload = Omit<Campaign, 'id' | 'created_at' | 'updated_at' | 'last_run_at' | 'next_run_at' | 'site'>
export type CreateGenerationPayload = Omit<Generation, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'site'>
export type CreateArticlePayload = Omit<Article, 'id' | 'created_at' | 'updated_at'>
export type CreateBacklinkPayload = Omit<Backlink, 'id' | 'created_at'>
export type CreateEditorialSlotPayload = Omit<EditorialSlot, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'generation'>
export type CreateAnalysisRunPayload = Omit<AnalysisRun, 'id' | 'created_at' | 'updated_at' | 'site'>
