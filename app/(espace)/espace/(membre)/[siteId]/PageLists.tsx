// ─────────────────────────────────────────────────────────────────────────────
// The two lists of a client's site: pages to come (ESP-3) and pages online
// (ESP-2). Server components: plain rows, no JavaScript sent for them.
// ─────────────────────────────────────────────────────────────────────────────

import { CircleCheck, Clock3, ExternalLink, SearchCheck, type LucideIcon } from 'lucide-react'
import { formatDay, formatDayLong } from '@/components/ui'
import type { ClientPageState, UpcomingPage } from '@/src/core/domain/client-space/overview'
import { PAGE_STATE_LABELS } from '@/lib/client-space/labels'
import type { OnlinePage } from '@/lib/client-space/overview'

const STATE_STYLE: Record<ClientPageState, { cls: string; icon: LucideIcon }> = {
  visible: { cls: 'badge badge-success', icon: CircleCheck },
  indexing: { cls: 'badge badge-info', icon: Clock3 },
  checking: { cls: 'badge badge-warning', icon: SearchCheck },
}

export function PageStateBadge({ state }: { state: ClientPageState }) {
  const { cls, icon: Icon } = STATE_STYLE[state]
  return (
    <span className={cls} title={PAGE_STATE_LABELS[state].hint}>
      <Icon size={14} aria-hidden="true" />
      {PAGE_STATE_LABELS[state].label}
    </span>
  )
}

export function UpcomingList({ pages }: { pages: UpcomingPage[] }) {
  return (
    <ul className="espace-list stagger">
      {pages.map((page) => (
        <li key={page.id} className="espace-row">
          <time className="espace-row__day" dateTime={page.day}>{formatDay(page.day)}</time>
          <p className="espace-row__title">{page.title}</p>
        </li>
      ))}
    </ul>
  )
}

/** « plomberie-martin.test/plombier-troyes » — the address as people say it. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
}

export function OnlineList({ pages }: { pages: OnlinePage[] }) {
  return (
    <ul className="espace-list stagger">
      {pages.map((page) => (
        <li key={page.id} className="espace-row espace-row--online">
          <div className="espace-row__main">
            <a className="espace-row__title espace-row__link" href={page.url} target="_blank" rel="noopener noreferrer">
              {page.title}
              <ExternalLink size={14} aria-hidden="true" />
              <span className="sr-only"> (s’ouvre dans un nouvel onglet)</span>
            </a>
            <p className="espace-row__meta">
              {displayUrl(page.url)}
              {page.publishedDay && <> · en ligne depuis le <time dateTime={page.publishedDay}>{formatDayLong(page.publishedDay)}</time></>}
            </p>
          </div>
          <PageStateBadge state={page.state} />
        </li>
      ))}
    </ul>
  )
}
