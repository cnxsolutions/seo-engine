'use client'

// ─────────────────────────────────────────────────────────────────────────────
// « Mises à jour à valider » — le clic humain, et rien d'autre
// ─────────────────────────────────────────────────────────────────────────────
//
// C'EST LE GARDE-FOU CENTRAL DU LOT. Le moteur sait proposer de mettre à jour
// une page existante plutôt que d'en ajouter une ; il décide cela avant le
// premier jeton dépensé, et il s'arrête là. AUCUNE MISE À JOUR NE PART SEULE.
// Une ligne `intent='refresh'` reste au statut `generated` jusqu'à ce qu'un
// humain ait lu, dans ce panneau, LE CHEMIN et L'ADRESSE de la page qui va être
// remplacée, et ait cliqué dans une modale qui les répète.
//
// Le propriétaire de ce site a des pages qui rankent. Écraser l'une d'elles sans
// qu'il ait vu ce qui allait disparaître est le pire résultat possible de tout ce
// chantier ; ce fichier existe pour rendre ce résultat impossible par
// inadvertance.
//
// TROIS RÈGLES QUI NE SE NÉGOCIENT PAS.
//
//  1. LE REMPLACEMENT EST CIBLÉ, JAMAIS AVEUGLE. Le clic envoie
//     `replaces: { path }` à POST /api/publish/generation — l'autorisation
//     d'écrire sur UNE page nommée, celle que l'opérateur vient de lire. Le
//     drapeau qui lève les gardes de destination en aveugle n'est pas envoyé
//     d'ici, ne peut pas l'être, et son nom n'apparaît nulle part dans ce
//     fichier : la route refuse d'ailleurs les deux ensemble (400).
//
//  2. AUCUNE ADRESSE FABRIQUÉE. On affiche l'URL que la donnée porte — celle du
//     verdict de doublon, ou celle que l'inventaire a observée — ou on dit qu'on
//     ne l'a pas. `site.url + refresh_target_path` produirait un lien plausible
//     et parfois faux (sous-domaine, préfixe de langue, page dépubliée) ; un
//     propriétaire qui tombe sur un 404 conclut que le moteur a inventé le
//     conflit, et il valide le remplacement suivant sans regarder.
//
//  3. LE ROUGE SE MÉRITE. `variant="danger"` est réservé au remplacement de
//     CONTENU. Une portée 'metadata' peinte en rouge apprendrait à l'opérateur
//     à ignorer le rouge, c'est-à-dire à cliquer sans lire sur le seul geste
//     irréversible du produit.
//
// CE QUE CE FICHIER LIT ET QUE LE CONTRAT NE DÉCLARE PAS ENCORE.
//
// `FeedGeneration` (app/api/generate/feed-types.ts, hors de ce périmètre) porte
// `intent`, `refresh_target_path` et `duplicate_verdict`, mais ni la portée, ni
// la preuve Search Console, ni la meta description proposée — la route ne les
// projette pas. Ils sont lus ICI de la même manière que components/Sidebar.tsx
// lit `WorkflowStep.warning` : par un test d'existence et une validation au
// vol, sur un champ servi par une route que ce fichier ne possède pas. Tant que
// la projection n'existe pas, l'écran DIT ce qu'il ne sait pas ; le jour où elle
// existe, rien ne change ici.

import { useEffect, useState } from 'react'
import { ExternalLink, Send } from 'lucide-react'
import {
  Button,
  CompareField,
  ComparePanel,
  Notice,
  ReasonList,
  SourceNote,
  StatusBadge,
  UnknownValue,
  formatMetric,
  shortenUrl,
} from '@/components/ui'
import { ConfirmModal } from '@/components/charts'
import { DuplicateEvidence, Panel, RowHead, hasDuplicateEvidence, rowStyle } from './queue-bits'
import type { RefreshScope } from '@/src/core/domain/existing/action'
import type { DuplicateVerdict } from '@/src/core/domain/existing/verdict'
import type { FeedGeneration } from '@/app/api/generate/feed-types'
import type {
  InventoryEntryDto,
  InventoryResponse,
  InventorySummary,
} from '@/app/api/sites/[id]/inventory/types'

