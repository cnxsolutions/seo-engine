// ─────────────────────────────────────────────────────────────────────────────
// Pages déjà en ligne — ce que le moteur sait du site qu'il écrit
// ─────────────────────────────────────────────────────────────────────────────
//
// `site_pages` n'apparaissait dans AUCUN fichier de l'interface : le
// propriétaire n'avait jamais pu voir ce que le moteur croit savoir de son
// propre site. Le moteur, lui, s'en sert pour refuser des doublons. Un verdict
// rendu sur des données invisibles est indiscutable au sens le plus mauvais du
// terme — cet écran rend la source discutable.
//
// UNE RÈGLE GOUVERNE TOUT L'ÉCRAN : quand le moteur ne SAIT pas, on le DIT.
// « Aucun crawl, donc rien à compter » et « zéro page » sont deux faits, et
// `crawledCount` est `number | null` pour cette seule raison. Un repli à zéro
// ici annoncerait au propriétaire que son site est vide, exactement au moment
// où le moteur s'apprête à écrire par-dessus ses pages.
//
// COMPOSANT SERVEUR, sans 'use client'. Le filtre et la pagination vivent dans
// l'URL : une vue filtrée se partage et survit à un rechargement, et le tableau
// ne coûte pas un octet de JavaScript. La seule interaction restante —
// « Mettre à jour cette page » — est désormais CÂBLÉE sur
// POST /api/generations/refresh, et elle est le seul îlot client de l'écran
// (./RefreshRequestButton). Elle reste rendue DÉSACTIVÉE AVEC SON MOTIF, jamais
// masquée, dans les régimes où le moteur ne peut pas juger ce qu'il remplacerait.
//
// ET ELLE NE REMPLACE RIEN. Le clic enregistre une intention : une ligne
// `generations` d'intention 'refresh' qui attendra un second clic humain à
// l'étape Publier, devant un panneau qui nomme la page visée. Aucun
// rafraîchissement ne part jamais tout seul, et le moteur ne supprime, ne
// fusionne et ne redirige aucune page.
//
// La lecture se fait EN DIRECT, sans passer par GET /api/sites/[id]/inventory :
// c'est le patron de sites/[id]/google/page.tsx, qui appelle getGoogleSyncState
// sans aller-retour HTTP. La route existe pour les consommateurs CLIENTS. Mais
// le filtre, le tri et la pagination passent par `projectInventory`, la fonction
// pure que la route appelle aussi — deux implémentations du même découpage
// divergeraient, et la première divergence visible serait une page N+1 qui
// réaffiche une ligne de la page N.

import { ExternalLink, Library, Minus, RefreshCw, SearchX } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { INVENTORY_PAGE_SIZE, projectInventory } from '@/app/api/sites/[id]/inventory/project'
import type { InventoryEntryDto, InventorySummary } from '@/app/api/sites/[id]/inventory/types'
import {
  EmptyState,
  Notice,
  PageHeader,
  RiskBadge,
  StatTile,
  StatusBadge,
  UnknownValue,
  formatDay,
  formatDayLong,
  type NoticeTone,
} from '@/components/ui'
import { loadSiteInventory } from '@/lib/existing/inventory'
import { createServiceClient } from '@/lib/supabase'
import type { InventoryOrigin } from '@/src/core/domain/existing/inventory'
import { RefreshRequestButton } from './RefreshRequestButton'

export const dynamic = 'force-dynamic'

/** Le seul chemin de crawl que le produit possède : POST /api/analysis-runs exige
 *  un type d'activité, un nom, des concurrents et des villes, et aucun endpoint
 *  ne se contente de recrawler un site. Un bouton « Relancer une analyse » sans
 *  route derrière est un bouton qui ne fait rien. */
const ANALYSE_HREF = '/strategy/new'

