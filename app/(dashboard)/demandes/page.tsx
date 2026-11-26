// ─────────────────────────────────────────────────────────────────────────────
// Demandes — every client request, and what CNX decides (KW-10)
// docs/design.md § 9.5
// ─────────────────────────────────────────────────────────────────────────────
//
// Opens on what waits for CNX (« À examiner »), oldest first; « Toutes » is the
// history, newest first. The filters live in the URL. Each site's own tab
// (/sites/<id>/demandes) shows the same queue, for that site only.

import { CheckCheck, MessageSquarePlus } from 'lucide-react'
import { RequestQueue } from '@/components/RequestQueue'
import { QueuePager, QueueSiteFilter, QueueViews } from '@/components/RequestQueueChrome'
import { EmptyState, PageHeader } from '@/components/ui'
import { listSiteOptions, readQueue } from '@/lib/keyword-requests/console'
import { QUEUE_TEXT } from '@/lib/keyword-requests/operator-labels'
import { readQueueView, readSiteFilter } from '@/lib/keyword-requests/queue'
import { readPageNumber } from '@/lib/page-number'

export const dynamic = 'force-dynamic'

const BASE = '/demandes'

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const view = readQueueView(params.vue)
  const siteId = readSiteFilter(params.site)
  const page = readPageNumber(params.page)
  const [screen, sites] = await Promise.all([readQueue({ view, siteId, page }), listSiteOptions()])

  return (
    <div>
      <PageHeader icon={MessageSquarePlus} badge={QUEUE_TEXT.eyebrow} title={QUEUE_TEXT.title} subtitle={QUEUE_TEXT.subtitle} />

      <div className="request-queue-toolbar">
        <QueueViews basePath={BASE} view={view} reviewCount={screen.reviewCount} siteId={siteId} />
        <QueueSiteFilter basePath={BASE} sites={sites} siteId={siteId} view={view} />
      </div>

      {screen.items.length === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title={view === 'review' ? QUEUE_TEXT.views.review : QUEUE_TEXT.views.all}
          description={view === 'review' ? QUEUE_TEXT.emptyReview : QUEUE_TEXT.emptyAll}
        />
      ) : (
        <RequestQueue items={screen.items} showSite={siteId === null} />
      )}

      <QueuePager basePath={BASE} view={view} siteId={siteId} page={page} lastPage={screen.lastPage} />
    </div>
  )
}
