import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MemberRow } from './repository'

const findMemberByUserId = vi.fn<(userId: string) => Promise<MemberRow | null>>()
vi.mock('./repository', () => ({ findMemberByUserId: (userId: string) => findMemberByUserId(userId) }))
vi.mock('./request-auth', () => ({ createRequestAuthClient: async () => null }))

import { resolveClientSession } from './session'

const NOW = new Date('2026-11-26T12:00:00Z')
const secondsAgo = (days: number) => Math.floor((NOW.getTime() - days * 24 * 60 * 60 * 1000) / 1000)

interface ClaimsFixture {
  sub?: string
  amr?: Array<{ method: string; timestamp: number }>
  errorCode?: string
}

function authWith(result: ClaimsFixture): SupabaseClient {
  return {
    auth: {
      getClaims: async () => ({
        data: result.sub ? { claims: { sub: result.sub, amr: result.amr } } : null,
        error: result.errorCode ? { code: result.errorCode, message: result.errorCode } : null,
      }),
    },
  } as unknown as SupabaseClient
}

/** A session opened by a code `days` ago. */
const codeSession = (days = 1): ClaimsFixture => ({ sub: 'user-1', amr: [{ method: 'otp', timestamp: secondsAgo(days) }] })

function member(values: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 'member-1',
    client_id: 'client-a',
    user_id: 'user-1',
    email: 'marie@martin.test',
    last_login_at: '2026-11-20T09:00:00Z',
    revoked_at: null,
    sessions_valid_after: null,
    created_at: '2026-11-01T09:00:00Z',
    ...values,
  }
}

beforeEach(() => findMemberByUserId.mockReset())

describe('resolveClientSession', () => {
  it('rend la session d un membre actif, ouverte par un code', async () => {
    findMemberByUserId.mockResolvedValue(member())
    expect(await resolveClientSession(authWith(codeSession()), NOW)).toEqual({
      status: 'active',
      session: { userId: 'user-1', memberId: 'member-1', clientId: 'client-a', email: 'marie@martin.test' },
    })
  })

  it('sans session Supabase, personne', async () => {
    expect(await resolveClientSession(authWith({}), NOW)).toEqual({ status: 'none' })
    expect(findMemberByUserId).not.toHaveBeenCalled()
  })

  it('un compte bloque par la revocation est dit revoque', async () => {
    expect(await resolveClientSession(authWith({ errorCode: 'user_banned' }), NOW)).toEqual({ status: 'revoked' })
  })

  it('un compte sans adhesion, ou une adhesion retiree, n entre pas', async () => {
    findMemberByUserId.mockResolvedValueOnce(null)
    expect((await resolveClientSession(authWith(codeSession()), NOW)).status).toBe('revoked')
    findMemberByUserId.mockResolvedValueOnce(member({ revoked_at: '2026-11-25T10:00:00Z' }))
    expect((await resolveClientSession(authWith(codeSession()), NOW)).status).toBe('revoked')
  })

  it('une session ouverte par son code il y a plus de 30 jours a expire, meme si le membre s est reconnecte ailleurs', async () => {
    findMemberByUserId.mockResolvedValue(member({ last_login_at: '2026-11-26T08:00:00Z' }))
    expect((await resolveClientSession(authWith(codeSession(31)), NOW)).status).toBe('expired')
  })

  it('une session d avant la derniere revocation ne revient pas avec la reouverture', async () => {
    findMemberByUserId.mockResolvedValue(member({ sessions_valid_after: '2026-11-25T12:00:00Z' }))
    expect((await resolveClientSession(authWith(codeSession(3)), NOW)).status).toBe('expired')
  })

  it('une session ouverte par un mot de passe, hors de cet espace, n entre pas', async () => {
    findMemberByUserId.mockResolvedValue(member())
    const password = authWith({ sub: 'user-1', amr: [{ method: 'password', timestamp: secondsAgo(0) }] })
    expect((await resolveClientSession(password, NOW)).status).toBe('expired')
  })
})