export default async function SiteExistingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams

  const { data: site } = await createServiceClient()
    .from('sites')
    .select('id, name, url')
    .eq('id', id)
    .maybeSingle()

  // La route d'inventaire, elle, ne rend JAMAIS 404 : elle sert un inventaire
  // aveugle dont le motif nomme la situation. Le contrôle d'existence appartient
  // à l'écran, qui lit déjà `sites` pour son titre.
  if (!site) notFound()

  const q = readText(query.q)
  const origin = readOrigin(query.origin)
  const requestedPage = Number(readText(query.page) || '1')

  const inventory = await loadSiteInventory(id)
  const view = projectInventory(inventory, {
    page: requestedPage,
    pageSize: INVENTORY_PAGE_SIZE,
    q: q || undefined,
    origin,
  })

  const { summary, entries, total, pageSize } = view
  const filtering = q !== '' || origin !== undefined
  const banner = freshnessBanner(summary, site.url)
  const refreshBlockedReason = refreshUnavailableReason(summary)

  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const firstRow = total === 0 ? 0 : (view.page - 1) * pageSize + 1
  const lastRow = Math.min(total, view.page * pageSize)

  return (
    <div>
      <PageHeader
        icon={Library}
        badge="EXISTANT"
        title="Pages déjà en ligne"
        subtitle="Ce que le moteur sait être publié sur ce site. Il ne peut éviter de dupliquer que ce qu’il voit."
        backHref="/sites"
        actions={<StatusBadge status={summary.freshness} />}
        meta={
          <>
            <span>{site.name}</span>
            <span className="truncate">{site.url}</span>
            <span>
              Dernière analyse&nbsp;:{' '}
              {summary.lastCrawledAt ? formatDayLong(summary.lastCrawledAt) : 'jamais'}
            </span>
            <span>
              {summary.crawledCount === null
                ? 'Pages vues sur le site : inconnu'
                : `${countLabel(summary.crawledCount)} vues sur le site`}
            </span>
            <span>{countLabel(summary.publishedCount)} publiées par le moteur</span>
          </>
        }
      />

      {/* Le bandeau de régime n'est jamais masqué ni repliable : il décrit une
          limite permanente de ce que le moteur voit, pas une notification. */}
      <Notice tone={banner.tone} title={banner.title} body={banner.body} action={banner.action} />

      {summary.truncated && (
        <Notice
          tone="warning"
          title="Inventaire partiel"
          body={`Le plafond de crawl a été atteint : ${countLabel(summary.crawledCount)} lues, il y en a davantage. Les seuils anti-doublon sont durcis en conséquence — un inventaire partiel rend le moteur plus prudent, jamais plus confiant.`}
        />
      )}

      <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Pages vues sur le site"
          // JAMAIS de repli à zéro. Un crawl qui a tourné et n'a rien rapporté
          // vaut bien 0 et l'affiche ; un site jamais analysé n'a rien à
          // compter, et c'est ce que la tuile dit.
          value={
            summary.crawledCount ?? (
              <UnknownValue why="Le site n’a jamais été analysé : aucun comptage n’existe." />
            )
          }
          icon={Library}
          hint={
            summary.truncated
              ? 'Crawl plafonné — inventaire partiel, seuils durcis'
              : summary.crawledCount === null
                ? 'Une analyse remplira ce compteur'
                : 'Relevées par l’analyse du site'
          }
        />
        <StatTile
          label="Pages publiées par le moteur"
          // Ce compteur se lit sur les lignes de `generations`, que la lecture
          // rapporte même sur un site jamais crawlé : un 0 ici est un vrai zéro.
          value={summary.publishedCount}
          icon={RefreshCw}
          hint={
            summary.publishedCount === 0
              ? 'Aucune page publiée pour l’instant.'
              : 'Écrites puis mises en ligne par le moteur.'
          }
        />
        <StatTile
          label="Dernière analyse"
          value={summary.lastCrawledAt ? formatDayLong(summary.lastCrawledAt) : 'Jamais'}
          icon={SearchX}
          hint={freshnessHint(summary)}
        />
      </div>

      {/* Un <form method="GET"> et rien d'autre : l'état du filtre EST l'URL,
          donc la vue se partage, se met en favori et se rend côté serveur.
          `page` n'est pas un champ du formulaire, donc une nouvelle recherche
          repart de la première page au lieu d'atterrir sur une page vide. */}
      <form method="GET" className="toolbar">
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Filtrer par adresse ou par titre"
          aria-label="Filtrer par adresse ou par titre"
          style={{ maxWidth: '22rem' }}
        />
        <select className="input" name="origin" defaultValue={origin ?? ''} aria-label="Origine des pages">
          <option value="">Toutes les origines</option>
          <option value="crawl">Vues sur le site</option>
          <option value="engine">Publiées par le moteur</option>
        </select>
        <button type="submit" className="btn-secondary">Filtrer</button>
        <span className="toolbar__spacer" />
        <StatusBadge status={summary.freshness} />
      </form>

      <section className="panel">
        <div className="panel__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            <h2 className="card-title">Inventaire</h2>
            {summary.truncated && <RiskBadge level="inconnu" label="Partiel" size="sm" />}
          </div>
          <span className="meta">
            {total === 0 ? 'Aucune ligne' : `${total} ligne${total > 1 ? 's' : ''}`}
            {filtering ? ' après filtre' : ''}
          </span>
        </div>

        {entries.length === 0 ? (
          <div className="panel__body">
            <InventoryEmptyState
              filtering={filtering}
              beyondLastPage={total > 0}
              blindReason={summary.blindReason}
              resetHref={inventoryHref(id, q, origin, 1)}
            />
          </div>
        ) : (
          <div className="panel__body--flush">
            {/* Neuf colonnes débordent `.main-content` bien avant 1280 px, et la
                chaîne Tailwind de ce projet ne compile AUCUNE règle de point de
                rupture : le tableau doit défiler dans son propre conteneur,
                sinon c'est le corps de la page qui défile latéralement. Le
                minWidth est ce qui rend `.scroll-x` effectif — sans lui, la
                table à `width: 100%` se comprime au lieu de déborder. */}
            <div className="scroll-x">
              <table className="data-table" style={{ minWidth: '76rem' }}>
                <thead>
                  <tr>
                    <th scope="col">Adresse</th>
                    <th scope="col">Titre</th>
                    <th scope="col">Description</th>
                    <th scope="col">Requête cible</th>
                    <th scope="col">Canonique</th>
                    <th scope="col">Signaux</th>
                    <th scope="col">Origine</th>
                    <th scope="col" className="cell-num">Vue le</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <InventoryRow
                      key={entry.path}
                      siteId={id}
                      entry={entry}
                      blockedReason={refreshBlockedReason}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="panel__footer">
          {/* Aucune ligne à situer, aucun compteur : « 0 sur 0 » sous un site
              jamais analysé se lirait comme une mesure, et l'état vide au-dessus
              a déjà dit ce qui manque. */}
          {total > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                flexWrap: 'wrap',
                marginBottom: 'var(--space-2)',
              }}
            >
              <span className="num">{`${firstRow}–${lastRow} sur ${total}`}</span>
              <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {view.page > 1 && (
                  <Link className="btn-ghost btn-sm" href={inventoryHref(id, q, origin, view.page - 1)}>
                    Précédent
                  </Link>
                )}
                {view.page < lastPage && (
                  <Link className="btn-ghost btn-sm" href={inventoryHref(id, q, origin, view.page + 1)}>
                    Suivant
                  </Link>
                )}
              </span>
            </div>
          )}
          <p style={{ margin: 0 }}>
            Source&nbsp;: la table site_pages (analyse du site) et les générations publiées. Le corps des
            pages n&apos;est jamais affiché ni chargé&nbsp;: seul un extrait par page est conservé, et c&apos;est
            pourquoi une comparaison de contenu ne prouve jamais l&apos;originalité d&apos;une page.
          </p>
        </div>
      </section>
    </div>
  )
}