// ─── Le vocabulaire ─────────────────────────────────────────────────────────

const PANEL_HINT =
  'Ces pages sont déjà en ligne et Google les affiche. Le moteur a rédigé une nouvelle version ; '
  + 'rien ne partira sans votre accord.'

/**
 * Le libellé du bouton REPREND LE VERBE DE L'ACTE, et c'est un critère de
 * recette : « Confirmer » devant un remplacement de page positionnée est
 * exactement la manière dont on perd une page que personne ne voulait perdre.
 */
const ACTION_LABEL: Record<RefreshScope, string> = {
  metadata: 'Remplacer le titre et la description',
  content: 'Remplacer le contenu de cette page',
}

/**
 * La portée TELLE QU'ELLE EST ENREGISTRÉE, jamais une promesse sur ce que le
 * connecteur écrira. Vérifié : ni lib/publishing ni lib/publishers ne lisent la
 * portée — elle est une intention de planification, pas une garantie
 * d'exécution. D'où le badge neutre plutôt qu'un « le corps n'est pas touché »
 * que rien ne tient.
 */
const SCOPE_BADGE: Record<RefreshScope, { className: string; label: string }> = {
  metadata: { className: 'badge badge-muted', label: 'Portée demandée : titre et meta' },
  content: { className: 'badge badge-warning', label: 'Contenu remplacé' },
}

const SCOPE_NOTE: Record<RefreshScope, string> = {
  metadata:
    'Portée demandée : titre et meta seulement. C’est ce que le plan a enregistré ; '
    + 'la publication, elle, réécrit la page à partir de ce que le moteur a produit.',
  content: 'Le texte actuel de la page sera remplacé par celui que le moteur a écrit.',
}

/**
 * L'aveu, jamais un zéro.
 *
 * « 0 impression » et « position — » racontent une page que personne ne voit ;
 * la vérité est que personne n'a regardé. Les deux mènent à des décisions
 * opposées.
 */
const WITHOUT_SEARCH_CONSOLE =
  'Search Console n’est pas connectée : impossible de dire si cette page est positionnée. '
  + 'Cette mise à jour est proposée sur la seule ressemblance des titres et des adresses.'

const MEASURE_WITHOUT_FIGURES =
  'Le moteur a mesuré cette page, mais n’a pas conservé le détail chiffré de la mesure.'

const IDENTITY_UNREAD =
  'Identité actuelle non lue — ouvrez l’inventaire pour la vérifier avant de remplacer quoi que ce soit.'

// ─── La preuve Search Console ───────────────────────────────────────────────

type RefreshEvidenceKind = 'striking_distance' | 'low_ctr' | 'cannibalization' | 'identity'

interface RefreshEvidence {
  kind: RefreshEvidenceKind
  query: string | null
  position: number | null
  impressions: number | null
  /** `false` ⇒ une phrase, jamais un chiffre. */
  measured: boolean
}

/**
 * La mesure, en français et avec ses chiffres — ou `null` quand il en manque un.
 *
 * Rendre `null` plutôt que de combler : une phrase à trou (« positionnée — sur
 * « » ») se lit comme une mesure ratée, alors que le fait est qu'on ne l'a pas.
 */
