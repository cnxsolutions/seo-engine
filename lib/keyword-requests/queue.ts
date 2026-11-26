// ─────────────────────────────────────────────────────────────────────────────
// The console's queue of client requests — what one row shows (KW-10)
// ─────────────────────────────────────────────────────────────────────────────

import { INTEGRATE_REASON_CODE, operatorActions, type OperatorAction } from '@/src/core/domain/keyword-requests/arbitration'
import { safeUrl } from '@/src/core/domain/keyword-requests/client-view'
import type { RequestStatus } from '@/src/core/domain/keyword-requests/lifecycle'
import type { OperatorRequestRow } from './repository'

/** Rows per screen of the queue. */
export const QUEUE_PAGE_SIZE = 25

export interface QueueItem {
  id: string
  siteId: string
  siteName: string
  keyword: string
  city: string | null
  note: string | null
  desiredBy: string | null
  status: RequestStatus
  reasonCode: string | null
  /** The engine's or CNX's own words: an operator reads them, a client never does. */
  reason: string | null
  receivedAt: string
  scheduledFor: string | null
  publishedUrl: string | null
  waitedCycles: number
  /** CNX asked it into the cycle in progress, and the engine has not answered yet. */
  integrating: boolean
  actions: OperatorAction[]
}

export function queueItem(row: OperatorRequestRow): QueueItem {
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site?.name ?? '—',
    keyword: row.keyword,
    city: row.city,
    note: row.note,
    desiredBy: row.desired_by,
    status: row.status,
    reasonCode: row.reason_code,
    reason: row.reasons[0]?.trim() || null,
    receivedAt: row.created_at,
    scheduledFor: row.scheduled_for,
    publishedUrl: safeUrl(row.published_url),
    waitedCycles: row.deferred_cycles,
    integrating: row.status === 'deferred' && row.reason_code === INTEGRATE_REASON_CODE,
    actions: row.reason_code === INTEGRATE_REASON_CODE ? [] : operatorActions(row.status),
  }
}

export type QueueView = 'review' | 'all'

/** `?vue=`: the queue to arbitrate by default, the whole history on request. */
export function readQueueView(raw: string | string[] | undefined): QueueView {
  return (Array.isArray(raw) ? raw[0] : raw) === 'toutes' ? 'all' : 'review'
}

/** `?site=`: an id-shaped value, or none — never handed to a query unchecked. */
export function readSiteFilter(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null
}