// ─── Une ligne ──────────────────────────────────────────────────────────────

function InventoryRow({
  siteId,
  entry,
  blockedReason,
}: {
  siteId: string
  entry: InventoryEntryDto
  /** `null` quand la demande est possible : le bouton est alors actif. */
  blockedReason: string | null
}) {
  const canonicalElsewhere = entry.canonicalPath !== null && entry.canonicalPath !== entry.path

  return (
    <tr>
      <th scope="row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span className="chip">{entry.path}</span>
          {entry.url && (
            <a className="btn-link" href={entry.url} target="_blank" rel="noopener noreferrer">
              Ouvrir <ExternalLink size={11} aria-hidden="true" />
            </a>
          )}
        </div>
        {/* Une entrée sans URL observée est une adresse RÉSERVÉE, pas une page
            servie. Rendre son chemin sans le dire ferait compter au propriétaire
            une page qui n'existe nulle part. */}
        {!entry.url && (
          <div className="meta" style={{ marginTop: 'var(--space-1)' }}>
            Adresse réservée, pas encore en ligne
          </div>
        )}
      </th>

      <td>
        {entry.title ? (
          <div className="cell-strong truncate" title={entry.title} style={{ maxWidth: '22rem' }}>
            {entry.title}
          </div>
        ) : (
          <AbsentText origin={entry.origin} absent="Aucun titre sur la page" />
        )}
      </td>

      <td>
        {entry.metaDescription ? (
          <div className="truncate" title={entry.metaDescription} style={{ maxWidth: '26rem' }}>
            {entry.metaDescription}
          </div>
        ) : (
          <AbsentText origin={entry.origin} absent="Aucune description sur la page" />
        )}
      </td>

      <td>
        {entry.focusKeyword ? <span className="chip">{entry.focusKeyword}</span> : <NoSignal label="Aucune requête cible enregistrée" />}
      </td>

      <td>
        {canonicalElsewhere ? (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}
            title={`Cette page déclare que la version de référence est ${entry.canonicalPath}.`}
          >
            <RiskBadge level="avertissement" label="Canonique ailleurs" size="sm" />
            <span className="chip">{entry.canonicalPath}</span>
          </span>
        ) : (
          // Surtout PAS « canonique ici » : rien n'a été mesuré qui permette de
          // l'affirmer, et une absence de signal n'est pas un signal positif.
          <NoSignal label="Aucune canonique déclarée ailleurs" />
        )}
      </td>

      <td>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {entry.noindex && (
            <span title="Cette page demande à Google de ne pas l’afficher.">
              <RiskBadge level="inconnu" label="Non indexable" size="sm" />
            </span>
          )}
          {entry.bodyIsExcerpt && (
            <span
              className="chip"
              title="Seuls 2000 caractères de cette page sont connus : une faible similarité de contenu ne prouve rien."
            >
              extrait
            </span>
          )}
          {!entry.noindex && !entry.bodyIsExcerpt && <NoSignal label="Aucun signal relevé" />}
        </span>
      </td>

      <td>
        {/* Une PROVENANCE n'est pas un statut. Les clés `connected` / `synced`
            de StatusBadge rendent toutes deux du vert : les deux origines
            sortiraient dans la même couleur, qui affirmerait un « succès » sans
            aucun sens ici. Une catégorie prend le `.chip`, comme page_type
            partout ailleurs dans le produit. */}
        <span className="chip">{entry.origin === 'engine' ? 'Moteur' : 'Crawl'}</span>
      </td>

      <td className="cell-num" style={{ whiteSpace: 'nowrap' }}>
        {entry.observedAt ? (
          formatDay(entry.observedAt)
        ) : (
          <UnknownValue why="Aucune date d’observation n’a été enregistrée pour cette page." />
        )}
      </td>

      <td style={{ minWidth: '16rem' }}>
        {/* Le seul îlot client de l'écran. Désactivé JAMAIS masqué quand le
            régime interdit de juger ce qui serait remplacé, et le motif voyage
            alors en `title` ET en `aria-label` : griser sans dire pourquoi est
            la faute que cet écran existe pour corriger ailleurs. */}
        <RefreshRequestButton
          siteId={siteId}
          entry={entry}
          disabled={blockedReason !== null}
          disabledReason={blockedReason ?? undefined}
        />
      </td>
    </tr>
  )
}

