import { redirect } from 'next/navigation'

/**
 * Bookmark shim for the old campaign creation URL. See ../page.tsx: creating a
 * campaign IS creating a strategy, and only /strategy/new does it.
 *
 * Nothing in the product links here any more; kept for old bookmarks only.
 */
export default function CampaignsNewRedirect() {
  redirect('/strategy/new')
}
