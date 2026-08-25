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

// ── Sites ─────────────────────────────────────────────────────────────

/**
 * Every column of `sites` EXCEPT `wp_app_password` and `github_token`.
 *
 * `select('*')` on this table is how a WordPress application password and a
 * GitHub write token ended up verbatim in the body of `GET /api/sites`. Every
 * query whose result can reach an HTTP response reads this list instead.
 *
 * Listing the columns by hand is the point: a `*` silently picks up whatever
 * secret the next migration adds to the table, an explicit list does not.
 */
export const SITE_SAFE_COLUMNS =
  'id,name,type,url,wp_username,wp_page_template,github_repo,github_branch,auto_promote,github_mdx_path,repo_profile,cms_schema,cms_schema_read_at,is_active,created_at,updated_at'

/** A site as it may cross the HTTP boundary. */
export type SafeSite = Omit<Site, 'wp_app_password' | 'github_token'>

/** A campaign whose embedded site carries no credentials. */
export type SafeCampaign = Omit<Campaign, 'site'> & { site?: SafeSite }

export async function listSites() {
  const supabase = requireSupabase()
  const { data: sites, error } = await supabase
    .from('sites')
    .select(SITE_SAFE_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const siteIds = (sites ?? []).map((s) => s.id)
  let connectedSiteIds = new Set<string>()
  let schemaReadableIds = new Set<string>()

  if (siteIds.length > 0) {
    // `has_schema` now means what it says: a schema HAS been read and kept.
    //
    // It used to be a lookup in `content_schemas`, a table nothing ever wrote,
    // so it was false for every site forever. It was then redefined as "the
    // schema COULD be read", which was honest but told the operator nothing
    // about whether it had been. Migration 017 gave the read somewhere to land,
    // so the flag can go back to its plain meaning.
    //
    // `wp_app_password` is only tested for non-nullness; it is never selected.
    const [connections, readable] = await Promise.all([
      supabase.from('google_connections').select('site_id').in('site_id', siteIds),
      supabase
        .from('sites')
        .select('id')
        .in('id', siteIds)
        .eq('type', 'wordpress')
        .not('cms_schema', 'is', null),
    ])
    connectedSiteIds = new Set((connections.data ?? []).map((c) => c.site_id))
    schemaReadableIds = new Set((readable.data ?? []).map((s) => s.id))
  }

  return (sites ?? []).map((site) => ({
    ...site,
    google_connected: connectedSiteIds.has(site.id),
    has_schema: schemaReadableIds.has(site.id),
  })) as SafeSite[]
}

export async function createSite(payload: CreateSitePayload) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('sites').insert(payload).select(SITE_SAFE_COLUMNS).single()
  if (error) throw new Error(error.message)
  return data as SafeSite
}

/**
 * The full `sites` row, credentials INCLUDED.
 *
 * Reserved for the server-side code that cannot work without them:
 * `publishToWordPress` needs `wp_app_password`, `publishToNextJs` and the repo
 * analyzer need `github_token`, and the WordPress schema extractor needs both
 * halves of the application password.
 *
 * Never hand this result to `NextResponse.json()`. Reading a site for display
 * goes through `listSites()`, which never sees the secrets in the first place.
 */
export async function getSiteWithCredentials(id: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('sites').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as Site | null
}

/**
 * @deprecated The name says nothing about the credentials it hands out, which is
 * how they spread. Its four remaining callers are all server-side and none of
 * them serialises the site, so the alias is safe as it stands; new code picks
 * `getSiteWithCredentials()` when it genuinely needs the secrets, and
 * `listSites()` otherwise.
 */
export const getSiteById = getSiteWithCredentials

/**
 * Resolve the site a WordPress webhook claims to come from.
 *
 * Host comparison rather than string equality: the plugin sends `home_url()`,
 * which differs from the stored URL by a trailing slash, a `www.` or a scheme
 * often enough that an `.eq('url', …)` would quietly never match — and a webhook
 * that never matches is a webhook that never updates a publication status.
 */
export async function findSiteIdByOrigin(siteUrl: string) {
  const wanted = normalizeHost(siteUrl)
  if (!wanted) return null

  const supabase = requireSupabase()
  const { data, error } = await supabase.from('sites').select('id,url')
  if (error) throw new Error(error.message)

  const match = (data ?? []).find((site) => normalizeHost(site.url) === wanted)
  return match ? (match.id as string) : null
}

function normalizeHost(value: string) {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return url.host.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
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
    .select(`*, site:sites(${SITE_SAFE_COLUMNS})`)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as SafeCampaign[]
}

export async function createCampaign(payload: CreateCampaignPayload) {
  const supabase = requireSupabase()
  const schedule = payload.frequency_hours > 0
    ? new Date(Date.now() + payload.frequency_hours * 60 * 60 * 1000).toISOString()
    : null

  const { data, error } = await supabase
    .from('campaigns')
    .insert({ ...payload, next_run_at: schedule })
    .select(`*, site:sites(${SITE_SAFE_COLUMNS})`)
    .single()

  if (error) throw new Error(error.message)
  return data as SafeCampaign
}

