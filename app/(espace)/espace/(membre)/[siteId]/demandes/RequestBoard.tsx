'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The « Demandes » screen of a site: the form, then the list (KW-1, KW-8, KW-9).
//
// Optimistic (docs/cadrage.md § 4.5): a keyword sent appears at once as
// « Reçue — analyse en cours », before the server answers; the server's list
// replaces it on refresh. While a request is being analysed, the list
// refreshes every 10 s, and stops as soon as none is. The form runs the
// domain's own checks (normalize.ts) for instant errors; the route runs them
// again — the browser is never trusted.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useOptimistic, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Undo2 } from 'lucide-react'
import { Button, FieldError, Notice, formatDay } from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { REQUEST_TEXT, requestProblemMessage } from '@/lib/client-space/labels'
import type { RequestZone } from '@/lib/client-space/requests'
import type { ClientRequestView } from '@/src/core/domain/keyword-requests/client-view'
import {
  CITY_MAX_CHARS,
  NOTE_MAX_CHARS,
  checkSubmission,
  type SubmissionProblem,
} from '@/src/core/domain/keyword-requests/normalize'
import { RequestItem } from './RequestItem'

/** While anything is being analysed (§ 4.5). */
const REFRESH_MS = 10_000

interface PostResult {
  ok: boolean
  status: number
  data: {
    error?: string
    problems?: SubmissionProblem[]
    outcomes?: Array<{ keyword: string; outcome: 'created' | 'duplicate' | 'full'; day: string | null }>
  }
}

async function post(url: string, body: Record<string, unknown>): Promise<PostResult> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await response.json().catch(() => ({}))) as PostResult['data']
    return { ok: response.ok, status: response.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: REQUEST_TEXT.unreachable } }
  }
}

/** What the server will show in a moment, shown now. */
function pendingView(keyword: string, city: string | null, index: number, today: string): ClientRequestView {
  return {
    id: `envoi-${Date.now()}-${index}`,
    keyword,
    city,
    note: null,
    desiredBy: null,
    state: 'analysing',
    detail: { kind: 'none' },
    timeline: [
      { kind: 'received', day: today, status: 'done' },
      { kind: 'analysed', day: null, status: 'current' },
    ],
    canWithdraw: false,
  }
}

/** One sentence per outcome kind: how many were received, which were already asked, whether the list is full. */
function feedbackOf(outcomes: NonNullable<PostResult['data']['outcomes']>): string[] {
  const lines: string[] = []
  const created = outcomes.filter((outcome) => outcome.outcome === 'created').length
  if (created > 0) lines.push(REQUEST_TEXT.submitted(created))
  for (const outcome of outcomes) {
    if (outcome.outcome === 'duplicate' && outcome.day) lines.push(REQUEST_TEXT.duplicate(outcome.keyword, formatDay(outcome.day)))
  }
  if (outcomes.some((outcome) => outcome.outcome === 'full')) lines.push(REQUEST_TEXT.full)
  return lines
}

export interface RequestBoardProps {
  siteId: string
  zone: RequestZone | null
  requests: ClientRequestView[]
  /** Paris days bounding « Pour quand ? ». */
  today: string
  lastDay: string
  /** The pager, rendered by the server under the list. */
  children?: ReactNode
}

