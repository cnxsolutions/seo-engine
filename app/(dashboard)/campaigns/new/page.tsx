import { redirect } from 'next/navigation'

/**
 * Bookmark shim for the old campaign creation URL. See ../page.tsx: creating a
 * campaign IS creating a strategy, and only /strategy/new does it.
 *
 * Still referenced by the dashboard quick actions, so it cannot be deleted yet.
 */
export default function CampaignsNewRedirect() {
  redirect('/strategy/new')
}
