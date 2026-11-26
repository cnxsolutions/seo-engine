// ─────────────────────────────────────────────────────────────────────────────
// The briefs of a cycle in progress whose page is not online yet (rule 3)
// ─────────────────────────────────────────────────────────────────────────────
//
// A brief lives twice: in the plan's JSON (cycle_plans.plan_data, with its
// secondary keywords) and as a slot of the calendar (its date and status). A
// brief counts when its slot is still to be written; the slot's own keyword
// and town win, since the operator can edit a slot after the plan was made.
// The plan is a JSON column written by the engine: read defensively.

import type { PlannedBrief } from './verdict'

export interface PlanInput {
  id: string
  campaign_id: string
  plan_data: unknown
}

export interface SlotInput {
  campaign_id: string
  plan_item_id: string | null
  scheduled_date: string
  target_keyword: string | null
  target_city: string | null
}

interface PlanItem {
  id: string
  targetKeyword: string
  targetCity: string
  secondaryKeywords: string[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function itemsOf(planData: unknown): PlanItem[] {
  if (!Array.isArray(planData)) return []
  return planData.flatMap((raw): PlanItem[] => {
    if (raw === null || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const id = text(item.id)
    if (!id) return []
    const secondary = Array.isArray(item.secondary_keywords) ? item.secondary_keywords.map(text).filter(Boolean) : []
    return [{ id, targetKeyword: text(item.target_keyword), targetCity: text(item.target_city), secondaryKeywords: secondary }]
  })
}

export function plannedBriefs(plan: PlanInput, slots: readonly SlotInput[]): PlannedBrief[] {
  const items = new Map(itemsOf(plan.plan_data).map((item) => [item.id, item]))
  return slots.flatMap((slot): PlannedBrief[] => {
    if (slot.campaign_id !== plan.campaign_id || !slot.plan_item_id) return []
    const item = items.get(slot.plan_item_id)
    if (!item) return []
    const targetKeyword = text(slot.target_keyword) || item.targetKeyword
    if (!targetKeyword) return []
    return [{
      cyclePlanId: plan.id,
      planItemId: item.id,
      day: slot.scheduled_date || null,
      targetKeyword,
      targetCity: text(slot.target_city) || item.targetCity,
      secondaryKeywords: item.secondaryKeywords,
    }]
  })
}
