import { describe, expect, it } from 'vitest'
import {
  ENGINE_VERDICT_STATUSES,
  OPEN_STATUSES,
  REQUEST_STATUSES,
  WITHDRAWABLE_STATUSES,
  canTransition,
  canWithdraw,
  isRequestStatus,
} from './lifecycle'

describe('cycle de vie d une demande (§ 3.3)', () => {
  it('le moteur conclut une demande recue, sans jamais la publier ni la refuser', () => {
    for (const status of ENGINE_VERDICT_STATUSES) expect(canTransition('received', status)).toBe(true)
    expect(canTransition('received', 'published')).toBe(false)
    expect(canTransition('received', 'declined')).toBe(false)
  })

  it('seul l operateur refuse, et seulement ce qu il examine', () => {
    expect(canTransition('review', 'declined')).toBe(true)
    expect(canTransition('deferred', 'declined')).toBe(false)
    expect(canTransition('declined', 'review')).toBe(true)
  })

  it('une demande en ligne ou retiree est terminee', () => {
    for (const to of REQUEST_STATUSES) {
      expect(canTransition('published', to)).toBe(false)
      expect(canTransition('withdrawn', to)).toBe(false)
    }
  })

  it('le client retire une demande tant qu elle n est pas en redaction (KW-9)', () => {
    expect(WITHDRAWABLE_STATUSES).toEqual(['received', 'review', 'deferred', 'scheduled'])
    expect(canWithdraw('in_production')).toBe(false)
    expect(canWithdraw('covered')).toBe(false)
  })

  it('les demandes ouvertes sont celles qui attendent encore quelque chose', () => {
    expect(OPEN_STATUSES).toEqual(['received', 'review', 'deferred', 'scheduled', 'in_production'])
    expect(OPEN_STATUSES).not.toContain('covered')
  })

  it('reconnait un statut, rien d autre', () => {
    expect(isRequestStatus('deferred')).toBe(true)
    expect(isRequestStatus('refused')).toBe(false)
    expect(isRequestStatus(null)).toBe(false)
  })
})
