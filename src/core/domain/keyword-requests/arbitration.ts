// ─────────────────────────────────────────────────────────────────────────────
// CNX arbitrates a request — KW-10, decision 1, docs/cadrage.md § 3.3
// ─────────────────────────────────────────────────────────────────────────────
//
// The engine settles the clear cases; what it sends to CNX (`review`), what it
// kept or found covered, CNX may turn around as long as no page is being
// written. Four gestures, each allowed only from the statuses § 3.3 allows:
//
//   integrate  review | deferred | covered → deferred, marked for the cycle in
//              progress: the requests task tries it within two minutes (the
//              brief is written by the model, never inside the click), and
//              keeps it for the next period when no slot can take it;
//   defer      review | covered → deferred: the next plan takes it first;
//   decline    review → declined, with a reason written FOR THE CLIENT —
//              mandatory, shown as is (§ 3.3);
//   reopen     declined → review.

import { canTransition, type RequestStatus } from './lifecycle'

export type OperatorAction = 'integrate' | 'defer' | 'decline' | 'reopen'

/** The reason a declined request shows its client: long enough to say something, short enough to read. */
export const DECLINE_REASON_CHARS = { min: 10, max: 500 } as const

/** Marks a request CNX wants in the cycle in progress; the requests task picks it up. */
export const INTEGRATE_REASON_CODE = 'OPERATOR_INTEGRATE'

const ACTIONS: Readonly<Record<OperatorAction, { from: readonly RequestStatus[]; to: RequestStatus }>> = {
  integrate: { from: ['review', 'deferred', 'covered'], to: 'deferred' },
  defer: { from: ['review', 'covered'], to: 'deferred' },
  decline: { from: ['review'], to: 'declined' },
  reopen: { from: ['declined'], to: 'review' },
}

export function operatorActions(status: RequestStatus): OperatorAction[] {
  return (Object.keys(ACTIONS) as OperatorAction[]).filter((action) => ACTIONS[action].from.includes(status))
}

export interface OperatorDecision {
  from: RequestStatus
  status: RequestStatus
  reason_code: string
  /** For `declined`, the first one is what the client reads. */
  reasons: string[]
  /** Back to a queue: whatever plan the request pointed at no longer holds it. */
  detach: boolean
}

export type DecisionProblem = 'not_allowed' | 'reason_required' | 'reason_too_long'

export function operatorDecision(
  action: OperatorAction,
  status: RequestStatus,
  reason?: string | null,
): { ok: true; decision: OperatorDecision } | { ok: false; problem: DecisionProblem } {
  const rule = ACTIONS[action]
  // A deferred request asked into the cycle stays deferred: the step is the mark, not the status.
  const allowed = rule.from.includes(status) && (status === rule.to || canTransition(status, rule.to))
  if (!allowed) return { ok: false, problem: 'not_allowed' }

  switch (action) {
    case 'integrate':
      return decided(status, rule.to, INTEGRATE_REASON_CODE, ['Intégration au cycle en cours demandée par CNX.'])
    case 'defer':
      return decided(status, rule.to, 'OPERATOR_DEFERRED', ['Reportée au cycle suivant par CNX : le prochain plan la prend en premier.'])
    case 'reopen':
      return decided(status, rule.to, 'OPERATOR_REOPENED', ['Rouverte par CNX.'])
    case 'decline': {
      const text = (reason ?? '').replace(/\s+/g, ' ').trim()
      if (text.length < DECLINE_REASON_CHARS.min) return { ok: false, problem: 'reason_required' }
      if (text.length > DECLINE_REASON_CHARS.max) return { ok: false, problem: 'reason_too_long' }
      return decided(status, rule.to, 'OPERATOR_DECLINED', [text])
    }
  }
}

function decided(from: RequestStatus, status: RequestStatus, reasonCode: string, reasons: string[]) {
  return { ok: true as const, decision: { from, status, reason_code: reasonCode, reasons, detach: true } }
}