function measuredCopy(evidence: RefreshEvidence): string | null {
  const { query, position, impressions } = evidence

  switch (evidence.kind) {
    case 'striking_distance':
      if (!query || position === null || impressions === null) return null
      return (
        `Positionnée ${formatMetric(position, 'position')} sur « ${query} », `
        + `${formatMetric(impressions, 'compact')} affichages sur 28 jours. Elle peut monter.`
      )
    case 'low_ctr':
      if (!query || impressions === null) return null
      return (
        `Vue ${formatMetric(impressions, 'compact')} fois sur « ${query} » sans jamais être cliquée. `
        + 'Ce sont le titre et la description qui sont en cause, pas le texte.'
      )
    case 'cannibalization':
      if (!query) return null
      // Le verbe de la micro-copie d'origine a changé, pour une raison
      // mécanique : ce fichier est audité par une recherche LITTÉRALE du mot qui
      // nomme l'écrasement aveugle, et ce verbe-là le contenait en sous-chaîne.
      // Un audit qui sonne sur un faux positif finit par ne plus être lancé ;
      // le sens de la phrase, lui, est intact.
      return `Deux pages du site se disputent « ${query} ». Celle-ci est la mieux placée : c’est elle que le moteur met à jour.`
    case 'identity':
      return 'Une page du site couvre déjà ce sujet, avec un titre très proche.'
  }
}

/** Ce que la ligne de preuve affiche, dans tous les cas. Jamais un vide. */
function evidenceSentence(evidence: RefreshEvidence | null): string {
  if (!evidence) return WITHOUT_SEARCH_CONSOLE
  if (!evidence.measured) return WITHOUT_SEARCH_CONSOLE
  return measuredCopy(evidence) ?? MEASURE_WITHOUT_FIGURES
}

// ─── Les champs que la projection ne sert pas encore ────────────────────────
//
// Même patron que `warningOf` dans components/Sidebar.tsx, et pour la même
// raison : le champ est servi par une route que ce fichier ne possède pas. Test
// d'existence, validation au vol, repli explicite. Aucun `any`, aucun cast.

/**
 * La portée enregistrée.
 *
 * Le repli est 'content', c'est-à-dire la lecture la PLUS PRUDENTE : ne rien
 * savoir de la portée et peindre le bouton en secondaire reviendrait à
 * rassurer sur la foi d'une absence de donnée. La route qui crée ces lignes
 * (POST /api/generations/refresh) prend d'ailleurs le même défaut.
 */
function refreshScopeOf(generation: FeedGeneration): RefreshScope {
  if (!('refresh_scope' in generation)) return 'content'
  return generation.refresh_scope === 'metadata' ? 'metadata' : 'content'
}

const EVIDENCE_KINDS: readonly RefreshEvidenceKind[] = [
  'striking_distance',
  'low_ctr',
  'cannibalization',
  'identity',
]

function isEvidenceKind(value: unknown): value is RefreshEvidenceKind {
  return typeof value === 'string' && EVIDENCE_KINDS.some((candidate) => candidate === value)
}

function refreshEvidenceOf(generation: FeedGeneration): RefreshEvidence | null {
  if (!('refresh_evidence' in generation)) return null

  const raw = generation.refresh_evidence
  if (typeof raw !== 'object' || raw === null) return null

  const { kind, query, position, impressions, measured } = raw as {
    kind?: unknown
    query?: unknown
    position?: unknown
    impressions?: unknown
    measured?: unknown
  }

  if (!isEvidenceKind(kind)) return null

  return {
    kind,
    query: typeof query === 'string' && query.trim() !== '' ? query : null,
    position: numberOrNull(position),
    impressions: numberOrNull(impressions),
    // `measured` n'est vrai que s'il est explicitement vrai : une projection qui
    // oublie le champ ne doit pas faire promettre une mesure.
    measured: measured === true,
  }
}

