// ─────────────────────────────────────────────────────────────────────────────
// keyword_requests, and what the analysis and the engine read around it (L3, L4)
// ─────────────────────────────────────────────────────────────────────────────
//
// Named columns, bounded lists, the service key — server side only. The
// functions that take a site id are called with the id of a ClientSiteDto
// (lib/client-space/scope.ts) or by the scheduler, never with an id the
// browser sent alone. Writes that must not race go through the functions of
// migrations 024 and 025.

import { createServiceClient } from '@/lib/supabase'
import type { RequestChange } from '@/src/core/domain/keyword-requests/change'
import type { WaitingRequest } from '@/src/core/domain/keyword-requests/consumption'
import type { RequestStatus } from '@/src/core/domain/keyword-requests/lifecycle'
import { pickRequestCampaign } from '@/src/core/domain/keyword-requests/campaign'
import type { GenerationState, ProducingRequest, SlotState } from '@/src/core/domain/keyword-requests/production'
import type { Evidence } from '@/src/core/domain/keyword-requests/verdict'

function fail(action: string, message: string): never {
  throw new Error(`[demandes] ${action} : ${message}`)
}

// ── What a client reads ───────────────────────────────────────────────────

export const REQUEST_COLUMNS =
  'id,keyword,city,note,desired_by,status,reason_code,reasons,evidence,scheduled_for,published_url,published_at,decided_at,created_at,updated_at'

export interface RequestRow {
  id: string
  keyword: string
  city: string | null
  note: string | null
  desired_by: string | null
  status: RequestStatus
  reason_code: string | null
  reasons: string[]
  evidence: Evidence[]
  scheduled_for: string | null
  published_url: string | null
  published_at: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
}

export async function listSiteRequests(siteId: string, page: { offset: number; limit: number }): Promise<{ rows: RequestRow[]; total: number }> {
  const { data, error, count } = await createServiceClient()
    .from('keyword_requests')
    .select(REQUEST_COLUMNS, { count: 'exact' })
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(page.offset, page.offset + page.limit - 1)
  if (error) fail('demandes du site', error.message)
  return { rows: (data ?? []) as unknown as RequestRow[], total: count ?? 0 }
}

// ── Submitting ────────────────────────────────────────────────────────────

export type SubmitOutcome =
  | { keyword: string; outcome: 'created'; id: string }
  | { keyword: string; outcome: 'duplicate'; id: string; created_at: string }
  | { keyword: string; outcome: 'full' }

export interface SubmitParams {
  clientId: string
  siteId: string
  memberId: string
  items: ReadonlyArray<{ keyword: string; normalized: string }>
  city: string | null
  note: string | null
  desiredBy: string | null
  openMax: number
}

export async function submitRequests(params: SubmitParams): Promise<SubmitOutcome[]> {
  const { data, error } = await createServiceClient().rpc('submit_keyword_requests', {
    p_client_id: params.clientId,
    p_site_id: params.siteId,
    p_member_id: params.memberId,
    p_items: params.items.map((item) => ({ keyword: item.keyword, keyword_normalized: item.normalized })),
    p_city: params.city,
    p_note: params.note,
    p_desired_by: params.desiredBy,
    p_open_max: params.openMax,
  })
  if (error) fail('envoi', error.message)
  return (Array.isArray(data) ? data : []) as SubmitOutcome[]
}

// ── Withdrawing ───────────────────────────────────────────────────────────

export type WithdrawOutcome = 'withdrawn' | 'not_found' | 'locked'

/**
 * 'withdrawn', or why not: the request is not this site's, or it is past the
 * point of return. A planned request's slot is set aside in the same
 * transaction (025): the scheduler cannot start writing the page in between.
 */
export async function withdrawRequest(siteId: string, requestId: string): Promise<WithdrawOutcome> {
  const { data, error } = await createServiceClient().rpc('withdraw_keyword_request', {
    p_site_id: siteId,
    p_request_id: requestId,
  })
  if (error) fail('retrait', error.message)
  return data === 'withdrawn' || data === 'locked' ? data : 'not_found'
}

// ── The analysis ──────────────────────────────────────────────────────────

export interface ReceivedRequest {
  id: string
  site_id: string
  keyword: string
  city: string | null
}

/** Oldest first: a request waits at most as long as the ones before it. */
export async function listReceivedRequests(limit: number): Promise<ReceivedRequest[]> {
  const { data, error } = await createServiceClient()
    .from('keyword_requests')
    .select('id,site_id,keyword,city')
    .eq('status', 'received')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) fail('demandes a analyser', error.message)
  return (data ?? []) as ReceivedRequest[]
}

export interface StoredVerdict {
  id: string
  status: RequestStatus
  reason_code: string
  reasons: string[]
  evidence: Evidence[]
  campaign_id: string | null
  cycle_plan_id: string | null
  plan_item_id: string | null
  scheduled_for: string | null
}

