import { toSitePagePayloads } from '@/lib/analyzer/to-site-pages'
import { crawlWebsite } from '@/lib/analyzer/crawler'
import {
  createCyclePlan,
  getCampaignsWithExpiringCycles,
  getLatestCyclePlan,
  updateCampaign,
  updateCyclePlan,
  upsertSitePages,
} from '@/lib/db'
import { indexSitePages } from '@/src/adapters/rag/VectorIndexingService'
import { deleteEditorialSlots, saveEditorialSlots } from './editorial'
import { generatePlanPreview } from './plan-preview'
import type { Campaign, CyclePlan, PlanPreviewItem } from '@/lib/types'

/**
 * Pages the renewal crawl is allowed to read.
 *
 * Same figure as the ceiling `loadSiteInventory` uses to decide `truncated`, so
 * "the crawl stopped early" and "the inventory admits it is incomplete" are the
 * same fact rather than two thresholds that drift apart.
 */
const RENEWAL_CRAWL_MAX_PAGES = 300

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
    // 300 rather than 50, aligned with the ceiling the inventory uses to decide
    // `truncated`. At 50 the renewal saw a sixth of a real client site and the
    // rest was invisible to every slug decision of the next cycle — a page the
    // crawl never reached is a page the engine will happily write over.
    const crawlResult = await crawlWebsite({
      siteUrl: campaign.site.url,
      maxPages: RENEWAL_CRAWL_MAX_PAGES,
      followLinks: true,
    })

    // Said out loud rather than counted silently: past the ceiling the inventory
    // stops claiming to know the site, and the operator is the only one who can
    // decide whether that matters.
    if (crawlResult.truncated) {
      console.warn(
        `[cycle-manager] crawl plafonne a ${RENEWAL_CRAWL_MAX_PAGES} pages pour ${campaign.site.url} :` +
          ` l'inventaire du prochain cycle sera incomplet.`
      )
    }

    const siteId = campaign.site_id

    if (crawlResult.pages.length > 0 && siteId) {
      const sitePages = toSitePagePayloads(siteId, crawlResult)

      // The cast covers the `|| null` fallbacks above, and only those: `SitePage`
      // types its optional strings as `string | undefined`, while `null` is what
      // actually CLEARS a column the crawl no longer finds. The fields added by
      // migration 018 are declared on `CreateSitePagePayload`, so they are not
      // what it is hiding — a cast is how a column gets lost, and this one is
      // bounded on purpose.
      // Journalise plutot qu'avale : un echec d'ecriture ici laissait
      // l'inventaire vide sans qu'aucune trace n'existe nulle part. Le cycle
      // continue — un inventaire absent degrade, il ne bloque pas — mais il
      // devient diagnosticable.
      await upsertSitePages(siteId, sitePages as Parameters<typeof upsertSitePages>[1]).catch(
        (error: unknown) => {
          console.error(
            `[cycle] site_pages non ecrit site=${siteId}:`,
            error instanceof Error ? error.message : error
          )
          return null
        }
      )

      // Refresh the vector index with what the re-crawl just found. This is the
      // second of the two crawl paths that run in production (the other is
      // /api/analysis-runs); both must index or the store only ever holds
      // whatever the very first crawl saw.
      //
      // Never fails the cycle: `indexSitePages` reports errors instead of
      // throwing, and a stale index is not a reason to block a cycle renewal.
      const indexing = await indexSitePages(siteId, { source: 'crawl' })
      if (indexing.errors.length > 0) {
        console.warn(`[cycle-manager] indexation partielle site=${siteId}:`, indexing.errors.join(' | '))
      }
    }

    await updateCampaign(campaign.id, { last_crawl_at: new Date().toISOString() })
  }

  // 3. Generate new plan (auto-confirmed since cycle_auto_renew=true)
  //
  // No site context is read here any more. This function used to call
  // `getSiteContext` and hand the planner two arrays of strings; the planner now
  // loads the inventory itself, right after this crawl updated it. Reading it
  // here as well would be the same rows over the wire twice, five lines apart —
  // and the two readers would drift the first time one of them was fixed.
  const cycleDays = campaign.cycle_duration_days || 14
  const planItems = await generatePlanPreview({
    campaign,
    cycleDays,
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

  // 4. Create editorial slots from plan
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

  // 5. Update campaign
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
