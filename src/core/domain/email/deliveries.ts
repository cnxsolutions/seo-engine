// ─────────────────────────────────────────────────────────────────────────────
// Who receives what — the e-mails of the keyword requests (KW-12, L7)
// docs/cadrage.md decisions 20 to 22, migration 027
// ─────────────────────────────────────────────────────────────────────────────
//
// The outbox holds one row per « this request reached this status ». This
// module turns the rows due now into deliveries, and says why the others do not
// leave. Pure: no clock, no database, no SMTP — lib/email/send-due.ts reads,
// sends and writes around it.
//
// The rules, in the order they are checked:
//   1. a row older than a day is dropped: a « votre demande est prévue » that
//      arrives a week late (the SMTP was down, the variable missing) misleads
//      more than it informs — the space says the truth meanwhile;
//   2. a row whose request has moved on is dropped: its new status has its own
//      row, and the client hears the latest news, not the history;
//   3. a client row goes to the member who sent the request (decision 21), if
//      they still have access and have not unsubscribed;
//   4. an operator row goes to OPERATOR_EMAIL (decision 22), if it is set.
// What remains is grouped by recipient: several news of the same pass leave in
// ONE e-mail (decision 20).

import type { RequestRecord } from '../keyword-requests/client-view'

export type OutboxKind = 'client_request' | 'operator_review'

export interface OutboxMember {
  id: string
  email: string
  revokedAt: string | null
  optedOutAt: string | null
  unsubscribeToken: string
}

export interface OutboxEntry {
  id: string
  kind: OutboxKind
  /** The status this row announces. */
  requestStatus: string
  attempts: number
  createdAt: string
  request: RequestRecord & { siteId: string; siteName: string }
  /** The member who sent the request; null when they were deleted. */
  member: OutboxMember | null
}

export type SkipReason = 'too_old' | 'superseded' | 'no_member' | 'member_revoked' | 'opted_out' | 'no_operator_address'

export interface ClientDelivery {
  kind: 'client'
  to: string
  memberId: string
  unsubscribeToken: string
  entries: OutboxEntry[]
}

export interface OperatorDelivery {
  kind: 'operator'
  to: string
  entries: OutboxEntry[]
}

export type Delivery = ClientDelivery | OperatorDelivery

export interface DeliveryPlan {
  deliveries: Delivery[]
  skipped: Array<{ id: string; reason: SkipReason }>
}

/** A day: past it, a status announcement is history, not news. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

export function planDeliveries(
  entries: readonly OutboxEntry[],
  options: { now: Date; operatorEmail: string | null },
): DeliveryPlan {
  const skipped: DeliveryPlan['skipped'] = []
  const clients = new Map<string, ClientDelivery>()
  let operator: OperatorDelivery | null = null

  const ordered = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const entry of ordered) {
    const reason = skipReason(entry, options)
    if (reason) {
      skipped.push({ id: entry.id, reason })
      continue
    }

    if (entry.kind === 'operator_review') {
      // skipReason has already refused an operator row without an address.
      if (!options.operatorEmail) continue
      operator ??= { kind: 'operator', to: options.operatorEmail, entries: [] }
      operator.entries.push(entry)
      continue
    }

    // skipReason has already refused a client row without a member.
    const member = entry.member
    if (!member) continue
    const delivery = clients.get(member.id) ?? {
      kind: 'client',
      to: member.email,
      memberId: member.id,
      unsubscribeToken: member.unsubscribeToken,
      entries: [],
    }
    delivery.entries.push(entry)
    clients.set(member.id, delivery)
  }

  return { deliveries: [...clients.values(), ...(operator ? [operator] : [])], skipped }
}

function skipReason(entry: OutboxEntry, options: { now: Date; operatorEmail: string | null }): SkipReason | null {
  if (options.now.getTime() - Date.parse(entry.createdAt) > MAX_AGE_MS) return 'too_old'
  if (entry.request.status !== entry.requestStatus) return 'superseded'
  if (entry.kind === 'operator_review') return options.operatorEmail ? null : 'no_operator_address'
  if (!entry.member) return 'no_member'
  if (entry.member.revokedAt) return 'member_revoked'
  if (entry.member.optedOutAt) return 'opted_out'
  return null
}

// ── When the SMTP refuses ────────────────────────────────────────────────────

/** Attempts before a row is given up: with the delays below, about three hours. */
export const MAX_ATTEMPTS = 5

const RETRY_DELAYS_MIN = [2, 10, 30, 120] as const

/**
 * What a refused send becomes: tried again later, or given up. `attempts` is
 * the count BEFORE this failure.
 */
export function afterFailure(attempts: number, now: Date): { attempts: number; giveUp: boolean; nextAttemptAt: string } {
  const next = attempts + 1
  const delay = RETRY_DELAYS_MIN[Math.min(next - 1, RETRY_DELAYS_MIN.length - 1)]
  return {
    attempts: next,
    giveUp: next >= MAX_ATTEMPTS,
    nextAttemptAt: new Date(now.getTime() + delay * 60_000).toISOString(),
  }
}
