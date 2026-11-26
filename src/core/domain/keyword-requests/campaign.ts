// ─────────────────────────────────────────────────────────────────────────────
// Which campaign a site's requests are judged against
// ─────────────────────────────────────────────────────────────────────────────
//
// A client site normally has one campaign; a site that was re-planned can keep
// older ones. One rule, used by the form (the towns it proposes) and by the
// analysis (the zone and the plan it confronts): the campaign that is running
// a cycle and is active, then active, then running a cycle, then the newest.

export interface CampaignCandidate {
  isActive: boolean
  hasCycle: boolean
  createdAt: string
}

function rank(campaign: CampaignCandidate): number {
  return (campaign.isActive ? 2 : 0) + (campaign.hasCycle ? 1 : 0)
}

export function pickRequestCampaign<T extends CampaignCandidate>(campaigns: readonly T[]): T | null {
  const sorted = [...campaigns].sort((a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt))
  return sorted[0] ?? null
}
