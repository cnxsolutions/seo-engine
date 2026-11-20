// ─────────────────────────────────────────────────────────────────────────────
// L'onglet « Indexation » — chaque page connue du site est-elle dans Google ?
//
// Demande du propriétaire (17/11/2026) : vérifier les pages de chaque site,
// voir si elles sont indexées, et renvoyer automatiquement celles qui ne le
// sont pas. Le job de 5 h (lib/indexing/check.ts) inspecte les pages dues via
// l'API URL Inspection ; cet écran lit ce qu'il a enregistré (page_indexing)
// et dit, pour chaque page, qui doit agir : le moteur (sitemap renvoyé) ou le
// site (noindex, 404, canonique, contenu).
//
// Composant serveur : la lecture se fait avec la clé de service, rien ne
// traverse vers le client sauf le bouton « Vérifier maintenant ».
// ─────────────────────────────────────────────────────────────────────────────

import { ExternalLink, PlugZap, ScanSearch } from 'lucide-react'
import { EmptyState, SourceNote, TabNav, formatDayLong, shortenUrl } from '@/components/ui'
import { getGoogleConnection } from '@/lib/google/client'
import { describeIndexState, INDEX_GROUP_LABELS } from '@/lib/indexing/describe'
import { countIndexStates, lastInspectionAt, listIndexingPage, type PageIndexingRow } from '@/lib/indexing/store'
import { INDEX_STATE_GROUPS, type IndexStateGroup } from '@/src/core/domain/indexing/status'
import { CheckIndexingButton } from './CheckIndexingButton'
import { BADGE } from './PublishedTracking'

const PAGE_SIZE = 50

/** Tab order, and the order in which the first non-empty group is opened by default. */
const GROUP_ORDER: readonly IndexStateGroup[] = ['to_fix', 'not_indexed', 'unchecked', 'indexed']

