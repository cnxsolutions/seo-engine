import { describe, expect, it } from 'vitest'
import { REASON_LABELS } from './operator-labels'
import { queueItem, readQueueView, readSiteFilter } from './queue'
import type { OperatorRequestRow } from './repository'

function row(overrides: Partial<OperatorRequestRow> = {}): OperatorRequestRow {
  return {
    id: 'r1',
    site_id: 'site-a',
    campaign_id: 'camp-1',
    keyword: 'adoucisseur d eau',
    city: 'Reims',
    note: 'Nouveau secteur depuis octobre.',
    desired_by: null,
    status: 'review',
    reason_code: 'CITY_OUT_OF_AREA',
    reasons: ['Reims n est pas dans les communes de la campagne.'],
    created_at: '2026-11-26T08:00:00Z',
    updated_at: '2026-11-26T08:02:00Z',
    decided_by: 'engine',
    decided_at: '2026-11-26T08:02:00Z',
    scheduled_for: null,
    published_url: null,
    deferred_cycles: 0,
    site: { name: 'Plomberie Martin' },
    ...overrides,
  }
}

describe('queueItem — une ligne de la file', () => {
  it('le site, la demande, le verdict du moteur dans ses mots, et les gestes permis', () => {
    expect(queueItem(row())).toMatchObject({
      siteName: 'Plomberie Martin',
      keyword: 'adoucisseur d eau',
      city: 'Reims',
      note: 'Nouveau secteur depuis octobre.',
      reasonCode: 'CITY_OUT_OF_AREA',
      reason: 'Reims n est pas dans les communes de la campagne.',
      integrating: false,
      actions: ['integrate', 'defer', 'decline'],
    })
  })

  it('une integration demandee attend la reponse du moteur, sans autre geste', () => {
    expect(queueItem(row({ status: 'deferred', reason_code: 'OPERATOR_INTEGRATE' }))).toMatchObject({ integrating: true, actions: [] })
  })

  it('seules les adresses http(s) deviennent des liens', () => {
    expect(queueItem(row({ status: 'published', published_url: 'javascript:alert(1)' })).publishedUrl).toBeNull()
    expect(queueItem(row({ status: 'published', published_url: 'https://plomberie.test/page' })).publishedUrl).toBe('https://plomberie.test/page')
  })
})

describe('les filtres de l adresse', () => {
  it('a examiner par defaut, toutes sur demande', () => {
    expect(readQueueView(undefined)).toBe('review')
    expect(readQueueView('toutes')).toBe('all')
    expect(readQueueView(['toutes', 'x'])).toBe('all')
    expect(readQueueView('n importe quoi')).toBe('review')
  })

  it('un site n est lu que s il a la forme d un identifiant', () => {
    expect(readSiteFilter('44B33FC0-C91A-3798-6B32-D1B48D2F96BE')).toBe('44b33fc0-c91a-3798-6b32-d1b48d2f96be')
    expect(readSiteFilter("1' or '1'='1")).toBeNull()
    expect(readSiteFilter(undefined)).toBeNull()
  })
})

describe('REASON_LABELS — aucun code a l ecran', () => {
  it('chaque motif que le moteur et la console ecrivent a ses mots', () => {
    const codes = [
      'ALREADY_PLANNED', 'ALREADY_WON', 'ALREADY_COVERED', 'NO_CAMPAIGN', 'CITY_OUT_OF_AREA', 'CITY_ON_NATIONAL',
      'OUT_OF_TRADE', 'UNSURE_TRADE', 'OPINION_UNAVAILABLE', 'NEXT_PERIOD', 'PLANNED', 'PLACED_IN_CYCLE', 'PLAN_GUARD',
      'WAITED_TOO_LONG', 'PRODUCTION_STOPPED', 'OPERATOR_INTEGRATE', 'OPERATOR_DEFERRED', 'OPERATOR_DECLINED',
      'OPERATOR_REOPENED', 'NO_SLOT_NOW',
    ]
    for (const code of codes) expect(REASON_LABELS[code], code).toBeTruthy()
  })
})
