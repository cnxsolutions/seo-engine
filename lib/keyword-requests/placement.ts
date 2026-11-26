// ─────────────────────────────────────────────────────────────────────────────
// A receivable request, placed in the cycle in progress — KW-4, L4c
// docs/cadrage.md § 3.2, § 3.4
// ─────────────────────────────────────────────────────────────────────────────
//
// Right after the analysis wrote « kept for the next period », the same task
// tries the cycle in progress. The domain says whether a slot can be replaced
// and which ones (placement.ts); the brief is written by THE SAME function as
// a plan's briefs (writePlanBriefs), against the same knowledge of the site
// plus the cycle's own briefs, so that it competes with none of them; then
// swap_plan_item (026) puts it in the plan, the slot and the request at once.
//
// Nothing here may lose a request: every way out that is not « placed » or
// « covered » leaves it kept for the next period, where the L4b consumes it.
// A brief is paid for only when a slot is there to take it.

import { getCampaignByIdSafe } from '@/lib/db'
import { isNationalCampaign, plannablePageTypes, targetCommunes } from '@/lib/geo/scope'
import {
  decideForSlot,
  loadPlanningKnowledge,
  writePlanBriefs,
  type PlannedSubject,
  type PlanningKnowledge,
  type PlanSlot,
} from '@/lib/planning/brief-plan'
import type { Campaign, PlanItemBrief } from '@/lib/types'
import { parisDay } from '@/src/core/domain/client-space/overview'
import { requestCity } from '@/src/core/domain/keyword-requests/consumption'
import { placementCandidates, type NoPlacementReason } from '@/src/core/domain/keyword-requests/placement'
import {
  advanceRequests,
  getRunningPlan,
  listCampaignPlannedSlots,
  listClaimedItemIds,
  listRequestsToPlace,
  swapPlanItem,
  type RunningPlan,
} from './repository'

/** A request the analysis has just judged receivable. */
export interface PlaceableRequest {
  id: string
  campaign_id: string
  keyword: string
  city: string | null
  desired_by: string | null
}

/** Why a request stayed kept for the next period: what the console tells CNX. */
export type KeptReason = NoPlacementReason | 'NO_CYCLE' | 'BRIEF_UNAVAILABLE' | 'SLOTS_TAKEN'

export interface PlacementResult {
  id: string
  outcome: 'placed' | 'covered' | 'kept'
  reason: KeptReason | null
}

export interface PlacementReport {
  placed: number
  covered: number
  kept: number
  results: PlacementResult[]
}

/** What placement needs from outside: the model and the site's reads, injectable for the integration test. */
export interface PlacementDeps {
  loadCampaign(id: string): Promise<Campaign | null>
  loadKnowledge(campaign: Campaign): Promise<PlanningKnowledge>
  writeBrief(knowledge: PlanningKnowledge, subject: PlannedSubject): Promise<PlanItemBrief | null>
  now(): Date
}

export const defaultPlacementDeps: PlacementDeps = {
  loadCampaign: getCampaignByIdSafe,
  loadKnowledge: (campaign) => loadPlanningKnowledge({ campaign }),
  writeBrief: async (knowledge, subject) => (await writePlanBriefs(knowledge, [subject]))[0] ?? null,
  now: () => new Date(),
}

type Placed = Pick<PlacementResult, 'outcome' | 'reason'>