export async function IndexingStatus({ siteId, group, page }: { siteId: string; group?: string; page: number }) {
  const connection = await getGoogleConnection(siteId).catch(() => null)
  if (!connection) {
    return (
      <EmptyState
        variant="not-connected"
        icon={PlugZap}
        title="Google n’est pas connecté pour ce site"
        description="La vérification de l’indexation passe par Search Console : connecter le compte Google du site, puis choisir sa propriété."
        action={{ label: 'Connecter Google', href: `/sites/${siteId}/reglages` }}
      />
    )
  }
  if (!connection.gsc_site_url) {
    return (
      <EmptyState
        variant="not-connected"
        icon={PlugZap}
        title="Aucune propriété Search Console choisie"
        description="Google est connecté, mais le moteur ne sait pas quelle propriété Search Console interroger pour ce site."
        action={{ label: 'Choisir la propriété', href: `/sites/${siteId}/google/select` }}
      />
    )
  }

  const summary = await Promise.all([countIndexStates(siteId), lastInspectionAt(siteId)]).catch(() => null)
  if (!summary) return <Unreadable />
  const [counts, lastCheck] = summary

  const groupCount = (key: IndexStateGroup) => INDEX_STATE_GROUPS[key].reduce((total, state) => total + counts[state], 0)
  const total = GROUP_ORDER.reduce((sum, key) => sum + groupCount(key), 0)

  const header = (
    <>
      <SourceNote
        source={`Search Console · Inspection de l’URL (${connection.gsc_site_url})`}
        period={lastCheck ? `dernière vérification le ${formatDayLong(lastCheck)}` : 'aucune vérification encore'}
        note={<>{total} page{total > 1 ? 's' : ''} suivie{total > 1 ? 's' : ''}</>}
      />
      <p className="meta" style={{ margin: 'calc(-1 * var(--space-3)) 0 var(--space-4)', lineHeight: 'var(--lh-normal)' }}>
        Chaque nuit à 5 h, le moteur inspecte les pages dues — une page non indexée à J+2, J+4, J+7 puis chaque semaine,
        une page indexée chaque mois. Google n’offre aucune API pour « Demander l’indexation » : pour une page qu’il
        n’a pas encore explorée, le moteur renvoie le sitemap (et IndexNow pour Bing). Les autres cas se corrigent sur le site.
      </p>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <CheckIndexingButton siteId={siteId} />
      </div>
    </>
  )

  if (total === 0) {
    return (
      <div>
        {header}
        <EmptyState
          icon={ScanSearch}
          title="Aucune page vérifiée pour l’instant"
          description="La première vérification relève toutes les pages publiées par le moteur et celles trouvées en lisant le site, puis interroge Google sur chacune."
        />
      </div>
    )
  }

  const requested = GROUP_ORDER.find((key) => key === group)
  const active = requested ?? GROUP_ORDER.find((key) => groupCount(key) > 0) ?? 'indexed'
  const currentPage = Math.max(1, Math.floor(page))
  const listing = await listIndexingPage(siteId, INDEX_STATE_GROUPS[active], {
    offset: (currentPage - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  }).catch(() => null)
  if (!listing) return <Unreadable />
  const { rows, total: groupTotal } = listing
  const lastPage = Math.max(1, Math.ceil(groupTotal / PAGE_SIZE))
  const hrefFor = (key: IndexStateGroup, p = 1) =>
    `/sites/${siteId}/performances?${new URLSearchParams({ vue: 'indexation', etat: key, ...(p > 1 ? { p: String(p) } : {}) }).toString()}`

  return (
    <div>
      {header}

      <TabNav
        items={GROUP_ORDER.map((key) => ({ id: key, label: INDEX_GROUP_LABELS[key], href: hrefFor(key), count: groupCount(key) }))}
        active={active}
        ariaLabel="État d’indexation"
      />

      {rows.length === 0 ? (
        <p className="meta" style={{ lineHeight: 'var(--lh-normal)' }}>Aucune page dans cet état.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
          {rows.map((row) => <IndexRow key={row.id} row={row} />)}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label="Pages de résultats" className="meta" style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', marginTop: 'var(--space-5)' }}>
          {currentPage > 1 && <a href={hrefFor(active, currentPage - 1)}>← Précédentes</a>}
          <span>Page {currentPage} sur {lastPage}</span>
          {currentPage < lastPage && <a href={hrefFor(active, currentPage + 1)}>Suivantes →</a>}
        </nav>
      )}
    </div>
  )
}

function Unreadable() {
  return (
    <EmptyState
      variant="error"
      title="L’état d’indexation est illisible"
      description="La table page_indexing n’a pas pu être lue (migration 020 appliquée ?). Ce n’est pas une absence d’indexation : rien ne peut être conclu tant qu’elle ne répond pas."
    />
  )
}

function IndexRow({ row }: { row: PageIndexingRow }) {
  const description = describeIndexState(row)

  return (
    <li className="panel" style={{ padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="cell-strong"
          style={{ color: 'inherit', minWidth: 0, overflowWrap: 'anywhere' }}
        >
          {shortenUrl(row.url)}
          <ExternalLink size={12} aria-hidden="true" style={{ marginLeft: 6, verticalAlign: 'baseline' }} />
        </a>
        <span className={BADGE[description.tone]} style={{ flexShrink: 0 }}>{description.label}</span>
      </div>

      {row.coverage_state && (
        <p className="meta" style={{ margin: 'var(--space-1) 0 0' }}>Google : « {row.coverage_state} »</p>
      )}

      <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-normal)' }}>
        {description.advice}
      </p>

      <p className="meta" style={{ margin: 'var(--space-2) 0 0', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-3)' }}>
        {row.generation_id && <span>Page du moteur</span>}
        {row.last_crawl_at && <span>Dernier passage de Google le {formatDayLong(row.last_crawl_at)}</span>}
        {row.inspected_at && <span>Vérifiée le {formatDayLong(row.inspected_at)}</span>}
        {row.state !== 'indexed' && <span>Prochaine vérification le {formatDayLong(row.next_check_at)}</span>}
        {row.last_resubmitted_at && <span>Sitemap renvoyé le {formatDayLong(row.last_resubmitted_at)}</span>}
        {row.inspection_link && (
          <a href={row.inspection_link} target="_blank" rel="noopener noreferrer">Ouvrir dans Search Console</a>
        )}
      </p>

      {row.last_error && (
        <p className="meta" role="status" style={{ margin: 'var(--space-1) 0 0', color: 'var(--status-critical-text)' }}>
          Dernier appel en échec : {row.last_error}
        </p>
      )}
    </li>
  )
}
