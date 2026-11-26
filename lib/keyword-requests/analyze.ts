// ─────────────────────────────────────────────────────────────────────────────
// The analysis of received keyword requests — KW-3
// A scheduler task (lib/scheduler/cron.ts, every 2 min, batches of 5)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per batch: the requests, then what they are confronted with — ONCE PER SITE,
// never once per request: campaigns, plans and slots in three reads for every
// site of the batch, then the inventory and the Search Console signals of each
// site in parallel. The rules run in the domain (verdict.ts); the model is
// asked only about a request the measurements did not settle; the verdicts
// are written in one call, each only if its request is still `received`.
//
// Nothing is placed in the cycle in progress yet: a receivable request is kept
// for the next period (`deferred`), whose plan consumes it first (L4b,
// lib/planning/brief-plan.ts). The current cycle takes requests from the L4c.

import { COMMUNES_AUBE } from '@/lib/geo/communes'
import { isNationalCampaign, targetCommunes } from '@/lib/geo/scope'
import { getGscPlanningSignals, type GscPlanningSignals } from '@/lib/google/performance'
import { loadSiteInventory } from '@/lib/existing/inventory'
import { campaignCityNames, NO_SEARCH_CONSOLE } from '@/lib/planning/brief-plan'
import { buildPageSlug } from '@/lib/seo/slug'
import type { SiteInventory } from '@/src/core/domain/existing/inventory'
import { normalizedRequest, requestQuery } from '@/src/core/domain/keyword-requests/normalize'
import { plannedBriefs } from '@/src/core/domain/keyword-requests/planned'
import {
  fitVerdict,
  measuredVerdict,
  type FitOpinion,
  type PlannedBrief,
  type RequestSubject,
  type RequestVerdict,
  type VerdictContext,
} from '@/src/core/domain/keyword-requests/verdict'
import { judgeFit, type FitInput } from './fit'
import {
  applyVerdicts,
  listExecutingPlans,
  listReceivedRequests,
  listSiteCampaigns,
  listSiteUrls,
  pickSiteCampaign,
  type CampaignRow,
  type ExecutingPlanRow,
  type OpenSlotRow,
  type ReceivedRequest,
  type StoredVerdict,
} from './repository'

/** Requests per run. Every two minutes, that is 150 an hour: far above what clients send. */
export const ANALYSIS_BATCH = 5

export interface SiteKnowledge {
  inventory: SiteInventory
  signals: GscPlanningSignals | null
}

/** What the analysis needs from outside, injectable for its tests. */
export interface AnalysisPorts {
  listReceived(limit: number): Promise<ReceivedRequest[]>
  listCampaigns(siteIds: readonly string[]): Promise<CampaignRow[]>
  listPlans(campaignIds: readonly string[]): Promise<{ plans: ExecutingPlanRow[]; slots: OpenSlotRow[] }>
  listSiteUrls(siteIds: readonly string[]): Promise<Map<string, string>>
  loadKnowledge(siteId: string): Promise<SiteKnowledge>
  judgeFit(input: FitInput): Promise<FitOpinion | null>
  applyVerdicts(verdicts: readonly StoredVerdict[]): Promise<string[]>
}

/** The real ones. Exported for the integration test, which swaps the model for a stand-in. */
export const defaultAnalysisPorts: AnalysisPorts = {
  listReceived: listReceivedRequests,
  listCampaigns: listSiteCampaigns,
  listPlans: listExecutingPlans,
  listSiteUrls,
  async loadKnowledge(siteId) {
    // Neither throws: an unreadable site comes back blind, Search Console absent comes back null.
    const [inventory, signals] = await Promise.all([
      loadSiteInventory(siteId),
      getGscPlanningSignals(siteId).catch(() => null),
    ])
    return { inventory, signals: signals?.available ? signals : null }
  },
  judgeFit,
  applyVerdicts,
}

interface SiteContext {
  campaign: CampaignRow | null
  verdict: VerdictContext
}

const KNOWN_COMMUNES = COMMUNES_AUBE.map((commune) => commune.name)

