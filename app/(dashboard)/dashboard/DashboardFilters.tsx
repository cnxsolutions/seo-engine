'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One filter row, above everything it scopes
//
// Site and period live in the URL rather than in component state: the choice
// survives a reload, is shareable as a link, and the server components re-read
// it without a client fetch. Per-chart filters are deliberately absent — every
// panel on the active tab answers to this single row.
//
// Both controls are the SHARED ones (components/charts.tsx). The local
// `SiteSwitcher.tsx` stand-in this file used to import has been deleted: the
// same switcher already runs on /generate and /publish, and a second one would
// have drifted the moment either changed.
// ─────────────────────────────────────────────────────────────────────────────

import { RefreshCw } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { SiteSwitcher, Tabs, type SiteOption } from '@/components/charts'

const PERIODS = [
  { id: '7', label: '7 j' },
  { id: '28', label: '28 j' },
  { id: '90', label: '90 j' },
]

export function DashboardFilters({
  sites,
  siteId,
  days,
}: {
  sites: SiteOption[]
  siteId: string | null
  days: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function apply(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  return (
    <div
      className="toolbar"
      style={{
        // Held at reduced opacity while the server re-renders: no skeleton flash,
        // no layout jump.
        opacity: pending ? 0.6 : 1,
        transition: `opacity var(--dur) var(--ease)`,
      }}
    >
      <SiteSwitcher
        sites={sites}
        value={siteId}
        onChange={(value) => apply({ site: value })}
        size="sm"
      />

      <span className="toolbar__spacer" />

      <Tabs
        items={PERIODS}
        value={String(days)}
        onChange={(value) => apply({ days: value })}
        variant="segmented"
        ariaLabel="Période"
      />

      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={() => startTransition(() => router.refresh())}
        aria-busy={pending || undefined}
      >
        <RefreshCw size={13} className={pending ? 'animate-spin' : undefined} />
        Actualiser
      </button>
    </div>
  )
}
