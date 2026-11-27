'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One filter row, above everything it scopes
//
// The period lives in the URL rather than in component state: the choice
// survives a reload, is shareable as a link, and the server components re-read
// it without a client fetch. Per-chart filters are deliberately absent — every
// panel on the active tab answers to this single row.
//
// There is no site in it any more: the dashboard measures every site, and a
// site's Performances tab IS the site. The site switcher both used to carry was
// rendered nowhere and has been removed from components/charts.tsx (L6f).
// ─────────────────────────────────────────────────────────────────────────────

import { RefreshCw } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Tabs } from '@/components/charts'
import './dashboard.css'

const PERIODS = [
  { id: '7', label: '7 j' },
  { id: '28', label: '28 j' },
  { id: '90', label: '90 j' },
]

export function DashboardFilters({ days }: { days: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function applyPeriod(days: string) {
    const next = new URLSearchParams(searchParams.toString())
    next.set('days', days)
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  return (
    // Held at reduced opacity while the server re-renders: no skeleton flash, no layout jump.
    <div className={`toolbar dashboard-filters${pending ? ' dashboard-filters--pending' : ''}`}>
      <span className="toolbar__spacer" />

      <Tabs
        items={PERIODS}
        value={String(days)}
        onChange={applyPeriod}
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