/**
 * Une valeur absente de la page et une valeur jamais relevée sont DEUX faits.
 *
 * Une ligne d'origine 'engine' que le crawl n'a pas encore revue ne dit rien de
 * ce qui est réellement en ligne : afficher « aucune description » serait une
 * mesure inventée. Un tiret nu pour les deux cas est exactement la manière dont
 * une liste commence à mentir.
 */
function AbsentText({ origin, absent }: { origin: InventoryOrigin; absent: string }) {
  return origin === 'engine' ? (
    <UnknownValue why="Cette page a été publiée par le moteur mais n’a pas encore été relue sur le site." />
  ) : (
    <span className="meta">{absent}</span>
  )
}

/** L'absence de signal, en chrome — un glyphe muet pour l'œil, une phrase pour
 *  le lecteur d'écran. --ink-faint mesure 3,50:1 : bon pour un trait, jamais
 *  pour un texte porteur de sens. */
function NoSignal({ label }: { label: string }) {
  return (
    <>
      <Minus size={12} color="var(--ink-faint)" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </>
  )
}

// ─── États vides ────────────────────────────────────────────────────────────

/**
 * `bare` partout : cet état vit dans un `.panel__body`, et sans lui l'EmptyState
 * rendrait un second cadre glass-card imbriqué dans le panneau.
 */
