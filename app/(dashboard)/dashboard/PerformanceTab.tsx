// ─────────────────────────────────────────────────────────────────────────────
// Performance tab — what Google does with what we published
//
// One source only: `gsc_performance`. No production counter appears here, and
// no Search Console figure appears on the Production tab.
//
// The tab leads with the striking distance list — queries already ranked 5 to
// 20. Those pages exist, Google already shows them, and a few places gained
// there costs far less than a page written from nothing. It is the single most
// actionable fact the product holds, so it gets the hero figure.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BarChart3,
  Eye,
  Link2Off,
  MousePointerClick,
  PlugZap,
  Search,
  Target,
  TrendingUp,
} from 'lucide-react'
import Link from 'next/link'
import type { DashboardSite, PerformanceMetrics } from '@/app/api/dashboard/metrics'
import { LineChart } from '@/components/charts'
import { EmptyState, HeroFigure, StatTile } from '@/components/ui'
import { MagnitudeBar, Panel, SourceNote } from './ui-bits'
import './dashboard.css'
import {
  formatCompact,
  formatCount,
  formatDay,
  formatDayLong,
  formatPercent,
  formatPosition,
  shortenUrl,
} from './viz'

/** Below this many impressions, a top-3 CTR is one lucky click, not a benchmark. */
const PODIUM_MIN_SAMPLE = 50

