import { describe, expect, it } from 'vitest'
import {
  CLIENT_SESSION_MAX_DAYS,
  SIGN_IN_CODE_PATTERN,
  codeSignInTime,
  judgeSession,
  memberState,
  normalizeEmail,
  normalizeSignInCode,
  planInvitation,
  safeNextPath,
} from './policy'

const NOW = new Date('2026-11-26T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

/** The `amr` claim of a session whose code was typed `days` ago. */
const codeAmr = (days: number) => [{ method: 'otp', timestamp: Math.floor(Date.parse(daysAgo(days)) / 1000) }]

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

describe('codeSignInTime', () => {
  it('lit l instant du code, le plus recent s il y en a plusieurs', () => {
    expect(codeSignInTime([...codeAmr(5), ...codeAmr(2)])).toBe(Math.floor(Date.parse(daysAgo(2)) / 1000) * 1000)
  })

  it('ne connait pas d autre porte que le code', () => {
    expect(codeSignInTime([{ method: 'password', timestamp: 1 }])).toBeNull()
    expect(codeSignInTime(undefined)).toBeNull()
  })
})

describe('judgeSession', () => {
  it('garde une session ouverte par un code depuis moins de la duree maximale', () => {
    expect(judgeSession(codeAmr(CLIENT_SESSION_MAX_DAYS - 1), null, NOW)).toBe('valid')
  })

  it('ferme une session plus vieille que la duree maximale, quoi que disent les rafraichissements', () => {
    expect(judgeSession(codeAmr(CLIENT_SESSION_MAX_DAYS + 1), null, NOW)).toBe('expired')
  })

  it('ferme une session ouverte avant une revocation ou une reouverture', () => {
    expect(judgeSession(codeAmr(3), daysAgo(1), NOW)).toBe('expired')
    expect(judgeSession(codeAmr(1), daysAgo(3), NOW)).toBe('valid')
    expect(judgeSession(codeAmr(1), 'pas une date', NOW)).toBe('expired')
  })

  it('compte a la seconde, comme le jeton : un code saisi dans la seconde de la reouverture passe', () => {
    const typed = [{ method: 'otp', timestamp: Date.parse('2026-11-26T10:00:00Z') / 1000 }]
    expect(judgeSession(typed, '2026-11-26T10:00:00.700Z', NOW)).toBe('valid')
    expect(judgeSession(typed, '2026-11-26T10:00:01.000Z', NOW)).toBe('expired')
  })

  it('refuse une session ouverte autrement que par un code', () => {
    expect(judgeSession([{ method: 'password', timestamp: Math.floor(NOW.getTime() / 1000) }], null, NOW)).toBe('refused')
    expect(judgeSession(undefined, null, NOW)).toBe('refused')
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
  const BACKSLASH = String.fromCharCode(92)

  it('garde un chemin de l espace client', () => {
    expect(safeNextPath('/espace')).toBe('/espace')
    expect(safeNextPath('/espace/demandes?site=1')).toBe('/espace/demandes?site=1')
  })

  it('ne redirige jamais hors de l espace client', () => {
    for (const raw of [null, '', 'espace', 'https://evil.test', '//evil.test', `/${BACKSLASH}evil.test`, '/dashboard', '/espacex']) {
      expect(safeNextPath(raw)).toBe('/espace')
    }
  })

  it('resout les segments « .. », encodes ou non, avant de juger', () => {
    for (const raw of ['/espace/../sites', '/espace/%2e%2e/api/sites', '/espace/%2E%2e/dashboard', `/espace${BACKSLASH}..${BACKSLASH}sites`]) {
      expect(safeNextPath(raw)).toBe('/espace')
    }
    expect(safeNextPath('/espace/a/../b')).toBe('/espace/b')
  })

  it('garde un double trait oblique DANS le chemin : il reste sur le meme site', () => {
    expect(safeNextPath('/espace//evil.test')).toBe('/espace//evil.test')
  })
})
