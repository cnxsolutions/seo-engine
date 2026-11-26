// ─────────────────────────────────────────────────────────────────────────────
// The life of a keyword request — docs/cadrage.md § 3.3
// ─────────────────────────────────────────────────────────────────────────────
//
// A state machine, and nothing else: which statuses exist, which follow which,
// which count as « open ». The database enforces the same lists (migration 024:
// the status CHECK, the partial unique index, the two functions); the
// integration test db/keyword-requests.db.test.ts holds them together.

export const REQUEST_STATUSES = [
  'received',
  'review',
  'deferred',
  'scheduled',
  'in_production',
  'published',
  'covered',
  'declined',
  'withdrawn',
] as const

export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/**
 * Still waiting for something: counted against the site's ceiling, and two of
 * them never carry the same search (the partial unique index of 024).
 */
export const OPEN_STATUSES: readonly RequestStatus[] = ['received', 'review', 'deferred', 'scheduled', 'in_production']

/**
 * § 3.3, row by row. A terminal status has no successor.
 *
 * Added at the L4, for what the engine sees happen to a planned request:
 *  - deferred → covered: the plan wrote its brief, and the guards dropped it
 *    (its keyword is already carried by a page of the site);
 *  - scheduled → published | review: the production is followed every two
 *    minutes (production.ts), and a short one can start and end in between.
 */
const TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  received: ['scheduled', 'deferred', 'covered', 'review', 'withdrawn'],
  review: ['scheduled', 'deferred', 'declined', 'withdrawn'],
  deferred: ['scheduled', 'covered', 'review', 'withdrawn'],
  scheduled: ['in_production', 'published', 'review', 'deferred', 'withdrawn'],
  in_production: ['published', 'review'],
  published: [],
  covered: ['scheduled', 'deferred'],
  declined: ['review'],
  withdrawn: [],
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** KW-9: the client takes a request back as long as nobody is writing it. */
export function canWithdraw(status: RequestStatus): boolean {
  return canTransition(status, 'withdrawn')
}

/** The statuses a withdrawal may start from, for the conditional update that performs it. */
export const WITHDRAWABLE_STATUSES: readonly RequestStatus[] = REQUEST_STATUSES.filter(canWithdraw)

/** What the engine may conclude about a request it has just received (§ 3.1). */
export const ENGINE_VERDICT_STATUSES = ['review', 'deferred', 'scheduled', 'covered'] as const satisfies readonly RequestStatus[]

export type EngineVerdictStatus = (typeof ENGINE_VERDICT_STATUSES)[number]

export function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value)
}
