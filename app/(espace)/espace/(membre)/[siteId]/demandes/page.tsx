import type { Metadata } from 'next'
import Link from 'next/link'
import { REQUEST_TEXT } from '@/lib/client-space/labels'
import { REQUESTS_PER_SCREEN, readRequestZone, readSiteRequests } from '@/lib/client-space/requests'
import { parisDay } from '@/src/core/domain/client-space/overview'
import { DESIRED_BY_MAX_DAYS } from '@/src/core/domain/keyword-requests/normalize'
import { currentSite } from '../current-site'
import { readPageNumber } from '@/lib/page-number'
import { RequestBoard } from './RequestBoard'

export const metadata: Metadata = { title: 'Demandes' }

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * /espace/<site>/demandes — KW-1 to KW-9: propose keywords, follow what the
 * engine concluded, take a request back. Twenty requests a screen, newest first.
 */
export default async function SiteRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { siteId } = await params
  const pageNumber = readPageNumber((await searchParams).page)
  const { site } = await currentSite(siteId)
  const [{ requests, total }, zone] = await Promise.all([
    readSiteRequests(site, { offset: (pageNumber - 1) * REQUESTS_PER_SCREEN, limit: REQUESTS_PER_SCREEN }),
    readRequestZone(site),
  ])
  const now = new Date()
  const lastPage = Math.max(1, Math.ceil(total / REQUESTS_PER_SCREEN))
  const href = (n: number) => (n === 1 ? `/espace/${site.id}/demandes#demandes-liste` : `/espace/${site.id}/demandes?page=${n}#demandes-liste`)

  return (
    <>
      <header className="espace-results__head">
        <p className="eyebrow">{REQUEST_TEXT.eyebrow}</p>
        <h1 className="espace-page-title">{REQUEST_TEXT.title}</h1>
      </header>

      <RequestBoard
        siteId={site.id}
        zone={zone}
        requests={requests}
        today={parisDay(now)}
        lastDay={parisDay(new Date(now.getTime() + DESIRED_BY_MAX_DAYS * DAY_MS))}
      >
        {lastPage > 1 && (
          <nav className="espace-pager" aria-label="Demandes, suite">
            {pageNumber > 1 ? <Link href={href(pageNumber - 1)} className="btn-secondary btn-sm">Plus récentes</Link> : <span />}
            <span className="espace-pager__where">{pageNumber} / {lastPage}</span>
            {pageNumber < lastPage ? <Link href={href(pageNumber + 1)} className="btn-secondary btn-sm">Plus anciennes</Link> : <span />}
          </nav>
        )}
      </RequestBoard>
    </>
  )
}
