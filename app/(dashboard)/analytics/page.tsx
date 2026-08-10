import { redirect } from 'next/navigation'

/**
 * Analytics has been folded into the dashboard.
 *
 * The two pages measured different universes — page volume on one side,
 * Search Console impressions and positions on the other — and both displayed
 * them in the same tile grid, so nothing said which was which. They are now the
 * two tabs of `/dashboard`, each announcing its own source and period.
 *
 * This shim keeps the sidebar entry and old bookmarks working; it lands on the
 * tab that carries what this page used to be about.
 */
export default function AnalyticsRedirect() {
  redirect('/dashboard?tab=performance')
}
