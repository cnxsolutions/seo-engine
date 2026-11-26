// ─────────────────────────────────────────────────────────────────────────────
// The waiting requests, consumed by the next plan — KW-5, KW-11, KW-13
// docs/cadrage.md § 3.2 (quota, order), § 3.5 (consumption)
// ─────────────────────────────────────────────────────────────────────────────
//
// A request the analysis kept for the next period (`deferred`) takes a slot of
// the next plan, BEFORE the rotation of the campaign's keywords: the first
// slots of the calendar carry the client's searches. A third of the slots at
// most (decision 4), never the pillar (the cycle's children link to it), and
// the volume of the cycle does not change — a request replaces a seed, it does
// not add a page.
//
// When the plan starts, each request learns what became of it (`planOutcome`):
// planned on a slot, covered (its brief fell to the guards), or one more cycle
// waited — and after MAX_DEFERRED_CYCLES, sent to CNX rather than left waiting.

import { normalizeForMatch } from '../text/text-utils'
import type { RequestChange } from './change'
import { detectPlaces } from './verdict'

/** Decision 4: at most a third of a cycle's slots come from client requests. */
export const PLAN_REQUEST_SHARE = 1 / 3

/** KW-11: past this many cycles waited, CNX looks at the request. */
export const MAX_DEFERRED_CYCLES = 3

/** A request kept for the next period, as the planner reads it. */
export interface WaitingRequest {
  id: string
  keyword: string
  city: string | null
  desired_by: string | null
  created_at: string
  deferred_cycles: number
}

/** How many slots of a plan may carry requests: a third, at least one, never more than there are. */
export function requestQuota(slotCount: number): number {
  if (slotCount <= 0) return 0
  return Math.min(slotCount, Math.max(1, Math.floor(slotCount * PLAN_REQUEST_SHARE)))
}

