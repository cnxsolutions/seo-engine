// ─────────────────────────────────────────────────────────────────────────────
// The dashboard — the one cross-site screen
//
// Everything about ONE site now lives in its own section (/sites/<id>):
// strategy, calendar, publication, Search Console, settings. The owner's rule
// (17/10/2026): « Analytics doit être dans chaque site, pas dans une section à
// part. » So this page no longer carries a Performance tab nor a site filter —
// both measured « the site picked in a menu », which is exactly what the site's
// own Performances tab now does without a menu.
//
// What stays here is what is true ACROSS sites:
//   · the sites themselves, each with its state and a way into its section;
//   · what the engine manufactured on all of them (the Production figures,
//     unchanged: our own rows, never a Google number).
//
// Old links keep resolving: `?tab=performance` goes to the /analytics site
// picker, `?site=<id>` to that site's Performances tab.
// ─────────────────────────────────────────────────────────────────────────────

import { ChevronRight, LayoutDashboard } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import {
  getProductionMetrics,
  listDashboardSites,
  resolvePeriod,
  type DashboardSite,
} from '@/app/api/dashboard/metrics'
import { EmptyState, PageHeader } from '@/components/ui'
import { DashboardFilters } from './DashboardFilters'
import { ProductionTab } from './ProductionTab'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const days = resolvePeriod(single(params.days))
  const requested = single(params.site)

  // The two shapes of link the old dashboard handed out. `redirect()` throws,
  // so both stay outside any try/catch.
  if (single(params.tab) === 'performance') {
    redirect(requested ? `/analytics?site=${encodeURIComponent(requested)}` : '/analytics')
  }

  const sites = await listDashboardSites()

  // A known site in the query means « this site's figures »: they live in its
  // own Performances tab now. An unknown id falls back to the overview rather
  // than to an empty screen — a shared link must never dead-end.
  if (requested && sites.some((site) => site.id === requested)) {
    redirect(`/sites/${requested}/performances?vue=production&days=${days}`)
  }

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        badge="Tableau de bord"
        title="Tableau de bord"
        subtitle="Tous les sites d’un coup d’œil, et ce que le moteur fabrique sur l’ensemble. Le détail d’un site — calendrier, publication, Search Console — se lit dans sa page."
      />

      {sites.length === 0 ? (
        <EmptyState
          variant="not-connected"
          title="Aucun site connecté"
          description="Le tableau de bord mesure des sites. Connectez-en un pour que la production et les statistiques Search Console aient quelque chose à raconter."
          action={{ label: 'Connecter un site', href: '/sites/new' }}
        />
      ) : (
        <>
          <SitesOverview sites={sites} />

          <h2 className="tab-intro__title" style={{ margin: 'var(--space-8) 0 var(--space-3)' }}>
            Production — tous les sites
          </h2>

          <Suspense fallback={<div style={{ height: 44, marginBottom: 'var(--space-5)' }} />}>
            <DashboardFilters days={days} />
          </Suspense>

          <ProductionTab metrics={await getProductionMetrics(null, days)} scopeLabel={`tous les sites (${sites.length})`} />
        </>
      )}
    </div>
  )
}

/**
 * One row per site: its state in words, and the way into its section. The
 * Search Console column says which of three facts holds — never a blank cell
 * that could pass for « nothing to measure ».
 */
function SitesOverview({ sites }: { sites: DashboardSite[] }) {
  // Active sites first: a deactivated site stays listed — the scheduler ignores
  // it, the operator should not forget it exists — but below the ones at work.
  const ordered = [...sites.filter((site) => site.isActive), ...sites.filter((site) => !site.isActive)]

  return (
    <section className="panel" aria-labelledby="dashboard-sites">
      <div className="panel__header">
        <h2 id="dashboard-sites" className="card-title">Vos sites</h2>
        <Link href="/sites" className="btn-link">Gérer les sites</Link>
      </div>
      <div className="panel__body--flush scroll-x">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Connecteur</th>
              <th scope="col">Planificateur</th>
              <th scope="col">Search Console</th>
              <th scope="col"><span className="sr-only">Ouvrir</span></th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((site) => (
              <tr key={site.id}>
                <th scope="row">
                  <Link href={`/sites/${site.id}`} className="cell-strong">{site.name}</Link>
                  <div className="meta truncate" style={{ maxWidth: '22rem' }}>{site.url}</div>
                </th>
                <td><span className="chip">{site.type === 'nextjs' ? 'Next.js' : 'WordPress'}</span></td>
                <td>
                  {site.isActive
                    ? <span className="badge badge-success">Actif</span>
                    : <span className="badge badge-muted">Désactivé</span>}
                </td>
                <td>
                  {!site.googleConnected ? (
                    <span className="badge badge-warning">Google non connecté</span>
                  ) : !site.gscProperty ? (
                    <span className="badge badge-warning">Propriété à choisir</span>
                  ) : (
                    <Link href={`/sites/${site.id}/performances`} className="btn-link">Reliée — voir les performances</Link>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/sites/${site.id}`} className="btn-ghost btn-sm" aria-label={`Ouvrir ${site.name}`}>
                    Ouvrir <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
