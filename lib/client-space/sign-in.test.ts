import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MemberRow } from './repository'

const repository = vi.hoisted(() => ({
  findMemberByEmail: vi.fn(),
  findMemberByUserId: vi.fn(),
  updateMember: vi.fn(),
}))
const sendSignInCode = vi.hoisted(() => vi.fn())

vi.mock('./repository', () => repository)
vi.mock('./auth-admin', () => ({ sendSignInCode }))

import { requestSignInCode, verifySignInCode, verifySignInLink } from './sign-in'

const MEMBER: MemberRow = {
  id: 'member-1',
  client_id: 'client-a',
  user_id: 'user-1',
  email: 'marie@martin.test',
  last_login_at: null,
  revoked_at: null,
  created_at: '2026-11-01T09:00:00Z',
}

let n = 0
/** The limiters are module-wide: every test asks from its own address and IP. */
const fresh = () => ({ email: `m${++n}@martin.test`, ip: `ip-${n}` })

function auth(verify: { userId?: string; error?: boolean }) {
  const signOut = vi.fn(async () => ({ error: null }))
  const client = {
    auth: {
      verifyOtp: vi.fn(async () => ({
        data: { user: verify.userId ? { id: verify.userId } : null },
        error: verify.error ? { message: 'Token has expired or is invalid' } : null,
      })),
      signOut,
    },
  } as unknown as SupabaseClient
  return { client, signOut }
}

beforeEach(() => {
  Object.values(repository).forEach((mock) => mock.mockReset())
  sendSignInCode.mockReset().mockResolvedValue({ ok: true })
})

describe('requestSignInCode', () => {
  it('envoie le code d un membre APRES la reponse', async () => {
    const { email, ip } = fresh()
    repository.findMemberByEmail.mockResolvedValue(MEMBER)
    const deferred: Array<() => Promise<void>> = []

    expect(await requestSignInCode({ email, ip, defer: (task) => deferred.push(task) })).toEqual({ status: 'accepted' })
    expect(sendSignInCode).not.toHaveBeenCalled()
    await deferred[0]()
    expect(sendSignInCode).toHaveBeenCalledWith(email)
  })

  it('repond pareil a un inconnu et a un membre revoque, sans rien envoyer', async () => {
    for (const found of [null, { ...MEMBER, revoked_at: '2026-11-25T10:00:00Z' }]) {
      const { email, ip } = fresh()
      repository.findMemberByEmail.mockResolvedValue(found)
      const deferred: Array<() => Promise<void>> = []
      expect(await requestSignInCode({ email, ip, defer: (task) => deferred.push(task) })).toEqual({ status: 'accepted' })
      expect(deferred).toHaveLength(0)
    }
  })

  it('freine au-dela de 5 demandes par adresse', async () => {
    const { email } = fresh()
    repository.findMemberByEmail.mockResolvedValue(null)
    for (let i = 0; i < 5; i++) {
      expect((await requestSignInCode({ email, ip: `${email}-${i}`, defer: () => undefined })).status).toBe('accepted')
    }
    const limited = await requestSignInCode({ email, ip: `${email}-6`, defer: () => undefined })
    expect(limited.status).toBe('limited')
    expect(repository.findMemberByEmail).toHaveBeenCalledTimes(5)
  })
})

describe('verifySignInCode', () => {
  it('ouvre la session d un membre et date sa connexion', async () => {
    const { email, ip } = fresh()
    repository.findMemberByUserId.mockResolvedValue(MEMBER)
    const now = new Date('2026-11-26T12:00:00Z')

    const result = await verifySignInCode({ email, code: '123456', ip, auth: auth({ userId: 'user-1' }).client, now })
    expect(result).toEqual({ status: 'signed_in' })
    expect(repository.updateMember).toHaveBeenCalledWith('member-1', { last_login_at: now.toISOString() })
  })

  it('refuse un code que Supabase refuse', async () => {
    const { email, ip } = fresh()
    expect(await verifySignInCode({ email, code: '123456', ip, auth: auth({ error: true }).client })).toEqual({ status: 'invalid' })
    expect(repository.findMemberByUserId).not.toHaveBeenCalled()
  })

  it('referme aussitot la session d un compte qui n est plus membre', async () => {
    const { email, ip } = fresh()
    repository.findMemberByUserId.mockResolvedValue({ ...MEMBER, revoked_at: '2026-11-25T10:00:00Z' })
    const { client, signOut } = auth({ userId: 'user-1' })

    expect(await verifySignInCode({ email, code: '123456', ip, auth: client })).toEqual({ status: 'invalid' })
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(repository.updateMember).not.toHaveBeenCalled()
  })

  it('freine au-dela de 10 essais par adresse', async () => {
    const { email } = fresh()
    for (let i = 0; i < 10; i++) {
      await verifySignInCode({ email, code: '000000', ip: `${email}-${i}`, auth: auth({ error: true }).client })
    }
    expect((await verifySignInCode({ email, code: '000000', ip: `${email}-x`, auth: auth({ error: true }).client })).status).toBe('limited')
  })
})

describe('verifySignInLink', () => {
  it('verifie le lien par son empreinte, pas par l adresse', async () => {
    repository.findMemberByUserId.mockResolvedValue(MEMBER)
    const { client } = auth({ userId: 'user-1' })
    expect(await verifySignInLink({ tokenHash: 'abc', ip: fresh().ip, auth: client })).toEqual({ status: 'signed_in' })
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'email' })
  })
})