/** The ids actually written: a request withdrawn during the analysis keeps its withdrawal. */
export async function applyVerdicts(verdicts: readonly StoredVerdict[]): Promise<string[]> {
  if (verdicts.length === 0) return []
  const { data, error } = await createServiceClient().rpc('apply_keyword_verdicts', { p_verdicts: verdicts })
  if (error) fail('verdicts', error.message)
  return (data ?? []) as string[]
}

// What the analysis confronts a request with, for several sites in three reads.

export interface CampaignRow {
  id: string
  site_id: string
  business_type: string | null
  business_name: string | null
  keywords: string[] | null
  communes: string[] | null
  department: string | null
  is_active: boolean | null
  current_cycle_id: string | null
  created_at: string
}

export const CAMPAIGN_COLUMNS = 'id,site_id,business_type,business_name,keywords,communes,department,is_active,current_cycle_id,created_at'

/** A site with more campaigns than this is a test bench, not a client site. */
const CAMPAIGNS_PER_SITE_MAX = 20

/** The campaign a site's requests are judged against (pickRequestCampaign), among that site's rows. */
export function pickSiteCampaign(rows: readonly CampaignRow[], siteId: string): CampaignRow | null {
  return pickRequestCampaign(
    rows
      .filter((row) => row.site_id === siteId)
      .map((row) => ({ ...row, isActive: row.is_active === true, hasCycle: row.current_cycle_id !== null, createdAt: row.created_at })),
  )
}

export async function listSiteCampaigns(siteIds: readonly string[]): Promise<CampaignRow[]> {
  if (siteIds.length === 0) return []
  const { data, error } = await createServiceClient()
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .in('site_id', siteIds as string[])
    .limit(CAMPAIGNS_PER_SITE_MAX * siteIds.length)
  if (error) fail('campagnes', error.message)
  return (data ?? []) as CampaignRow[]
}

export interface ExecutingPlanRow {
  id: string
  campaign_id: string
  plan_data: unknown
}

export interface OpenSlotRow {
  campaign_id: string
  plan_item_id: string | null
  scheduled_date: string
  target_keyword: string | null
  target_city: string | null
}

/** Slots whose page is not online yet: what a request can be « already planned » on. */
const NOT_YET_ONLINE = ['planned', 'generating', 'generated', 'failed']
const SLOTS_PER_CAMPAIGN_MAX = 200

export async function listExecutingPlans(campaignIds: readonly string[]): Promise<{ plans: ExecutingPlanRow[]; slots: OpenSlotRow[] }> {
  if (campaignIds.length === 0) return { plans: [], slots: [] }
  const supabase = createServiceClient()
  const [plans, slots] = await Promise.all([
    supabase.from('cycle_plans').select('id,campaign_id,plan_data').in('campaign_id', campaignIds as string[]).eq('status', 'executing').limit(campaignIds.length * 2),
    supabase
      .from('editorial_calendar')
      .select('campaign_id,plan_item_id,scheduled_date,target_keyword,target_city')
      .in('campaign_id', campaignIds as string[])
      .eq('artifact_kind', 'page')
      .in('status', NOT_YET_ONLINE)
      .not('plan_item_id', 'is', null)
      .limit(SLOTS_PER_CAMPAIGN_MAX * campaignIds.length),
  ])
  if (plans.error) fail('plans en cours', plans.error.message)
  if (slots.error) fail('creneaux prevus', slots.error.message)
  return { plans: (plans.data ?? []) as ExecutingPlanRow[], slots: (slots.data ?? []) as OpenSlotRow[] }
}

export async function listSiteUrls(siteIds: readonly string[]): Promise<Map<string, string>> {
  if (siteIds.length === 0) return new Map()
  const { data, error } = await createServiceClient().from('sites').select('id,url').in('id', siteIds as string[])
  if (error) fail('sites', error.message)
  return new Map(((data ?? []) as Array<{ id: string; url: string | null }>).map((row) => [row.id, row.url ?? '']))
}

// ── The requests in the engine (L4b) ──────────────────────────────────────

/** Every step of a batch in one call, each only if its request is still where the engine saw it (025). */
export async function advanceRequests(changes: readonly RequestChange[]): Promise<string[]> {
  if (changes.length === 0) return []
  const { data, error } = await createServiceClient().rpc('advance_keyword_requests', { p_changes: changes })
  if (error) fail('avancement', error.message)
  return (data ?? []) as string[]
}

const WAITING_COLUMNS = 'id,keyword,city,desired_by,created_at,deferred_cycles'
/** More than a plan has slots (60) and than a site may have open requests (30). */
const WAITING_PER_CAMPAIGN_MAX = 60

