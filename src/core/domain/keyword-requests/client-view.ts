// ─────────────────────────────────────────────────────────────────────────────
// A request as its client reads it — KW-6 to KW-9, docs/cadrage.md § 3.3, § 3.7
// ─────────────────────────────────────────────────────────────────────────────
//
// What the engine recorded (status, reason code, evidence, dates) turned into
// what the client may know: a state, ONE detail (the date, the page, the
// position, the town), the steps already passed, and whether they can still
// take it back. Never the operator's reasons, a model, a cost or a code. The
// only free text that crosses is the motif of a request CNX declined — written
// for the client, and mandatory (§ 3.3).
//
// The words live in lib/client-space/labels.ts; this module only decides.

import { parisDay } from '../client-space/overview'
import { canWithdraw, isRequestStatus, type RequestStatus } from './lifecycle'

export interface RequestRecord {
  id: string
  keyword: string
  city: string | null
  note: string | null
  desired_by: string | null
  status: RequestStatus
  reason_code: string | null
  reasons: readonly string[]
  evidence: unknown
  scheduled_for: string | null
  published_url: string | null
  published_at: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
}

export type ClientRequestState =
  | 'analysing'
  | 'review'
  | 'deferred'
  | 'scheduled'
  | 'in_production'
  | 'published'
  | 'covered'
  | 'declined'
  | 'withdrawn'

export type ClientRequestDetail =
  /** `already`: the cycle had the search before the client asked (rule 3), not planned for them. */
  | { kind: 'planned'; day: string | null; already: boolean }
  | { kind: 'won'; position: number; url: string | null }
  | { kind: 'page'; url: string | null }
  | { kind: 'city'; city: string }
  | { kind: 'declined'; reason: string | null }
  | { kind: 'none' }

export type TimelineStepKind = 'received' | 'analysed' | 'planned' | 'writing' | 'online' | 'next_period' | 'withdrawn'

export interface TimelineStep {
  kind: TimelineStepKind
  /** A Paris day, when the step has one. */
  day: string | null
  status: 'done' | 'current' | 'upcoming'
}

export interface ClientRequestView {
  id: string
  keyword: string
  city: string | null
  note: string | null
  desiredBy: string | null
  state: ClientRequestState
  detail: ClientRequestDetail
  timeline: TimelineStep[]
  canWithdraw: boolean
}

export function clientRequestView(record: RequestRecord): ClientRequestView {
  const status: RequestStatus = isRequestStatus(record.status) ? record.status : 'review'
  const evidence = evidenceOf(record.evidence)
  return {
    id: record.id,
    keyword: record.keyword,
    city: record.city,
    note: record.note,
    desiredBy: record.desired_by,
    state: status === 'received' ? 'analysing' : status,
    detail: detailOf(status, record, evidence),
    timeline: timelineOf(status, record),
    canWithdraw: canWithdraw(status),
  }
}

// ── The one detail ────────────────────────────────────────────────────────

interface ReadEvidence {
  pageUrl: string | null
  position: number | null
  city: string | null
}

/** The evidence column is JSON the engine wrote: read only what is shaped as expected. */
function evidenceOf(raw: unknown): ReadEvidence {
  const read: ReadEvidence = { pageUrl: null, position: null, city: null }
  if (!Array.isArray(raw)) return read
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (entry.kind === 'page' && read.pageUrl === null) read.pageUrl = safeUrl(entry.url)
    if (entry.kind === 'position' && typeof entry.position === 'number' && Number.isFinite(entry.position)) read.position = Math.max(1, Math.round(entry.position))
    if (entry.kind === 'city' && typeof entry.city === 'string' && entry.city.trim()) read.city = entry.city.trim()
  }
  return read
}

/** Only an http(s) address becomes a link: anything else could run in the client's browser. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function detailOf(status: RequestStatus, record: RequestRecord, evidence: ReadEvidence): ClientRequestDetail {
  switch (status) {
    case 'scheduled':
      return { kind: 'planned', day: record.scheduled_for, already: record.reason_code === 'ALREADY_PLANNED' }
    case 'published':
      return { kind: 'page', url: safeUrl(record.published_url) }
    case 'covered':
      return record.reason_code === 'ALREADY_WON' && evidence.position !== null
        ? { kind: 'won', position: evidence.position, url: evidence.pageUrl }
        : { kind: 'page', url: evidence.pageUrl }
    case 'review':
      return evidence.city && (record.reason_code === 'CITY_OUT_OF_AREA' || record.reason_code === 'CITY_ON_NATIONAL')
        ? { kind: 'city', city: evidence.city }
        : { kind: 'none' }
    case 'declined':
      return { kind: 'declined', reason: record.reasons[0]?.trim() || null }
    default:
      return { kind: 'none' }
  }
}

// ── The steps passed (KW-8) ───────────────────────────────────────────────

function day(instant: string | null): string | null {
  return instant ? parisDay(instant) : null
}

function timelineOf(status: RequestStatus, record: RequestRecord): TimelineStep[] {
  const received: TimelineStep = { kind: 'received', day: day(record.created_at), status: 'done' }
  const analysed = (current: boolean): TimelineStep => ({ kind: 'analysed', day: day(record.decided_at), status: current ? 'current' : 'done' })

  switch (status) {
    case 'received':
      return [received, { kind: 'analysed', day: null, status: 'current' }]
    case 'review':
      // Still with CNX: the analysis is where it stands.
      return [received, analysed(true)]
    case 'covered':
    case 'declined':
      // Concluded: nothing more will happen to it.
      return [received, analysed(false)]
    case 'deferred':
      return [received, analysed(false), { kind: 'next_period', day: null, status: 'current' }]
    case 'withdrawn':
      return [received, { kind: 'withdrawn', day: day(record.updated_at), status: 'done' }]
    case 'scheduled':
    case 'in_production':
    case 'published': {
      const stage = status === 'scheduled' ? 0 : status === 'in_production' ? 1 : 2
      const at = (index: number): TimelineStep['status'] => (index < stage ? 'done' : index === stage ? 'current' : 'upcoming')
      return [
        received,
        analysed(false),
        { kind: 'planned', day: record.scheduled_for, status: at(0) },
        { kind: 'writing', day: null, status: at(1) },
        { kind: 'online', day: day(record.published_at), status: status === 'published' ? 'done' : 'upcoming' },
      ]
    }
  }
}
