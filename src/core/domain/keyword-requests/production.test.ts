import { describe, expect, it } from 'vitest'
import { productionChange, type GenerationState, type ProducingRequest, type SlotState } from './production'

function request(overrides: Partial<ProducingRequest> = {}): ProducingRequest {
  return {
    id: 'r1',
    status: 'scheduled',
    campaign_id: 'camp-1',
    cycle_plan_id: 'plan-1',
    plan_item_id: 'item-1',
    scheduled_for: '2026-11-28',
    ...overrides,
  }
}

function slot(overrides: Partial<SlotState> = {}): SlotState {
  return { status: 'planned', scheduled_date: '2026-11-28', generation_id: null, error_message: null, ...overrides }
}

function generation(overrides: Partial<GenerationState> = {}): GenerationState {
  return { status: 'generating', published_url: null, published_at: null, error_message: null, ...overrides }
}

describe('productionChange — ce que le creneau et sa generation disent de la demande', () => {
  it('prevue tant que son creneau attend, et sa date suit le calendrier', () => {
    expect(productionChange(request(), slot(), null, 'plan-1')).toBeNull()
    expect(productionChange(request(), slot({ scheduled_date: '2026-11-30' }), null, 'plan-1')).toEqual({
      id: 'r1', from: 'scheduled', status: 'scheduled', scheduled_for: '2026-11-30',
    })
  })

  it('en redaction des que le creneau est reclame, sans y revenir deux fois', () => {
    expect(productionChange(request(), slot({ status: 'generating' }), generation(), 'plan-1')).toEqual({
      id: 'r1', from: 'scheduled', status: 'in_production',
    })
    expect(productionChange(request({ status: 'in_production' }), slot({ status: 'generated' }), generation({ status: 'generated' }), 'plan-1')).toBeNull()
    // Rendu au calendrier apres un echec passager : toujours en redaction, jamais « prevue » de nouveau.
    expect(productionChange(request({ status: 'in_production' }), slot({ status: 'planned' }), generation({ status: 'failed' }), 'plan-1')).toBeNull()
  })

  it('en ligne avec l adresse, quel que soit le chemin de publication', () => {
    const online = generation({ status: 'published', published_url: 'https://plomberie.test/debouchage-troyes', published_at: '2026-11-28T09:12:00Z' })
    // Publiee par le planificateur, ou a la main depuis la console (le creneau est reste « generated »).
    for (const state of ['published', 'generated']) {
      expect(productionChange(request({ status: 'in_production' }), slot({ status: state }), online, 'plan-1')).toEqual({
        id: 'r1', from: 'in_production', status: 'published',
        published_url: 'https://plomberie.test/debouchage-troyes', published_at: '2026-11-28T09:12:00Z',
      })
    }
    // Une production courte, commencee et finie entre deux passages.
    expect(productionChange(request(), slot({ status: 'published' }), online, 'plan-1')?.status).toBe('published')
  })

  it('un arret part a CNX, avec le motif pour l operateur', () => {
    expect(productionChange(request({ status: 'in_production' }), slot({ status: 'failed', error_message: 'Rejete par le pipeline : doublon.' }), generation({ status: 'rejected' }), 'plan-1')).toEqual({
      id: 'r1', from: 'in_production', status: 'review', reason_code: 'PRODUCTION_STOPPED', reasons: ['Rejete par le pipeline : doublon.'],
    })
    expect(productionChange(request({ status: 'in_production' }), slot({ status: 'generated' }), generation({ status: 'failed', error_message: 'WordPress injoignable.' }), 'plan-1')).toMatchObject({
      status: 'review', reasons: ['WordPress injoignable.'],
    })
    expect(productionChange(request(), slot({ status: 'skipped' }), null, 'plan-1')).toMatchObject({ from: 'scheduled', status: 'review' })
  })

  it('sans creneau : de retour en file si son plan a ete remplace, sinon on attend', () => {
    expect(productionChange(request(), null, null, 'plan-2')).toMatchObject({
      from: 'scheduled', status: 'deferred', reason_code: 'NEXT_PERIOD', cycle_plan_id: null, plan_item_id: null, scheduled_for: null,
    })
    // Le plan tourne encore : le creneau est peut-etre en train d'etre recree.
    expect(productionChange(request(), null, null, 'plan-1')).toBeNull()
    expect(productionChange(request({ status: 'in_production' }), null, null, 'plan-2')).toBeNull()
  })
})