/** A campaign's queue, in consumption order (§ 3.2). */
export async function listWaitingRequests(campaignId: string): Promise<WaitingRequest[]> {
  const { data, error } = await createServiceClient()
    .from('keyword_requests')
    .select(WAITING_COLUMNS)
    .eq('campaign_id', campaignId)
    .eq('status', 'deferred')
    .order('desired_by', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(WAITING_PER_CAMPAIGN_MAX)
  if (error) fail('file d attente', error.message)
  return (data ?? []) as WaitingRequest[]
}

/** The requests planned on a campaign's slots that are still waiting for their day. */
export async function listRequestsOnPlannedSlots(campaignId: string): Promise<Array<{ id: string }>> {
  const supabase = createServiceClient()
  const { data: slots, error: slotError } = await supabase
    .from('editorial_calendar')
    .select('plan_item_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'planned')
    .not('plan_item_id', 'is', null)
    .limit(SLOTS_PER_CAMPAIGN_MAX)
  if (slotError) fail('creneaux a remplacer', slotError.message)
  const itemIds = [...new Set(((slots ?? []) as Array<{ plan_item_id: string }>).map((slot) => slot.plan_item_id))]
  if (itemIds.length === 0) return []

  const { data, error } = await supabase
    .from('keyword_requests')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', 'scheduled')
    .in('plan_item_id', itemIds)
  if (error) fail('demandes a rendre a la file', error.message)
  return (data ?? []) as Array<{ id: string }>
}

/** Set aside slots whose page must not be written, as long as nobody claimed them. */
export async function skipPlannedSlots(campaignId: string, planItemIds: readonly string[], reason: string): Promise<void> {
  if (planItemIds.length === 0) return
  const { error } = await createServiceClient()
    .from('editorial_calendar')
    .update({ status: 'skipped', error_message: reason })
    .eq('campaign_id', campaignId)
    .in('plan_item_id', planItemIds as string[])
    .eq('status', 'planned')
  if (error) fail('creneaux ecartes', error.message)
}

/** Requests followed through production per pass. Reads only: wide on purpose. */
const PRODUCING_PER_PASS = 300

export async function listProducingRequests(): Promise<ProducingRequest[]> {
  const { data, error } = await createServiceClient()
    .from('keyword_requests')
    .select('id,status,campaign_id,cycle_plan_id,plan_item_id,scheduled_for')
    .in('status', ['scheduled', 'in_production'])
    .not('plan_item_id', 'is', null)
    .order('scheduled_for', { ascending: true })
    .order('id', { ascending: true })
    .limit(PRODUCING_PER_PASS)
  if (error) fail('demandes en production', error.message)
  return (data ?? []) as ProducingRequest[]
}

export interface ProductionView {
  /** The slot of each plan item, the most recent when an item has several. */
  slots: Map<string, SlotState>
  generations: Map<string, GenerationState>
  /** Each campaign's running plan. */
  currentPlans: Map<string, string | null>
}

/** What the slots, their generations and the campaigns say about these requests: three reads. */
export async function readProduction(requests: readonly ProducingRequest[]): Promise<ProductionView> {
  const view: ProductionView = { slots: new Map(), generations: new Map(), currentPlans: new Map() }
  if (requests.length === 0) return view

  const supabase = createServiceClient()
  const itemIds = [...new Set(requests.map((request) => request.plan_item_id))]
  const campaignIds = [...new Set(requests.map((request) => request.campaign_id).filter((id): id is string => id !== null))]

  const [slots, campaigns] = await Promise.all([
    supabase
      .from('editorial_calendar')
      .select('plan_item_id,status,scheduled_date,generation_id,error_message,created_at')
      .in('plan_item_id', itemIds)
      .order('created_at', { ascending: true }),
    campaignIds.length > 0
      ? supabase.from('campaigns').select('id,current_cycle_id').in('id', campaignIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (slots.error) fail('creneaux des demandes', slots.error.message)
  if (campaigns.error) fail('campagnes des demandes', campaigns.error.message)

  // Ascending: the last one written wins.
  for (const slot of (slots.data ?? []) as Array<SlotState & { plan_item_id: string }>) view.slots.set(slot.plan_item_id, slot)
  for (const campaign of (campaigns.data ?? []) as Array<{ id: string; current_cycle_id: string | null }>) {
    view.currentPlans.set(campaign.id, campaign.current_cycle_id)
  }

  const generationIds = [...new Set([...view.slots.values()].map((slot) => slot.generation_id).filter((id): id is string => id !== null))]
  if (generationIds.length > 0) {
    const { data, error } = await supabase
      .from('generations')
      .select('id,status,published_url,published_at,error_message')
      .in('id', generationIds)
    if (error) fail('generations des demandes', error.message)
    for (const row of (data ?? []) as Array<GenerationState & { id: string }>) view.generations.set(row.id, row)
  }
  return view
}