export async function placeInCurrentCycle(
  requests: readonly PlaceableRequest[],
  deps: PlacementDeps = defaultPlacementDeps,
): Promise<PlacementReport> {
  const report: PlacementReport = { placed: 0, covered: 0, kept: 0, results: [] }
  if (requests.length === 0) return report

  const byCampaign = new Map<string, PlaceableRequest[]>()
  for (const request of requests) byCampaign.set(request.campaign_id, [...(byCampaign.get(request.campaign_id) ?? []), request])

  for (const [campaignId, list] of byCampaign) {
    const campaign = await deps.loadCampaign(campaignId).catch(() => null)
    // The site's knowledge is read once per campaign, and only if a slot can take a request.
    let knowledge: Promise<PlanningKnowledge> | null = null
    const knowledgeOf = () => (knowledge ??= deps.loadKnowledge(campaign as Campaign))

    // Sequential: each placement changes the plan the next one reads.
    for (const request of list) {
      const result: Placed = campaign?.current_cycle_id
        ? await placeOne(request, campaign, knowledgeOf, deps).catch((error: unknown): Placed => {
            console.warn(`[demandes] integration au cycle impossible pour ${request.id}, gardee : ${error instanceof Error ? error.message : error}`)
            return { outcome: 'kept', reason: 'BRIEF_UNAVAILABLE' }
          })
        : { outcome: 'kept', reason: 'NO_CYCLE' }
      report[result.outcome]++
      report.results.push({ id: request.id, ...result })
    }
  }

  if (report.placed + report.covered > 0) {
    console.log(`[demandes] cycle en cours : ${report.placed} integree(s), ${report.covered} couverte(s), ${report.kept} gardee(s) pour la periode suivante`)
  }
  return report
}

async function placeOne(
  request: PlaceableRequest,
  campaign: Campaign,
  knowledgeOf: () => Promise<PlanningKnowledge>,
  deps: PlacementDeps,
): Promise<Placed> {
  const plan = await getRunningPlan(campaign.current_cycle_id as string)
  const [slots, claimed] = plan
    ? await Promise.all([listCampaignPlannedSlots(campaign.id), listClaimedItemIds(plan.items.map((item) => item.id))])
    : [[], new Set<string>()]

  const placement = placementCandidates({
    plan,
    slots,
    claimedItemIds: claimed,
    today: parisDay(deps.now()),
    desiredBy: request.desired_by,
  })
  if (placement.kind === 'none') return { outcome: 'kept', reason: placement.reason }
  if (!plan) return { outcome: 'kept', reason: 'NO_RUNNING_CYCLE' }

  const knowledge = withCycleBriefs(await knowledgeOf(), plan)
  const first = placement.slots[0]
  const replaced = plan.items.find((item) => item.id === first.itemId)
  const subject: PlannedSubject = {
    ...decideForSlot(seedSlot(request, campaign, first.scheduledDate, replaced), knowledge),
    requestId: request.id,
  }

  const brief = await deps.writeBrief(knowledge, subject)
  if (!brief) return { outcome: 'kept', reason: 'BRIEF_UNAVAILABLE' }

  if (brief.action?.kind === 'skip') {
    const written = await advanceRequests([{
      id: request.id,
      from: 'deferred',
      status: 'covered',
      reason_code: 'PLAN_GUARD',
      reasons: [...brief.action.reasons],
    }])
    return written.length > 0 ? { outcome: 'covered', reason: null } : { outcome: 'kept', reason: 'SLOTS_TAKEN' }
  }

  for (const candidate of placement.slots) {
    const previous = plan.items.find((item) => item.id === candidate.itemId)
    const outcome = await swapPlanItem({
      planId: plan.id,
      slotId: candidate.slotId,
      oldItemId: candidate.itemId,
      newItem: { ...brief, scheduled_date: candidate.scheduledDate },
      requestId: request.id,
      reasons: [
        `Intégrée au cycle en cours, créneau du ${candidate.scheduledDate}` +
          (previous ? `, à la place de « ${previous.target_keyword} ».` : '.'),
      ],
    })
    if (outcome === 'placed') return { outcome: 'placed', reason: null }
    if (outcome !== 'slot_taken') return { outcome: 'kept', reason: 'SLOTS_TAKEN' }
  }
  return { outcome: 'kept', reason: 'SLOTS_TAKEN' }
}

/** Requests CNX asked into the cycle in progress, per pass of the requests task. */
export const OPERATOR_PLACEMENT_BATCH = 5

