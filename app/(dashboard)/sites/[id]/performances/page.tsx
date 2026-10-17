// ─────────────────────────────────────────────────────────────────────────────
// L'onglet « Performances » d'un site — Google, puis ce que le moteur a fabriqué
//
// Décision du propriétaire (17/10/2026) : « Analytics doit être dans chaque
// site, pas dans une section à part. » Les deux onglets du tableau de bord
// transverse (Performance, Production) et l'écran /analytics qui y redirigeait
// mesuraient « le site choisi dans un menu » ; ils mesurent ici CE site, sans
// menu. Trois vues, chacune avec sa source :
//
//   Search Console   la table gsc_performance (positions, impressions, clics)
//   Fiche Google     les avis lus et les posts publiés par le moteur
//   Production       generations, editorial_calendar, job_executions
//
// Les vues et la période vivent dans l'URL (`?vue=`, `?days=`) : une vue se
// partage, survit à un rechargement, et les composants serveur la relisent sans
// aucun fetch client. Les mesures elles-mêmes sont celles du tableau de bord
// (app/api/dashboard/metrics.ts) : une seule définition de « position moyenne ».
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import {
  getPerformanceMetrics,
  getProductionMetrics,
  listDashboardSites,
  resolvePeriod,
} from '@/app/api/dashboard/metrics'
import { TabNav } from '@/components/ui'
import { DashboardFilters } from '@/app/(dashboard)/dashboard/DashboardFilters'
import { PerformanceTab } from '@/app/(dashboard)/dashboard/PerformanceTab'
import { ProductionTab } from '@/app/(dashboard)/dashboard/ProductionTab'
import { loadSite } from '../site-data'
import { TabIntro } from '../TabIntro'
import { GbpSummary } from './GbpSummary'

export const dynamic = 'force-dynamic'

const VIEWS = [
  { id: 'search', label: 'Search Console', caption: 'Ce que Google fait des pages du site' },
  { id: 'fiche', label: 'Fiche Google', caption: 'Les avis de la fiche et les posts que le moteur y publie' },
  { id: 'production', label: 'Production', caption: 'Ce que le moteur a fabriqué pour ce site' },
] as const

type View = (typeof VIEWS)[number]['id']

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function resolveView(raw: string | undefined): View {
  return VIEWS.some((view) => view.id === raw) ? (raw as View) : 'search'
}

export default async function SitePerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams
  const view = resolveView(single(query.vue))
  const days = resolvePeriod(single(query.days))

  const site = await loadSite(id)
  if (!site) notFound()

  const meta = VIEWS.find((candidate) => candidate.id === view) ?? VIEWS[0]
  const tabItems = VIEWS.map((candidate) => {
    const next = new URLSearchParams({ vue: candidate.id, days: String(days) })
    return { id: candidate.id, label: candidate.label, href: `/sites/${id}/performances?${next.toString()}` }
  })

  return (
    <>
      <TabIntro
        title="Performances"
        subtitle="Search Console, la fiche Google et la production du moteur — chaque vue annonce sa source et sa période."
      />

      <TabNav items={tabItems} active={view} ariaLabel="Nature des mesures" />
      <p className="meta" style={{ margin: 'calc(-1 * var(--space-3)) 0 var(--space-4)' }}>{meta.caption}</p>

      {/* La période ne s'applique pas à la fiche : avis et posts sont des
          totaux, pas des séries. Le filtre n'y apparaît donc pas. */}
      {view !== 'fiche' && (
        <Suspense fallback={<div style={{ height: 44, marginBottom: 'var(--space-5)' }} />}>
          <DashboardFilters days={days} />
        </Suspense>
      )}

      {view === 'search' && (
        <PerformanceTab
          metrics={await getPerformanceMetrics(id, days, await listDashboardSites())}
          scopeLabel={site.name}
          siteId={id}
        />
      )}

      {view === 'fiche' && <GbpSummary siteId={id} />}

      {view === 'production' && (
        <ProductionTab
          metrics={await getProductionMetrics(id, days)}
          scopeLabel={site.name}
          links={{ calendar: `/sites/${id}/calendrier`, strategy: `/strategy/new?site=${id}` }}
        />
      )}
    </>
  )
}