/** § 3.2: the closest wished date first, then the oldest request (FIFO). */
export function consumptionOrder(requests: readonly WaitingRequest[]): WaitingRequest[] {
  return [...requests].sort((a, b) => {
    if (a.desired_by !== b.desired_by) {
      if (a.desired_by === null) return 1
      if (b.desired_by === null) return -1
      return a.desired_by < b.desired_by ? -1 : 1
    }
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * The town a request aims at: the one the client chose, else the campaign
 * commune its keyword names (« plombier troyes »), else none — the slot keeps
 * the town its rotation gave it.
 */
export function requestCity(request: Pick<WaitingRequest, 'keyword' | 'city'>, communes: readonly string[]): string | null {
  if (request.city?.trim()) return request.city.trim()
  return detectPlaces(normalizeForMatch(request.keyword), communes)[0] ?? null
}

/** A calendar slot, as far as seeding is concerned. */
export interface SeedableSlot {
  page_type?: string | null
  target_keyword?: string | null
  target_city?: string | null
}

export interface SeedPlacement {
  /** A national campaign has no town: every seeded slot keeps an empty one. */
  national: boolean
  /** The page type a request's page takes, when the campaign plans it; null keeps the slot's. */
  pageType: string | null
  /** The campaign's communes: a keyword naming one of them aims at it. */
  communes: readonly string[]
}

export interface SeededSlots<S extends SeedableSlot> {
  slots: S[]
  /** For each slot, in order, the request it now carries — null for a seed of the rotation. */
  requestIds: Array<string | null>
}

/**
 * The first non-pillar slots of the calendar take the waiting requests, in
 * consumption order, up to the quota. The rest of the calendar is untouched.
 */
export function seedWaitingRequests<S extends SeedableSlot>(
  slots: readonly S[],
  requests: readonly WaitingRequest[],
  placement: SeedPlacement,
): SeededSlots<S> {
  const queue = consumptionOrder(requests).slice(0, requestQuota(slots.length))
  const requestIds: Array<string | null> = slots.map(() => null)
  let next = 0

  const seeded = slots.map((slot, index) => {
    if (next >= queue.length || slot.page_type === 'pillar') return slot
    const request = queue[next++]
    requestIds[index] = request.id
    const city = placement.national ? '' : requestCity(request, placement.communes) ?? slot.target_city ?? ''
    return {
      ...slot,
      page_type: placement.pageType ?? slot.page_type,
      target_keyword: request.keyword,
      target_city: city,
    }
  })

  return { slots: seeded, requestIds }
}

/** A plan item, as far as its request is concerned. */
export interface PlannedItem {
  id: string
  scheduled_date: string
  client_request_id?: string
  action?: { kind: string; reasons?: readonly string[] }
}

/**
 * What a plan that STARTS means for the campaign's waiting requests.
 *
 *  - its item will be written: `scheduled`, on that item and its date;
 *  - its item fell to the guards: `covered`, with the guard's reason;
 *  - not in the plan (quota, a later wish): one more cycle waited, and past
 *    MAX_DEFERRED_CYCLES, `review` — CNX is told rather than the client left
 *    waiting. A request sent after the plan was written could not be in it, and
 *    is not counted as having waited.
 */
export function planOutcome(input: {
  planId: string
  campaignId: string
  items: readonly PlannedItem[]
  waiting: readonly WaitingRequest[]
  /** When the plan was written. */
  plannedAt: string
}): RequestChange[] {
  const itemOf = new Map<string, PlannedItem>()
  for (const item of input.items) if (item.client_request_id) itemOf.set(item.client_request_id, item)

  return input.waiting.flatMap((request): RequestChange[] => {
    const item = itemOf.get(request.id)

    if (item && item.action?.kind === 'skip') {
      return [{
        id: request.id,
        from: 'deferred',
        status: 'covered',
        reason_code: 'PLAN_GUARD',
        reasons: [...(item.action.reasons ?? ['Le plan a ecarte ce sujet.'])],
        cycle_plan_id: input.planId,
        plan_item_id: null,
        scheduled_for: null,
      }]
    }

    if (item) {
      return [{
        id: request.id,
        from: 'deferred',
        status: 'scheduled',
        reason_code: 'PLANNED',
        reasons: [`Prevue au plan du cycle, creneau du ${item.scheduled_date}.`],
        campaign_id: input.campaignId,
        cycle_plan_id: input.planId,
        plan_item_id: item.id,
        scheduled_for: item.scheduled_date,
      }]
    }

    if (request.created_at > input.plannedAt) return []

    const waited = request.deferred_cycles + 1
    if (waited >= MAX_DEFERRED_CYCLES) {
      return [{
        id: request.id,
        from: 'deferred',
        from_deferred_cycles: request.deferred_cycles,
        status: 'review',
        reason_code: 'WAITED_TOO_LONG',
        reasons: [`Gardee ${waited} cycles sans trouver de creneau : a examiner.`],
        deferred_cycles: waited,
      }]
    }
    return [{
      id: request.id,
      from: 'deferred',
      from_deferred_cycles: request.deferred_cycles,
      status: 'deferred',
      deferred_cycles: waited,
    }]
  })
}

/** A request planned on a slot that a new cycle is about to delete, unproduced. */
export interface ReleasedRequest {
  id: string
}

/**
 * Back to the queue, without loss (§ 3.3, `scheduled → deferred`): the slot is
 * gone, the request keeps its place for the next plan.
 */
export function releaseChanges(requests: readonly ReleasedRequest[]): RequestChange[] {
  return requests.map((request) => ({
    id: request.id,
    from: 'scheduled',
    status: 'deferred',
    reason_code: 'NEXT_PERIOD',
    reasons: ["Le creneau prevu n'a pas ete produit avant la fin du cycle : gardee pour le suivant."],
    cycle_plan_id: null,
    plan_item_id: null,
    scheduled_for: null,
  }))
}
