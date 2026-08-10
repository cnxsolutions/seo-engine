// ─────────────────────────────────────────────────────────────────────────────
// The dashboard — one page, two tabs, one scope
//
// It used to be two pages that each mixed two kinds of measurement in the same
// tile grid: "1 page générée" sitting next to "#26,2 position moyenne" and
// "0,9 % CTR". Three universes of measurement, one row of tiles, nothing
// readable.
//
// The split is now structural rather than cosmetic:
//   Production   our own rows — what the engine manufactured.
//   Performance  Search Console rows — what Google did with it.
// Each tab states its source and its period; neither borrows the other's
// figures. Site and period live in the URL, so a view is shareable and survives
// a reload.
// ─────────────────────────────────────────────────────────────────────────────

import { LayoutDashboard } from 'lucide-react'
import { Suspense } from 'react'
import {
  DASHBOARD_TABS,
  getPerformanceMetrics,
  getProductionMetrics,
  listDashboardSites,
  resolvePeriod,
  resolveTab,
  type DashboardTab,
} from '@/app/api/dashboard/metrics'
import { EmptyState, PageHeader, TabNav } from '@/components/ui'
import { DashboardFilters } from './DashboardFilters'
import { PerformanceTab } from './PerformanceTab'
import { ProductionTab } from './ProductionTab'

export const dynamic = 'force-dynamic'

const TAB_META: Record<DashboardTab, { label: string; caption: string }> = {
  production: { label: 'Production', caption: 'Ce que le moteur fabrique' },
  performance: { label: 'Performance', caption: 'Ce que Google en pense' },
}

type SearchParams = Record<string, string | string[] | undefined>

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const tab = resolveTab(single(params.tab))
  const days = resolvePeriod(single(params.days))

  const sites = await listDashboardSites()

  // An unknown or stale site id falls back to the aggregate rather than to an
  // empty screen — a shared link must never dead-end.
  const requested = single(params.site)
  const siteId = requested && sites.some((site) => site.id === requested) ? requested : null
  const site = siteId ? sites.find((candidate) => candidate.id === siteId) : null
  const scopeLabel = site ? site.name : `tous les sites (${sites.length})`

  // Link-tabs, not a client tablist: each tab is a real, bookmarkable URL, and
  // `TabNav` is the shared component that renders exactly that (aria-current on
  // links rather than a tablist role, which would lie about what a click does).
  const tabItems = DASHBOARD_TABS.map((candidate) => {
    const query = new URLSearchParams({ tab: candidate, days: String(days) })
    if (siteId) query.set('site', siteId)
    return { id: candidate, label: TAB_META[candidate].label, href: `/dashboard?${query.toString()}` }
  })

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        badge="Tableau de bord"
        title="Tableau de bord"
        subtitle="Deux mesures, deux onglets : ce que le moteur produit, et ce que Google en fait."
      >
        {sites.length > 0 && (
          <>
            <TabNav items={tabItems} active={tab} ariaLabel="Nature des métriques" />
            <p className="meta" style={{ marginTop: 'var(--space-2)' }}>{TAB_META[tab].caption}</p>
          </>
        )}
      </PageHeader>

      {sites.length === 0 ? (
        <EmptyState
          variant="not-connected"
          title="Aucun site connecté"
          description="Le tableau de bord mesure des sites. Connectez-en un pour que la production et les statistiques Search Console aient quelque chose à raconter."
          action={{ label: 'Connecter un site', href: '/sites/new' }}
        />
      ) : (
        <>
          <Suspense fallback={<div style={{ height: 44, marginBottom: 'var(--space-5)' }} />}>
            <DashboardFilters
              sites={sites.map(({ id, name, url, type }) => ({ id, name, url, type }))}
              siteId={siteId}
              days={days}
            />
          </Suspense>

          {tab === 'production' ? (
            <ProductionTab metrics={await getProductionMetrics(siteId, days)} scopeLabel={scopeLabel} />
          ) : (
            <PerformanceTab
              metrics={await getPerformanceMetrics(siteId, days, sites)}
              scopeLabel={scopeLabel}
              siteId={siteId}
            />
          )}
        </>
      )}
    </div>
  )
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
