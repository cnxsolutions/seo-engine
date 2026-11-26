import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberRow } from './repository'

const repository = vi.hoisted(() => ({
  attachSiteToClient: vi.fn(),
  findMemberByEmail: vi.fn(),
  findMemberOfClient: vi.fn(),
  findSiteLink: vi.fn(),
  getClient: vi.fn(),
  insertClient: vi.fn(),
  insertMember: vi.fn(),
  listClientSites: vi.fn(),
  listClients: vi.fn(),
  listMembers: vi.fn(),
  updateMember: vi.fn(),
}))
const admin = vi.hoisted(() => ({
  ensureConfirmedUser: vi.fn(),
  sendSignInCode: vi.fn(),
  setUserBanned: vi.fn(),
}))

vi.mock('./repository', () => repository)
vi.mock('./auth-admin', () => admin)

import { inviteMember, loadSiteAccess, revokeMember } from './access'

const SITE = { id: 'site-1', name: 'Plomberie Martin', client_id: null as string | null }
const member = (values: Partial<MemberRow> = {}): MemberRow => ({
  id: 'member-1', client_id: 'client-a', user_id: 'user-1', email: 'marie@martin.test',
  last_login_at: null, revoked_at: null, sessions_valid_after: null, created_at: '2026-11-01T09:00:00Z', ...values,
})

beforeEach(() => {
  Object.values(repository).forEach((mock) => mock.mockReset())
  Object.values(admin).forEach((mock) => mock.mockReset())
  admin.sendSignInCode.mockResolvedValue({ ok: true })
  admin.ensureConfirmedUser.mockResolvedValue('user-new')
})

describe('inviteMember', () => {
  it('cree le client, rattache le site, cree le membre, envoie le code', async () => {
    repository.findSiteLink.mockResolvedValue(SITE)
    repository.insertClient.mockResolvedValue({ id: 'client-new', name: 'Martin Bâtiment' })
    repository.attachSiteToClient.mockResolvedValue(true)
    repository.findMemberByEmail.mockResolvedValue(null)

    const result = await inviteMember({ siteId: 'site-1', email: 'marie@martin.test', client: { kind: 'new', name: 'Martin Bâtiment' } })
    expect(result).toEqual({ status: 'invited' })
    expect(repository.attachSiteToClient).toHaveBeenCalledWith('site-1', 'client-new')
    expect(repository.insertMember).toHaveBeenCalledWith({ client_id: 'client-new', user_id: 'user-new', email: 'marie@martin.test' })
    expect(admin.sendSignInCode).toHaveBeenCalledWith('marie@martin.test')
  })

  it('exige un client pour un site qui n en a pas', async () => {
    repository.findSiteLink.mockResolvedValue(SITE)
    expect(await inviteMember({ siteId: 'site-1', email: 'x@y.test', client: null })).toMatchObject({ code: 'client_required' })
    expect(admin.sendSignInCode).not.toHaveBeenCalled()
  })

  it('refuse une adresse deja rattachee a un autre client, en le nommant', async () => {
    repository.findSiteLink.mockResolvedValue({ ...SITE, client_id: 'client-a' })
    repository.findMemberByEmail.mockResolvedValue(member({ client_id: 'client-b' }))
    repository.getClient.mockResolvedValue({ id: 'client-b', name: 'Électricité Durand' })

    const result = await inviteMember({ siteId: 'site-1', email: 'marie@martin.test', client: null })
    expect(result).toMatchObject({ status: 'refused', code: 'other_client' })
    expect(result.status === 'refused' && result.message).toContain('Électricité Durand')
    expect(repository.insertMember).not.toHaveBeenCalled()
  })

  it('rouvre un acces revoque : efface la revocation, ecarte les anciennes sessions, puis debloque le compte', async () => {
    repository.findSiteLink.mockResolvedValue({ ...SITE, client_id: 'client-a' })
    repository.findMemberByEmail.mockResolvedValue(member({ revoked_at: '2026-11-25T10:00:00Z' }))

    expect(await inviteMember({ siteId: 'site-1', email: 'marie@martin.test', client: null })).toEqual({ status: 'reopened' })
    expect(repository.updateMember).toHaveBeenCalledWith('member-1', { revoked_at: null, sessions_valid_after: expect.any(String) })
    expect(admin.setUserBanned).toHaveBeenCalledWith('user-1', false)
    expect(repository.updateMember.mock.invocationCallOrder[0]).toBeLessThan(admin.setUserBanned.mock.invocationCallOrder[0])
  })

  it('dit quand Supabase refuse un second e-mail dans la minute', async () => {
    repository.findSiteLink.mockResolvedValue({ ...SITE, client_id: 'client-a' })
    repository.findMemberByEmail.mockResolvedValue(member())
    admin.sendSignInCode.mockResolvedValue({ ok: false, reason: 'too_soon' })

    expect(await inviteMember({ siteId: 'site-1', email: 'marie@martin.test', client: null })).toMatchObject({ code: 'code_too_soon' })
  })

  it('ne rattache pas un site a deux clients quand deux invitations se croisent', async () => {
    repository.findSiteLink
      .mockResolvedValueOnce(SITE)
      .mockResolvedValueOnce({ ...SITE, client_id: 'client-other' })
    repository.getClient.mockResolvedValue({ id: 'client-a', name: 'A' })
    repository.attachSiteToClient.mockResolvedValue(false)

    const result = await inviteMember({ siteId: 'site-1', email: 'x@y.test', client: { kind: 'existing', id: 'client-a' } })
    expect(result).toMatchObject({ code: 'site_has_other_client' })
    expect(repository.insertMember).not.toHaveBeenCalled()
  })
})

