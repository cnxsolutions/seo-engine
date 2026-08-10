import { crawlWebsite } from '@/lib/analyzer/crawler'
import {
  createCyclePlan,
  getCampaignsWithExpiringCycles,
  getLatestCyclePlan,
  getSiteContext,
  updateCampaign,
  updateCyclePlan,
  upsertSitePages,
} from '@/lib/db'
import { indexSitePages } from '@/src/adapters/rag/VectorIndexingService'
import { deleteEditorialSlots, saveEditorialSlots } from './editorial'
import { generatePlanPreview } from './plan-preview'
import type { Campaign, CyclePlan, PlanPreviewItem } from '@/lib/types'

export async function checkCycleCompletion() {
  const now = new Date().toISOString()
  const expiringCycles = await getCampaignsWithExpiringCycles(now)

  const renewals = expiringCycles.filter(
    (cyclePlan) => cyclePlan.campaign && cyclePlan.campaign.cycle_auto_renew
  )

  // A renewal re-crawls the site and calls the model: one campaign whose site is
  // unreachable must not stop the others from getting their next cycle. The
  // rejection is journalled rather than swallowed — a cycle that silently never
  // renews looks exactly like a campaign that has nothing left to publish.
  const results = await Promise.allSettled(
    renewals.map((cyclePlan) => endCycleAndStartNew(cyclePlan.campaign, cyclePlan))
  )

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(
        '[ERROR] [cycle] Cycle renewal failed for campaign',
        renewals[index].campaign?.id,
        result.reason instanceof Error ? result.reason.message : result.reason
      )
    }
  })
}

export async function endCycleAndStartNew(campaign: Campaign, currentCycle: CyclePlan) {
  // 1. Mark current cycle as completed
  await updateCyclePlan(currentCycle.id, { status: 'completed' })

  // 2. Re-crawl the site to detect new pages and changes
  if (campaign.site?.url) {
    const crawlResult = await crawlWebsite({
      siteUrl: campaign.site.url,
      maxPages: 50,
      followLinks: true,
    })

    if (crawlResult.pages.length > 0 && campaign.site_id) {
      const sitePages = crawlResult.pages.map(page => ({
        site_id: campaign.site_id,
        url: page.url,
        path: page.path,
        title: page.title || null,
        meta_description: page.metaDescription || null,
        h1: page.h1 || null,
        h2s: page.h2s,
        word_count: page.wordCount,
        focus_keyword: page.keywords[0] || null,
        keywords: page.keywords,
        internal_links: page.internalLinks.slice(0, 20),
        external_links: page.externalLinks.slice(0, 10),
        has_schema: page.hasSchema,
        schema_types: page.schemaTypes,
        has_faq: page.hasFaq,
        has_local_business: page.hasLocalBusiness,
        geo_signals: page.geoSignals,
        // The body of the page, not just its headings — see the same field in
        // app/api/analysis-runs/route.ts.
        content_excerpt: page.textExcerpt || null,
        crawled_at: crawlResult.crawledAt,
      }))

      await upsertSitePages(campaign.site_id, sitePages as Parameters<typeof upsertSitePages>[1]).catch(() => null)

      // Refresh the vector index with what the re-crawl just found. This is the
      // second of the two crawl paths that run in production (the other is
      // /api/analysis-runs); both must index or the store only ever holds
      // whatever the very first crawl saw.
      //
      // Never fails the cycle: `indexSitePages` reports errors instead of
      // throwing, and a stale index is not a reason to block a cycle renewal.
      const indexing = await indexSitePages(campaign.site_id, { source: 'crawl' })
      if (indexing.errors.length > 0) {
        console.warn(`[cycle-manager] indexation partielle site=${campaign.site_id}:`, indexing.errors.join(' | '))
      }
    }

    await updateCampaign(campaign.id, { last_crawl_at: new Date().toISOString() })
  }

  // 3. Get fresh site context for dedup
  let existingSlugs: string[] = []
  let existingKeywords: string[] = []
  if (campaign.site_id) {
    const context = await getSiteContext(campaign.site_id).catch(() => null)
    if (context) {
      existingSlugs = context.usedSlugs
      existingKeywords = context.usedKeywords
    }
  }

  // 4. Generate new plan (auto-confirmed since cycle_auto_renew=true)
  const cycleDays = campaign.cycle_duration_days || 14
  const planItems = await generatePlanPreview({
    campaign,
    cycleDays,
    existingSlugs,
    existingKeywords,
  })

  if (planItems.length === 0) return

  const nextCycleNumber = currentCycle.cycle_number + 1
  const totalWords = planItems.reduce((sum, item) => sum + item.estimated_word_count, 0)

  const newPlan = await createCyclePlan({
    campaign_id: campaign.id,
    cycle_number: nextCycleNumber,
    status: 'executing',
    cycle_duration_days: cycleDays,
    cycle_started_at: new Date().toISOString(),
    cycle_ends_at: new Date(Date.now() + cycleDays * 24 * 60 * 60 * 1000).toISOString(),
    plan_data: planItems,
    total_pages: planItems.length,
    total_estimated_words: totalWords,
    crawl_completed_at: new Date().toISOString(),
  })

  // 5. Create editorial slots from plan
  await deleteEditorialSlots(campaign.id)
  const slots = planItems.map(item => ({
    campaign_id: campaign.id,
    plan_item_id: item.id,
    scheduled_date: item.scheduled_date,
    page_type: item.page_type,
    target_keyword: item.target_keyword,
    target_city: item.target_city,
    status: 'planned' as const,
  }))
  await saveEditorialSlots(slots)

  // 6. Update campaign
  await updateCampaign(campaign.id, { current_cycle_id: newPlan.id })
}

export async function startCycle(campaign: Campaign, planId: string, planItems: PlanPreviewItem[]) {
  const cycleDays = campaign.cycle_duration_days || 14
  const now = new Date()
  const endsAt = new Date(now.getTime() + cycleDays * 24 * 60 * 60 * 1000)

  // Update plan to executing
  await updateCyclePlan(planId, {
    status: 'executing',
    cycle_started_at: now.toISOString(),
    cycle_ends_at: endsAt.toISOString(),
  })

  // Create editorial calendar slots
  await deleteEditorialSlots(campaign.id)
  const slots = planItems.map(item => ({
    campaign_id: campaign.id,
    plan_item_id: item.id,
    scheduled_date: item.scheduled_date,
    page_type: item.page_type,
    target_keyword: item.target_keyword,
    target_city: item.target_city,
    status: 'planned' as const,
  }))
  await saveEditorialSlots(slots)

  // Update campaign
  await updateCampaign(campaign.id, { current_cycle_id: planId })
}

export async function getCycleStatus(campaignId: string) {
  const plan = await getLatestCyclePlan(campaignId)
  if (!plan) return null

  return {
    plan,
    isActive: plan.status === 'executing',
    daysRemaining: plan.cycle_ends_at
      ? Math.max(0, Math.ceil((new Date(plan.cycle_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : 0,
    progress: plan.status === 'executing' && plan.cycle_started_at && plan.cycle_ends_at
      ? Math.min(100, Math.round(
          ((Date.now() - new Date(plan.cycle_started_at).getTime()) /
           (new Date(plan.cycle_ends_at).getTime() - new Date(plan.cycle_started_at).getTime())) * 100
        ))
      : 0,
  }
}
