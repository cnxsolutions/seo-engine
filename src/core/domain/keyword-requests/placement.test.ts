import { describe, expect, it } from 'vitest'
import { addDays, placementCandidates, type CyclePlanItemView, type OpenSlotView, type RunningPlanView } from './placement'

const TODAY = '2026-11-26'

function item(id: string, overrides: Partial<CyclePlanItemView> = {}): CyclePlanItemView {
  return { id, page_type: 'child', priority: 'medium', action: { kind: 'create' }, ...overrides }
}

function slot(itemId: string, day: string, status = 'planned'): OpenSlotView {
  return { id: `slot-${itemId}`, plan_item_id: itemId, scheduled_date: day, status }
}

function plan(items: CyclePlanItemView[], endsAt = '2026-12-08T00:00:00Z'): RunningPlanView {
  return { id: 'plan-1', cycle_ends_at: endsAt, items }
}

const place = (overrides: Partial<Parameters<typeof placementCandidates>[0]>) =>
  placementCandidates({ plan: null, slots: [], claimedItemIds: new Set(), today: TODAY, desiredBy: null, ...overrides })

describe('placementCandidates — les conditions (§ 3.2)', () => {
  it('sans cycle en cours, ou un cycle qui finit dans moins de 3 jours : la periode suivante', () => {
    expect(place({ plan: null })).toEqual({ kind: 'none', reason: 'NO_RUNNING_CYCLE' })
    expect(place({ plan: plan([item('a')], '2026-11-28T00:00:00Z') })).toEqual({ kind: 'none', reason: 'CYCLE_ENDING' })
    expect(place({ plan: plan([item('a')], null as unknown as string) })).toEqual({ kind: 'none', reason: 'CYCLE_ENDING' })
  })

  it('un tiers des pages du cycle au plus vient des demandes (decision 4)', () => {
    const items = [item('p', { page_type: 'pillar' }), item('a', { client_request_id: 'r1' }), item('b'), item('c'), item('d'), item('e')]
    // 6 creations : 2 demandes au plus. Une seule y est : il reste une place.
    expect(place({ plan: plan(items), slots: [slot('b', '2026-12-01')] }).kind).toBe('slots')
    const full = [...items.slice(0, 5), item('e', { client_request_id: 'r2' })]
    expect(place({ plan: plan(full), slots: [slot('b', '2026-12-01')] })).toEqual({ kind: 'none', reason: 'QUOTA_REACHED' })
  })

  it('jamais le pilier, une demande, la cible d une demande deja prevue, un creneau entame ou trop proche', () => {
    const items = [
      item('pilier', { page_type: 'pillar' }),
      item('demande', { client_request_id: 'r1' }),
      item('cible'),
      item('entame'),
      item('demain'),
      item('ecarte', { action: { kind: 'skip' } }),
      item('libre'),
    ]
    const result = place({
      plan: plan(items),
      claimedItemIds: new Set(['cible']),
      slots: [
        slot('pilier', '2026-12-01'), slot('demande', '2026-12-01'), slot('cible', '2026-12-01'),
        slot('entame', '2026-12-01', 'generating'), slot('demain', '2026-11-27'), slot('ecarte', '2026-12-01'),
        slot('libre', '2026-12-03'),
      ],
    })
    expect(result).toEqual({ kind: 'slots', slots: [{ slotId: 'slot-libre', itemId: 'libre', scheduledDate: '2026-12-03' }] })
  })

  it('aucun creneau remplacable : la periode suivante', () => {
    expect(place({ plan: plan([item('a')]), slots: [slot('a', '2026-11-27')] })).toEqual({ kind: 'none', reason: 'NO_FREE_SLOT' })
  })
})

describe('placementCandidates — quel creneau', () => {
  const items = [item('haut', { priority: 'high' }), item('bas-tard', { priority: 'low' }), item('bas-tot', { priority: 'low' }), item('moyen')]
  const slots = [slot('haut', '2026-11-29'), slot('bas-tard', '2026-12-05'), slot('bas-tot', '2026-12-01'), slot('moyen', '2026-11-30')]

  it('sans date souhaitee : la plus basse priorite d abord, la plus tot a priorite egale', () => {
    const result = place({ plan: plan(items), slots })
    expect(result.kind === 'slots' && result.slots.map((entry) => entry.itemId)).toEqual(['bas-tot', 'bas-tard', 'moyen', 'haut'])
  })

  it('avec une date souhaitee : le dernier creneau avant elle, puis les autres par priorite', () => {
    const result = place({ plan: plan(items), slots, desiredBy: '2026-11-30' })
    expect(result.kind === 'slots' && result.slots.map((entry) => entry.itemId)).toEqual(['moyen', 'haut', 'bas-tot', 'bas-tard'])
  })
})

describe('addDays', () => {
  it('compte en jours de calendrier, mois et annee compris', () => {
    expect(addDays('2026-11-26', 3)).toBe('2026-11-29')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })
})