export function RequestBoard({ siteId, zone, requests, today, lastDay, children }: RequestBoardProps) {
  const router = useRouter()
  const [keywords, setKeywords] = useState('')
  const [city, setCity] = useState('')
  const [note, setNote] = useState('')
  const [desiredBy, setDesiredBy] = useState('')
  const [problems, setProblems] = useState<SubmissionProblem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string[]>([])
  const [sending, startSending] = useTransition()
  const [shown, addPending] = useOptimistic(requests, (current: ClientRequestView[], pending: ClientRequestView[]) => [...pending, ...current])

  const [withdrawing, setWithdrawing] = useState<ClientRequestView | null>(null)
  const [withdrawBusy, setWithdrawBusy] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const analysing = shown.some((request) => request.state === 'analysing')
  useEffect(() => {
    if (!analysing) return
    const timer = window.setInterval(() => router.refresh(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [analysing, router])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setFeedback([])
    const check = checkSubmission({ keywords, city, note, desiredBy })
    if (!check.ok) {
      setProblems(check.problems)
      return
    }
    setProblems([])

    startSending(async () => {
      addPending(check.items.map((item, index) => pendingView(item.keyword, check.city, index, today)))
      const result = await post(`/api/espace/sites/${siteId}/demandes`, { keywords, city, note, desiredBy })
      if (!result.ok) {
        if (result.data.problems) setProblems(result.data.problems)
        else setError(result.data.error ?? REQUEST_TEXT.unavailable)
        return
      }
      setKeywords('')
      setNote('')
      setDesiredBy('')
      setFeedback(feedbackOf(result.data.outcomes ?? []))
      // In a transition, so that the optimistic rows stay until the server's list replaces them.
      startSending(() => router.refresh())
    })
  }

  const confirmWithdraw = async () => {
    if (!withdrawing) return
    setWithdrawBusy(true)
    setWithdrawError(null)
    const result = await post(`/api/espace/sites/${siteId}/demandes/${withdrawing.id}/retrait`, {})
    setWithdrawBusy(false)
    if (!result.ok) {
      setWithdrawError(result.data.error ?? REQUEST_TEXT.withdrawFailed)
      return
    }
    setWithdrawing(null)
    router.refresh()
  }

  const problemsOf = (field: SubmissionProblem['field']) => problems.filter((problem) => problem.field === field)
  const fieldError = (field: SubmissionProblem['field'], id: string) => {
    const list = problemsOf(field)
    if (list.length === 0) return null
    return (
      <div id={id}>
        {list.map((problem, index) => <FieldError key={index}>{requestProblemMessage(problem)}</FieldError>)}
      </div>
    )
  }
  const described = (hint: string, field: SubmissionProblem['field'], errorId: string) =>
    problemsOf(field).length > 0 ? `${hint} ${errorId}` : hint

  return (
    <>
      <section className="espace-card espace-anchor" id="proposer" aria-label={REQUEST_TEXT.title}>
        <p className="espace-section__lead">{REQUEST_TEXT.intro}</p>
        <form className="espace-form" onSubmit={submit} noValidate>
          <div className="espace-field">
            <label className="field-label" htmlFor="demande-mots-cles">{REQUEST_TEXT.keywordsLabel}</label>
            <textarea
              id="demande-mots-cles"
              className="input"
              rows={3}
              required
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              aria-invalid={problemsOf('keywords').length > 0 || undefined}
              aria-describedby={described('demande-mots-cles-aide', 'keywords', 'demande-mots-cles-erreur')}
            />
            <p id="demande-mots-cles-aide" className="field-hint">{REQUEST_TEXT.keywordsHint}</p>
            {fieldError('keywords', 'demande-mots-cles-erreur')}
          </div>

          <div className="espace-form__pair">
            <div className="espace-field">
              <label className="field-label" htmlFor="demande-ville">{REQUEST_TEXT.cityLabel}</label>
              <input
                id="demande-ville"
                className="input"
                type="text"
                list={zone && !zone.national && zone.communes.length > 0 ? 'demande-communes' : undefined}
                autoComplete="off"
                maxLength={CITY_MAX_CHARS}
                value={city}
                onChange={(event) => setCity(event.target.value)}
                aria-invalid={problemsOf('city').length > 0 || undefined}
                aria-describedby={described('demande-ville-aide', 'city', 'demande-ville-erreur')}
              />
              {zone && !zone.national && zone.communes.length > 0 && (
                <datalist id="demande-communes">
                  {zone.communes.map((commune) => <option key={commune} value={commune} />)}
                </datalist>
              )}
              <p id="demande-ville-aide" className="field-hint">{zone?.national ? REQUEST_TEXT.cityHintNational : REQUEST_TEXT.cityHint}</p>
              {fieldError('city', 'demande-ville-erreur')}
            </div>

            <div className="espace-field">
              <label className="field-label" htmlFor="demande-date">{REQUEST_TEXT.desiredByLabel}</label>
              <input
                id="demande-date"
                className="input"
                type="date"
                min={today}
                max={lastDay}
                value={desiredBy}
                onChange={(event) => setDesiredBy(event.target.value)}
                aria-invalid={problemsOf('desiredBy').length > 0 || undefined}
                aria-describedby={described('demande-date-aide', 'desiredBy', 'demande-date-erreur')}
              />
              <p id="demande-date-aide" className="field-hint">{REQUEST_TEXT.desiredByHint}</p>
              {fieldError('desiredBy', 'demande-date-erreur')}
            </div>
          </div>

          <div className="espace-field">
            <label className="field-label" htmlFor="demande-note">{REQUEST_TEXT.noteLabel}</label>
            <textarea
              id="demande-note"
              className="input"
              rows={2}
              maxLength={NOTE_MAX_CHARS}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={problemsOf('note').length > 0 || undefined}
              aria-describedby={described('demande-note-aide', 'note', 'demande-note-erreur')}
            />
            <p id="demande-note-aide" className="field-hint">{REQUEST_TEXT.noteHint}</p>
            {fieldError('note', 'demande-note-erreur')}
          </div>

          <div aria-live="polite">
            {feedback.length > 0 && <Notice inline tone="good" title={feedback[0]} body={feedback.length > 1 ? feedback.slice(1).join(' ') : undefined} />}
            {error && <Notice inline tone="critical" title={error} />}
          </div>

          <div className="espace-form__actions">
            <Button type="submit" size="lg" icon={Send} loading={sending}>{REQUEST_TEXT.submit}</Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="demandes-liste">
        <div className="espace-section__head">
          <h2 id="demandes-liste" className="espace-section__title">{REQUEST_TEXT.listTitle}</h2>
        </div>
        {shown.length === 0 ? (
          <p className="espace-empty">{REQUEST_TEXT.listEmpty}</p>
        ) : (
          <ul className="espace-list">
            {shown.map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                action={request.canWithdraw ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setWithdrawError(null)
                      setWithdrawing(request)
                    }}
                  >
                    {REQUEST_TEXT.withdraw}
                  </button>
                ) : undefined}
              />
            ))}
          </ul>
        )}
        {children}
      </section>

      <ConfirmDialog
        open={withdrawing !== null}
        title={REQUEST_TEXT.withdrawTitle}
        subject={withdrawing ? `« ${withdrawing.keyword} »` : undefined}
        confirmLabel={REQUEST_TEXT.withdrawConfirm}
        confirmIcon={Undo2}
        tone="primary"
        busy={withdrawBusy}
        error={withdrawError}
        errorTitle="Retrait non effectué"
        onConfirm={confirmWithdraw}
        onClose={() => setWithdrawing(null)}
      >
        <p>{REQUEST_TEXT.withdrawBody}</p>
      </ConfirmDialog>
    </>
  )
}