/**
 * Campaign WITH the site credentials embedded.
 *
 * The `sites(*)` here is load-bearing: `POST /api/campaigns/[id]/run` passes the
 * result straight to `runCampaignNow()`, which publishes inline and reads
 * `campaign.site.wp_app_password` / `campaign.site.github_token`. Projecting the
 * columns here would not raise a type error — both fields are optional on `Site`
 * — it would just publish with an empty password and fail against the client's
 * WordPress at the last step.
 */
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

/**
 * The same campaign, with the site credentials left in the database.
 *
 * `getCampaignById()` embeds `sites(*)` because the run and publish paths cannot
 * work without the secrets. Two routes, however, hand a campaign straight back
 * to the caller — `GET /api/campaigns/[id]` and `POST /api/analysis-runs/[id]/plan`
 * — and returning the credentialed row there put a WordPress application
 * password and a GitHub token in a JSON body again, one layer below the
 * projection every other read already goes through.
 */
export async function getCampaignByIdSafe(id: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('campaigns')
    .select(`*, site:sites(${SITE_SAFE_COLUMNS})`)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as SafeCampaign | null
}

export async function updateCampaignSchedule(id: string, values: Partial<Campaign>) {
  const supabase = requireSupabase()
  const { error } = await supabase.from('campaigns').update(values).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Scheduler-only, and credentialed for the same reason as `getCampaignById()`:
 * the cron tick publishes inline from `campaign.site`. No HTTP route returns
 * this result.
 */
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

/**
 * THIS FUNCTION THROWS. Everything folded into one call fails together.
 *
 * That is not a defect — a caller storing a generated page wants to know its
 * write failed — but it decides what may travel in the same `values`, and two
 * columns must NOT.
 *
 * `slug` was the first lesson: written here alongside the HTML, a collision on
 * the unique index failed the ENTIRE update and threw away a page that had
 * already been generated and paid for. The address is reserved on its own now
 * (lib/existing/reservation.ts), before a single token is spent.
 *
 * `duplicate_verdict` is the second, and it is the one this pass adds. The
 * verdict is bookkeeping ABOUT a page that already exists: losing the page
 * because its evidence could not be filed would be the worse failure of the two.
 * It is therefore written by `persistDuplicateVerdict` (lib/pipeline/repository.ts),
 * which never throws, in its own UPDATE — and, critically, on BOTH sides of the
 * decision, the branch that rejects and the branch that lets the page through.
 * While the gate runs in observation mode the verdict is computed on pages that
 * DO ship: filing it only when it blocked would make the blocking rate that the
 * switch to enforcement will be decided on read 100 % for ever, measured on an
 * empty sample.
 *
 * Nothing here forbids it in the type. `lib/db.ts` is shared data access and
 * holds no editorial policy of its own — the rule is named where it is broken,
 * not enforced by narrowing a generic CRUD helper.
 */
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
    .select(`*, site:sites(${SITE_SAFE_COLUMNS})`)
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as Generation[]
}

/**
 * Generations awaiting the deferred publishing job.
 *
 * The `campaigns!inner` join combined with `campaign.auto_publish = true` is
 * load-bearing, not cosmetic: without it this query returns every generation
 * sitting in 'generated', which is exactly the status used to park a page when
 * the campaign has auto-publish DISABLED. The publishing job would then push to
 * the client's site the very content they asked us not to publish.
 *
 * The inner join also excludes generations with no campaign (one-off runs from
 * /api/generate), which must stay manual by design.
 *
 * The `sites(*)` embed keeps the credentials on purpose — the publishing job
 * pushes to WordPress and GitHub straight from `gen.site`. Projecting the safe
 * columns here would compile cleanly and publish with an empty password.
 *
 * `intent = 'create'` is what makes "a refresh is never automatic" true.
 *
 * A row with `intent = 'refresh'` sits in `generated` on purpose: that is where
 * the architecture parks a page rewrite until a human clicks. Without this
 * filter the deferred job would pick it up at the next tick and push it with no
 * `replaces`, which on the owner's site means overwriting — or being refused as
 * 'occupe' on — a page that ranks. Rows written before migration 018 carry the
 * column's default, so this filter excludes nothing that existed before it.
 */
export async function listPendingPublishGenerations() {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('generations')
    .select('*, site:sites(*), campaign:campaigns!inner(*)')
    .eq('status', 'generated')
    .eq('intent', 'create')
    .eq('campaign.auto_publish', true)
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

// `getSiteContext` and `checkDuplicates` used to live here.
//
// They were two of the four places that each simulated a knowledge of what the
// site already carries. Both read `select('*')` twice — the FULL HTML of every
// generation pulled over the wire to extract three arrays of strings — and
// neither separated the only two questions that matter: "is this URL taken?"
// and "is this subject already covered?".
//
// Both are replaced by `loadSiteInventory` (lib/existing/inventory.ts), one read
// with a narrow projection. They were deleted rather than deprecated so the
// compiler names every caller instead of letting a fifth one appear; and this
// file goes back to being shared data access, with no editorial policy of its
// own.

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
    .select(`*, site:sites(${SITE_SAFE_COLUMNS})`)
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
    .select(`*, campaign:campaigns(*, site:sites(${SITE_SAFE_COLUMNS}))`)
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
