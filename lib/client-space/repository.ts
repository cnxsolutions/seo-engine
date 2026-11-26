// ─────────────────────────────────────────────────────────────────────────────
// Clients, members and the sites they own — data access
// Migration 022. Service key, server side only.
// ─────────────────────────────────────────────────────────────────────────────
//
// Nothing here decides who may see what: lib/client-space/scope.ts does, for
// members, and the operator routes sit behind the Basic gate. Every function
// selects its columns by name (no `*`), and every list is bounded.

import { createServiceClient } from '@/lib/supabase'
import { CLIENT_SITE_COLUMNS, type ClientSiteRow } from './dto'

const MEMBER_COLUMNS = 'id,client_id,user_id,email,last_login_at,revoked_at,created_at'
const CLIENT_COLUMNS = 'id,name'

/** More members than this on one client is not a list a screen can show. */
const MEMBERS_PER_CLIENT_MAX = 100
/** The operator's client picker. Past this, it needs a search, not a longer list. */
const CLIENTS_MAX = 500
/** Sites of one client. Past this, it is a portfolio and wants pagination. */
const SITES_PER_CLIENT_MAX = 100

export interface MemberRow {
  id: string
  client_id: string
  user_id: string
  email: string
  last_login_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface ClientRow {
  id: string
  name: string
}

export interface SiteLink {
  id: string
  name: string
  client_id: string | null
}

function fail(action: string, message: string): never {
  throw new Error(`[client-space] ${action} : ${message}`)
}

// ── Members ───────────────────────────────────────────────────────────

export async function findMemberByUserId(userId: string): Promise<MemberRow | null> {
  const { data, error } = await createServiceClient()
    .from('client_members').select(MEMBER_COLUMNS).eq('user_id', userId).maybeSingle()
  if (error) fail('lecture du membre', error.message)
  return (data as MemberRow | null) ?? null
}

/** `email` must already be normalised (normalizeEmail): the column only holds lower-case. */
export async function findMemberByEmail(email: string): Promise<MemberRow | null> {
  const { data, error } = await createServiceClient()
    .from('client_members').select(MEMBER_COLUMNS).eq('email', email).maybeSingle()
  if (error) fail('lecture du membre', error.message)
  return (data as MemberRow | null) ?? null
}

export async function findMemberOfClient(clientId: string, memberId: string): Promise<MemberRow | null> {
  const { data, error } = await createServiceClient()
    .from('client_members').select(MEMBER_COLUMNS).eq('client_id', clientId).eq('id', memberId).maybeSingle()
  if (error) fail('lecture du membre', error.message)
  return (data as MemberRow | null) ?? null
}

export async function listMembers(clientId: string): Promise<MemberRow[]> {
  const { data, error } = await createServiceClient()
    .from('client_members').select(MEMBER_COLUMNS).eq('client_id', clientId)
    .order('created_at', { ascending: true }).limit(MEMBERS_PER_CLIENT_MAX)
  if (error) fail('liste des membres', error.message)
  return (data as MemberRow[] | null) ?? []
}

export async function insertMember(values: { client_id: string; user_id: string; email: string }): Promise<MemberRow> {
  const { data, error } = await createServiceClient()
    .from('client_members').insert(values).select(MEMBER_COLUMNS).single()
  if (error) fail('creation du membre', error.message)
  return data as MemberRow
}

export async function updateMember(
  id: string,
  values: Partial<Pick<MemberRow, 'last_login_at' | 'revoked_at'>>,
): Promise<void> {
  const { error } = await createServiceClient().from('client_members').update(values).eq('id', id)
  if (error) fail('mise a jour du membre', error.message)
}

// ── Clients ───────────────────────────────────────────────────────────

export async function getClient(id: string): Promise<ClientRow | null> {
  const { data, error } = await createServiceClient()
    .from('clients').select(CLIENT_COLUMNS).eq('id', id).maybeSingle()
  if (error) fail('lecture du client', error.message)
  return (data as ClientRow | null) ?? null
}

export async function listClients(): Promise<ClientRow[]> {
  const { data, error } = await createServiceClient()
    .from('clients').select(CLIENT_COLUMNS).order('name', { ascending: true }).limit(CLIENTS_MAX)
  if (error) fail('liste des clients', error.message)
  return (data as ClientRow[] | null) ?? []
}

export async function insertClient(name: string): Promise<ClientRow> {
  const { data, error } = await createServiceClient()
    .from('clients').insert({ name }).select(CLIENT_COLUMNS).single()
  if (error) fail('creation du client', error.message)
  return data as ClientRow
}

// ── Sites ─────────────────────────────────────────────────────────────

export async function findSiteLink(siteId: string): Promise<SiteLink | null> {
  const { data, error } = await createServiceClient()
    .from('sites').select('id,name,client_id').eq('id', siteId).maybeSingle()
  if (error) fail('lecture du site', error.message)
  return (data as SiteLink | null) ?? null
}

/**
 * Attaches a site to a client only if it has none yet. Two operators inviting
 * at once cannot attach the same site to two clients: the second update
 * matches no row, and the caller re-reads which client won.
 */
export async function attachSiteToClient(siteId: string, clientId: string): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from('sites').update({ client_id: clientId }).eq('id', siteId).is('client_id', null).select('id')
  if (error) fail('rattachement du site', error.message)
  return (data ?? []).length > 0
}

/** The sites of a client, as a member may see them — CLIENT_SITE_COLUMNS only. */
export async function listClientSites(clientId: string): Promise<ClientSiteRow[]> {
  const { data, error } = await createServiceClient()
    .from('sites').select(CLIENT_SITE_COLUMNS).eq('client_id', clientId)
    .order('name', { ascending: true }).limit(SITES_PER_CLIENT_MAX)
  if (error) fail('liste des sites du client', error.message)
  return (data as ClientSiteRow[] | null) ?? []
}

/** One site, only if it belongs to this client: the filter IS the isolation. */
export async function findClientSite(clientId: string, siteId: string): Promise<ClientSiteRow | null> {
  const { data, error } = await createServiceClient()
    .from('sites').select(CLIENT_SITE_COLUMNS).eq('client_id', clientId).eq('id', siteId).maybeSingle()
  if (error) fail('lecture du site du client', error.message)
  return (data as ClientSiteRow | null) ?? null
}
