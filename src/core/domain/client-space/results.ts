// ─────────────────────────────────────────────────────────────────────────────
// A site's Google results, as the client reads them (ESP-5, design.md § 9.4)
// ─────────────────────────────────────────────────────────────────────────────
//
// The SQL function client_search_summary (migration 023) aggregates; this turns
// its JSON into what the screen shows — and refuses to say more than the data
// supports: no comparison when the previous window is not fully covered, no
// percentage against zero, every day of the curve present (a day with no row
// is a day with no visit, not a missing point).

export interface Totals {
  clicks: number
  impressions: number
}

export interface DailyPoint {
  day: string
  clicks: number
  impressions: number
}

export interface RankedPage {
  url: string
  clicks: number
}

export interface RankedQuery {
  query: string
  clicks: number
}

export interface SearchResults {
  /** First and last day of the window shown, inclusive. */
  fromDay: string
  toDay: string
  days: number
  current: Totals
  /** Relative change against the window before, or null when it cannot be said honestly. */
  change: { clicks: number | null; impressions: number | null }
  daily: DailyPoint[]
  pages: RankedPage[]
  queries: RankedQuery[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}

/** (current − previous) / previous, or null: a change from nothing is not a percentage. */
export function relativeChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return (current - previous) / previous
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0)
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const list = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []

/**
 * The function's JSON, made safe to render; null when the site has no data at
 * all (the screen then explains why rather than showing zeros).
 */
export function summarizeResults(raw: unknown): SearchResults | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  if (!isDay(data.last_day)) return null

  const days = Math.max(1, Math.round(num(data.days)) || 28)
  const toDay = data.last_day
  const fromDay = addDays(toDay, -(days - 1))
  const current = { clicks: num((data.current as Record<string, unknown> | undefined)?.clicks), impressions: num((data.current as Record<string, unknown> | undefined)?.impressions) }
  const previous = { clicks: num((data.previous as Record<string, unknown> | undefined)?.clicks), impressions: num((data.previous as Record<string, unknown> | undefined)?.impressions) }

  // The previous window is comparable only if the history reaches its first day.
  const comparable = isDay(data.first_day) && data.first_day <= addDays(fromDay, -days)

  const byDay = new Map(list(data.daily).filter((point) => isDay(point.day)).map((point) => [point.day as string, point]))
  const daily: DailyPoint[] = []
  for (let offset = 0; offset < days; offset++) {
    const day = addDays(fromDay, offset)
    const point = byDay.get(day)
    daily.push({ day, clicks: num(point?.clicks), impressions: num(point?.impressions) })
  }

  return {
    fromDay,
    toDay,
    days,
    current,
    change: {
      clicks: comparable ? relativeChange(current.clicks, previous.clicks) : null,
      impressions: comparable ? relativeChange(current.impressions, previous.impressions) : null,
    },
    daily,
    pages: list(data.pages)
      .filter((row) => typeof row.page === 'string' && row.page)
      .map((row) => ({ url: row.page as string, clicks: num(row.clicks) })),
    queries: list(data.queries)
      .filter((row) => typeof row.query === 'string' && row.query)
      .map((row) => ({ query: row.query as string, clicks: num(row.clicks) })),
  }
}

/** `https://www.site.fr/taxi-troyes/` → `/taxi-troyes`; the home page → null (said in words by the screen). */
export function pagePath(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    return path === '' ? null : decodeURIComponent(path)
  } catch {
    return url
  }
}