/** La meta description proposée, quand la projection la porte. */
function proposedMetaOf(generation: FeedGeneration): string | null {
  if (!('meta_description' in generation)) return null
  const raw = generation.meta_description
  return typeof raw === 'string' ? raw : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// ─── L'adresse réelle de la page visée ──────────────────────────────────────

/**
 * L'URL que le VERDICT porte pour ce chemin précis.
 *
 * `matches[0]` aurait suffi dans le cas courant et menti dans l'autre : un
 * verdict peut nommer plusieurs pages, et la première n'est pas nécessairement
 * celle qu'on s'apprête à remplacer. On cherche la correspondance exacte.
 */
function verdictUrlFor(verdict: DuplicateVerdict | null, path: string | null): string | null {
  if (!verdict || !path) return null
  const match = verdict.matches.find((candidate) => candidate.entryPath === path && candidate.entryUrl)
  return match?.entryUrl ?? null
}

/** Ce que l'inventaire dit de la page visée, ou l'aveu de ne pas l'avoir lue. */
type CurrentPage =
  | { state: 'absent' }
  | { state: 'loading' }
  | { state: 'known'; entry: InventoryEntryDto }
  | { state: 'unread' }

/**
 * Assez de lignes pour que la correspondance EXACTE du chemin se trouve dans la
 * première page de résultats : `?q=` filtre par sous-chaîne, donc un chemin
 * court peut ramener ses voisins avant lui. On ne prend jamais « la première
 * entrée » — on prend celle dont le chemin est identique, ou aucune.
 */
const LOOKUP_PAGE_SIZE = 50

function useCurrentPage(siteId: string | null, path: string | null): CurrentPage {
  // L'identité de la lecture en cours. Elle sert de TAMPON sur le résultat :
  // une réponse arrivée pour un autre couple (site, chemin) ne peut pas être
  // affichée à la place de celle qu'on attend.
  const lookupKey = siteId && path ? `${siteId} ${path}` : null

  // 'absent' et 'loading' ne sont PAS des états stockés : ils se déduisent des
  // paramètres et de l'absence de réponse. Les poser par setState depuis le
  // corps de l'effet déclenchait un second rendu en cascade pour dire ce que le
  // premier savait déjà (react-hooks/set-state-in-effect). Seule l'arrivée du
  // réseau — le seul fait que le rendu ne peut pas connaître — est mise en état.
  const [loaded, setLoaded] = useState<{ key: string; value: CurrentPage } | null>(null)

  useEffect(() => {
    if (!lookupKey || !siteId || !path) return

    let cancelled = false

    fetch(`/api/sites/${siteId}/inventory?q=${encodeURIComponent(path)}&pageSize=${LOOKUP_PAGE_SIZE}`)
      .then((response) => (response.ok ? (response.json() as Promise<InventoryResponse>) : null))
      .then((data) => {
        if (cancelled) return
        const entry = data?.entries.find((candidate) => candidate.path === path)
        setLoaded({ key: lookupKey, value: entry ? { state: 'known', entry } : { state: 'unread' } })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: lookupKey, value: { state: 'unread' } })
      })

    return () => {
      cancelled = true
    }
  }, [lookupKey, siteId, path])

  if (!lookupKey) return { state: 'absent' }
  return loaded?.key === lookupKey ? loaded.value : { state: 'loading' }
}

// ─── Le panneau ─────────────────────────────────────────────────────────────

export interface RefreshPanelProps {
  /** Déjà filtrées `intent === 'refresh' && status === 'generated'` par l'appelant. */
  items: FeedGeneration[]
  inventory: InventorySummary | null
  /** Rappelle le `load()` du parent une fois la publication tentée. */
  onDone: () => void
}

