import { NextResponse } from 'next/server'
import { listEditorialSlots } from '@/lib/scheduler/editorial'
import { createServiceClient } from '@/lib/supabase'
import type { CalendarSlot, CalendarSlotGeneration } from '@/lib/types'

// ─── Response shape ──────────────────────────────────────────
//
// `CalendarSlot` lives in lib/types and is shared with the page that renders it
// (app/(dashboard)/calendar/page.tsx). It carries the real slot union, `failed`
// included: this route used to widen `status` to `string` while that member was
// still being added, and the widening has outlived its reason.
//
// Read-only on purpose. A POST used to live here that deleted the campaign's
// planned slots and regenerated a bare calendar — no cycle plan, no briefs, so
// every recreated slot lost the `plan_item_id` the generator reads its brief
// from. Nothing called it, and the only supported way to fill the calendar is
// confirming a cycle plan (PATCH /api/campaigns/:id/plan). Rescheduling a single
// slot goes through PATCH /api/calendar/:id.

/**
 * listEditorialSlots() only joins the campaign, so a slot that has already run
 * arrives without any trace of its outcome. Resolve the generations separately
 * instead of leaving the calendar unable to show published URLs and errors.
 */
async function attachGenerations(slots: CalendarSlot[]): Promise<CalendarSlot[]> {
  const ids = Array.from(new Set(slots.map((s) => s.generation_id).filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return slots

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('generations')
    .select('id, title, slug, status, published_url, error_message, updated_at')
    .in('id', ids)

  if (error) {
    // A missing outcome must not hide the plan itself: serve the slots as-is.
    console.warn('[calendar] generations lookup failed:', error.message)
    return slots
  }

  const byId = new Map<string, CalendarSlotGeneration>(
    (data ?? []).map((row) => [row.id as string, row as CalendarSlotGeneration])
  )
  return slots.map((slot) => ({
    ...slot,
    generation: slot.generation_id ? byId.get(slot.generation_id) ?? null : null,
  }))
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaign_id') || undefined
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined

  try {
    const slots = await listEditorialSlots(campaignId, from, to)
    return NextResponse.json({ slots: await attachGenerations(slots) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur serveur' },
      { status: 500 }
    )
  }
}
