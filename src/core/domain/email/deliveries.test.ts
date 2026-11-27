import { describe, expect, it } from 'vitest'
import { afterFailure, MAX_ATTEMPTS, planDeliveries, type OutboxEntry, type OutboxMember } from './deliveries'

const NOW = new Date('2026-11-28T10:00:00Z')

const marie: OutboxMember = {
  id: 'm1',
  email: 'marie@martin-batiment.test',
  revokedAt: null,
  optedOutAt: null,
  unsubscribeToken: 't-marie',
}

function entry(overrides: Partial<OutboxEntry> & { status?: string } = {}): OutboxEntry {
  const { status = 'scheduled', ...rest } = overrides
  return {
    id: 'o1',
    kind: 'client_request',
    requestStatus: status,
    attempts: 0,
    createdAt: '2026-11-28T09:58:00Z',
    member: marie,
    request: {
      id: 'r1',
      keyword: 'débouchage',
      city: 'Troyes',
      note: null,
      desired_by: null,
      status: status as OutboxEntry['request']['status'],
      reason_code: null,
      reasons: [],
      evidence: [],
      scheduled_for: '2026-12-12',
      published_url: null,
      published_at: null,
      decided_at: '2026-11-28T09:58:00Z',
      created_at: '2026-11-28T09:56:00Z',
      updated_at: '2026-11-28T09:58:00Z',
      siteId: 's1',
      siteName: 'Plomberie Martin',
    },
    ...rest,
  }
}

describe('planDeliveries', () => {
  it('envoie au membre qui a envoyé la demande', () => {
    const plan = planDeliveries([entry()], { now: NOW, operatorEmail: 'contact@cnx-solutions.fr' })
    expect(plan.skipped).toEqual([])
    expect(plan.deliveries).toEqual([
      { kind: 'client', to: marie.email, memberId: 'm1', unsubscribeToken: 't-marie', entries: [entry()] },
    ])
  })

  it('regroupe les nouvelles d’un même membre en un seul e-mail, dans l’ordre où elles sont arrivées', () => {
    const later = entry({ id: 'o2', createdAt: '2026-11-28T09:59:00Z', request: { ...entry().request, id: 'r2' } })
    const plan = planDeliveries([later, entry()], { now: NOW, operatorEmail: null })
    expect(plan.deliveries).toHaveLength(1)
    expect(plan.deliveries[0].entries.map((e) => e.id)).toEqual(['o1', 'o2'])
  })

  it('sépare deux membres', () => {
    const luc = { ...marie, id: 'm2', email: 'luc@electricite-durand.test', unsubscribeToken: 't-luc' }
    const plan = planDeliveries([entry(), entry({ id: 'o2', member: luc })], { now: NOW, operatorEmail: null })
    expect(plan.deliveries.map((d) => d.to)).toEqual([marie.email, luc.email])
  })

  it('n’écrit à personne pour une demande sans membre, un membre révoqué ou désinscrit', () => {
    const plan = planDeliveries(
      [
        entry({ id: 'a', member: null }),
        entry({ id: 'b', member: { ...marie, revokedAt: '2026-11-27T00:00:00Z' } }),
        entry({ id: 'c', member: { ...marie, optedOutAt: '2026-11-27T00:00:00Z' } }),
      ],
      { now: NOW, operatorEmail: 'contact@cnx-solutions.fr' },
    )
    expect(plan.deliveries).toEqual([])
    expect(plan.skipped).toEqual([
      { id: 'a', reason: 'no_member' },
      { id: 'b', reason: 'member_revoked' },
      { id: 'c', reason: 'opted_out' },
    ])
  })

  it('écarte une nouvelle dépassée : la demande a changé de statut depuis', () => {
    const moved = entry({ request: { ...entry().request, status: 'published' } })
    expect(planDeliveries([moved], { now: NOW, operatorEmail: null }).skipped).toEqual([{ id: 'o1', reason: 'superseded' }])
  })

  it('écarte une nouvelle de plus d’un jour plutôt que de l’envoyer en retard', () => {
    const old = entry({ createdAt: '2026-11-27T09:00:00Z' })
    expect(planDeliveries([old], { now: NOW, operatorEmail: null }).skipped).toEqual([{ id: 'o1', reason: 'too_old' }])
  })

  it('envoie les demandes à examiner à CNX, en un seul e-mail', () => {
    const review = (id: string) => entry({ id, kind: 'operator_review', status: 'review', member: null })
    const plan = planDeliveries([review('x'), review('y')], { now: NOW, operatorEmail: 'contact@cnx-solutions.fr' })
    expect(plan.deliveries).toEqual([{ kind: 'operator', to: 'contact@cnx-solutions.fr', entries: [review('x'), review('y')] }])
  })

  it('écarte les demandes à examiner quand aucune adresse CNX n’est réglée', () => {
    const review = entry({ kind: 'operator_review', status: 'review' })
    expect(planDeliveries([review], { now: NOW, operatorEmail: null })).toEqual({
      deliveries: [],
      skipped: [{ id: 'o1', reason: 'no_operator_address' }],
    })
  })
})

describe('afterFailure', () => {
  it('réessaie de plus en plus tard', () => {
    expect(afterFailure(0, NOW)).toEqual({ attempts: 1, giveUp: false, nextAttemptAt: '2026-11-28T10:02:00.000Z' })
    expect(afterFailure(1, NOW).nextAttemptAt).toBe('2026-11-28T10:10:00.000Z')
    expect(afterFailure(3, NOW).nextAttemptAt).toBe('2026-11-28T12:00:00.000Z')
  })

  it('abandonne après le nombre d’essais prévu', () => {
    expect(afterFailure(MAX_ATTEMPTS - 2, NOW).giveUp).toBe(false)
    expect(afterFailure(MAX_ATTEMPTS - 1, NOW).giveUp).toBe(true)
  })
})