function InventoryEmptyState({
  filtering,
  beyondLastPage,
  blindReason,
  resetHref,
}: {
  filtering: boolean
  beyondLastPage: boolean
  blindReason: InventorySummary['blindReason']
  resetHref: string
}) {
  // Une page de liste au-delà du dernier numéro n'est pas un filtre sans
  // résultat : dire « aucune page ne correspond » enverrait chercher un bug de
  // filtre là où il suffit de revenir en arrière.
  if (beyondLastPage) {
    return (
      <EmptyState
        bare
        variant="no-results"
        title="Cette page de la liste est vide"
        description="Le numéro de page demandé dépasse le nombre de résultats."
        action={{ label: 'Revenir au début de la liste', href: resetHref }}
      />
    )
  }

  if (filtering) {
    return (
      <EmptyState
        bare
        variant="no-results"
        title="Aucune page ne correspond"
        description="Élargissez le filtre ci-dessus."
      />
    )
  }

  // Ton d'invitation, jamais de mur : un site jamais analysé n'est pas une
  // panne, et le moteur ne s'arrête pas pour autant.
  if (blindReason === 'jamais-analyse') {
    return (
      <EmptyState
        bare
        variant="not-connected"
        icon={SearchX}
        title="Ce site n’a jamais été analysé"
        description="Le moteur ne connaît que les pages qu’il a lui-même publiées. Il produira quand même, en vérifiant chaque adresse directement sur le site avant d’écrire — mais il ne peut proposer aucune mise à jour d’une page qu’il n’a jamais vue."
        action={{ label: 'Analyser le site', href: ANALYSE_HREF }}
      />
    )
  }

  return (
    <EmptyState
      bare
      variant="no-data"
      icon={Library}
      title="Aucune page connue sur ce site"
      description="Ni l’analyse ni le moteur n’ont rapporté de page. Un site neuf n’a rien à dupliquer : la génération se fait normalement."
      action={{ label: 'Analyser le site', href: ANALYSE_HREF }}
    />
  )
}

// ─── Régimes de fraîcheur ───────────────────────────────────────────────────

interface FreshnessBanner {
  tone: NoticeTone
  title: string
  body: React.ReactNode
  action?: { label: string; href: string }
}

