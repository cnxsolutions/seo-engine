import { describe, expect, it } from 'vitest'
import { DECLINE_REASON_CHARS, operatorActions, operatorDecision } from './arbitration'
import { REQUEST_STATUSES } from './lifecycle'

describe('operatorActions — ce que CNX peut faire, statut par statut (§ 3.3)', () => {
  it('a examiner : integrer, reporter ou refuser ; reportee : integrer ; couverte : integrer ou reporter ; refusee : rouvrir', () => {
    expect(operatorActions('review')).toEqual(['integrate', 'defer', 'decline'])
    expect(operatorActions('deferred')).toEqual(['integrate'])
    expect(operatorActions('covered')).toEqual(['integrate', 'defer'])
    expect(operatorActions('declined')).toEqual(['reopen'])
  })

  it('rien sur une demande recue, en cours, en ligne ou retiree : le moteur ou le client la tiennent', () => {
    for (const status of ['received', 'scheduled', 'in_production', 'published', 'withdrawn'] as const) {
      expect(operatorActions(status)).toEqual([])
    }
  })

  it('chaque geste permis est une transition du cycle de vie', () => {
    for (const status of REQUEST_STATUSES) {
      for (const action of operatorActions(status)) {
        expect(operatorDecision(action, status, 'Un motif assez long pour le client.').ok).toBe(true)
      }
    }
  })
})

describe('operatorDecision', () => {
  it('integrer marque la demande pour le cycle en cours, sans la sortir de la file', () => {
    expect(operatorDecision('integrate', 'review')).toEqual({
      ok: true,
      decision: { from: 'review', status: 'deferred', reason_code: 'OPERATOR_INTEGRATE', reasons: ['Integration au cycle en cours demandee par CNX.'], detach: true },
    })
    expect(operatorDecision('integrate', 'deferred')).toMatchObject({ ok: true, decision: { from: 'deferred', status: 'deferred' } })
  })

  it('refuser exige un motif ecrit pour le client, ni vide ni roman', () => {
    expect(operatorDecision('decline', 'review', '  ')).toEqual({ ok: false, problem: 'reason_required' })
    expect(operatorDecision('decline', 'review', 'Non.')).toEqual({ ok: false, problem: 'reason_required' })
    expect(operatorDecision('decline', 'review', 'x'.repeat(DECLINE_REASON_CHARS.max + 1))).toEqual({ ok: false, problem: 'reason_too_long' })
    expect(operatorDecision('decline', 'review', '  La climatisation   n’est pas un service du site.  ')).toMatchObject({
      ok: true, decision: { status: 'declined', reason_code: 'OPERATOR_DECLINED', reasons: ['La climatisation n’est pas un service du site.'] },
    })
  })

  it('un geste hors de son statut est refuse', () => {
    expect(operatorDecision('decline', 'deferred', 'Un motif assez long.')).toEqual({ ok: false, problem: 'not_allowed' })
    expect(operatorDecision('reopen', 'review')).toEqual({ ok: false, problem: 'not_allowed' })
    expect(operatorDecision('integrate', 'in_production')).toEqual({ ok: false, problem: 'not_allowed' })
  })
})
