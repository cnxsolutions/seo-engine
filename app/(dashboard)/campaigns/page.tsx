import { redirect } from 'next/navigation'

/**
 * Bookmark shim, NOT a navigation entry.
 *
 * "Campagnes" and "3. Stratégie" were two sidebar entries opening the same
 * page, and nothing said which one was the real one. The menu entry is gone
 * (see components/Sidebar.tsx); this file survives only so an old bookmark or
 * an old link still lands somewhere.
 *
 * Temporary (307) rather than permanent on purpose: a 308 is cached by the
 * browser for good, and /campaigns is a plausible name for a future real page.
 *
 * Deletable the day nothing links here — `app/(dashboard)/dashboard/page.tsx`
 * still does.
 */
export default function CampaignsRedirect() {
  redirect('/strategy')
}
