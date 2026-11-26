// ─────────────────────────────────────────────────────────────────────────────
// The requests in the engine: planned, produced, put back — L4b
// docs/cadrage.md § 3.3, § 3.5, § 3.6
// ─────────────────────────────────────────────────────────────────────────────
//
// Three moments, each a thin layer over the domain (consumption.ts,
// production.ts) and the batch writes of migration 025:
//
//  - a new cycle is about to delete the unproduced slots of the previous one:
//    the requests planned on them go back to the queue (`releaseReplacedSlots`);
//  - a plan starts (confirmed by hand, or renewed automatically): each waiting
//    request of the campaign learns what became of it (`applyStartedPlan`);
//  - every two minutes, the requests being produced follow their slot and its
//    generation (`followProduction`).
//
// None of them may stop a cycle: the callers journal their failures and carry
// on. A request left behind by a failed pass is caught by the next one — a slot
// gone with its plan sends its request back to the queue from here too.

import { planOutcome, releaseChanges, type PlannedItem } from '@/src/core/domain/keyword-requests/consumption'
import { productionChange } from '@/src/core/domain/keyword-requests/production'
import type { RequestChange } from '@/src/core/domain/keyword-requests/change'
import {
  advanceRequests,
  listProducingRequests,
  listRequestsOnPlannedSlots,
  listWaitingRequests,
  readProduction,
  skipPlannedSlots,
} from './repository'

/** Before a new cycle deletes the slots nobody produced: their requests keep their place. */
export async function releaseReplacedSlots(campaignId: string): Promise<number> {
  const planned = await listRequestsOnPlannedSlots(campaignId)
  const written = await advanceRequests(releaseChanges(planned))
  return written.length
}

export const WITHDRAWN_BEFORE_START = 'Demande retirée par le client avant le début du cycle : aucune page à produire.'

/**
 * A plan that starts — its slots are saved — and the campaign's waiting
 * requests: planned, covered, or one more cycle waited (planOutcome).
 *
 * A brief written for a request that is no longer waiting (withdrawn while the
 * plan was a draft) must not become a page the client took back: its slot is
 * set aside, as long as nobody has claimed it.
 */
export async function applyStartedPlan(input: {
  campaignId: string
  planId: string
  plannedAt: string
  items: readonly PlannedItem[]
}): Promise<{ written: number; setAside: number }> {
  const waiting = await listWaitingRequests(input.campaignId)
  const changes = planOutcome({ ...input, waiting })
  const written = new Set(await advanceRequests(changes))

  const scheduled = new Set(changes.filter((change) => change.status === 'scheduled' && written.has(change.id)).map((change) => change.id))
  const orphans = input.items
    .filter((item) => item.client_request_id && (item.action?.kind ?? 'create') === 'create' && !scheduled.has(item.client_request_id))
    .map((item) => item.id)
  await skipPlannedSlots(input.campaignId, orphans, WITHDRAWN_BEFORE_START)

  return { written: written.size, setAside: orphans.length }
}

/** Every request being produced, one step further when its slot or its generation moved. */
export async function followProduction(): Promise<{ followed: number; advanced: number }> {
  const requests = await listProducingRequests()
  if (requests.length === 0) return { followed: 0, advanced: 0 }

  const view = await readProduction(requests)
  const changes = requests.flatMap((request): RequestChange[] => {
    const slot = view.slots.get(request.plan_item_id) ?? null
    const generation = slot?.generation_id ? view.generations.get(slot.generation_id) ?? null : null
    const currentPlan = request.campaign_id ? view.currentPlans.get(request.campaign_id) ?? null : null
    const change = productionChange(request, slot, generation, currentPlan)
    return change ? [change] : []
  })

  const written = await advanceRequests(changes)
  if (written.length > 0) console.log(`[demandes] production : ${written.length} demande(s) avancee(s) sur ${requests.length} suivie(s)`)
  return { followed: requests.length, advanced: written.length }
}
