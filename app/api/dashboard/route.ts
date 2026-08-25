// ─────────────────────────────────────────────────────────────────────────────
// Dashboard API — one aggregated read for the tabbed dashboard
//
// The page itself is a server component and calls `metrics.ts` directly, so this
// route exists for what a server component cannot do: a client-side refresh, and
// an inspectable endpoint to check a figure against the database by hand — which
// is how the "counter stuck at 1" class of bug gets caught early.
//
// `view` mirrors the tabs exactly. Asking for one tab never pays for the other's
// queries: the Search Console read is the expensive one and Production has no
// business triggering it.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'
import {
  getPerformanceMetrics,
  getProductionMetrics,
  listDashboardSites,
  resolvePeriod,
} from './metrics'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') ?? 'all'
  const days = resolvePeriod(searchParams.get('days'))

  // "all" is a real scope (every site aggregated), not a missing parameter.
  const requestedSite = searchParams.get('siteId')
  const siteId = !requestedSite || requestedSite === 'all' ? null : requestedSite

  try {
    const sites = await listDashboardSites()

    if (siteId && !sites.some((site) => site.id === siteId)) {
      return Response.json({ error: 'Site inconnu' }, { status: 404 })
    }

    const scope = {
      siteId,
      siteName: siteId ? (sites.find((site) => site.id === siteId)?.name ?? null) : null,
      days,
      sites: sites.map(({ id, name, url, type, googleConnected, gscProperty }) => ({
        id,
        name,
        url,
        type,
        googleConnected,
        gscProperty,
      })),
    }

    switch (view) {
      case 'sites':
        return Response.json({ scope })

      case 'production':
        return Response.json({ scope, production: await getProductionMetrics(siteId, days) })

      case 'performance':
        return Response.json({ scope, performance: await getPerformanceMetrics(siteId, days, sites) })

      case 'all': {
        const [production, performance] = await Promise.all([
          getProductionMetrics(siteId, days),
          getPerformanceMetrics(siteId, days, sites),
        ])
        return Response.json({ scope, production, performance })
      }

      default:
        return Response.json({ error: `Vue inconnue : ${view}` }, { status: 400 })
    }
  } catch (error) {
    console.error('[Dashboard API]', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 }
    )
  }
}
