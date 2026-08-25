// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Repository
// SEO Engine - Post-generation pipeline
// Every database read the pipeline needs, and nothing else
// ─────────────────────────────────────────────────────────────────────────────
//
// Isolated here so the rest of the module stays pure and testable without a
// database. It lives in lib/pipeline rather than lib/db.ts for the same reason
// the scheduler keeps its own claims in lib/scheduler/editorial.ts: this is
// pipeline-internal data access, and lib/db.ts is a shared surface.

import { createServiceClient } from '@/lib/supabase'
import { isBlocking, type DuplicateVerdict } from '@/src/core/domain/existing/verdict'

// `loadSiteLinkContext`, `SiteLinkContext` and `MAX_LINK_CANDIDATES` used to
// live here.
//
// Its two queries hit exactly the population of rows `loadSiteInventory` had
// just read: it was the fourth concurrent reader of what the site already
// carries. The SHAPE survives untouched in lib/existing/inventory.ts, where
// `deriveLinkContext` computes it from the inventory already in hand — what
// disappears is the round-trip, not the contract.
//
// No re-export was left behind on purpose: a second import path is how two
// definitions of "what exists on this site" start diverging again.

// ─── Rejection ──────────────────────────────────────────────────────────────

/** Longest reason string persisted, matching `failEditorialSlot`. */
const MAX_ERROR_MESSAGE = 2000

export interface RejectionOutcome {
  status: 'rejected' | 'failed'
  message: string
}

/**
 * Park a generation the gate refused, without ever losing it.
 *
 * `rejected` is a real member of `GenerationStatus`, but the `generations` table
 * was created by hand and its CHECK constraint is not in this repository (see
 * migration 008, which widens it). If the write is refused the row falls back to
 * `failed`: a status the table has accepted since day one. Both are terminal and
 * both carry the reasons — what must never happen is a generated, paid-for page
 * silently staying in `generated` where the publishing job would pick it up
 * again and publish exactly what the gate just refused.
 */
export async function markGenerationRejected(
  generationId: string,
  reasons: string[]
): Promise<RejectionOutcome> {
  const supabase = createServiceClient()
  const message = `Rejete par le pipeline : ${reasons.join(' | ')}`.slice(0, MAX_ERROR_MESSAGE)

  const { error } = await supabase
    .from('generations')
    .update({ status: 'rejected', error_message: message, updated_at: new Date().toISOString() })
    .eq('id', generationId)

  if (!error) return { status: 'rejected', message }

  const { error: fallbackError } = await supabase
    .from('generations')
    .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
    .eq('id', generationId)

  if (fallbackError) throw new Error(fallbackError.message)
  return { status: 'failed', message }
}

// ─── Duplicate verdict ──────────────────────────────────────────────────────

/**
 * Persist what the duplicate check concluded, blocking or not.
 *
 * A verdict is written even when nothing blocked, and that is the point: the
 * trace that the check RAN is what tells "no duplicate was found" apart from
 * "no duplicate was looked for". Reading a rejection rate off rows that only
 * exist when they blocked would report 100 % every time.
 *
 * `refusal_kind` is only set when a blocking code is present, because that
 * column means "the engine declined on purpose" and an observation is not a
 * decision. While DUPLICATE_ENFORCEMENT stays at 'observe' the row therefore
 * keeps its verdict and its status, which is exactly what a measurement period
 * needs.
 *
 * Never throws: this is bookkeeping ABOUT a page that already exists, and
 * losing the page because its evidence could not be filed would be the worse
 * failure of the two.
 */
export async function persistDuplicateVerdict(
  generationId: string,
  verdict: DuplicateVerdict
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('generations')
    .update({
      duplicate_verdict: verdict,
      ...(isBlocking(verdict) ? { refusal_kind: 'duplicat' as const } : {}),
    })
    .eq('id', generationId)

  if (error) {
    console.warn(`[pipeline] verdict de duplicat non enregistre (generation ${generationId}) : ${error.message}`)
  }
}
