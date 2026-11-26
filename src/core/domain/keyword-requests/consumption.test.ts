import { describe, expect, it } from 'vitest'
import {
  MAX_DEFERRED_CYCLES,
  consumptionOrder,
  planOutcome,
  releaseChanges,
  requestCity,
  requestQuota,
  seedWaitingRequests,
  type WaitingRequest,
} from './consumption'

function waiting(overrides: Partial<WaitingRequest> = {}): WaitingRequest {
  return {
    id: 'r1',
    keyword: 'debouchage canalisation',
    city: null,
    desired_by: null,
    created_at: '2026-11-20T10:00:00Z',
    deferred_cycles: 0,
    ...overrides,
  }
}

const slot = (page_type: string, target_keyword: string, target_city = 'Troyes') => ({ page_type, target_keyword, target_city, scheduled_date: '2026-12-01' })
const PLACEMENT = { national: false, pageType: 'child', communes: ['Troyes', 'Sainte-Savine', 'Rosières-près-Troyes'] }

describe('requestQuota — un tiers des creneaux (decision 4)', () => {
  it('un tiers, au moins un, jamais plus qu il n y en a', () => {
    expect(requestQuota(0)).toBe(0)
    expect(requestQuota(1)).toBe(1)
    expect(requestQuota(2)).toBe(1)
    expect(requestQuota(7)).toBe(2)
    expect(requestQuota(9)).toBe(3)
  })
})

describe('consumptionOrder — date souhaitee la plus proche, puis anciennete', () => {
  it('une date souhaitee passe avant une demande sans date, puis la plus ancienne', () => {
    const order = consumptionOrder([
      waiting({ id: 'sans-date-ancienne', created_at: '2026-11-01T00:00:00Z' }),
      waiting({ id: 'date-lointaine', desired_by: '2027-02-01' }),
      waiting({ id: 'date-proche', desired_by: '2026-12-15' }),
      waiting({ id: 'sans-date-recente', created_at: '2026-11-25T00:00:00Z' }),
    ])
    expect(order.map((request) => request.id)).toEqual(['date-proche', 'date-lointaine', 'sans-date-ancienne', 'sans-date-recente'])
  })
})

describe('requestCity — la ville visee', () => {
  it('celle du client, sinon la commune que nomme le mot-cle, sinon aucune', () => {
    expect(requestCity({ keyword: 'plombier', city: 'Sainte-Savine' }, PLACEMENT.communes)).toBe('Sainte-Savine')
    expect(requestCity({ keyword: 'plombier troyes urgence', city: null }, PLACEMENT.communes)).toBe('Troyes')
    // « Rosières-près-Troyes » est une commune, pas Troyes.
    expect(requestCity({ keyword: 'plombier rosieres pres troyes', city: null }, PLACEMENT.communes)).toBe('Rosières-près-Troyes')
    expect(requestCity({ keyword: 'debouchage canalisation', city: null }, PLACEMENT.communes)).toBeNull()
  })
})

describe('seedWaitingRequests — les premiers creneaux prennent les demandes', () => {
  it('avant la rotation, jamais sur le pilier, dans le quota, le reste du calendrier intact', () => {
    const slots = [
      slot('pillar', 'plombier'),
      slot('child', 'chauffe-eau'),
      slot('local_pack', 'plombier', 'Sainte-Savine'),
      slot('child', 'fuite'),
      slot('child', 'robinet'),
      slot('child', 'wc'),
    ]
    const seeded = seedWaitingRequests(slots, [
      waiting({ id: 'b', created_at: '2026-11-22T00:00:00Z', keyword: 'recherche de fuite' }),
      waiting({ id: 'a', created_at: '2026-11-21T00:00:00Z', keyword: 'debouchage', city: 'Sainte-Savine' }),
      waiting({ id: 'c', created_at: '2026-11-23T00:00:00Z' }),
    ], PLACEMENT)

    // 6 creneaux : 2 demandes au plus, sur les deux premiers creneaux qui ne sont pas le pilier.
    expect(seeded.requestIds).toEqual([null, 'a', 'b', null, null, null])
    expect(seeded.slots[0]).toBe(slots[0])
    expect(seeded.slots[1]).toMatchObject({ page_type: 'child', target_keyword: 'debouchage', target_city: 'Sainte-Savine' })
    // Sans ville choisie ni nommee, le creneau garde la sienne ; un local pack devient une page enfant.
    expect(seeded.slots[2]).toMatchObject({ page_type: 'child', target_keyword: 'recherche de fuite', target_city: 'Sainte-Savine' })
    expect(seeded.slots.slice(3)).toEqual(slots.slice(3))
  })

  it('une campagne nationale n a pas de ville, et un type absent de la campagne laisse celui du creneau', () => {
    const seeded = seedWaitingRequests([slot('alternative', 'logiciel', '')], [waiting({ keyword: 'agenda en ligne' })], {
      national: true,
      pageType: null,
      communes: [],
    })
    expect(seeded.slots[0]).toMatchObject({ page_type: 'alternative', target_keyword: 'agenda en ligne', target_city: '' })
  })

  it('sans demande, le calendrier est rendu tel quel', () => {
    const slots = [slot('pillar', 'plombier'), slot('child', 'fuite')]
    const seeded = seedWaitingRequests(slots, [], PLACEMENT)
    expect(seeded.slots).toEqual(slots)
    expect(seeded.requestIds).toEqual([null, null])
  })
})

