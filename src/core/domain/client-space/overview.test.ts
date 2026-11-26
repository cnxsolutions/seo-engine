import { describe, expect, it } from 'vitest'
import {
  clientPageState,
  daysBetween,
  pageTitle,
  parisDay,
  periodProgress,
  planTitles,
  summarizePeriod,
  type SlotRow,
} from './overview'

const slot = (values: Partial<SlotRow> & Pick<SlotRow, 'id' | 'scheduled_date' | 'status'>): SlotRow => ({
  target_keyword: 'plombier troyes', target_city: 'Troyes', plan_item_id: null, ...values,
})

describe('parisDay', () => {
  it('donne le jour qu il etait a Paris, pas a Greenwich', () => {
    expect(parisDay('2026-11-25T23:30:00Z')).toBe('2026-11-26')
    expect(parisDay('2026-07-14T21:59:00Z')).toBe('2026-07-14')
    expect(parisDay('2026-07-14T22:01:00Z')).toBe('2026-07-15')
  })
})

describe('periodProgress', () => {
  it('va de 0 au debut a 1 a la fin, sans deborder', () => {
    expect(periodProgress('2026-11-20', '2026-12-04', '2026-11-20')).toBe(0)
    expect(periodProgress('2026-11-20', '2026-12-04', '2026-11-27')).toBeCloseTo(0.5)
    expect(periodProgress('2026-11-20', '2026-12-04', '2026-12-10')).toBe(1)
    expect(periodProgress('2026-11-20', '2026-12-04', '2026-11-01')).toBe(0)
  })

  it('traverse le changement d heure sans perdre un jour', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
})

describe('summarizePeriod', () => {
  const cycles = [{ cycle_started_at: '2026-11-19T23:00:00Z', cycle_ends_at: '2026-12-03T23:00:00Z' }]
  const slots = [
    slot({ id: 'a', scheduled_date: '2026-11-20', status: 'published' }),
    slot({ id: 'b', scheduled_date: '2026-11-22', status: 'published' }),
    slot({ id: 'c', scheduled_date: '2026-11-24', status: 'failed' }),
    slot({ id: 'd', scheduled_date: '2026-11-28', status: 'planned', plan_item_id: 'p1' }),
    slot({ id: 'e', scheduled_date: '2026-11-26', status: 'generated' }),
    slot({ id: 'f', scheduled_date: '2026-11-30', status: 'skipped' }),
    slot({ id: 'g', scheduled_date: '2026-12-20', status: 'planned' }),
  ]

  it('compte les pages de la periode, en ligne et a venir, a l heure de Paris', () => {
    const summary = summarizePeriod(cycles, slots, new Map([['p1', 'Plombier à Troyes : dépannage']]), '2026-11-26')
    expect(summary).toMatchObject({ startDay: '2026-11-20', endDay: '2026-12-04', planned: 5, published: 2 })
    expect(summary?.upcoming).toEqual([
      { id: 'e', day: '2026-11-26', title: 'Plombier à Troyes' },
      { id: 'd', day: '2026-11-28', title: 'Plombier à Troyes : dépannage' },
    ])
  })

  it('ne montre pas de periode sans cycle date', () => {
    expect(summarizePeriod([{ cycle_started_at: null, cycle_ends_at: null }], slots, new Map(), '2026-11-26')).toBeNull()
    expect(summarizePeriod([], slots, new Map(), '2026-11-26')).toBeNull()
  })

  it('reunit plusieurs cycles en une seule periode', () => {
    const two = [...cycles, { cycle_started_at: '2026-11-24T23:00:00Z', cycle_ends_at: '2026-12-21T23:00:00Z' }]
    expect(summarizePeriod(two, slots, new Map(), '2026-11-26')).toMatchObject({ startDay: '2026-11-20', endDay: '2026-12-22', planned: 6 })
  })
})

describe('planTitles', () => {
  it('lit les titres proposes et ignore les elements malformes', () => {
    const titles = planTitles([{ id: 'p1', proposed_title: ' Titre ' }, { id: 2 }, null, 'x', { id: 'p3', proposed_title: '' }])
    expect([...titles]).toEqual([['p1', 'Titre']])
    expect(planTitles({ not: 'an array' }).size).toBe(0)
  })
})

describe('pageTitle', () => {
  it('ecrit le sujet en francais quand le plan ne propose pas de titre', () => {
    expect(pageTitle({ plan_item_id: null, target_keyword: 'débouchage canalisation la chapelle-saint-luc', target_city: 'La Chapelle-Saint-Luc' }, new Map()))
      .toBe('Débouchage canalisation à La Chapelle-Saint-Luc')
    expect(pageTitle({ plan_item_id: 'x', target_keyword: 'chauffe-eau', target_city: null }, new Map())).toBe('Chauffe-eau')
    expect(pageTitle({ plan_item_id: null, target_keyword: null, target_city: null }, new Map())).toBe('Nouvelle page')
  })
})

describe('clientPageState', () => {
  it('dit vrai : visible, en attente normale, ou a regarder chez CNX', () => {
    expect(clientPageState('indexed')).toBe('visible')
    for (const state of [null, undefined, 'unchecked', 'not_discovered', 'crawled_not_indexed']) {
      expect(clientPageState(state)).toBe('indexing')
    }
    for (const state of ['blocked', 'fetch_error', 'canonical_elsewhere']) expect(clientPageState(state)).toBe('checking')
  })
})
