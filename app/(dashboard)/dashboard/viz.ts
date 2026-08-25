// ─────────────────────────────────────────────────────────────────────────────
// Dashboard formatters
//
// This file used to also declare a palette — a violet/orange pair, its own
// ordinal ramp and its own status steps, all as raw hex. That palette was
// written in parallel with `components/tokens.css` and disagreed with it: the
// dashboard painted its charts in the old generic violet while every other view
// had moved to the deep blue of the design system. There is one palette now, and
// it lives in tokens.css; the shared charts read it through CSS variables, so
// nothing here has to know a colour at all.
//
// What remains is French number formatting, and it delegates to `formatMetric`
// from components/ui for the same reason: two implementations of "how do we
// print a number" drift, and one of them was built on `Intl.NumberFormat`, whose
// grouping character has changed between Node releases — a hydration mismatch on
// every figure the day a chart tooltip prints one client-side.
// ─────────────────────────────────────────────────────────────────────────────

import { formatMetric } from '@/components/ui'

export function formatCount(value: number): string {
  return formatMetric(value, 'number')
}

/** Compact only past 10 000 — below that the exact figure still fits and reads better. */
export function formatCompact(value: number): string {
  return Math.abs(value) >= 10000 ? formatMetric(value, 'compact') : formatMetric(value, 'number')
}

/** Takes a RATIO (0.032), not percentage points. */
export function formatPercent(ratio: number, decimals = 2): string {
  return formatMetric(ratio * 100, 'percent', { decimals })
}

/** Search Console positions are ranks, so they wear a `#` and never a decimal beyond one. */
export function formatPosition(position: number): string {
  if (!position) return '—'
  return `#${formatMetric(position, 'position', { decimals: 1 })}`
}

/** Takes MILLISECONDS, which is what `job_executions.duration_ms` stores. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return formatMetric(ms / 1000, 'duration')
}

// ─── Dates ───────────────────────────────────────────────────────────────────
//
// The short-day, long-day and URL shorteners used to be declared here, byte for
// byte identical to the ones in components/ui. They are re-exported now rather
// than redeclared: this file stays the single import site for the two dashboard
// tabs (nothing downstream has to change) while there remains exactly one
// implementation of "how do we print a day" in the repository.
//
// `formatDateTime` stays local — it is the only one of the four with no twin in
// the design system, and its `jj/mm hh:mm` shape belongs to the run table.
//
// `Intl.DateTimeFormat` is safe here where `Intl.NumberFormat` was not: both tabs
// are server components, so these run once on the server and cross to the client
// as finished strings — including the x-axis labels handed to the charts.

export { formatDay, formatDayLong, shortenUrl } from '@/components/ui'

const DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso))
}
