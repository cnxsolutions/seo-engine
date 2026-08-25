import { redirect } from 'next/navigation'

/**
 * Bookmark shim for the standalone site analysis that no longer exists.
 *
 * Competitor analysis is now the first screen of strategy creation
 * (app/(dashboard)/strategy/new/page.tsx posts to /api/analysis-runs), so this
 * URL has no page of its own. Nothing in the product links here — it is kept
 * for old bookmarks only, and is safe to delete once those are forgotten.
 */
export default function AnalyzeRedirect() {
  redirect('/strategy/new')
}