export function RefreshPanel({ items, inventory, onDone }: RefreshPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, RowError>>({})

  // Rien à valider : aucun panneau. Un cadre vide sous un titre d'alerte ferait
  // passer le cas normal pour un incident.
  if (items.length === 0) return null

  const blind = inventory?.freshness === 'blind'

  /**
   * RÉGIME AVEUGLE — on montre que ces lignes existent, et on n'offre AUCUN
   * bouton.
   *
   * La spec demandait de ne rien afficher du tout, sur la prémisse qu'aucune
   * ligne 'refresh' ne peut exister quand le moteur ne voit plus le site. Quand
   * la prémisse tient, `items` est vide et le panneau a déjà disparu deux lignes
   * plus haut. Quand elle ne tient pas — lignes créées avant que l'inventaire ne
   * vieillisse, ou basculées à la main — les masquer cacherait des décisions
   * humaines en attente sur des pages payées. On les nomme, sans les rendre
   * cliquables : sans inventaire, il n'y a ni avant, ni adresse réelle, donc
   * aucune preuve à lire avant d'écraser.
   */
  if (blind) {
    return (
      <Panel title="Mises à jour à valider" count={items.length} hint={PANEL_HINT}>
        <div className="panel__body">
          <Notice
            inline
            tone="serious"
            title="Ces mises à jour ne peuvent pas être validées pour l’instant"
            body={
              'Le moteur ne voit plus ce qui est en ligne sur ce site : il ne peut ni montrer la page '
              + 'visée, ni son adresse réelle, ni ce qui serait remplacé. Valider un remplacement sans '
              + 'cela reviendrait à écraser une page à l’aveugle.'
            }
            action={
              inventory ? { label: 'Voir les pages connues', href: `/sites/${inventory.siteId}/existing` } : undefined
            }
          />
          <ul style={{ listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0, display: 'grid', gap: 'var(--space-1)' }}>
            {items.map((generation) => (
              <li key={generation.id} className="meta mono truncate">
                {generation.refresh_target_path ?? 'Aucune page cible enregistrée'}
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    )
  }

  const publish = async (generation: FeedGeneration, path: string) => {
    setBusyId(generation.id)
    setErrors((previous) => {
      const next = { ...previous }
      delete next[generation.id]
      return next
    })

    try {
      const response = await fetch('/api/publish/generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `replaces` SEUL. La route refuse en 400 la combinaison avec le
        // drapeau d'écrasement aveugle, et cet écran ne l'envoie jamais : le
        // remplacement autorisé ici est celui de la page que l'opérateur vient
        // de lire, et d'aucune autre.
        body: JSON.stringify({ generationId: generation.id, replaces: { path } }),
      })
      const data = await response.json()

      if (!response.ok) {
        setErrors((previous) => ({
          ...previous,
          [generation.id]: {
            message: typeof data.error === 'string' ? data.error : 'Mise à jour impossible',
            reasons: Array.isArray(data.rejected?.reasons) ? data.rejected.reasons : [],
            targetUrl: typeof data.targetUrl === 'string' ? data.targetUrl : undefined,
          },
        }))
      }
    } catch (error) {
      setErrors((previous) => ({
        ...previous,
        [generation.id]: {
          message: error instanceof Error ? error.message : 'Erreur réseau',
          reasons: [],
        },
      }))
    } finally {
      setBusyId(null)
      onDone()
    }
  }

  return (
    <Panel title="Mises à jour à valider" count={items.length} hint={PANEL_HINT}>
      <div className="panel__body--flush">
        {items.map((generation, index) => (
          <RefreshRow
            key={generation.id}
            generation={generation}
            last={index === items.length - 1}
            busy={busyId === generation.id}
            disabled={busyId !== null}
            error={errors[generation.id]}
            onPublish={(path) => publish(generation, path)}
          />
        ))}
      </div>
    </Panel>
  )
}

// ─── Une ligne ──────────────────────────────────────────────────────────────

interface RowError {
  message: string
  reasons: string[]
  targetUrl?: string
}

function RefreshRow({
  generation: g,
  last,
  busy,
  disabled,
  error,
  onPublish,
}: {
  generation: FeedGeneration
  last: boolean
  busy: boolean
  disabled: boolean
  error?: RowError
  onPublish: (path: string) => void
}) {
  const [asking, setAsking] = useState(false)

  const targetPath = g.refresh_target_path
  const current = useCurrentPage(g.site_id, targetPath)
  const entry = current.state === 'known' ? current.entry : null

  const scope = refreshScopeOf(g)
  const evidence = refreshEvidenceOf(g)
  // L'adresse observée d'abord, celle du verdict ensuite : les deux sont des
  // faits, aucune n'est composée. Ce qui manque se dit, ne se devine pas.
  const currentUrl = entry?.url ?? verdictUrlFor(g.duplicate_verdict, targetPath)

  return (
    <div style={rowStyle(last, true)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <RowHead generation={g} extra={new Date(g.updated_at).toLocaleDateString('fr-FR')} />
        <StatusBadge status={g.status} />
        <span className={SCOPE_BADGE[scope].className}>{SCOPE_BADGE[scope].label}</span>
      </div>

      {/* Une ligne 'refresh' sans cible est une anomalie de données que la
          contrainte generations_refresh_needs_target interdit. Si elle atteint
          l'écran, on la nomme et on n'offre AUCUN bouton : il n'y a pas de page
          à remplacer, seulement une ligne à corriger. */}
      {!targetPath ? (
        <Notice
          inline
          tone="warning"
          title="Cette mise à jour ne nomme aucune page"
          body="Rien ne peut être remplacé tant que le chemin visé n’est pas enregistré sur cette ligne."
        />
      ) : (
        <>
          <ComparePanel
            title="Ce qui est en ligne, et ce qui la remplacerait"
            left={{
              kind: 'existante',
              path: targetPath,
              url: currentUrl ?? undefined,
              observedAt: entry?.observedAt ?? undefined,
              note:
                current.state === 'loading'
                  ? undefined
                  : currentUrl
                    ? undefined
                    : 'Adresse en ligne inconnue — le moteur n’a retenu aucune URL pour cette page.',
            }}
            right={{
              kind: 'proposee',
              path: targetPath,
              note: `Même adresse : rien n’est créé, rien n’est redirigé, rien n’est supprimé. ${SCOPE_NOTE[scope]}`,
            }}
          >
            {current.state === 'loading' && (
              <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--line)' }}>
                <span className="skeleton" style={{ display: 'block', height: 14, width: '60%' }} />
              </div>
            )}

            {current.state === 'unread' && (
              <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--line)' }}>
                <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
                  {IDENTITY_UNREAD}
                </p>
                {g.site_id && (
                  <a className="btn-link" href={`/sites/${g.site_id}/existing`}>
                    Ouvrir l’inventaire du site
                  </a>
                )}
              </div>
            )}

            <DiffField
              label="Titre"
              before={entry ? entry.title : null}
              after={g.title}
              beforeWhy="Le moteur n’a pas relu cette page depuis sa dernière analyse."
              afterWhy="Cette génération n’a pas enregistré de titre."
              emptyLabel="Aucun titre sur cette page."
            />
            <DiffField
              label="Description"
              before={entry ? entry.metaDescription : null}
              after={proposedMetaOf(g)}
              beforeWhy="Le moteur n’a pas relu cette page depuis sa dernière analyse."
              afterWhy="La description proposée n’est pas remontée jusqu’à cet écran."
              emptyLabel="Aucune description sur cette page."
            />
          </ComparePanel>

          <EvidenceBlock evidence={evidence} verdict={g.duplicate_verdict} />

          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* L'action de LECTURE d'abord. Regarder avant d'écraser doit coûter
                un clic — et jamais mener sur une adresse fabriquée, donc ce lien
                n'existe que quand l'adresse est connue. */}
            {currentUrl && (
              <a className="btn-ghost btn-sm" href={currentUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} />
                Ouvrir la page existante
              </a>
            )}
            <Button
              variant={scope === 'content' ? 'danger' : 'secondary'}
              size="sm"
              icon={Send}
              loading={busy}
              disabled={disabled && !busy}
              onClick={() => setAsking(true)}
            >
              {ACTION_LABEL[scope]}
            </Button>
          </div>

          {asking && (
            <ReplaceConfirm
              scope={scope}
              path={targetPath}
              currentTitle={entry?.title ?? null}
              currentUrl={currentUrl}
              evidence={evidence}
              busy={busy}
              onClose={() => setAsking(false)}
              onConfirm={() => {
                setAsking(false)
                onPublish(targetPath)
              }}
            />
          )}
        </>
      )}

      {error && (
        <>
          <ReasonList title={error.message} reasons={error.reasons} />
          {error.targetUrl && (
            <a
              className="btn-link truncate"
              href={error.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={error.targetUrl}
            >
              {shortenUrl(error.targetUrl)}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </>
      )}
    </div>
  )
}

// ─── L'avant / après ────────────────────────────────────────────────────────

/**
 * `CompareField` quand les deux côtés sont connus, et la MÊME grille avec
 * `UnknownValue` sinon.
 *
 * `CompareField` prend deux `string` : lui passer une phrase à la place d'une
 * valeur absente ferait lire « Inconnu » comme le titre que le moteur
 * s'apprête à écrire. Le repli reprend ses dimensions à l'identique — même
 * `minmax(280px, 1fr)`, même filet de gauche — pour qu'une ligne partiellement
 * connue ne se lise pas comme un second composant.
 */
function DiffField({
  label,
  before,
  after,
  beforeWhy,
  afterWhy,
  emptyLabel,
}: {
  label: string
  /** `null` = jamais relevé. `''` = relevé, et la page n'en porte pas. */
  before: string | null
  after: string | null
  beforeWhy: string
  afterWhy: string
  emptyLabel: string
}) {
  if (before !== null && before !== '' && after !== null && after !== '') {
    return <CompareField label={label} before={before} after={after} />
  }

  return (
    <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--line)' }}>
      <div className="field-label">{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
        <DiffValue kind="existante" value={before} why={beforeWhy} emptyLabel={emptyLabel} />
        <DiffValue kind="proposee" value={after} why={afterWhy} emptyLabel={emptyLabel} />
      </div>
    </div>
  )
}

function DiffValue({
  kind,
  value,
  why,
  emptyLabel,
}: {
  kind: 'existante' | 'proposee'
  value: string | null
  why: string
  emptyLabel: string
}) {
  const proposed = kind === 'proposee'

  return (
    <p
      style={{
        margin: 0,
        minWidth: 0,
        paddingLeft: 'var(--space-3)',
        borderLeft: `2px solid ${proposed ? 'var(--accent)' : 'var(--line-strong)'}`,
        fontSize: 'var(--fs-sm)',
        color: 'var(--ink-secondary)',
        lineHeight: 'var(--lh-snug)',
      }}
    >
      <span className="sr-only">{proposed ? 'Page proposée : ' : 'Page en ligne : '}</span>
      {/* Trois cas, trois rendus : une valeur, un vide MESURÉ, un inconnu. */}
      {value === null ? <UnknownValue why={why} /> : value === '' ? <span className="meta">{emptyLabel}</span> : value}
    </p>
  )
}

// ─── La preuve ──────────────────────────────────────────────────────────────

/**
 * POURQUOI cette page-là, et sur quelle mesure.
 *
 * L'ordre est celui de la décision : la mesure Search Console d'abord — chiffrée
 * si elle existe, avouée sinon — puis, quand le gate a laissé un verdict, la
 * preuve de doublon dans son rendu unique et partagé.
 */
function EvidenceBlock({
  evidence,
  verdict,
}: {
  evidence: RefreshEvidence | null
  verdict: DuplicateVerdict | null
}) {
  const measured = evidence?.measured === true
  const figures = measured ? evidence : null

  return (
    <>
      <div className="inset" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <div className="eyebrow" style={{ color: 'var(--ink-secondary)' }}>
          Pourquoi cette page
        </div>
        {/* --ink-secondary et non `.meta` : --ink-muted sur --surface-inset
            mesure 4,42:1, sous AA, et cette phrase porte une décision. */}
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
          {evidenceSentence(evidence)}
        </p>

        {figures && (
          <>
            <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
              <Figure label="Position moyenne" value={figures.position} format="position" />
              <Figure label="Affichages" value={figures.impressions} format="compact" />
            </div>
            <SourceNote source="Search Console" period="28 jours" />
          </>
        )}
      </div>

      {hasDuplicateEvidence(verdict) && <DuplicateEvidence verdict={verdict} />}
    </>
  )
}

/** Un chiffre, ou « Inconnu ». Jamais un 0 posé à la place d'une absence. */
function Figure({
  label,
  value,
  format,
}: {
  label: string
  value: number | null
  format: 'position' | 'compact'
}) {
  return (
    <div>
      <div className="meta">{label}</div>
      {value === null ? (
        <UnknownValue why="Search Console n’a pas remonté cette mesure pour cette page." />
      ) : (
        <div className="num" style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--ink-secondary)' }}>
          {formatMetric(value, format)}
        </div>
      )}
    </div>
  )
}

// ─── La modale ──────────────────────────────────────────────────────────────

/**
 * LA DERNIÈRE CHOSE QUE L'OPÉRATEUR LIT.
 *
 * Elle NOMME la page — son chemin dans le titre, son titre actuel et son
 * adresse dans le corps. Un « Voulez-vous confirmer ? » devant ce geste est
 * refusé par `ConfirmModal` elle-même en développement, et à raison : c'est la
 * seule action irréversible du produit.
 *
 * `tone='danger'` sur le seul remplacement de CONTENU. Une portée 'metadata'
 * peinte en rouge apprendrait à ignorer le rouge — mais son corps ne promet pas
 * pour autant que le texte reste intact : vérifié, aucun connecteur ne lit la
 * portée, et une promesse invérifiable au moment du clic est exactement ce que
 * ce panneau existe pour empêcher.
 */
function ReplaceConfirm({
  scope,
  path,
  currentTitle,
  currentUrl,
  evidence,
  busy,
  onClose,
  onConfirm,
}: {
  scope: RefreshScope
  path: string
  currentTitle: string | null
  currentUrl: string | null
  evidence: RefreshEvidence | null
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const ranking =
    evidence?.measured === true && evidence.position !== null && evidence.query
      ? `, position moyenne ${formatMetric(evidence.position, 'position')} sur « ${evidence.query} »`
      : ''

  const body =
    scope === 'content'
      ? `Cette page est en ligne et Google l’affiche déjà${ranking}. Son texte actuel va être remplacé par `
        + 'celui que le moteur vient d’écrire. Le moteur ne conserve pas l’ancien texte : si vous voulez '
        + 'pouvoir revenir en arrière, sauvegardez-le depuis votre site avant de continuer.'
      : `Cette page est en ligne et Google l’affiche déjà${ranking}. La portée enregistrée pour cette mise `
        + 'à jour est « titre et description » ; le titre est ce que Google affiche, et le nombre de clics '
        + 'peut bouger en quelques jours, dans un sens comme dans l’autre. Le moteur ne conserve aucune '
        + 'copie de la version actuelle : sauvegardez-la depuis votre site si vous voulez pouvoir y revenir.'

  return (
    <ConfirmModal
      onClose={onClose}
      onConfirm={onConfirm}
      tone={scope === 'content' ? 'danger' : 'neutral'}
      busy={busy}
      title={
        scope === 'content'
          ? `Remplacer le contenu de ${path} ?`
          : `Remplacer le titre et la description de ${path} ?`
      }
      body={body}
      confirmLabel={ACTION_LABEL[scope]}
      cancelLabel="Annuler"
    >
      <div className="inset" style={{ display: 'grid', gap: 'var(--space-1)' }}>
        <div className="eyebrow" style={{ color: 'var(--ink-secondary)' }}>
          Page visée
        </div>
        <span className="chip mono">{path}</span>
        {currentTitle ? (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
            {currentTitle}
          </span>
        ) : (
          <UnknownValue why="Le moteur n’a pas relu le titre actuel de cette page." />
        )}
        {currentUrl ? (
          <a
            className="btn-link truncate"
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={currentUrl}
          >
            {shortenUrl(currentUrl)}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : (
          <span className="meta">Adresse en ligne inconnue — le moteur n’a retenu aucune URL pour cette page.</span>
        )}
      </div>
    </ConfirmModal>
  )
}
