// ─────────────────────────────────────────────────────────────────────────────
// Le suivi des pages publiées — chacune, depuis le jour de sa mise en ligne
//
// Demande du propriétaire (08/11/2026) : « une manière de gérer le suivi d'une
// publication sur Google Search et l'interpréter ». La vue Search Console dit
// ce que Google fait du SITE sur une période ; celle-ci dit ce qu'il a fait de
// CHAQUE PAGE du moteur depuis sa publication, ce que ça veut dire, et quoi en
// faire (lib/google/tracking.ts).
//
// Les requêtes « inattendues » — celles sur lesquelles Google montre une page
// sans qu'elle les ait choisies — sont la moitié la plus utile : celles qu'aucune
// page du site ne porte reviennent au planificateur comme sujets mesurés
// (`emergingQueries`, section E du prompt).
//
// Composant serveur : la lecture se fait avec la clé de service, rien ne
// traverse vers le client.
// ─────────────────────────────────────────────────────────────────────────────

import { CalendarClock, Compass, ExternalLink, FileText, PlugZap } from 'lucide-react'
import { EmptyState, formatDayLong } from '@/components/ui'
import { EMERGING_MIN_IMPRESSIONS } from '@/lib/google/performance'
import type { QueryKind } from '@/lib/google/query-match'
import {
  trackPublishedPages,
  type PublicationTracking,
  type TrackedPage,
  type TrackingTone,
  type UnexpectedQuery,
} from '@/lib/google/tracking'
import { Panel, SourceNote } from '@/app/(dashboard)/dashboard/ui-bits'
import { formatCount, formatPercent, formatPosition, shortenUrl } from '@/app/(dashboard)/dashboard/viz'
import './performances.css'

export const BADGE: Record<TrackingTone, string> = {
  good: 'badge badge-success',
  info: 'badge badge-info',
  warning: 'badge badge-warning',
  critical: 'badge badge-danger',
  muted: 'badge badge-muted',
}

const KIND_LABEL: Record<QueryKind, string> = {
  target: 'mot-clé visé',
  related: 'proche',
  unexpected: 'inattendue',
  brand: 'marque',
}

export async function PublishedTracking({ site }: { site: { id: string; name: string; url: string } }) {
  const tracking = await trackPublishedPages(site)

  if (tracking.state === 'no_publication') {
    return (
      <EmptyState
        variant="no-data"
        icon={FileText}
        title="Aucune page publiée par le moteur depuis six mois"
        description="Le suivi commence le jour où une page du calendrier est publiée : ses impressions, ses positions et les requêtes qui la montrent s’afficheront ici."
        action={{ label: 'Voir le calendrier', href: `/sites/${site.id}/calendrier` }}
      />
    )
  }

  if (tracking.state === 'unreadable') {
    return (
      <EmptyState
        variant="error"
        title="Les mesures Search Console sont illisibles"
        description="Les mesures Search Console enregistrées n’ont pas pu être lues. Ce n’est pas une absence de trafic : rien ne peut être conclu tant qu’elles ne sont pas lisibles."
      />
    )
  }

  if (tracking.state === 'no_data') {
    return (
      <EmptyState
        variant="not-connected"
        icon={PlugZap}
        title="Search Console n’a encore rien rapporté pour ce site"
        description="Les pages sont publiées, mais aucune donnée Search Console n’est stockée : sans elle, ni impression ni position ne peut être suivie. Ce n’est pas un trafic nul, c’est une absence de mesure."
        action={{ label: 'Voir la connexion Google', href: `/sites/${site.id}/performances?vue=search` }}
      />
    )
  }

  return (
    <div>
      <SourceNote
        source="pages publiées par le moteur × Search Console"
        period={`depuis la publication de chaque page — données jusqu’au ${formatDayLong(tracking.lastDataDate ?? '')}`}
        note={<>{tracking.pages.length} page{tracking.pages.length > 1 ? 's' : ''} suivie{tracking.pages.length > 1 ? 's' : ''}</>}
      />

      <p className="meta tracking-lede">
        Search Console publie avec deux à trois jours de retard, et une page neuve met une à deux semaines à apparaître :
        le verdict tient compte de l’âge de chaque page. Les positions sont calculées hors requêtes de marque.
      </p>

      <VerdictSummary pages={tracking.pages} />

      <div className="tracking-pages">
        {tracking.pages.map((page) => <PageCard key={page.generationId} page={page} />)}
      </div>

      <UnexpectedPanel tracking={tracking} />
    </div>
  )
}

function VerdictSummary({ pages }: { pages: readonly TrackedPage[] }) {
  const counts = new Map<string, { label: string; tone: TrackingTone; count: number }>()
  for (const page of pages) {
    const entry = counts.get(page.verdict) ?? { label: page.interpretation.label, tone: page.interpretation.tone, count: 0 }
    entry.count += 1
    counts.set(page.verdict, entry)
  }

  return (
    <div className="tracking-verdicts">
      {[...counts.values()].map((entry) => (
        <span key={entry.label} className={BADGE[entry.tone]}>
          {entry.count} · {entry.label}
        </span>
      ))}
    </div>
  )
}

