// ─────────────────────────────────────────────────────────────────────────────
// A French day, written once — for the screens (components/ui.tsx re-exports
// these) and for what leaves without a screen: the e-mails of lib/email.
//
// `Intl.DateTimeFormat` is safe where `Intl.NumberFormat` was not: the month
// abbreviations are stable across the Node and browser ICU builds.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const DAY_LONG = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Noon UTC, deliberately: a bare date parsed as midnight lands on the day
 *  before in any negative offset, and the whole app runs on ISO days. */
export function formatDay(iso: string): string {
  return DAY.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
}

export function formatDayLong(iso: string): string {
  return DAY_LONG.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
}
