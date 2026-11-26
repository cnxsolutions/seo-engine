// ─────────────────────────────────────────────────────────────────────────────
// What a member may see — the ONE place that decides it
// docs/cadrage.md § 3.7, ACC-3, QA-2
// ─────────────────────────────────────────────────────────────────────────────
//
// Every read of the client space starts here, from a ClientSession and never
// from an identifier the browser sent alone. A site outside the member's
// client is `null`, which pages and routes turn into a 404: a 403 would confirm
// to a curious member that the site exists.
//
// Tested against the local Supabase: db/client-space.db.test.ts.

import { toClientSiteDto, type ClientSiteDto } from './dto'
import { findClientSite, listClientSites } from './repository'
import type { ClientSession } from './session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listMemberSites(session: ClientSession): Promise<ClientSiteDto[]> {
  const rows = await listClientSites(session.clientId)
  return rows.map(toClientSiteDto)
}

/**
 * The site, if it belongs to the member's client; `null` otherwise — and for
 * anything that is not an identifier at all, which Postgres would otherwise
 * answer with an error, i.e. a 500 instead of a 404.
 */
export async function findMemberSite(session: ClientSession, siteId: string): Promise<ClientSiteDto | null> {
  if (!UUID.test(siteId)) return null
  const row = await findClientSite(session.clientId, siteId)
  return row ? toClientSiteDto(row) : null
}
