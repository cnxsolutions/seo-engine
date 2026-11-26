// ─────────────────────────────────────────────────────────────────────────────
// What a client reads about a site — the rules, without a database
// docs/cadrage.md ESP-1 to ESP-3, docs/design.md § 9.1 and § 10
// ─────────────────────────────────────────────────────────────────────────────
//
// lib/client-space/overview.ts reads narrow rows; these functions turn them into
// what the space shows, in the client's words: a « période », « pages
// prévues », « en ligne » — never a cycle, a slot, a brief or a page type.

/** Every date the client reads is a day in Paris: the container runs in UTC. */
const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })

/** `2026-11-25T23:30:00Z` → `2026-11-26`: the day it was in Paris. */
export function parisDay(instant: string | Date): string {
  return PARIS_DAY.format(typeof instant === 'string' ? new Date(instant) : instant)
}

// ── The period in progress ────────────────────────────────────────────────

export interface CycleRow {
  cycle_started_at: string | null
  cycle_ends_at: string | null
}

export interface SlotRow {
  id: string
  scheduled_date: string
  status: string
  target_keyword: string | null
  target_city: string | null
  plan_item_id: string | null
}

export interface UpcomingPage {
  id: string
  day: string
  title: string
}

export interface PeriodSummary {
  startDay: string
  endDay: string
  /** 0 to 1: how much of the period has gone by, for the thread (design.md § 6). */
  progress: number
  /** Pages of the period, whatever happened to them — except slots the operator dropped. */
  planned: number
  published: number
  upcoming: UpcomingPage[]
}

/** Slot statuses the client never counts: dropped by the operator. */
const DROPPED = new Set(['skipped'])
/** Still to come, as long as the day has not passed: planned, being written, written, or to retry. */
const STILL_TO_COME = new Set(['planned', 'generating', 'generated', 'failed'])

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The period of the executing cycles of a site, or null when none runs.
 *
 * A site usually has one campaign, hence one cycle in progress. With several,
 * the client sees one period: from the earliest start to the latest end, all
 * pages counted together — they are the same client's pages.
 */
export function summarizePeriod(
  cycles: CycleRow[],
  slots: SlotRow[],
  titles: Map<string, string>,
  today: string,
): PeriodSummary | null {
  const dated = cycles.filter((cycle): cycle is { cycle_started_at: string; cycle_ends_at: string } =>
    Boolean(cycle.cycle_started_at && cycle.cycle_ends_at))
  if (dated.length === 0) return null

  const startDay = dated.map((cycle) => parisDay(cycle.cycle_started_at)).sort()[0]
  const endDay = dated.map((cycle) => parisDay(cycle.cycle_ends_at)).sort().at(-1) as string

  const inPeriod = slots.filter((slot) => slot.scheduled_date >= startDay && slot.scheduled_date <= endDay && !DROPPED.has(slot.status))
  const upcoming = inPeriod
    .filter((slot) => STILL_TO_COME.has(slot.status) && slot.scheduled_date >= today)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .map((slot) => ({ id: slot.id, day: slot.scheduled_date, title: pageTitle(slot, titles) }))

  return {
    startDay,
    endDay,
    progress: periodProgress(startDay, endDay, today),
    planned: inPeriod.length,
    published: inPeriod.filter((slot) => slot.status === 'published').length,
    upcoming,
  }
}

/** Days are compared at noon UTC: no daylight-saving hour can move a day boundary. */
function dayTime(day: string): number {
  return Date.parse(`${day}T12:00:00Z`)
}

export function periodProgress(startDay: string, endDay: string, today: string): number {
  const span = dayTime(endDay) - dayTime(startDay)
  if (span <= 0) return today >= endDay ? 1 : 0
  return Math.min(1, Math.max(0, (dayTime(today) - dayTime(startDay)) / span))
}

/** Whole days between two days, for « dans 3 jours ». */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayTime(to) - dayTime(from)) / DAY_MS)
}

// ── Titles of planned pages ───────────────────────────────────────────────

/**
 * `plan_item_id` → the title the plan proposed, read from a cycle's plan.
 * Defensive: the plan is a JSON column written by the engine, and a malformed
 * item must cost its title, not the page.
 */
export function planTitles(planData: unknown): Map<string, string> {
  const titles = new Map<string, string>()
  if (!Array.isArray(planData)) return titles
  for (const item of planData) {
    if (!item || typeof item !== 'object') continue
    const { id, proposed_title: title } = item as { id?: unknown; proposed_title?: unknown }
    if (typeof id === 'string' && typeof title === 'string' && title.trim()) titles.set(id, title.trim())
  }
  return titles
}

/**
 * The plan's title when there is one; otherwise the subject in plain words —
 * « Plombier urgence à Troyes » rather than a lower-case search query.
 */
export function pageTitle(slot: Pick<SlotRow, 'plan_item_id' | 'target_keyword' | 'target_city'>, titles: Map<string, string>): string {
  const proposed = slot.plan_item_id ? titles.get(slot.plan_item_id) : undefined
  if (proposed) return proposed

  const keyword = (slot.target_keyword ?? '').trim()
  const city = (slot.target_city ?? '').trim()
  const withoutCity = city && keyword.toLowerCase().endsWith(city.toLowerCase())
    ? keyword.slice(0, keyword.length - city.length).trim()
    : keyword
  const subject = withoutCity || 'Nouvelle page'
  const sentence = subject.charAt(0).toUpperCase() + subject.slice(1)
  return city ? `${sentence} à ${city}` : sentence
}

// ── Google's view of a page ───────────────────────────────────────────────

/**
 * Three states, said plainly (design.md § 10):
 *
 * - `visible`  — Google has it in its index;
 * - `indexing` — not yet: never checked, not discovered, crawled but not yet
 *                indexed. The normal wait of a new page;
 * - `checking` — something on the site stands in the way (blocked, fetch
 *                error, another canonical). Not « en cours » — that would be
 *                untrue — but « CNX vérifie »: the operator has it on screen.
 */
export type ClientPageState = 'visible' | 'indexing' | 'checking'

const NEEDS_A_LOOK = new Set(['blocked', 'fetch_error', 'canonical_elsewhere'])

export function clientPageState(indexState: string | null | undefined): ClientPageState {
  if (indexState === 'indexed') return 'visible'
  if (indexState && NEEDS_A_LOOK.has(indexState)) return 'checking'
  return 'indexing'
}
