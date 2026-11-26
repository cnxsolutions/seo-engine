// ─────────────────────────────────────────────────────────────────────────────
// A member proposes keywords — KW-1, KW-2
// ─────────────────────────────────────────────────────────────────────────────
//
// From the session, never from an id the browser sent alone: the site is
// resolved by lib/client-space/scope.ts, and a site of another client is
// `not_found` — the route answers 404. The verdict comes later, from the
// scheduler (analyze.ts): a submission only checks, counts and stores.

import { createRateLimiter, type RateLimiter } from '@/lib/rate-limit'
import { findMemberSite } from '@/lib/client-space/scope'
import type { ClientSession } from '@/lib/client-space/session'
import {
  OPEN_REQUESTS_PER_SITE,
  REQUEST_SUBMISSIONS,
  checkSubmission,
  type SubmissionInput,
  type SubmissionProblem,
} from '@/src/core/domain/keyword-requests/normalize'
import { submitRequests, withdrawRequest, type SubmitOutcome } from './repository'

export type SubmitResult =
  | { kind: 'not_found' }
  | { kind: 'invalid'; problems: SubmissionProblem[] }
  | { kind: 'limited'; retryAfterSeconds: number }
  | { kind: 'done'; outcomes: SubmitOutcome[] }

/** Per member, in memory: one instance (CLAUDE.md), and the ceiling of open requests stands behind it in the database. */
const submissions: RateLimiter = createRateLimiter(REQUEST_SUBMISSIONS)

export async function submitForMember(input: {
  session: ClientSession
  siteId: string
  body: SubmissionInput
  now?: Date
  limiter?: RateLimiter
}): Promise<SubmitResult> {
  const check = checkSubmission(input.body, input.now)
  if (!check.ok) return { kind: 'invalid', problems: check.problems }

  const verdict = (input.limiter ?? submissions).hit(`member:${input.session.memberId}`)
  if (!verdict.allowed) return { kind: 'limited', retryAfterSeconds: verdict.retryAfterSeconds }

  const site = await findMemberSite(input.session, input.siteId)
  if (!site) return { kind: 'not_found' }

  const outcomes = await submitRequests({
    clientId: input.session.clientId,
    siteId: site.id,
    memberId: input.session.memberId,
    items: check.items,
    city: check.city,
    note: check.note,
    desiredBy: check.desiredBy,
    openMax: OPEN_REQUESTS_PER_SITE,
  })
  return { kind: 'done', outcomes }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** KW-9. `locked`: the page is being written — the route answers 409 with the reason. */
export async function withdrawForMember(input: {
  session: ClientSession
  siteId: string
  requestId: string
}): Promise<'withdrawn' | 'not_found' | 'locked'> {
  if (!UUID.test(input.requestId)) return 'not_found'
  const site = await findMemberSite(input.session, input.siteId)
  if (!site) return 'not_found'
  return withdrawRequest(site.id, input.requestId)
}