function PageCard({ page }: { page: TrackedPage }) {
  const { interpretation } = page
  const shownQueries = page.queries.length

  return (
    <section className="panel">
      <header className="panel__header tracking-card__header">
        <div className="tracking-card__titles">
          <h3 className="card-title">
            <a href={page.pageUrl} target="_blank" rel="noopener noreferrer" className="tracking-card__link">
              {page.title || shortenUrl(page.pageUrl)}
              <ExternalLink size={12} aria-hidden="true" className="external-mark" />
            </a>
          </h3>
          <p className="meta tracking-card__context">
            Publiée le {formatDayLong(page.publishedAt.slice(0, 10))} · J+{page.daysLive}
            {page.firstImpressionOn && ` · première impression le ${formatDayLong(page.firstImpressionOn)}`}
            {page.focusKeyword && <> · visée : « {page.focusKeyword} »</>}
          </p>
        </div>
        <span className={`${BADGE[interpretation.tone]} verdict-badge`}>{interpretation.label}</span>
      </header>

      <div className="panel__body tracking-card__body">
        <div className="tracking-figures">
          <Figure label="Impressions" value={formatCount(page.impressions)} />
          <Figure label="Clics" value={formatCount(page.clicks)} />
          <Figure label="CTR" value={page.impressions > 0 ? formatPercent(page.ctr, 1) : '—'} />
          <Figure label="Position (hors marque)" value={page.position === null ? '—' : formatPosition(page.position)} />
          <Figure label="Sur le mot-clé visé" value={page.targetPosition === null ? 'jamais affichée' : formatPosition(page.targetPosition)} />
        </div>

        <p className="tracking-card__text">
          {interpretation.explanation}
        </p>
        <p className="tracking-card__text">
          <strong>À faire :</strong> {interpretation.action}
        </p>

        {interpretation.insights.length > 0 && (
          <ul className="meta tracking-card__insights">
            {interpretation.insights.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}

        {shownQueries > 0 && (
          <details>
            <summary className="meta tracking-card__toggle">
              Les {shownQueries} requête{shownQueries > 1 ? 's' : ''} qui l’ont montrée
            </summary>
            <div className="scroll-x tracking-card__queries">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Requête</th>
                    <th scope="col">Lien avec la page</th>
                    <th scope="col" className="cell-num">Impressions</th>
                    <th scope="col" className="cell-num">Clics</th>
                    <th scope="col" className="cell-num">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {page.queries.map((query) => (
                    <tr key={query.query}>
                      <th scope="row" className="cell-strong">{query.query}</th>
                      <td><span className={query.kind === 'unexpected' ? 'chip' : 'meta'}>{KIND_LABEL[query.kind]}</span></td>
                      <td className="cell-num">{formatCount(query.impressions)}</td>
                      <td className="cell-num">{formatCount(query.clicks)}</td>
                      <td className="cell-num">{formatPosition(query.position)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </section>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="meta">{label}</div>
      <div className="num tracking-figure__value">{value}</div>
    </div>
  )
}

function UnexpectedPanel({ tracking }: { tracking: PublicationTracking }) {
  return (
    <Panel
      title="Ce que Google associe aux pages sans qu’elles l’aient choisi"
      subtitle="Les requêtes qui montrent les pages publiées sans partager leur sujet. Celles qu’aucune page du site ne traite, vues au moins 5 fois, sont proposées comme sujets aux prochains plans."
      icon={Compass}
    >
      {tracking.unexpected.length === 0 ? (
        <p className="meta tracking-none">
          Aucune pour l’instant : chaque page n’est montrée que sur son sujet, ses variantes proches ou le nom du site.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Requête</th>
                <th scope="col" className="cell-num">Impressions</th>
                <th scope="col" className="cell-num">Meilleure position</th>
                <th scope="col">Montrée via</th>
                <th scope="col">Pour le moteur</th>
              </tr>
            </thead>
            <tbody>
              {tracking.unexpected.map((query) => (
                <tr key={query.query}>
                  <th scope="row" className="cell-strong">{query.query}</th>
                  <td className="cell-num">{formatCount(query.impressions)}</td>
                  <td className="cell-num">{formatPosition(query.position)}</td>
                  <td>
                    <span className="meta">
                      {query.pages.slice(0, 2).map((page) => shortenUrl(page.pageUrl)).join(', ')}
                      {query.pages.length > 2 && ` +${query.pages.length - 2}`}
                    </span>
                  </td>
                  <td><span className="meta">{fateOf(query)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="meta tracking-planner-note">
        <CalendarClock size={12} aria-hidden="true" />
        Le planificateur relit ces requêtes sur 90 jours à chaque nouveau plan, pas seulement celles des pages du moteur.
      </p>
    </Panel>
  )
}

/** Une adresse lisible dans une phrase : la racine du site a un nom. */
function pageName(url: string): string {
  try {
    if (new URL(url).pathname.replace(/\/+$/, '') === '') return 'la page d’accueil'
  } catch {
    // Not a URL: shown as is.
  }
  return shortenUrl(url)
}

/** Ce que le planificateur fera de la requête — la règle de selectEmergingQueries, dite en clair. */
function fateOf(query: UnexpectedQuery): string {
  const page = query.heldBy ? pageName(query.heldBy.url) : 'une autre page du site'
  switch (query.fate) {
    case 'carried':
      return `Déjà classée ${query.heldBy?.position ? `${formatPosition(query.heldBy.position)} ` : ''}par ${page} : la renforcer, ne pas la doubler.`
    case 'disputed':
      return `Plusieurs pages du site se la disputent déjà (à garder : ${page}) : aucune page de plus.`
    case 'covered':
      return `Déjà traitée par ${page} : aucune page neuve.`
    case 'rare':
      return `À surveiller : moins de ${EMERGING_MIN_IMPRESSIONS} impressions, pas encore une demande.`
    case 'candidate':
      return 'Proposée comme sujet d’une page neuve aux prochains plans, si elle relève de l’activité de la campagne.'
  }
}
