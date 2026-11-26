import type { Metadata } from 'next'
import Link from 'next/link'
import { CLIENT_SPACE_TEXT } from '@/lib/client-space/labels'
import { ONLINE_PAGES_PER_SCREEN, readOnlinePages, readPeriod } from '@/lib/client-space/overview'
import { currentSite } from '../current-site'
import { OnlineList, UpcomingList } from '../PageLists'
import { readPageNumber } from '@/lib/page-number'

export const metadata: Metadata = { title: 'Pages' }

/**
 * /espace/<site>/pages — ESP-2 and ESP-3: every page still to come in the
 * period, then the pages online, twenty at a time.
 */
export default async function SitePagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { siteId } = await params
  const pageNumber = readPageNumber((await searchParams).page)
  const { site } = await currentSite(siteId)
  const [period, online] = await Promise.all([
    readPeriod(site),
    readOnlinePages(site, { offset: (pageNumber - 1) * ONLINE_PAGES_PER_SCREEN, limit: ONLINE_PAGES_PER_SCREEN }),
  ])
  const lastPage = Math.max(1, Math.ceil(online.total / ONLINE_PAGES_PER_SCREEN))
  const href = (n: number) => (n === 1 ? `/espace/${site.id}/pages#en-ligne` : `/espace/${site.id}/pages?page=${n}#en-ligne`)

  return (
    <>
      <h1 className="espace-page-title">Vos pages</h1>

      <section id="prochaines" aria-labelledby="prochaines-titre" className="espace-anchor">
        <div className="espace-section__head">
          <h2 id="prochaines-titre" className="espace-section__title">{CLIENT_SPACE_TEXT.upcomingTitle}</h2>
        </div>
        {!period
          ? <p className="espace-empty">{CLIENT_SPACE_TEXT.noPeriodBody}</p>
          : period.upcoming.length === 0
            ? <p className="espace-empty">{CLIENT_SPACE_TEXT.upcomingEmpty}</p>
            : <UpcomingList pages={period.upcoming} />}
      </section>

      <section id="en-ligne" aria-labelledby="en-ligne-titre" className="espace-anchor">
        <div className="espace-section__head">
          <h2 id="en-ligne-titre" className="espace-section__title">{CLIENT_SPACE_TEXT.onlineTitle}</h2>
          {online.total > 0 && <span className="espace-section__count">{online.total}</span>}
        </div>
        <p className="espace-section__lead">{CLIENT_SPACE_TEXT.onlineSource}</p>
        {online.pages.length === 0
          ? <p className="espace-empty">{period ? CLIENT_SPACE_TEXT.onlineEmpty : CLIENT_SPACE_TEXT.onlineEmptyNoPeriod}</p>
          : <OnlineList pages={online.pages} />}
        {lastPage > 1 && (
          <nav className="espace-pager" aria-label="Pages en ligne, suite">
            {pageNumber > 1 ? <Link href={href(pageNumber - 1)} className="btn-secondary btn-sm">Précédentes</Link> : <span />}
            <span className="espace-pager__where">{pageNumber} / {lastPage}</span>
            {pageNumber < lastPage ? <Link href={href(pageNumber + 1)} className="btn-secondary btn-sm">Suivantes</Link> : <span />}
          </nav>
        )}
      </section>
    </>
  )
}
