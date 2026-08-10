import { NextResponse } from 'next/server'
import { updateEditorialSlot } from '@/lib/scheduler/editorial'
import type { EditorialSlot } from '@/lib/types'

/**
 * Fields a human may edit on a slot.
 *
 * The body used to be forwarded to `updateEditorialSlot()` verbatim, which meant
 * any caller could write `status` and `attempt_count` directly. That contradicts
 * the scheduler outright: it owns those two columns and moves them through
 * compare-and-swap claims (`claimEditorialSlot`, `releaseEditorialSlot`) so that
 * exactly one runner can own a slot. A blind write could hand a slot that is
 * mid-generation back to 'planned' and have it produced twice, or reset the
 * attempt budget and let a broken slot burn tokens forever.
 *
 * `campaign_id` and `generation_id` are excluded for the same reason: they are
 * the links the reaper follows to decide whether a page was already published.
 */
const EDITABLE_FIELDS = [
  'scheduled_date',
  'page_type',
  'target_keyword',
  'target_city',
] as const satisfies readonly (keyof EditorialSlot)[]

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body: unknown = await request.json().catch(() => null)

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corps de requete invalide' }, { status: 400 })
    }

    const received = body as Record<string, unknown>
    const values: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in received) values[field] = received[field]
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json(
        { error: `Aucun champ modifiable fourni. Champs acceptes : ${EDITABLE_FIELDS.join(', ')}.` },
        { status: 400 }
      )
    }

    await updateEditorialSlot(id, values as Partial<EditorialSlot>)
    return NextResponse.json({ success: true, updated: Object.keys(values) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur serveur' },
      { status: 500 }
    )
  }
}