/**
 * Cinq régimes, cinq titres, cinq phrases.
 *
 * « Jamais analysé » et « analysé, aucune page trouvée » sont deux situations
 * différentes : la première attend un premier crawl, la seconde a déjà reçu sa
 * réponse — généralement un plan de site injoignable ou un site rendu côté
 * client, deux problèmes que seul le propriétaire peut trancher. Les confondre
 * enverrait relancer une analyse qui rendra le même vide.
 *
 * AUCUN régime n'est peint en critique, et le vocabulaire de la panne est banni
 * des cinq formulations : une cécité n'est pas une défaillance, le moteur
 * continue de produire en vérifiant chaque adresse à distance avant d'écrire.
 * Le seul ton qui monte est celui d'un inventaire trop vieux — là, des pages
 * réelles existent et le moteur décide sans les voir.
 *
 * NOTE DE DETTE : app/(dashboard)/publish/queue-bits.tsx doit devenir l'unique
 * foyer de ce dictionnaire (`freshnessNotice`), consommé aussi par /publish et
 * /generate. Le module n'existe pas encore ; ce bloc est écrit sous la forme
 * exacte d'une fonction pure prenant `InventorySummary` pour qu'il y déménage
 * sans réécriture, et pour qu'aucune formulation ne soit inventée deux fois.
 */
function freshnessBanner(summary: InventorySummary, siteUrl: string | null): FreshnessBanner {
  const day = summary.lastCrawledAt ? formatDayLong(summary.lastCrawledAt) : null
  const analyser = { label: 'Analyser le site', href: ANALYSE_HREF }

  if (summary.freshness === 'fresh') {
    return {
      tone: 'good',
      title: 'Inventaire à jour',
      body: `Dernière analyse le ${day}. Le moteur compare chaque nouvelle page aux ${countLabel(
        summary.crawledCount,
      )} ci-dessous avant de l’écrire.`,
    }
  }

  if (summary.freshness === 'stale') {
    return {
      tone: 'warning',
      title: `Inventaire vieux de ${summary.ageDays} jours`,
      body: `Dernière analyse le ${day}. Les pages mises en ligne depuis — par vous, par un autre outil — ne sont pas dans cette liste. Avant chaque écriture, le moteur ira vérifier l’adresse directement sur le site.`,
      action: analyser,
    }
  }

  if (summary.blindReason === 'crawl-trop-vieux') {
    return {
      tone: 'serious',
      title: 'Inventaire trop vieux pour être utilisé',
      body: `Dernière analyse le ${day}, il y a ${summary.ageDays} jours. Le moteur ne s’en sert plus pour décider : il vérifie chaque adresse directement sur le site et ne propose aucune mise à jour.`,
      action: analyser,
    }
  }

  if (summary.blindReason === 'aucune-page-trouvee') {
    return {
      tone: 'warning',
      title: 'L’analyse n’a trouvé aucune page',
      body: (
        <>
          {`Le site a bien été analysé${day ? ` le ${day}` : ''}, mais aucune page n’en est ressortie. Deux explications possibles : le site est neuf, ou l’analyse n’a pas pu le lire (plan du site introuvable, accès bloqué). Tant que ce point n’est pas tranché, le moteur travaille comme s’il ne voyait rien.`}
          {/* L'adresse enregistrée est affichée plutôt que renvoyée derrière un
              lien « vérifier l'adresse » : aucun écran d'édition de site
              n'existe dans ce produit, et un lien vers l'écran de création
              serait une destination fausse. */}
          {siteUrl && (
            <>
              {' '}
              Adresse enregistrée&nbsp;: <span className="mono">{siteUrl}</span>
            </>
          )}
        </>
      ),
      action: analyser,
    }
  }

  return {
    tone: 'info',
    title: 'Le moteur n’a jamais regardé ce site',
    body: 'Aucune analyse n’a été menée. Il ne sait donc pas quelles pages existent déjà, ni quels titres sont pris. Il continue de produire — il vérifie chaque adresse directement sur le site avant d’écrire — mais il ne proposera aucune mise à jour de page existante.',
    action: analyser,
  }
}

