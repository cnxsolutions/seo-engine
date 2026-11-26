// ─────────────────────────────────────────────────────────────────────────────
// A client's keyword requests, as their space shows them (L3 — KW-6 to KW-9)
// ─────────────────────────────────────────────────────────────────────────────
//
// Takes the ClientSiteDto that lib/client-space/scope.ts hands out, never an
// id. What leaves for the browser is a ClientRequestView: the operator's
// reasons and the raw evidence stay on the server.

import { targetCommunes, isNationalCampaign } from '@/lib/geo/scope'
import { clientRequestView, type ClientRequestView } from '@/src/core/domain/keyword-requests/client-view'
import { listSiteCampaigns, listSiteRequests, pickSiteCampaign } from '@/lib/keyword-requests/repository'
import type { ClientSiteDto } from './dto'

export const REQUESTS_PER_SCREEN = 20

export async function readSiteRequests(
  site: ClientSiteDto,
  page: { offset: number; limit: number },
): Promise<{ requests: ClientRequestView[]; total: number }> {
  const { rows, total } = await listSiteRequests(site.id, page)
  return { requests: rows.map(clientRequestView), total }
}

export interface RequestZone {
  national: boolean
  /** The towns the form proposes: the communes of the campaign requests are judged against. */
  communes: string[]
}

/** The zone of the site's campaign; null for a site without one. */
export async function readRequestZone(site: ClientSiteDto): Promise<RequestZone | null> {
  const campaign = pickSiteCampaign(await listSiteCampaigns([site.id]), site.id)
  if (!campaign) return null
  return { national: isNationalCampaign(campaign), communes: targetCommunes(campaign.communes) }
}
