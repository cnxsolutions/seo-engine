// ─────────────────────────────────────────────────────────────────────────────
// One step of a request, as the engine writes it — migration 025
// ─────────────────────────────────────────────────────────────────────────────
//
// What `advance_keyword_requests` receives. `from` is the status the request
// must still have: a request withdrawn, or moved by another pass, in between is
// left alone (compare-and-swap). A key that is absent leaves its column as it
// is; a key set to null clears it — which is why the optional fields are
// optional rather than nullable by default.

import type { RequestStatus } from './lifecycle'
import type { Evidence } from './verdict'

/** What the engine may conclude on its own: never received, declined nor withdrawn (025). */
export type EngineStepStatus = Extract<RequestStatus, 'deferred' | 'scheduled' | 'in_production' | 'published' | 'covered' | 'review'>

export interface RequestChange {
  id: string
  from: RequestStatus
  status: EngineStepStatus
  /** Same status, one more cycle waited: written only if the count is still this one. */
  from_deferred_cycles?: number
  reason_code?: string | null
  reasons?: string[]
  evidence?: Evidence[]
  campaign_id?: string | null
  cycle_plan_id?: string | null
  plan_item_id?: string | null
  scheduled_for?: string | null
  published_url?: string | null
  published_at?: string | null
  deferred_cycles?: number
}
