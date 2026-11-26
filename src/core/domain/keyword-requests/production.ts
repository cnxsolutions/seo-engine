// ─────────────────────────────────────────────────────────────────────────────
// A planned request, followed through its production — KW-8, § 3.6
// ─────────────────────────────────────────────────────────────────────────────
//
// Every two minutes the scheduler reads, for each request `scheduled` or
// `in_production`, the slot of its brief and the generation of that slot, and
// asks this module what the request has become. Read from the slot and the
// generation rather than hooked into each publication path: a page published by
// the scheduler, by the deferred job or by hand from the console is seen the
// same way, and the scheduler's own paths stay untouched.
//
//   slot planned           → still planned (its date followed if it moved)
//   slot generating        → in production
//   generation published   → online, with its address
//   slot failed / skipped,
//   generation failed      → CNX looks at it (`review`): the client is told
//                            CNX is on it, never a technical error
//   no slot, plan replaced → back to the queue (`deferred`), without loss

import type { RequestChange } from './change'

export interface ProducingRequest {
  id: string
  status: 'scheduled' | 'in_production'
  campaign_id: string | null
  cycle_plan_id: string | null
  plan_item_id: string
  scheduled_for: string | null
}

export interface SlotState {
  status: string
  scheduled_date: string
  generation_id: string | null
  error_message: string | null
}

export interface GenerationState {
  status: string
  published_url: string | null
  published_at: string | null
  error_message: string | null
}

const STOPPED_SLOT = new Set(['failed', 'skipped'])
const STOPPED_GENERATION = new Set(['failed', 'rejected'])

export function productionChange(
  request: ProducingRequest,
  slot: SlotState | null,
  generation: GenerationState | null,
  /** The campaign's running plan: a request of another plan whose slot is gone was replaced. */
  currentPlanId: string | null,
): RequestChange | null {
  if (!slot) {
    if (request.status !== 'scheduled' || request.cycle_plan_id === currentPlanId) return null
    return {
      id: request.id,
      from: 'scheduled',
      status: 'deferred',
      reason_code: 'NEXT_PERIOD',
      reasons: ["Le creneau prevu n'existe plus (nouveau cycle) : gardee pour le suivant."],
      cycle_plan_id: null,
      plan_item_id: null,
      scheduled_for: null,
    }
  }

  if (generation?.status === 'published' && generation.published_url) {
    return {
      id: request.id,
      from: request.status,
      status: 'published',
      published_url: generation.published_url,
      published_at: generation.published_at,
    }
  }

  if (STOPPED_SLOT.has(slot.status) || (generation && STOPPED_GENERATION.has(generation.status) && slot.status !== 'planned')) {
    return {
      id: request.id,
      from: request.status,
      status: 'review',
      reason_code: 'PRODUCTION_STOPPED',
      reasons: [slot.error_message || generation?.error_message || "La production de la page s'est arretee."],
    }
  }

  if (slot.status === 'planned') {
    // Waiting for its day, or handed back after a transient failure: an
    // in-production request stays so — nothing goes back to « prévue ».
    if (request.status === 'scheduled' && slot.scheduled_date !== request.scheduled_for) {
      return { id: request.id, from: 'scheduled', status: 'scheduled', scheduled_for: slot.scheduled_date }
    }
    return null
  }

  // generating, generated, published-without-address, publishing: being written.
  return request.status === 'scheduled'
    ? { id: request.id, from: 'scheduled', status: 'in_production' }
    : null
}
