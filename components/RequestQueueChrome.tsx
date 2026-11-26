// ─────────────────────────────────────────────────────────────────────────────
// Around the queue: the two views, the site filter, the pages — KW-10
// ─────────────────────────────────────────────────────────────────────────────
//
// No 'use client': the filters live in the URL, as links and a GET form. A
// filtered view is shared and survives a reload, and costs no JavaScript.

import Link from 'next/link'
import { QUEUE_TEXT } from '@/lib/keyword-requests/operator-labels'
import type { QueueView } from '@/lib/keyword-requests/queue'

function href(basePath: string, params: Record<string, string | null>): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])))
  const text = query.toString()
  return text ? `${basePath}?${text}` : basePath
}

export function QueueViews({ basePath, view, reviewCount, siteId }: {
  basePath: string
  view: QueueView
  reviewCount: number
  siteId: string | null
}) {
  return (
    <nav className="request-queue-views" aria-label={QUEUE_TEXT.viewsLabel}>
      <Link
        href={href(basePath, { site: siteId })}
        className={`request-queue-views__item${view === 'review' ? ' request-queue-views__item--active' : ''}`}
        aria-current={view === 'review' ? 'page' : undefined}
      >
        {QUEUE_TEXT.views.review}
        <span className="request-queue-views__count">{reviewCount}</span>
      </Link>
      <Link
        href={href(basePath, { vue: 'toutes', site: siteId })}
        className={`request-queue-views__item${view === 'all' ? ' request-queue-views__item--active' : ''}`}
        aria-current={view === 'all' ? 'page' : undefined}
      >
        {QUEUE_TEXT.views.all}
      </Link>
    </nav>
  )
}

export function QueueSiteFilter({ basePath, sites, siteId, view }: {
  basePath: string
  sites: ReadonlyArray<{ id: string; name: string }>
  siteId: string | null
  view: QueueView
}) {
  return (
    <form method="get" action={basePath} className="request-queue-filter">
      {view === 'all' && <input type="hidden" name="vue" value="toutes" />}
      <label className="request-queue-filter__label" htmlFor="request-queue-site">{QUEUE_TEXT.siteFilter}</label>
      <select id="request-queue-site" name="site" defaultValue={siteId ?? ''} className="input request-queue-filter__select">
        <option value="">{QUEUE_TEXT.allSites}</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
      <button type="submit" className="btn-secondary btn-sm">{QUEUE_TEXT.filter}</button>
    </form>
  )
}

export function QueuePager({ basePath, view, siteId, page, lastPage }: {
  basePath: string
  view: QueueView
  siteId: string | null
  page: number
  lastPage: number
}) {
  if (lastPage <= 1) return null
  const at = (target: number) => href(basePath, { vue: view === 'all' ? 'toutes' : null, site: siteId, page: target > 1 ? String(target) : null })
  return (
    <nav className="request-queue-pager" aria-label={QUEUE_TEXT.pager}>
      {page > 1 ? <Link href={at(page - 1)} className="btn-ghost btn-sm">{QUEUE_TEXT.previous}</Link> : <span />}
      <span className="meta">{page} / {lastPage}</span>
      {page < lastPage ? <Link href={at(page + 1)} className="btn-ghost btn-sm">{QUEUE_TEXT.next}</Link> : <span />}
    </nav>
  )
}
