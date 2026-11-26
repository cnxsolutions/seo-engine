// ─────────────────────────────────────────────────────────────────────────────
// CNX arbitrates a request from the console — KW-10
// ─────────────────────────────────────────────────────────────────────────────
//
// The domain says which gesture a status allows and what it writes
// (arbitration.ts); this layer reads the request, gives a campaign to one that
// had none (a site with no campaign when the request arrived: the queue it
// goes back to is a campaign's), and writes the decision only if the request
// is still where the console saw it.
//
// « Integrate » only MARKS the request: the brief is written by the model in
// the requests task (placement.ts, placeRequestedByOperator), within two
// minutes — never inside the operator's click.

import { operatorDecision, type DecisionProblem, type OperatorAction } from '@/src/core/domain/keyword-requests/arbitration'
import type { RequestStatus } from '@/src/core/domain/keyword-requests/lifecycle'
import {
  applyOperatorDecision,
  getRequestForArbitration,
  listSiteCampaigns,
  pickSiteCampaign,
} from './repository'

export type ArbitrationOutcome =
  | { kind: 'done'; status: RequestStatus; reasonCode: string }
  | { kind: 'not_found' }
  /** The request moved between the screen and the click: the console reloads it. */
  | { kind: 'changed' }
  | { kind: 'problem'; problem: DecisionProblem | 'no_campaign' }

export async function arbitrate(input: { requestId: string; action: OperatorAction; reason?: string | null }): Promise<ArbitrationOutcome> {
  const request = await getRequestForArbitration(input.requestId)
  if (!request) return { kind: 'not_found' }

  const result = operatorDecision(input.action, request.status, input.reason)
  if (!result.ok) return { kind: 'problem', problem: result.problem }
  const { decision } = result

  // Back to a campaign's queue: it needs a campaign.
  let campaignId: string | null = null
  if (decision.status === 'deferred' && !request.campaign_id) {
    const campaign = pickSiteCampaign(await listSiteCampaigns([request.site_id]), request.site_id)
    if (!campaign) return { kind: 'problem', problem: 'no_campaign' }
    campaignId = campaign.id
  }

  const written = await applyOperatorDecision(request.id, decision, campaignId)
  return written ? { kind: 'done', status: decision.status, reasonCode: decision.reason_code } : { kind: 'changed' }
}
