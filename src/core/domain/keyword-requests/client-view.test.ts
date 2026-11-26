import { describe, expect, it } from 'vitest'
import { clientRequestView, safeUrl, type RequestRecord } from './client-view'

function record(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: 'r1',
    keyword: 'débouchage',
    city: 'Troyes',
    note: null,
    desired_by: null,
    status: 'received',
    reason_code: null,
    reasons: ['Motif interne pour CNX.'],
    evidence: [],
    scheduled_for: null,
    published_url: null,
    published_at: null,
    decided_at: null,
    created_at: '2026-11-25T23:30:00Z',
    updated_at: '2026-11-25T23:30:00Z',
    ...overrides,
  }
}

describe('clientRequestView', () => {
  it('une demande recue est en analyse, au jour de Paris', () => {
    const view = clientRequestView(record())
    expect(view.state).toBe('analysing')
    expect(view.timeline).toEqual([
      { kind: 'received', day: '2026-11-26', status: 'done' },
      { kind: 'analysed', day: null, status: 'current' },
    ])
    expect(view.canWithdraw).toBe(true)
  })

  it('prevue : la date du creneau, et les etapes qui restent', () => {
    const view = clientRequestView(record({ status: 'scheduled', scheduled_for: '2026-11-28', decided_at: '2026-11-26T10:00:00Z', reason_code: 'PLANNED' }))
    expect(view.detail).toEqual({ kind: 'planned', day: '2026-11-28', already: false })
    expect(view.timeline.map((step) => `${step.kind}:${step.status}`)).toEqual([
      'received:done', 'analysed:done', 'planned:current', 'writing:upcoming', 'online:upcoming',
    ])
  })

  it('deja au programme avant la demande, ou mise au programme pour elle : deux phrases differentes', () => {
    expect(clientRequestView(record({ status: 'scheduled', scheduled_for: '2026-11-30', reason_code: 'ALREADY_PLANNED' })).detail)
      .toEqual({ kind: 'planned', day: '2026-11-30', already: true })
  })

  it('deja gagnee : la position et la page, jamais les motifs internes', () => {
    const view = clientRequestView(record({
      status: 'covered',
      reason_code: 'ALREADY_WON',
      evidence: [{ kind: 'position', query: 'plomberie martin', position: 1.4 }, { kind: 'page', url: 'https://plomberie-martin.test/' }],
    }))
    expect(view.detail).toEqual({ kind: 'won', position: 1, url: 'https://plomberie-martin.test/' })
    // Conclue : plus rien n'est en cours.
    expect(view.timeline.every((step) => step.status === 'done')).toBe(true)
    expect(JSON.stringify(view)).not.toContain('Motif interne')
    expect(view.canWithdraw).toBe(false)
  })

  it('a l etude pour une ville : la ville, pour le dire', () => {
    expect(clientRequestView(record({ status: 'review', reason_code: 'CITY_OUT_OF_AREA', evidence: [{ kind: 'city', city: 'Reims' }] })).detail)
      .toEqual({ kind: 'city', city: 'Reims' })
    expect(clientRequestView(record({ status: 'review', reason_code: 'OUT_OF_TRADE' })).detail).toEqual({ kind: 'none' })
    expect(clientRequestView(record({ status: 'review' })).timeline.at(-1)?.status).toBe('current')
  })

  it('non retenue : le motif ecrit pour le client', () => {
    expect(clientRequestView(record({ status: 'declined', reasons: ['Ce service n’est plus proposé.'] })).detail)
      .toEqual({ kind: 'declined', reason: 'Ce service n’est plus proposé.' })
  })

  it('retiree : la date du retrait, et rien a retirer de plus', () => {
    const view = clientRequestView(record({ status: 'withdrawn', updated_at: '2026-11-27T08:00:00Z' }))
    expect(view.timeline.at(-1)).toEqual({ kind: 'withdrawn', day: '2026-11-27', status: 'done' })
    expect(view.canWithdraw).toBe(false)
  })

  it('en ligne : la page, et toutes les etapes passees', () => {
    const view = clientRequestView(record({ status: 'published', published_url: 'https://plomberie-martin.test/debouchage-troyes', published_at: '2026-11-29T09:00:00Z' }))
    expect(view.detail).toEqual({ kind: 'page', url: 'https://plomberie-martin.test/debouchage-troyes' })
    expect(view.timeline.every((step) => step.status === 'done')).toBe(true)
  })
})

describe('safeUrl', () => {
  it('seules les adresses http(s) deviennent des liens', () => {
    expect(safeUrl('https://x.test/a')).toBe('https://x.test/a')
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('/relative')).toBeNull()
    expect(safeUrl(42)).toBeNull()
  })
})
