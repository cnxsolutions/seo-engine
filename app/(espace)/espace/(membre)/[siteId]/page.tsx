import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { formatDay } from '@/components/ui'
import { CLIENT_SPACE_TEXT } from '@/lib/client-space/labels'
import { readOnlinePages, readPeriod } from '@/lib/client-space/overview'
import { currentSite } from './current-site'
import { OnlineList, UpcomingList } from './PageLists'
import { PeriodThread } from './PeriodThread'

export const metadata: Metadata = { title: 'Accueil' }

/** The home shows a glimpse; « Pages » shows everything. */
const GLIMPSE = 3

/**
 * /espace/<site> — ESP-1: the period in progress (dates, the thread, pages
 * planned and online), the next pages, the latest pages online. The client's
 * keyword requests and the « Proposer un mot-clé » button join it in the L3.
 */
export default async function SiteHomePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  const { site } = await currentSite(siteId)
  const [period, online] = await Promise.all([
    readPeriod(site),
    readOnlinePages(site, { offset: 0, limit: GLIMPSE }),
  ])
  const pagesHref = `/espace/${site.id}/pages`

  return (
    <>
      <section className="espace-hero" aria-labelledby="periode-titre">
        <p className="espace-hero__eyebrow">{CLIENT_SPACE_TEXT.periodEyebrow}</p>
        {period ? (
          <>
            <h1 id="periode-titre" className="espace-hero__title">
              Du {formatDay(period.startDay)} au {formatDay(period.endDay)}
            </h1>
            <PeriodThread progress={period.progress} label={`${Math.round(period.progress * 100)} % de la période écoulés`} />
            <p className="espace-hero__text">
              {period.planned} {period.planned > 1 ? 'pages prévues' : 'page prévue'} · {period.published} en ligne
            </p>
          </>
        ) : (
          <>
            <h1 id="periode-titre" className="espace-hero__title">{CLIENT_SPACE_TEXT.noPeriodTitle}</h1>
            <p className="espace-hero__text">{CLIENT_SPACE_TEXT.noPeriodBody}</p>
          </>
        )}
      </section>

      {period && (
        <section aria-labelledby="prochaines-titre">
          <div className="espace-section__head">
            <h2 id="prochaines-titre" className="espace-section__title">{CLIENT_SPACE_TEXT.upcomingTitle}</h2>
            {period.upcoming.length > GLIMPSE && (
              <Link href={`${pagesHref}#prochaines`} className="espace-section__more">
                Tout voir <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </div>
          {period.upcoming.length === 0
            ? <p className="espace-empty">{CLIENT_SPACE_TEXT.upcomingEmpty}</p>
            : <UpcomingList pages={period.upcoming.slice(0, GLIMPSE)} />}
        </section>
      )}

      <section aria-labelledby="en-ligne-titre">
        <div className="espace-section__head">
          <h2 id="en-ligne-titre" className="espace-section__title">Dernières pages en ligne</h2>
          {online.total > GLIMPSE && (
            <Link href={`${pagesHref}#en-ligne`} className="espace-section__more">
              Toutes les pages <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
        {online.pages.length === 0
          ? <p className="espace-empty">{period ? CLIENT_SPACE_TEXT.onlineEmpty : CLIENT_SPACE_TEXT.onlineEmptyNoPeriod}</p>
          : <OnlineList pages={online.pages} />}
      </section>
    </>
  )
}