const KEPT_REASONS: Readonly<Record<KeptReason, string>> = {
  NO_CYCLE: "Aucun cycle ne tourne sur ce site : la demande attend le prochain plan.",
  NO_RUNNING_CYCLE: "Aucun cycle ne tourne sur ce site : la demande attend le prochain plan.",
  CYCLE_ENDING: 'Le cycle en cours finit dans moins de 3 jours : la demande passe en tête du prochain plan.',
  QUOTA_REACHED: "Un tiers des pages du cycle viennent déjà de demandes : la demande passe en tête du prochain plan.",
  NO_FREE_SLOT: "Aucune page prévue n'est remplaçable (toutes entamées, trop proches ou piliers) : la demande passe en tête du prochain plan.",
  BRIEF_UNAVAILABLE: "Le brief n'a pas pu être rédigé (modèle indisponible) : la demande passe en tête du prochain plan.",
  SLOTS_TAKEN: 'Les pages remplaçables ont été prises pendant la rédaction : la demande passe en tête du prochain plan.',
}

/**
 * The requests CNX marked « integrate » (arbitration.ts), tried in the cycle in
 * progress. One that cannot enter says why — in the console — and is no longer
 * tried: it stays at the head of the queue for the next plan.
 */
export async function placeRequestedByOperator(deps: PlacementDeps = defaultPlacementDeps): Promise<PlacementReport> {
  const requests = await listRequestsToPlace(OPERATOR_PLACEMENT_BATCH)
  const placeable = requests.filter((request): request is PlaceableRequest => request.campaign_id !== null)
  const report = await placeInCurrentCycle(placeable, deps)

  const kept = [
    ...report.results.filter((result) => result.outcome === 'kept'),
    ...requests.filter((request) => request.campaign_id === null).map((request) => ({ id: request.id, reason: 'NO_CYCLE' as const })),
  ]
  await advanceRequests(kept.map((result) => ({
    id: result.id,
    from: 'deferred' as const,
    status: 'deferred' as const,
    reason_code: 'NO_SLOT_NOW',
    reasons: [KEPT_REASONS[result.reason ?? 'SLOTS_TAKEN']],
  })))
  return report
}

/**
 * The slot as the planner would seed it for this request: the client's
 * search, their town (else the one the keyword names, else the replaced
 * page's), and a child page when the campaign plans them — the same rules as
 * the next plan's consumption (consumption.ts).
 */
function seedSlot(request: PlaceableRequest, campaign: Campaign, day: string, replaced: PlanItemBrief | undefined): PlanSlot {
  const national = isNationalCampaign(campaign)
  const city = national ? '' : requestCity(request, targetCommunes(campaign.communes)) ?? replaced?.target_city ?? ''
  const pageType = plannablePageTypes(campaign).includes('child') ? 'child' : replaced?.page_type ?? 'child'
  return {
    campaign_id: campaign.id,
    scheduled_date: day,
    page_type: pageType,
    target_keyword: request.keyword,
    target_city: city,
    status: 'planned',
  } as PlanSlot
}

/**
 * The site's knowledge, plus the briefs of the cycle in progress: their
 * addresses are taken and their keywords carried, exactly as if the request
 * had been one more slot of that plan. A fresh copy each time — the brief
 * writing reserves its own address in it.
 */
function withCycleBriefs(knowledge: PlanningKnowledge, plan: RunningPlan): PlanningKnowledge {
  const creations = plan.items.filter((item) => (item.action?.kind ?? 'create') === 'create')
  const slugs = creations.map((item) => item.proposed_slug.replace(/^\/+/, '')).filter(Boolean)
  const keywords = creations.map((item) => item.target_keyword.toLowerCase()).filter(Boolean)
  return {
    ...knowledge,
    takenPaths: new Set([...knowledge.takenPaths, ...slugs.map((slug) => `/${slug}`)]),
    existingSlugs: [...new Set([...knowledge.existingSlugs, ...slugs])],
    existingKeywords: [...new Set([...knowledge.existingKeywords, ...keywords])],
  }
}
