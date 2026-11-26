// ─────────────────────────────────────────────────────────────────────────────
// The site a member's page is about — the third check of the client space
// (docs/cadrage.md § 4.4): the site in the URL must belong to the member's
// client, or the page does not exist. Memoised per request: the layout and the
// page both ask.
// ─────────────────────────────────────────────────────────────────────────────

import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import type { ClientSiteDto } from '@/lib/client-space/dto'
import { findMemberSite, listMemberSites } from '@/lib/client-space/scope'
import { getClientSession, type ClientSession } from '@/lib/client-space/session'

export interface CurrentSite {
  session: ClientSession
  site: ClientSiteDto
  /** Every site of the member's client, for the switcher. */
  sites: ClientSiteDto[]
}

export const currentSite = cache(async (siteId: string): Promise<CurrentSite> => {
  const result = await getClientSession()
  // The member layout already sent anything else away; this narrows the type.
  if (result.status !== 'active') redirect('/espace/connexion')

  const [site, sites] = await Promise.all([
    findMemberSite(result.session, siteId),
    listMemberSites(result.session),
  ])
  if (!site) notFound()
  return { session: result.session, site, sites }
})
