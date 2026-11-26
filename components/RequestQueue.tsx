'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The queue of client requests, and CNX's four gestures on each — KW-10
// docs/design.md § 9.5
// ─────────────────────────────────────────────────────────────────────────────
//
// Read by the console's « Demandes » screen and by each site's « Demandes »
// tab. The page reads the rows (server side); this component acts on them:
// optimistic first — the row shows the decision at once — then the server
// confirms, and a refusal shows on the row, the server's own words.
//
// « Refuser… » opens the confirmation dialog with a reason the client will read
// as is: mandatory, counted, kept under the field when the server refuses it.
// « Intégrer » is answered by the requests task within two minutes; while a row
// waits for it, the screen re-reads itself every ten seconds.

import { useRouter } from 'next/navigation'
import { useEffect, useId, useOptimistic, useState, useTransition } from 'react'
import { ExternalLink, Ban } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button, formatDay } from '@/components/ui'
import { OPERATOR_STATUS_LABELS, QUEUE_TEXT, REASON_LABELS, type QueueTone } from '@/lib/keyword-requests/operator-labels'
import type { QueueItem } from '@/lib/keyword-requests/queue'
import { DECLINE_REASON_CHARS, type OperatorAction } from '@/src/core/domain/keyword-requests/arbitration'

const TONE_CLASS: Readonly<Record<QueueTone, string>> = {
  neutral: 'badge badge-muted',
  info: 'badge badge-info',
  good: 'badge badge-success',
  warning: 'badge badge-warning',
}

const REFRESH_MS = 10_000

interface Optimistic {
  id: string
  action: OperatorAction
}

/** What a row looks like the moment the gesture is made, before the server answers. */
function settled(item: QueueItem, action: OperatorAction): QueueItem {
  switch (action) {
    case 'integrate':
      return { ...item, status: 'deferred', reasonCode: 'OPERATOR_INTEGRATE', integrating: true, actions: [] }
    case 'defer':
      return { ...item, status: 'deferred', reasonCode: 'OPERATOR_DEFERRED', actions: ['integrate'] }
    case 'decline':
      return { ...item, status: 'declined', reasonCode: 'OPERATOR_DECLINED', actions: ['reopen'] }
    case 'reopen':
      return { ...item, status: 'review', reasonCode: 'OPERATOR_REOPENED', actions: ['integrate', 'defer', 'decline'] }
  }
}