describe('revokeMember', () => {
  it('retire l acces puis bloque le compte', async () => {
    repository.findSiteLink.mockResolvedValue({ ...SITE, client_id: 'client-a' })
    repository.findMemberOfClient.mockResolvedValue(member())

    expect(await revokeMember('site-1', 'member-1')).toBe('revoked')
    expect(repository.updateMember).toHaveBeenCalledWith('member-1', { revoked_at: expect.any(String), sessions_valid_after: expect.any(String) })
    expect(admin.setUserBanned).toHaveBeenCalledWith('user-1', true)
    expect(repository.updateMember.mock.invocationCallOrder[0]).toBeLessThan(admin.setUserBanned.mock.invocationCallOrder[0])
  })

  it('ignore un membre d un autre client, et un site sans client', async () => {
    repository.findSiteLink.mockResolvedValueOnce({ ...SITE, client_id: 'client-a' })
    repository.findMemberOfClient.mockResolvedValue(null)
    expect(await revokeMember('site-1', 'member-x')).toBe('not_found')

    repository.findSiteLink.mockResolvedValueOnce(SITE)
    expect(await revokeMember('site-1', 'member-1')).toBe('not_found')
    expect(admin.setUserBanned).not.toHaveBeenCalled()
  })
})

describe('loadSiteAccess', () => {
  it('montre les membres et leur etat, et les autres sites du client', async () => {
    repository.findSiteLink.mockResolvedValue({ ...SITE, client_id: 'client-a' })
    repository.getClient.mockResolvedValue({ id: 'client-a', name: 'Martin Bâtiment' })
    repository.listMembers.mockResolvedValue([member({ last_login_at: '2026-11-20T09:00:00Z' }), member({ id: 'member-2', email: 'paul@martin.test' })])
    repository.listClientSites.mockResolvedValue([
      { id: 'site-1', name: 'Plomberie Martin', url: 'https://a.test' },
      { id: 'site-2', name: 'Toitures Lambert', url: 'https://b.test' },
    ])

    const access = await loadSiteAccess('site-1')
    expect(access?.members.map((m) => [m.email, m.state])).toEqual([['marie@martin.test', 'active'], ['paul@martin.test', 'pending']])
    expect(access?.otherSites).toEqual([{ id: 'site-2', name: 'Toitures Lambert' }])
    expect(repository.listClients).not.toHaveBeenCalled()
  })
})
