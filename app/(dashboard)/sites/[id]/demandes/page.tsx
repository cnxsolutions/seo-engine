// ─────────────────────────────────────────────────────────────────────────────
// L'onglet « Demandes » d'un site — les mots-clés que son client propose (KW-10)
// ─────────────────────────────────────────────────────────────────────────────
//
// La même file que /demandes, pour ce site seul : mêmes gestes, même lecture
// (lib/keyword-requests/console.ts). Le site vient du chemin, vérifié par le
// layout du site (notFound sur un identifiant inconnu).

import { CheckCheck } from 'lucide-react'
import { RequestQueue } from '@/components/RequestQueue'
import { QueuePager, QueueViews } from '@/components/RequestQueueChrome'
import { EmptyState } from '@/components/ui'
import { readQueue } from '@/lib/keyword-requests/console'
import { QUEUE_TEXT } from '@/lib/keyword-requests/operator-labels'
import { readQueueView, readSiteFilter } from '@/lib/keyword-requests/queue'
import { readPageNumber } from '@/lib/page-number'
import { TabIntro } from '../TabIntro'

export const dynamic = 'force-dynamic'

export default async function SiteRequestsTab({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams
  const siteId = readSiteFilter(id)
  if (!siteId) return null

  const view = readQueueView(query.vue)
  const page = readPageNumber(query.page)
  const screen = await readQueue({ view, siteId, page })
  const base = `/sites/${siteId}/demandes`

  return (
    <div>
      <TabIntro title={QUEUE_TEXT.siteTitle} subtitle={QUEUE_TEXT.siteSubtitle} />
      <div className="request-queue-toolbar">
        <QueueViews basePath={base} view={view} reviewCount={screen.reviewCount} siteId={null} />
      </div>

      {screen.items.length === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title={view === 'review' ? QUEUE_TEXT.views.review : QUEUE_TEXT.views.all}
          description={view === 'review' ? QUEUE_TEXT.emptyReview : QUEUE_TEXT.emptyAll}
        />
      ) : (
        <RequestQueue items={screen.items} showSite={false} />
      )}

      <QueuePager basePath={base} view={view} siteId={null} page={page} lastPage={screen.lastPage} />
    </div>
  )
}
