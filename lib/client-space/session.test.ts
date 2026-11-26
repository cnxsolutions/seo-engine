import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MemberRow } from './repository'

const findMemberByUserId = vi.fn<(userId: string) => Promise<MemberRow | null>>()
vi.mock('./repository', () => ({ findMemberByUserId: (userId: string) => findMemberByUserId(userId) }))
vi.mock('./request-auth', () => ({ createRequestAuthClient: async () => null }))

import { resolveClientSession } from './session'

const NOW = new Date('2026-11-26T12:00:00Z')

function authWith(result: { sub?: string; errorCode?: string }): SupabaseClient {
  return {
    auth: {
      getClaims: async () => ({
        data: result.sub ? { claims: { sub: result.sub } } : null,
        error: result.errorCode ? { code: result.errorCode, message: result.errorCode } : null,
      }),
    },
  } as unknown as SupabaseClient
}

function member(values: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 'member-1',
    client_id: 'client-a',
    user_id: 'user-1',
    email: 'marie@martin.test',
    last_login_at: '2026-11-20T09:00:00Z',
    revoked_at: null,
    created_at: '2026-11-01T09:00:00Z',
    ...values,
  }
}

beforeEach(() => findMemberByUserId.mockReset())

describe('resolveClientSession', () => {
  it('rend la session d un membre actif', async () => {
    findMemberByUserId.mockResolvedValue(member())
    expect(await resolveClientSession(authWith({ sub: 'user-1' }), NOW)).toEqual({
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
    expect((await resolveClientSession(authWith({ sub: 'user-1' }), NOW)).status).toBe('revoked')
    findMemberByUserId.mockResolvedValueOnce(member({ revoked_at: '2026-11-25T10:00:00Z' }))
    expect((await resolveClientSession(authWith({ sub: 'user-1' }), NOW)).status).toBe('revoked')
  })

  it('une connexion de plus de 30 jours a expire', async () => {
    findMemberByUserId.mockResolvedValue(member({ last_login_at: '2026-10-20T09:00:00Z' }))
    expect((await resolveClientSession(authWith({ sub: 'user-1' }), NOW)).status).toBe('expired')
  })
})