export function RequestQueue({ items, showSite }: { items: QueueItem[]; showSite: boolean }) {
  const router = useRouter()
  const [, startRefresh] = useTransition()
  const [shown, applyOptimistic] = useOptimistic(items, (current: QueueItem[], change: Optimistic) =>
    current.map((item) => (item.id === change.id ? settled(item, change.action) : item)))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startAction] = useTransition()
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({})

  const [declining, setDeclining] = useState<QueueItem | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [declineBusy, setDeclineBusy] = useState(false)
  const reasonId = useId()

  // A row CNX asked into the cycle is answered by the requests task: look again until it is.
  const waiting = shown.some((item) => item.integrating)
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => startRefresh(() => router.refresh()), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [waiting, router])

  async function send(item: QueueItem, action: OperatorAction, reason?: string): Promise<string | null> {
    try {
      const response = await fetch(`/api/demandes/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: reason ?? null }),
      })
      if (response.ok) return null
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (response.status === 409) startRefresh(() => router.refresh())
      return body.error ?? QUEUE_TEXT.failed
    } catch {
      return QUEUE_TEXT.failed
    }
  }

  function act(item: QueueItem, action: OperatorAction) {
    if (action === 'decline') {
      setDeclining(item)
      setDeclineReason('')
      setDeclineError(null)
      return
    }
    setPendingId(item.id)
    setRowErrors((errors) => ({ ...errors, [item.id]: '' }))
    startAction(async () => {
      applyOptimistic({ id: item.id, action })
      const error = await send(item, action)
      setPendingId(null)
      if (error) {
        setRowErrors((errors) => ({ ...errors, [item.id]: error }))
      } else {
        setRowNotes((notes) => ({ ...notes, [item.id]: QUEUE_TEXT.done[action] }))
      }
      startRefresh(() => router.refresh())
    })
  }

  async function confirmDecline() {
    if (!declining) return
    const length = declineReason.trim().length
    if (length < DECLINE_REASON_CHARS.min) return setDeclineError(QUEUE_TEXT.problems.reason_required)
    if (length > DECLINE_REASON_CHARS.max) return setDeclineError(QUEUE_TEXT.problems.reason_too_long)

    setDeclineBusy(true)
    const item = declining
    const error = await send(item, 'decline', declineReason)
    setDeclineBusy(false)
    if (error) return setDeclineError(error)
    setDeclining(null)
    setRowNotes((notes) => ({ ...notes, [item.id]: QUEUE_TEXT.done.decline }))
    startRefresh(() => router.refresh())
  }

  return (
    <>
      <ul className="request-queue">
        {shown.map((item) => {
          const status = OPERATOR_STATUS_LABELS[item.status]
          const reasonLabel = item.reasonCode ? REASON_LABELS[item.reasonCode] : null
          const error = rowErrors[item.id]
          const note = rowNotes[item.id]
          return (
            <li key={item.id} className="request-queue__row">
              <div className="request-queue__subject">
                {showSite && <span className="request-queue__site">{item.siteName}</span>}
                <span className="request-queue__keyword">
                  {item.keyword}
                  {item.city && <span className="meta"> · {item.city}</span>}
                </span>
                {item.note && (
                  <p className="request-queue__note">
                    <span className="sr-only">{QUEUE_TEXT.noteLabel} : </span>« {item.note} »
                  </p>
                )}
                <span className="meta">
                  {QUEUE_TEXT.received(formatDay(item.receivedAt))}
                  {item.desiredBy && `, ${QUEUE_TEXT.wished(formatDay(item.desiredBy))}`}
                  {item.waitedCycles > 0 && ` · ${QUEUE_TEXT.waited(item.waitedCycles)}`}
                </span>
              </div>

              <div className="request-queue__verdict">
                <span className={TONE_CLASS[status.tone]}>
                  {item.status === 'scheduled' && item.scheduledFor ? QUEUE_TEXT.plannedFor(formatDay(item.scheduledFor)) : status.label}
                </span>
                {reasonLabel && <span className="request-queue__reason">{reasonLabel}</span>}
                {item.integrating
                  ? <p className="request-queue__why">{QUEUE_TEXT.integrating}</p>
                  : item.reason && <p className="request-queue__why">{item.reason}</p>}
                {item.publishedUrl && (
                  <a className="request-queue__link" href={item.publishedUrl} target="_blank" rel="noopener noreferrer">
                    {QUEUE_TEXT.viewPage} <ExternalLink size={13} aria-hidden="true" />
                    <span className="sr-only"> (s’ouvre dans un nouvel onglet)</span>
                  </a>
                )}
              </div>

              <div className="request-queue__actions" role="group" aria-label={QUEUE_TEXT.actionsLabel(item.keyword)}>
                {item.actions.map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant={action === 'integrate' ? 'primary' : action === 'decline' ? 'ghost' : 'secondary'}
                    loading={pendingId === item.id}
                    disabled={pendingId !== null && pendingId !== item.id}
                    title={QUEUE_TEXT.actionHints[action]}
                    onClick={() => act(item, action)}
                  >
                    {QUEUE_TEXT.actions[action]}
                  </Button>
                ))}
                <p className="request-queue__feedback" aria-live="polite">
                  {error ? <span className="request-queue__error">{error}</span> : note}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={declining !== null}
        title={QUEUE_TEXT.declineTitle}
        subject={declining ? `« ${declining.keyword} »` : undefined}
        confirmLabel={QUEUE_TEXT.declineConfirm}
        confirmIcon={Ban}
        tone="danger"
        busy={declineBusy}
        error={declineError}
        errorTitle="Refus non enregistré"
        onConfirm={confirmDecline}
        onClose={() => setDeclining(null)}
      >
        <p>{QUEUE_TEXT.declineBody}</p>
        <label className="request-queue__reason-field" htmlFor={reasonId}>
          <span className="field-label">{QUEUE_TEXT.declineLabel}</span>
          <textarea
            id={reasonId}
            className="input request-queue__textarea"
            rows={4}
            maxLength={DECLINE_REASON_CHARS.max}
            value={declineReason}
            onChange={(event) => setDeclineReason(event.target.value)}
            aria-describedby={`${reasonId}-count`}
          />
          <span id={`${reasonId}-count`} className="meta">
            {QUEUE_TEXT.declineCount(declineReason.trim().length, DECLINE_REASON_CHARS.max)}
          </span>
        </label>
      </ConfirmDialog>
    </>
  )
}
