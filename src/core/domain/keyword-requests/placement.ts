// ─────────────────────────────────────────────────────────────────────────────
// A receivable request, placed in the cycle in progress — KW-4
// docs/cadrage.md § 3.2, decisions 4 and 5
// ─────────────────────────────────────────────────────────────────────────────
//
// The request REPLACES a page the cycle planned and nobody has started — it
// never adds one: volume, promised frequency and cost stay the campaign's. The
// conditions, all needed:
//   1. a cycle runs and ends in MIN_CYCLE_DAYS_LEFT days or more;
//   2. a replaceable slot: still `planned`, MIN_SLOT_LEAD_DAYS days ahead or
//      more, not a pillar (the cycle's children link to it), not already
//      serving a request — by its brief, or as the page a request « already
//      planned » points at;
//   3. the quota: a third of the cycle's pages at most come from requests.
// The fourth — the brief passes the planner's guards — is checked once it is
// written (lib/keyword-requests/placement.ts).
//
// Which slot: with a wished date, the last replaceable slot on or before it;
// otherwise, and after those, the lowest priority, the earliest first.

import { requestQuota } from './consumption'

export const MIN_CYCLE_DAYS_LEFT = 3
export const MIN_SLOT_LEAD_DAYS = 2

export interface CyclePlanItemView {
  id: string
  page_type: string
  priority?: string | null
  client_request_id?: string
  action?: { kind: string } | null
}

export interface RunningPlanView {
  id: string
  /** End of the cycle, an instant. */
  cycle_ends_at: string | null
  items: readonly CyclePlanItemView[]
}

export interface OpenSlotView {
  id: string
  plan_item_id: string | null
  scheduled_date: string
  status: string
}

export type NoPlacementReason = 'NO_RUNNING_CYCLE' | 'CYCLE_ENDING' | 'QUOTA_REACHED' | 'NO_FREE_SLOT'

export interface CandidateSlot {
  slotId: string
  itemId: string
  scheduledDate: string
}

export type Placement =
  | { kind: 'slots'; slots: CandidateSlot[] }
  | { kind: 'none'; reason: NoPlacementReason }

const PRIORITY_RANK: Readonly<Record<string, number>> = { low: 0, medium: 1, high: 2 }

/** `YYYY-MM-DD` plus some days, in UTC arithmetic on a calendar date. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isCreation(item: CyclePlanItemView): boolean {
  return (item.action?.kind ?? 'create') === 'create'
}

export function placementCandidates(input: {
  plan: RunningPlanView | null
  slots: readonly OpenSlotView[]
  /** Item ids an open request already points at (« déjà prévue », 024 rule 3). */
  claimedItemIds: ReadonlySet<string>
  /** Today, in Paris. */
  today: string
  desiredBy: string | null
}): Placement {
  const { plan, today } = input
  if (!plan) return { kind: 'none', reason: 'NO_RUNNING_CYCLE' }
  if (!plan.cycle_ends_at || plan.cycle_ends_at.slice(0, 10) < addDays(today, MIN_CYCLE_DAYS_LEFT)) {
    return { kind: 'none', reason: 'CYCLE_ENDING' }
  }

  const creations = plan.items.filter(isCreation)
  if (creations.filter((item) => item.client_request_id).length >= requestQuota(creations.length)) {
    return { kind: 'none', reason: 'QUOTA_REACHED' }
  }

  const items = new Map(plan.items.map((item) => [item.id, item]))
  const earliest = addDays(today, MIN_SLOT_LEAD_DAYS)
  const replaceable = input.slots.flatMap((slot) => {
    const item = slot.plan_item_id ? items.get(slot.plan_item_id) : undefined
    if (!item || slot.status !== 'planned' || slot.scheduled_date < earliest) return []
    if (!isCreation(item) || item.page_type === 'pillar' || item.client_request_id || input.claimedItemIds.has(item.id)) return []
    return [{ slot, rank: PRIORITY_RANK[item.priority ?? 'medium'] ?? 1 }]
  })
  if (replaceable.length === 0) return { kind: 'none', reason: 'NO_FREE_SLOT' }

  const byPriority = [...replaceable].sort((a, b) =>
    a.rank - b.rank || a.slot.scheduled_date.localeCompare(b.slot.scheduled_date) || a.slot.id.localeCompare(b.slot.id))
  const beforeWish = input.desiredBy
    ? replaceable
      .filter(({ slot }) => slot.scheduled_date <= (input.desiredBy as string))
      .sort((a, b) => b.slot.scheduled_date.localeCompare(a.slot.scheduled_date) || a.rank - b.rank)
    : []
  const ordered = [...beforeWish, ...byPriority.filter((entry) => !beforeWish.includes(entry))]

  return {
    kind: 'slots',
    slots: ordered.map(({ slot }) => ({ slotId: slot.id, itemId: slot.plan_item_id as string, scheduledDate: slot.scheduled_date })),
  }
}