describe('planOutcome — ce qu un plan qui demarre dit a chaque demande', () => {
  const plannedAt = '2026-11-26T09:00:00Z'

  it('prevue sur son creneau, couverte si les gardes l ont ecartee', () => {
    const changes = planOutcome({
      planId: 'plan-2',
      campaignId: 'camp-1',
      plannedAt,
      items: [
        { id: 'item-a', scheduled_date: '2026-11-28', client_request_id: 'a', action: { kind: 'create' } },
        { id: 'item-b', scheduled_date: '2026-11-30', client_request_id: 'b', action: { kind: 'skip', reasons: ['Mot-cle deja porte par /plombier-troyes.'] } },
        { id: 'item-x', scheduled_date: '2026-12-02' },
      ],
      waiting: [waiting({ id: 'a' }), waiting({ id: 'b' })],
    })

    expect(changes).toEqual([
      {
        id: 'a', from: 'deferred', status: 'scheduled', reason_code: 'PLANNED',
        reasons: ['Prevue au plan du cycle, creneau du 2026-11-28.'],
        campaign_id: 'camp-1', cycle_plan_id: 'plan-2', plan_item_id: 'item-a', scheduled_for: '2026-11-28',
      },
      {
        id: 'b', from: 'deferred', status: 'covered', reason_code: 'PLAN_GUARD',
        reasons: ['Mot-cle deja porte par /plombier-troyes.'],
        cycle_plan_id: 'plan-2', plan_item_id: null, scheduled_for: null,
      },
    ])
  })

  it('une demande restee hors du plan attend un cycle de plus, puis part a CNX (KW-11)', () => {
    const changes = planOutcome({
      planId: 'plan-2',
      campaignId: 'camp-1',
      plannedAt,
      items: [],
      waiting: [
        waiting({ id: 'patiente', deferred_cycles: 0 }),
        waiting({ id: 'trop-longue', deferred_cycles: MAX_DEFERRED_CYCLES - 1 }),
        // Envoyee apres l'ecriture du plan : elle ne pouvait pas y etre.
        waiting({ id: 'arrivee-apres', created_at: '2026-11-26T10:00:00Z' }),
      ],
    })

    expect(changes).toEqual([
      { id: 'patiente', from: 'deferred', from_deferred_cycles: 0, status: 'deferred', deferred_cycles: 1 },
      {
        id: 'trop-longue', from: 'deferred', from_deferred_cycles: 2, status: 'review', reason_code: 'WAITED_TOO_LONG',
        reasons: ['Gardee 3 cycles sans trouver de creneau : a examiner.'], deferred_cycles: 3,
      },
    ])
  })
})

describe('releaseChanges — un creneau supprime rend la demande a la file', () => {
  it('sans perte : de nouveau gardee, detachee du creneau', () => {
    expect(releaseChanges([{ id: 'r1' }])).toEqual([{
      id: 'r1', from: 'scheduled', status: 'deferred', reason_code: 'NEXT_PERIOD',
      reasons: ["Le creneau prevu n'a pas ete produit avant la fin du cycle : gardee pour le suivant."],
      cycle_plan_id: null, plan_item_id: null, scheduled_for: null,
    }])
  })
})
