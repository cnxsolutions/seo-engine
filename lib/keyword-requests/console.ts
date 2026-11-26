// ─────────────────────────────────────────────────────────────────────────────
// What the console's « Demandes » screens read — KW-10
// ─────────────────────────────────────────────────────────────────────────────
//
// One reader for the cross-site queue (/demandes) and each site's tab
// (/sites/<id>/demandes): the same filter, order and page size, so the two
// screens cannot disagree about what « à examiner » means.

import { createServiceClient } from '@/lib/supabase'
import { countRequestsToReview, listOperatorRequests } from './repository'
import { QUEUE_PAGE_SIZE, queueItem, type QueueItem, type QueueView } from './queue'

export interface QueueScreen {
  items: QueueItem[]
  total: number
  lastPage: number
  /** For the « À examiner » filter, whatever filter is shown. */
  reviewCount: number
}

export async function readQueue(input: { view: QueueView; siteId: string | null; page: number }): Promise<QueueScreen> {
  const [{ rows, total }, reviewCount] = await Promise.all([
    listOperatorRequests(
      {
        statuses: input.view === 'review' ? ['review'] : null,
        siteId: input.siteId,
        order: input.view === 'review' ? 'oldest' : 'newest',
      },
      { offset: (input.page - 1) * QUEUE_PAGE_SIZE, limit: QUEUE_PAGE_SIZE },
    ),
    countRequestsToReview(input.siteId),
  ])
  return {
    items: rows.map(queueItem),
    total,
    lastPage: Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE)),
    reviewCount,
  }
}

/** The sites a request can come from, for the site filter: two columns, never the credentials. */
export async function listSiteOptions(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await createServiceClient()
    .from('sites')
    .select('id,name')
    .order('name', { ascending: true })
    .limit(500)
  if (error) throw new Error(`[demandes] sites : ${error.message}`)
  return (data ?? []) as Array<{ id: string; name: string }>
}
