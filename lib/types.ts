// Database types matching supabase/schema.sql

export type SiteType = 'wordpress' | 'nextjs'
export type PublishStatus = 'publish' | 'draft' | 'pending'
export type GenerationStatus = 'pending' | 'generating' | 'generated' | 'publishing' | 'published' | 'failed' | 'rejected'
export type ArticleType = 'tutorial' | 'list' | 'case_study' | 'glossary' | 'example'
export type BacklinkType = 'thematic' | 'local' | 'directory' | 'guest_post' | 'social'
export type PageType = 'pillar' | 'child' | 'alternative' | 'comparative' | 'local_pack'
/**
 * Kept as a loose alias of the generation catalogue: `campaigns.ai_model` is a
 * text column, and a model added in lib/ai/provider must not require a schema
 * change to be selectable.
 */
export type AiProvider = import('@/lib/ai/provider').AiModel | (string & {})
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
  /**
   * Branch generated pages are committed to. NULL/absent means the repository
   * default branch — production on most setups, with no review step.
   */
  github_branch?: string
  /**
   * Merge `github_branch` into the repository default branch after publishing.
   *
   * Off by default: turning it on means a generated page reaches production
   * without anyone reading it. On, because otherwise the branch is a dead end —
   * the host deploys the default branch and the page is never visible.
   */
  auto_promote?: boolean
  /**
   * Last schema read from the client's CMS.
   *
   * Kept because reading it is several authenticated round-trips to their
   * production site — the same reason `repo_profile` is kept for Next.js.
   */
  cms_schema?: unknown
  cms_schema_read_at?: string | null
  github_mdx_path?: string
  repo_profile?: unknown
  is_active: boolean
  created_at: string
  updated_at: string
  google_connected?: boolean
  /** Last successful vector indexing run for this site (migration 009). */
  last_indexed_at?: string | null
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
  /**
   * The complete page object returned by the generator, stored verbatim.
   *
   * The scalar columns above (title, content, slug…) cannot carry the JSON-LD
   * schemas, the FAQ items or the internal links, so any publishing path that
   * rebuilds a page from them alone silently ships a page stripped of its
   * structured data and internal linking. Persisting the payload lets the
   * deferred publishing job republish exactly what was generated.
   *
   * Nullable: rows created before this column existed fall back to the
   * reconstruction path in the publisher.
   */
  page_payload?: import('@/lib/ai/openai').GeneratedPage
  status: GenerationStatus
  published_url?: string
  published_page_id?: number
  /** How the connector produced the page. Free string, read by humans. */
  publish_mode?: string | null
  /** Whether a visitor could reach it at publication time. Gates indexing. */
  publish_live?: boolean | null
  /** What the connector had to say that was not an error. */
  publish_notes?: string[] | null
  /**
   * Why the engine declined, when it declined on purpose.
   *
   * NULL on a breakage. A breakage retries itself; a refusal waits for a human,
   * and until this column existed the two were the same row in the same status.
   */
  refusal_kind?: string | null
  ai_model: string
  tokens_used?: number
  error_message?: string
  scheduled_for?: string
  /**
   * When the page actually went online (migration 010).
   *
   * Distinct from `updated_at`, which moves on every write: the J+30 performance
   * measurement joins a page to the Search Console rows of the 30 days that
   * FOLLOWED its publication, so using `updated_at` silently re-dates a page
   * every time anything touches its row.
   */
  published_at?: string | null
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
  /**
   * `failed` is terminal on purpose: the scheduler only ever picks up `planned`
   * slots, so a slot that exhausted its retries must not sit in `generating`
   * forever. The reaper hands stale `generating` slots back to `planned`;
   * `failed` means the run really did not work and needs a human decision.
   */
  status: 'planned' | 'generating' | 'generated' | 'published' | 'skipped' | 'failed'
  error_message?: string
  /**
   * Attempts already spent on this slot, incremented when it is claimed.
   *
   * The scheduler retries a slot across ticks rather than inside one: a
   * generation cannot be cancelled, so retrying it a few seconds after a timeout
   * simply runs two of them at once. This counter is what bounds those
   * across-tick retries.
   */
  attempt_count?: number
  created_at: string
  updated_at: string
  campaign?: Campaign
  generation?: Generation
}

/**
 * The slice of a generation the editorial calendar shows: enough to say what
 * came out of a slot and why it failed, without shipping the full HTML page.
 */
export interface CalendarSlotGeneration {
  id: string
  title?: string | null
  slug?: string | null
  status?: GenerationStatus | null
  published_url?: string | null
  error_message?: string | null
  updated_at?: string | null
}

/**
 * A slot as `GET /api/calendar` serialises it.
 *
 * Shared by the route and the page on purpose: both used to redeclare it, with
 * `status` widened to `string` while `EditorialSlot['status']` was gaining its
 * `failed` member. Now that the member exists, one declaration keeps the two
 * ends from drifting again — a status the API can return but the page cannot
 * name is exactly how `failed` stayed invisible in the first place.
 */
export type CalendarSlot = Omit<EditorialSlot, 'generation'> & {
  generation?: CalendarSlotGeneration | null
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
  /**
   * Readable body text captured by the crawler (migration 009).
   *
   * This is what the vector index embeds. Without it a document is built from
   * the title and headings alone, which describes what a page is called rather
   * than what it says.
   */
  content_excerpt?: string | null
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