export async function analyzeReceivedRequests(ports: AnalysisPorts = defaultAnalysisPorts): Promise<{ analysed: number; written: number }> {
  const requests = await ports.listReceived(ANALYSIS_BATCH)
  if (requests.length === 0) return { analysed: 0, written: 0 }

  const contexts = await loadContexts([...new Set(requests.map((request) => request.site_id))], ports)

  const verdicts: StoredVerdict[] = []
  for (const request of requests) {
    const context = contexts.get(request.site_id)
    if (!context) continue
    // Sequential: at most one model call per request, five per run, and the
    // order of the batch stays the order of arrival.
    const verdict = await judge(request, context, ports)
    verdicts.push(stored(request, context, verdict))
  }

  const written = await ports.applyVerdicts(verdicts)
  console.log(
    `[demandes] ${requests.length} analysee(s), ${written.length} verdict(s) ecrit(s)` +
      (written.length < verdicts.length ? ` — ${verdicts.length - written.length} retiree(s) pendant l'analyse` : ''),
  )
  return { analysed: requests.length, written: written.length }
}

async function judge(request: ReceivedRequest, context: SiteContext, ports: AnalysisPorts): Promise<RequestVerdict> {
  const subject = subjectOf(request)
  const measured = measuredVerdict(subject, context.verdict)
  if (measured) return measured

  // measuredVerdict settles a site without campaign (NO_CAMPAIGN): here there is one.
  const campaign = context.campaign as CampaignRow
  const opinion = await ports.judgeFit({
    businessType: campaign.business_type ?? '',
    businessName: campaign.business_name ?? '',
    services: campaign.keywords ?? [],
    communes: context.verdict.zone?.communes ?? [],
    search: requestQuery(request.keyword, request.city),
  })
  return fitVerdict(subject, context.verdict, opinion)
}

function subjectOf(request: ReceivedRequest): RequestSubject {
  const query = requestQuery(request.keyword, request.city)
  return {
    keyword: request.keyword,
    city: request.city,
    normalized: normalizedRequest(request.keyword, request.city),
    // The page this request would become, as the planner would address it.
    target: {
      path: `/${buildPageSlug({ focusKeyword: query, city: request.city ?? '' })}`,
      title: query.charAt(0).toUpperCase() + query.slice(1),
      metaDescription: '',
      focusKeyword: query,
    },
  }
}

function stored(request: ReceivedRequest, context: SiteContext, verdict: RequestVerdict): StoredVerdict {
  return {
    id: request.id,
    status: verdict.status,
    reason_code: verdict.reasonCode,
    reasons: verdict.reasons,
    evidence: verdict.evidence,
    campaign_id: context.campaign?.id ?? null,
    cycle_plan_id: verdict.plan?.cyclePlanId ?? null,
    plan_item_id: verdict.plan?.planItemId ?? null,
    scheduled_for: verdict.plan?.scheduledFor ?? null,
  }
}

async function loadContexts(siteIds: string[], ports: AnalysisPorts): Promise<Map<string, SiteContext>> {
  const [campaigns, siteUrls, knowledge] = await Promise.all([
    ports.listCampaigns(siteIds),
    ports.listSiteUrls(siteIds),
    Promise.all(siteIds.map(async (siteId) => [siteId, await ports.loadKnowledge(siteId)] as const)),
  ])

  const chosen = new Map<string, CampaignRow>()
  for (const siteId of siteIds) {
    const campaign = pickSiteCampaign(campaigns, siteId)
    if (campaign) chosen.set(siteId, campaign)
  }

  const { plans, slots } = await ports.listPlans([...chosen.values()].map((campaign) => campaign.id))
  const knowledgeBySite = new Map(knowledge)

  return new Map(siteIds.map((siteId) => {
    const campaign = chosen.get(siteId) ?? null
    const { inventory, signals } = knowledgeBySite.get(siteId) as SiteKnowledge
    const briefs: PlannedBrief[] = campaign
      ? plans.filter((plan) => plan.campaign_id === campaign.id).flatMap((plan) => plannedBriefs(plan, slots))
      : []
    const communes = campaign ? targetCommunes(campaign.communes) : []
    const verdict: VerdictContext = {
      zone: campaign ? { national: isNationalCampaign(campaign), communes } : null,
      plannedBriefs: briefs,
      wonQueries: signals?.wonQueries ?? [],
      editorial: {
        gsc: signals ?? NO_SEARCH_CONSOLE,
        inventory,
        cityTokens: campaign ? campaignCityNames({ communes: campaign.communes ?? [], department: campaign.department ?? undefined }) : [],
      },
      knownPlaces: [...KNOWN_COMMUNES, ...communes],
      siteUrl: siteUrls.get(siteId) ?? '',
    }
    return [siteId, { campaign, verdict }]
  }))
}
