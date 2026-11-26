// ─────────────────────────────────────────────────────────────────────────────
// The header of a site — a compact HERO band (docs/design.md § 9.6, UX-5)
// ─────────────────────────────────────────────────────────────────────────────
//
// The site's name once (the <h1> of every tab: TabIntro opens on an <h2>), its
// address and connector, and its cycle in progress drawn by the thread — the
// one signature of the CNX films, one per screen (§ 6). The tab bar sits under
// the band, on the page's light background.
//
// No 'use client': nothing here has state.

import { ArrowLeft, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { PeriodThread } from '@/components/PeriodThread'
import { formatDay } from '@/components/ui'
import { SITE_HEADER_TEXT } from '@/lib/console-labels'
import type { PeriodSummary } from '@/src/core/domain/client-space/overview'

export function SiteHero({
  icon: Icon, connectorLabel, name, url, meta, period, children,
}: {
  icon: LucideIcon
  connectorLabel: string
  name: string
  url: string
  /** The connector's facts: repository and branch, or WordPress user. */
  meta?: ReactNode
  period: PeriodSummary | null
  /** The tab bar. */
  children?: ReactNode
}) {
  return (
    <header className="site-hero">
      <div className="site-hero__band">
        <Link href="/sites" className="site-hero__back">
          <ArrowLeft size={14} aria-hidden="true" /> {SITE_HEADER_TEXT.back}
        </Link>
        <p className="site-hero__eyebrow">
          <Icon size={14} aria-hidden="true" /> {connectorLabel}
        </p>
        <h1 className="site-hero__title">{name}</h1>
        <p className="site-hero__meta">
          <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
          {meta}
        </p>

        {period ? (
          <div className="site-hero__period">
            <p className="site-hero__period-head">
              <span className="site-hero__period-label">{SITE_HEADER_TEXT.currentCycle}</span>
              <span>{SITE_HEADER_TEXT.span(formatDay(period.startDay), formatDay(period.endDay))}</span>
            </p>
            <PeriodThread progress={period.progress} label={SITE_HEADER_TEXT.elapsed(Math.round(period.progress * 100))} />
            <p className="site-hero__period-count">{SITE_HEADER_TEXT.pages(period.planned, period.published)}</p>
          </div>
        ) : (
          <p className="site-hero__period-empty">{SITE_HEADER_TEXT.noCycle}</p>
        )}
      </div>
      {children && <div className="site-hero__tabs">{children}</div>}
    </header>
  )
}
