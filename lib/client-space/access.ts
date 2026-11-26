// ─────────────────────────────────────────────────────────────────────────────
// Who has access to a site — the operator's side
// docs/cadrage.md ACC-1, ACC-4, ACC-7. Behind the Basic gate (proxy.ts).
// ─────────────────────────────────────────────────────────────────────────────
//
// From a site's « Réglages », the operator attaches the site to a client (an
// existing one, or one created on the spot), invites addresses, and revokes
// them. Every member of a client sees every site of that client.
//
// No transaction spans these steps: they cross Supabase Auth and the database,
// which share none. They are ordered so that a failure half-way leaves only
// harmless, re-playable state — a client with no member, an Auth account with
// no membership (found again by ensureConfirmedUser on the next attempt) —
// and never a member who could enter a space they should not.

import {
  memberState,
  planInvitation,
  type MemberState,
} from '@/src/core/domain/client-access/policy'
import { ensureConfirmedUser, sendSignInCode, setUserBanned } from './auth-admin'
import {
  attachSiteToClient,
  findMemberByEmail,
  findMemberOfClient,
  findSiteLink,
  getClient,
  insertClient,
  insertMember,
  listClientSites,
  listClients,
  listMembers,
  updateMember,
  type ClientRow,
} from './repository'

export interface MemberView {
  id: string
  email: string
  state: MemberState
  lastLoginAt: string | null
}

export interface SiteAccess {
  siteId: string
  siteName: string
  client: ClientRow | null
  members: MemberView[]
  /** The client's OTHER sites: what a member sees besides this one. */
  otherSites: Array<{ id: string; name: string }>
  /** For the picker, when the site has no client yet. */
  clients: ClientRow[]
}

export async function loadSiteAccess(siteId: string): Promise<SiteAccess | null> {
  const site = await findSiteLink(siteId)
  if (!site) return null

  if (!site.client_id) {
    return { siteId, siteName: site.name, client: null, members: [], otherSites: [], clients: await listClients() }
  }

  const [client, members, sites] = await Promise.all([
    getClient(site.client_id),
    listMembers(site.client_id),
    listClientSites(site.client_id),
  ])
  return {
    siteId,
    siteName: site.name,
    client,
    members: members.map((member) => ({
      id: member.id,
      email: member.email,
      state: memberState(member),
      lastLoginAt: member.last_login_at,
    })),
    otherSites: sites.filter((other) => other.id !== siteId).map(({ id, name }) => ({ id, name })),
    clients: [],
  }
}

export type ClientChoice = { kind: 'existing'; id: string } | { kind: 'new'; name: string }

export type InviteResult =
  | { status: 'invited' | 'reopened' | 'resent' }
  | { status: 'refused'; code: InviteRefusal; message: string }

export type InviteRefusal =
  | 'site_not_found'
  | 'client_required'
  | 'client_not_found'
  | 'site_has_other_client'
  | 'other_client'
  | 'code_too_soon'
  | 'send_failed'

const refuse = (code: InviteRefusal, message: string): InviteResult => ({ status: 'refused', code, message })

/** `email` normalised by the caller. `client` is read only when the site has no client yet. */
export async function inviteMember(input: { siteId: string; email: string; client: ClientChoice | null }): Promise<InviteResult> {
  const site = await findSiteLink(input.siteId)
  if (!site) return refuse('site_not_found', 'Site introuvable.')

  const resolved = await resolveClient(site.id, site.client_id, input.client)
  if ('refusal' in resolved) return resolved.refusal
  const clientId = resolved.clientId

  const existing = await findMemberByEmail(input.email)
  const plan = planInvitation(existing, clientId)

  if (plan === 'other_client') {
    const other = existing ? await getClient(existing.client_id) : null
    return refuse('other_client', `Cette adresse a déjà accès à l’espace de « ${other?.name ?? 'un autre client'} ». Une adresse n’ouvre qu’un espace.`)
  }

  if (plan === 'create') {
    const userId = await ensureConfirmedUser(input.email)
    await insertMember({ client_id: clientId, user_id: userId, email: input.email })
  } else if (plan === 'reopen' && existing) {
    // Sessions from before the revocation stay dead: only a code typed from
    // now on opens the space again.
    await updateMember(existing.id, { revoked_at: null, sessions_valid_after: new Date().toISOString() })
    await setUserBanned(existing.user_id, false)
  }

  // Awaited, unlike the sign-in page: the operator is waiting to know whether
  // the e-mail left, and an asynchronous queue arrives with the L7.
  const sent = await sendSignInCode(input.email)
  if (!sent.ok && sent.reason === 'too_soon') {
    return refuse('code_too_soon', 'Accès ouvert, mais un code vient déjà de partir vers cette adresse : réessayez l’envoi dans une minute.')
  }
  if (!sent.ok) {
    console.warn(`[access] e-mail d'acces non envoye (site ${site.id}) : ${sent.detail}`)
    return refuse('send_failed', 'Accès ouvert, mais l’e-mail n’est pas parti. Vérifiez la configuration d’envoi de Supabase, puis renvoyez le code.')
  }

  return { status: plan === 'create' ? 'invited' : plan === 'reopen' ? 'reopened' : 'resent' }
}

async function resolveClient(
  siteId: string,
  currentClientId: string | null,
  choice: ClientChoice | null,
): Promise<{ clientId: string } | { refusal: InviteResult }> {
  if (currentClientId) {
    if (choice?.kind === 'existing' && choice.id !== currentClientId) {
      return { refusal: refuse('site_has_other_client', 'Ce site est déjà rattaché à un autre client.') }
    }
    return { clientId: currentClientId }
  }

  if (!choice) return { refusal: refuse('client_required', 'Choisissez le client de ce site, ou créez-le.') }

  let clientId: string
  if (choice.kind === 'existing') {
    const client = await getClient(choice.id)
    if (!client) return { refusal: refuse('client_not_found', 'Ce client n’existe plus.') }
    clientId = client.id
  } else {
    clientId = (await insertClient(choice.name)).id
  }

  if (await attachSiteToClient(siteId, clientId)) return { clientId }

  // Someone attached the site in between: their client stands.
  const now = await findSiteLink(siteId)
  if (now?.client_id && now.client_id === clientId) return { clientId }
  return { refusal: refuse('site_has_other_client', 'Ce site vient d’être rattaché à un autre client : rechargez la page.') }
}

/**
 * Takes effect at once: `revoked_at` first, which every request of the space
 * reads (session.ts), then the Auth ban, which kills the session itself and
 * stops new codes. A member of another client is `not_found` — the operator
 * acts from a site, and only on that site's client.
 */
export async function revokeMember(siteId: string, memberId: string): Promise<'revoked' | 'not_found'> {
  const site = await findSiteLink(siteId)
  if (!site?.client_id) return 'not_found'
  const member = await findMemberOfClient(site.client_id, memberId)
  if (!member) return 'not_found'

  const now = new Date().toISOString()
  if (!member.revoked_at) await updateMember(member.id, { revoked_at: now, sessions_valid_after: now })
  await setUserBanned(member.user_id, true)
  return 'revoked'
}
