// ─────────────────────────────────────────────────────────────────────────────
// One keyword request, as its client reads it: the keyword, its state, ONE
// sentence on what was found and what happens next, and the steps passed
// (KW-6 to KW-8). No hook: rendered by the home (server) and by the board.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { Check, Circle, CircleDot, ExternalLink } from 'lucide-react'
import { formatDay } from '@/components/ui'
import {
  REQUEST_DETAIL_TEXT,
  REQUEST_STATE_LABELS,
  REQUEST_TEXT,
  TIMELINE_LABELS,
} from '@/lib/client-space/labels'
import type { ClientRequestView, TimelineStep } from '@/src/core/domain/keyword-requests/client-view'

const BADGE: Record<(typeof REQUEST_STATE_LABELS)[keyof typeof REQUEST_STATE_LABELS]['tone'], string> = {
  neutral: 'badge badge-muted',
  info: 'badge badge-info',
  good: 'badge badge-success',
}

function stateLabel(request: ClientRequestView): string {
  if (request.state === 'scheduled' && request.detail.kind === 'planned' && request.detail.day) {
    return `Prévue le ${formatDay(request.detail.day)}`
  }
  return REQUEST_STATE_LABELS[request.state].label
}

function PageLink({ url }: { url: string | null }) {
  if (!url) return null
  return (
    <a className="espace-row__link espace-request__link" href={url} target="_blank" rel="noopener noreferrer">
      {REQUEST_TEXT.viewPage}
      <ExternalLink size={14} aria-hidden="true" />
      <span className="sr-only"> (s’ouvre dans un nouvel onglet)</span>
    </a>
  )
}

function Detail({ request }: { request: ClientRequestView }) {
  const { detail } = request
  switch (request.state) {
    case 'analysing':
      return <>{REQUEST_DETAIL_TEXT.analysing}</>
    case 'review':
      return <>{detail.kind === 'city' ? REQUEST_DETAIL_TEXT.reviewCity(detail.city) : REQUEST_DETAIL_TEXT.review}</>
    case 'deferred':
      return <>{REQUEST_DETAIL_TEXT.deferred}</>
    case 'scheduled':
      return <>{REQUEST_DETAIL_TEXT.planned(detail.kind === 'planned' && detail.day ? formatDay(detail.day) : null)}</>
    case 'in_production':
      return <>{REQUEST_DETAIL_TEXT.inProduction}</>
    case 'published':
      return <>{REQUEST_DETAIL_TEXT.published} {detail.kind === 'page' && <PageLink url={detail.url} />}</>
    case 'covered':
      if (detail.kind === 'won') return <>{REQUEST_DETAIL_TEXT.won(detail.position)} <PageLink url={detail.url} /></>
      return detail.kind === 'page' && detail.url
        ? <>{REQUEST_DETAIL_TEXT.covered} <PageLink url={detail.url} /></>
        : <>{REQUEST_DETAIL_TEXT.coveredNoPage}</>
    case 'declined':
      return <>{detail.kind === 'declined' && detail.reason ? detail.reason : REQUEST_DETAIL_TEXT.declined}</>
    case 'withdrawn':
      return <>{REQUEST_DETAIL_TEXT.withdrawn}</>
  }
}

const STEP_ICON = { done: Check, current: CircleDot, upcoming: Circle } as const

function Step({ step }: { step: TimelineStep }) {
  const Icon = STEP_ICON[step.status]
  return (
    <li className={`espace-step espace-step--${step.status}`} aria-current={step.status === 'current' ? 'step' : undefined}>
      <Icon size={14} aria-hidden="true" />
      <span>
        {TIMELINE_LABELS[step.kind]}
        {step.day && <> · <time dateTime={step.day}>{formatDay(step.day)}</time></>}
      </span>
    </li>
  )
}

export function RequestItem({ request, action }: { request: ClientRequestView; action?: ReactNode }) {
  const tone = REQUEST_STATE_LABELS[request.state].tone
  return (
    <li className="espace-row espace-request">
      <div className="espace-request__head">
        <p className="espace-request__keyword">
          {request.keyword}
          {request.city && <span className="espace-request__city"> · {request.city}</span>}
        </p>
        <span className={BADGE[tone]}>{stateLabel(request)}</span>
      </div>
      <p className="espace-request__detail"><Detail request={request} /></p>
      <ol className="espace-request__steps" aria-label="Étapes de la demande">
        {request.timeline.map((step) => <Step key={step.kind} step={step} />)}
      </ol>
      {(request.desiredBy || action) && (
        <div className="espace-request__foot">
          {request.desiredBy && <p className="espace-row__meta">{REQUEST_TEXT.desiredBy(formatDay(request.desiredBy))}</p>}
          {action}
        </div>
      )}
    </li>
  )
}
