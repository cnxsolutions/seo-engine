import { describe, expect, it } from 'vitest'
import {
  CLIENT_SESSION_MAX_DAYS,
  SIGN_IN_CODE_PATTERN,
  isSessionExpired,
  memberState,
  normalizeEmail,
  normalizeSignInCode,
  planInvitation,
  safeNextPath,
} from './policy'

const NOW = new Date('2026-11-26T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

describe('normalizeEmail', () => {
  it('ramene une adresse a une seule ecriture', () => {
    expect(normalizeEmail('  Marie.Martin@Plomberie-Martin.TEST ')).toBe('marie.martin@plomberie-martin.test')
  })
})

describe('normalizeSignInCode', () => {
  it('retire les espaces et tirets colles depuis l e-mail', () => {
    expect(normalizeSignInCode(' 123 456 ')).toBe('123456')
    expect(normalizeSignInCode('123-456')).toBe('123456')
  })

  it('ne transforme pas des lettres en chiffres', () => {
    expect(SIGN_IN_CODE_PATTERN.test(normalizeSignInCode('12a456'))).toBe(false)
  })
})

describe('memberState', () => {
  it('distingue actif, jamais connecte et revoque', () => {
    expect(memberState({ revoked_at: null, last_login_at: daysAgo(1) })).toBe('active')
    expect(memberState({ revoked_at: null, last_login_at: null })).toBe('pending')
    expect(memberState({ revoked_at: daysAgo(0), last_login_at: daysAgo(3) })).toBe('revoked')
  })
})

describe('isSessionExpired', () => {
  it('garde une session ouverte depuis moins de la duree maximale', () => {
    expect(isSessionExpired(daysAgo(CLIENT_SESSION_MAX_DAYS - 1), NOW)).toBe(false)
  })

  it('ferme une session plus vieille que la duree maximale', () => {
    expect(isSessionExpired(daysAgo(CLIENT_SESSION_MAX_DAYS + 1), NOW)).toBe(true)
  })

  it('ne fait confiance ni a une connexion absente ni a une date illisible', () => {
    expect(isSessionExpired(null, NOW)).toBe(true)
    expect(isSessionExpired('pas une date', NOW)).toBe(true)
  })
})

describe('planInvitation', () => {
  it('cree un membre pour une adresse inconnue', () => {
    expect(planInvitation(null, 'client-a')).toBe('create')
  })

  it('renvoie un code a un membre actif du meme client', () => {
    expect(planInvitation({ client_id: 'client-a', revoked_at: null }, 'client-a')).toBe('resend')
  })

  it('rouvre un acces revoque du meme client', () => {
    expect(planInvitation({ client_id: 'client-a', revoked_at: daysAgo(2) }, 'client-a')).toBe('reopen')
  })

  it('refuse une adresse deja rattachee a un autre client, meme revoquee', () => {
    expect(planInvitation({ client_id: 'client-b', revoked_at: null }, 'client-a')).toBe('other_client')
    expect(planInvitation({ client_id: 'client-b', revoked_at: daysAgo(2) }, 'client-a')).toBe('other_client')
  })
})

describe('safeNextPath', () => {
  it('garde un chemin de l espace client', () => {
    expect(safeNextPath('/espace')).toBe('/espace')
    expect(safeNextPath('/espace/demandes?site=1')).toBe('/espace/demandes?site=1')
  })

  it('ne redirige jamais hors de l espace client', () => {
    for (const raw of [null, '', 'https://evil.test', '//evil.test', '/dashboard', '/espacex', '/espace//evil.test', '/espace\\evil']) {
      expect(safeNextPath(raw)).toBe('/espace')
    }
  })
})