export function PerformanceTab({
  metrics,
  scopeLabel,
  siteId,
}: {
  metrics: PerformanceMetrics
  scopeLabel: string
  siteId: string | null
}) {
  const { window, coverage, totals, striking } = metrics
  const requested = `${formatDayLong(window.start)} → ${formatDayLong(window.end)} (${window.days} jours)`

  const period =
    coverage.firstDate && coverage.lastDate
      ? `${formatDayLong(coverage.firstDate)} → ${formatDayLong(coverage.lastDate)}`
      : requested

  if (metrics.availability !== 'ok') {
    return (
      <div>
        <SourceNote
          source="Google Search Console, synchronisé chaque nuit"
          period={requested}
          note={<>Périmètre : {scopeLabel}</>}
        />
        <UnavailableState metrics={metrics} siteId={siteId} />
      </div>
    )
  }

  // Measured on this site over this period — not modelled, and not shown at all
  // below a sample where a ratio would be noise dressed as a benchmark.
  const podium = metrics.bands[0]
  const podiumCtr = podium.impressions >= PODIUM_MIN_SAMPLE ? podium.clicks / podium.impressions : null
  const strikingCtr = striking.impressions > 0 ? striking.clicks / striking.impressions : 0
  const maxStrikingImpressions = Math.max(...striking.queries.map((query) => query.impressions), 1)
  const maxZeroClickImpressions = Math.max(...metrics.zeroClickPages.map((page) => page.impressions), 1)
  const maxBandImpressions = Math.max(...metrics.bands.map((band) => band.impressions), 1)

  return (
    <div>
      <SourceNote
        source="Google Search Console, synchronisé chaque nuit"
        period={period}
        note={
          <>
            {formatCount(coverage.rows)} lignes · {formatCount(coverage.pages)} pages ·{' '}
            {formatCount(coverage.queries)} requêtes
            {metrics.property
              ? ` · propriété ${metrics.property}`
              : ` · agrégé sur ${formatCount(metrics.connectedCount)} sites connectés`}
          </>
        }
      />

      {coverage.lastDate && coverage.lastDate < window.end && (
        <p className="meta performance__lag">
          Search Console publie ses chiffres avec deux à trois jours de retard : les données s&apos;arrêtent au{' '}
          {formatDayLong(coverage.lastDate)}, ce n&apos;est pas une chute de trafic.
        </p>
      )}

      {metrics.disconnected.length > 0 && <DisconnectedNotice sites={metrics.disconnected} />}

      {/* The one number this view leads with. */}
      <section className="panel performance__lead">
        <div className="panel__body performance__lead-body">
          <div className="performance__figure">
            <HeroFigure
              label="Le gisement"
              value={striking.total}
              format="number"
              caption={`requête${striking.total > 1 ? 's' : ''} déjà classée${striking.total > 1 ? 's' : ''} entre la ${striking.minPosition}ᵉ et la ${striking.maxPosition}ᵉ place`}
            />
          </div>

          <div className="performance__claim">
            <p className="performance__claim-text">
              Elles ont été affichées {formatCount(striking.impressions)} fois et n&apos;ont rapporté que{' '}
              {formatCount(striking.clicks)} clic{striking.clicks > 1 ? 's' : ''} ({formatPercent(strikingCtr)}).
            </p>
            {podiumCtr !== null && (
              <p className="meta performance__claim-note">
                Sur ce même site, les positions 1-3 convertissent {formatPercent(podiumCtr, 1)} de leurs impressions. La
                page existe déjà et Google la montre déjà : la faire monter coûte moins cher que d&apos;en écrire une
                nouvelle.
              </p>
            )}
          </div>

          {/* On a site, the cycle is planned from its own Stratégie tab; the
              creation form only when no single site is in scope. */}
          <Link href={siteId ? `/sites/${siteId}/strategie` : '/strategy/new'} className="btn-primary performance__cta">
            Planifier un cycle
          </Link>
        </div>
      </section>

      <div className="kpi-row dashboard-row">
        <StatTile
          icon={Eye}
          label="Impressions"
          value={formatCompact(totals.impressions)}
          hint="Nombre de fois où une page du site est apparue dans les résultats"
        />
        <StatTile
          icon={MousePointerClick}
          label="Clics"
          value={formatCompact(totals.clicks)}
          hint="Visites réellement gagnées depuis la recherche Google"
        />
        <StatTile
          icon={Target}
          label="CTR moyen"
          value={formatPercent(totals.ctr)}
          hint="Clics ÷ impressions, recalculé sur les totaux — pas une moyenne de moyennes"
        />
        <StatTile
          icon={BarChart3}
          label="Position moyenne"
          value={formatPosition(totals.position)}
          hint="Pondérée par les impressions : un jour à une impression ne pèse pas comme un jour à mille"
        />
      </div>

      <div className="dashboard-block">
        <Panel
          title={`Les requêtes en position ${striking.minPosition} à ${striking.maxPosition}`}
          subtitle="Classées par volume d'affichage. Une place gagnée ici se paye en optimisation, pas en rédaction."
          icon={TrendingUp}
        >
          {striking.queries.length === 0 ? (
            <p className="meta dashboard__lead">
              Aucune requête de ce site ne se classe entre la {striking.minPosition}ᵉ et la {striking.maxPosition}ᵉ place
              sur la période. Il n&apos;y a pas de gisement à exploiter pour l&apos;instant — la priorité reste de
              publier et de se faire indexer.
            </p>
          ) : (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Requête</th>
                    <th scope="col">Page</th>
                    <th scope="col" className="cell-num dashboard-cell--nowrap">Position</th>
                    <th scope="col" className="performance__col-impressions">Impressions</th>
                    <th scope="col" className="cell-num">Clics</th>
                  </tr>
                </thead>
                <tbody>
                  {striking.queries.map((query) => (
                    <tr key={`${query.query}-${query.pageUrl}`}>
                      <th scope="row" className="cell-strong">{query.query}</th>
                      <td>
                        <a
                          href={query.pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="meta performance__page-link"
                        >
                          {shortenUrl(query.pageUrl)}
                        </a>
                      </td>
                      <td className="cell-num dashboard-cell--nowrap">{formatPosition(query.position)}</td>
                      <td>
                        <div className="performance__bar-cell">
                          <span className="num performance__bar-value performance__bar-value--44">
                            {formatCount(query.impressions)}
                          </span>
                          <span className="performance__bar performance__bar--60">
                            <MagnitudeBar value={query.impressions} max={maxStrikingImpressions} />
                          </span>
                        </div>
                      </td>
                      <td className="cell-num">{formatCount(query.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {striking.total > striking.queries.length && (
                <p className="meta dashboard__after">
                  {striking.queries.length} requêtes affichées sur {striking.total} dans la tranche.
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--gap-below">
        <Panel
          title="Où sont les impressions"
          subtitle={`Par tranche de position. Le gisement (positions ${striking.minPosition} à ${striking.maxPosition}) couvre la fin de la deuxième tranche et toute la troisième.`}
          icon={BarChart3}
        >
          {/* Four ordered rows with three measures each: a table, not a chart.
              The bar carries the comparison, and every figure — clicks and
              couples included — is printed. They used to appear only while the
              pointer rested on the band. */}
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Tranche</th>
                  <th scope="col" className="performance__col-impressions--band">Impressions</th>
                  <th scope="col" className="cell-num">Clics</th>
                  <th scope="col" className="cell-num">Couples</th>
                </tr>
              </thead>
              <tbody>
                {metrics.bands.map((band) => (
                  <tr key={band.id}>
                    <th scope="row">
                      <span className="cell-strong performance__band">
                        {band.label}
                        {band.id === 'page2' && <span className="chip performance__band-chip">Gisement</span>}
                      </span>
                      <span className="meta">{band.hint}</span>
                    </th>
                    <td>
                      <div className="performance__bar-cell">
                        <span className="num performance__bar-value performance__bar-value--48">
                          {formatCount(band.impressions)}
                        </span>
                        <span className="performance__bar performance__bar--56">
                          <MagnitudeBar value={band.impressions} max={maxBandImpressions} />
                        </span>
                      </div>
                    </td>
                    <td className="cell-num">{formatCount(band.clicks)}</td>
                    <td className="cell-num">{formatCount(band.couples)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Vues, jamais cliquées"
          subtitle="Pages affichées au moins 10 fois sans récolter un seul clic — un problème de titre ou de promesse, pas de contenu."
          icon={Link2Off}
        >
          {metrics.zeroClickPages.length === 0 ? (
            <p className="meta dashboard__lead">
              Aucune page dans ce cas : toutes les pages suffisamment affichées ont récolté au moins un clic.
            </p>
          ) : (
            <>
              <div className="scroll-x">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Page</th>
                      <th scope="col" className="cell-num dashboard-cell--nowrap">Position</th>
                      <th scope="col" className="performance__col-impressions--page">Impressions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.zeroClickPages.map((page) => (
                      <tr key={page.pageUrl}>
                        <th scope="row">
                          <a
                            href={page.pageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cell-strong performance__page"
                          >
                            {shortenUrl(page.pageUrl)}
                          </a>
                          {page.topQuery && <span className="meta">requête principale : {page.topQuery}</span>}
                        </th>
                        <td className="cell-num dashboard-cell--nowrap">{formatPosition(page.position)}</td>
                        <td>
                          <div className="performance__bar-cell">
                            <span className="num performance__bar-value performance__bar-value--38">
                              {formatCount(page.impressions)}
                            </span>
                            <span className="performance__bar performance__bar--50">
                              <MagnitudeBar value={page.impressions} max={maxZeroClickImpressions} />
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="meta dashboard__after">
                Total affiché sans clic : {formatCount(metrics.zeroClickImpressions)} impressions.
              </p>
            </>
          )}
        </Panel>
      </div>

      <div className="dashboard-grid">
        <Panel title="Impressions par jour" subtitle="Search Console" icon={Eye}>
          <LineChart
            series={[
              {
                id: 'impressions',
                name: 'Impressions',
                slot: 1,
                points: metrics.perDay.map((day) => ({ label: formatDay(day.date), value: day.impressions })),
              },
            ]}
            area
            height={190}
          />
        </Panel>

        <Panel title="Clics par jour" subtitle="Search Console" icon={MousePointerClick}>
          <LineChart
            series={[
              {
                id: 'clicks',
                name: 'Clics',
                // Pinned to slot 2: clicks keep their hue whatever else is on
                // screen, so the two panels never swap colours.
                slot: 2,
                points: metrics.perDay.map((day) => ({ label: formatDay(day.date), value: day.clicks })),
              },
            ]}
            area
            height={190}
          />
        </Panel>
      </div>

      <p className="meta dashboard__after-lead">
        Deux graphes séparés, volontairement : impressions et clics n&apos;ont pas le même ordre de grandeur. Les
        superposer sur un double axe ferait apparaître une corrélation que les chiffres ne contiennent pas.
      </p>
    </div>
  )
}

// ─── Unavailability ──────────────────────────────────────────────────────────

/**
 * Five ways of having no chart, five different screens.
 *
 * A site with no Google connection must be offered the connection, never a row
 * of zeros — a zero is a measurement, and there is nothing to measure yet.
 */
function UnavailableState({ metrics, siteId }: { metrics: PerformanceMetrics; siteId: string | null }) {
  const target = metrics.disconnected.length === 1 ? metrics.disconnected[0] : null

  switch (metrics.availability) {
    case 'no-site':
      return (
        <EmptyState
          variant="not-connected"
          icon={PlugZap}
          title="Aucun site connecté"
          description="Search Console mesure un site. Ajoutez-en un, puis autorisez Google : les statistiques seront récupérées automatiquement."
          action={{ label: 'Ajouter un site', href: '/sites/new' }}
        />
      )

    case 'not-connected':
      return (
        <EmptyState
          variant="not-connected"
          icon={PlugZap}
          title="Search Console n'est pas connectée"
          description={
            target
              ? `${target.name} n'a jamais été relié à Google. Sans cette autorisation, aucune impression, aucun clic et aucune position ne peut être affiché — ce n'est pas un trafic nul, c'est une absence de mesure.`
              : "Aucun des sites de ce scope n'est relié à Google. Sans autorisation, il n'y a pas de mesure à afficher — ce n'est pas un trafic nul."
          }
          action={
            target
              ? { label: 'Connecter Google', href: `/api/google/auth?site_id=${target.id}` }
              : { label: 'Voir les sites', href: '/sites' }
          }
        />
      )

    case 'no-property':
      return (
        <EmptyState
          variant="not-connected"
          icon={Search}
          title="Google est autorisé, la propriété reste à choisir"
          description="L'accès OAuth est en place mais aucune propriété Search Console n'a été sélectionnée pour ce site, donc rien n'est synchronisé."
          action={
            target || siteId
              ? { label: 'Choisir la propriété', href: `/sites/${target?.id ?? siteId}/google/select` }
              : { label: 'Voir les sites', href: '/sites' }
          }
        />
      )

    case 'connected-no-data':
      return (
        <EmptyState
          variant="no-data"
          icon={Search}
          title="Connectée, pas encore de données"
          description="La propriété Search Console est bien reliée, mais aucune ligne n'a encore été importée. La synchronisation récupère l'historique après la connexion ; comptez quelques minutes, et sachez que Google ne publie ses chiffres qu'avec deux à trois jours de décalage."
        />
      )

    case 'no-data-in-window':
      return (
        <EmptyState
          variant="no-results"
          icon={Search}
          title="Aucune donnée sur cette période"
          description="Des données existent pour ce site, mais aucune ne tombe dans la fenêtre choisie. Élargissez la période pour les voir."
        />
      )

    default:
      return (
        <EmptyState
          variant="error"
          icon={Link2Off}
          title="Lecture impossible"
          description="Les mesures Search Console enregistrées n'ont pas pu être lues. Aucun chiffre n'est affiché plutôt que des zéros trompeurs."
        />
      )
  }
}

function DisconnectedNotice({ sites }: { sites: DashboardSite[] }) {
  return (
    <div className="panel dashboard-notice">
      <div className="dashboard-notice__row">
        <PlugZap size={16} color="var(--status-warning)" className="notice__icon" />
        <div className="dashboard-notice__text">
          {sites.length === 1 ? 'Ce site est exclu des chiffres ci-dessous' : 'Ces sites sont exclus des chiffres ci-dessous'}{' '}
          faute de Search Console :{' '}
          {sites.map((site, index) => (
            <span key={site.id}>
              {index > 0 && ', '}
              <strong className="dashboard__strong">{site.name}</strong>{' '}
              <Link
                href={site.googleConnected ? `/sites/${site.id}/google/select` : `/api/google/auth?site_id=${site.id}`}
                className="btn-link"
              >
                ({site.googleConnected ? 'choisir la propriété' : 'connecter'})
              </Link>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