/** Une ligne de contexte sous la date, dans le vocabulaire du régime. */
function freshnessHint(summary: InventorySummary): string {
  if (summary.freshness === 'fresh') return 'Inventaire à jour'
  if (summary.freshness === 'stale') return `Analysé il y a ${summary.ageDays} jours`
  if (summary.blindReason === 'crawl-trop-vieux') return `Analysé il y a ${summary.ageDays} jours — trop vieux pour décider`
  if (summary.blindReason === 'aucune-page-trouvee') return 'Analyse menée, aucune page rapportée'
  return 'Aucune analyse n’a jamais tourné'
}

/**
 * Pourquoi « Mettre à jour cette page » est indisponible — ou `null` quand elle
 * ne l'est pas.
 *
 * TROIS MOTIFS ET PAS UN SEUL. Ils ne se réparent pas de la même façon : un
 * site jamais analysé attend un premier crawl, un inventaire trop vieux attend
 * une nouvelle analyse, une analyse revenue vide attend que le propriétaire
 * tranche pourquoi son site n'a pas pu être lu. Écrire le même texte dans les
 * trois cas ferait relancer une analyse qui rendra le même vide.
 *
 * LA GARDE EST LA MÊME QUE CELLE DE LA ROUTE, volontairement : POST
 * /api/generations/refresh répond 409 en régime aveugle, parce qu'on ne
 * rafraîchit pas une page qu'on n'a jamais vue. L'écran ne décide rien de plus,
 * il évite un aller-retour dont l'issue est connue — et il dit pourquoi.
 */
function refreshUnavailableReason(summary: InventorySummary): string | null {
  if (summary.blindReason === 'jamais-analyse') {
    return 'Le site n’a jamais été analysé : le moteur ne peut pas proposer la mise à jour d’une page qu’il n’a pas vue.'
  }
  if (summary.blindReason === 'crawl-trop-vieux') {
    return 'L’inventaire est trop vieux pour décider : analysez le site avant de demander une mise à jour.'
  }
  if (summary.blindReason === 'aucune-page-trouvee') {
    return 'L’analyse n’a rapporté aucune page : le moteur ne sait pas ce qui est réellement en ligne.'
  }
  return null
}

// ─── Lecture de l'URL ───────────────────────────────────────────────────────

function readText(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value
  return (first ?? '').trim()
}

/** Une origine inconnue vaut « toutes » : un paramètre bricolé à la main ne doit
 *  pas produire une liste vide que personne ne saurait expliquer. */
function readOrigin(value: string | string[] | undefined): InventoryOrigin | undefined {
  const raw = readText(value)
  return raw === 'crawl' || raw === 'engine' ? raw : undefined
}

/**
 * Les liens de pagination recopient les TROIS paramètres que cet écran possède,
 * et rien d'autre. Recopier l'intégralité de la requête traînerait derrière
 * chaque clic les paramètres d'une autre vue — ou d'une campagne de tracking —
 * dans une URL que le propriétaire partage.
 */
function inventoryHref(siteId: string, q: string, origin: InventoryOrigin | undefined, page: number): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (origin) params.set('origin', origin)
  if (page > 1) params.set('page', String(page))
  const search = params.toString()
  return `/sites/${siteId}/existing${search ? `?${search}` : ''}`
}

/**
 * « 12 pages », ou l'aveu qu'on ne sait pas compter.
 *
 * Le paramètre accepte `null` pour qu'aucun appelant n'ait besoin d'un repli à
 * zéro : ce repli-là est précisément celui qui écrirait « 0 pages » sur un site
 * que personne n'a jamais analysé.
 */
function countLabel(count: number | null): string {
  if (count === null) return 'un nombre inconnu de pages'
  return `${count} page${count > 1 ? 's' : ''}`
}
