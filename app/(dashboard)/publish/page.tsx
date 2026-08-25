'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — Publication
// What is waiting to go online, what went online, and what was refused
// ─────────────────────────────────────────────────────────────────────────────
//
// Same origin story as step 4: this page read `GET /api/articles` (table
// `articles`, which nothing writes) and looked for a `generations` key that
// response never carried. It listed nothing, always.
//
// It reads the real feed now, and it can act on it. The deferred publishing job
// only picks up generations whose campaign has `auto_publish = true`, so a page
// produced by a manual campaign used to sit in `generated` forever with no way
// to push it — that button is `POST /api/publish/generation`.

import { useCallback, useEffect, useState } from 'react'
import {
  Send,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  ShieldAlert,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { EmptyState, Notice, PageHeader, ReasonList, StatTile, StatusBadge, splitReasons } from '@/components/ui'
import { SiteSwitcher, Tabs } from '@/components/charts'
import { REFUSAL_TITLES } from '@/lib/publishing/refusal-labels'
import type { FeedGeneration, FeedSite, GenerationCounts, GenerationFeedResponse } from '@/app/api/generate/feed-types'
import type { InventoryResponse, InventorySummary } from '@/app/api/sites/[id]/inventory/types'
// Les pièces de file vivent dans un module frère, pas dans cette page : /generate
// rend exactement la même ligne, et la preuve de doublon doit avoir UN seul
// rendu. Deux copies divergent au premier correctif de formulation.
import {
  DuplicateEvidence,
  DuplicateFlag,
  Panel,
  RowHead,
  freshnessNotice,
  hasDuplicateEvidence,
  rowStyle,
} from './queue-bits'
// Le partage de la file et les deux compteurs qui s'en déduisent : un module de
// données pur, testé sans rendu (./counts.test.ts).
import { splitPublishQueue, toPublishCount } from './counts'
// Le clic humain sur une page qui ranke a son propre module : il porte une
// modale, une confirmation destructrice et un corps de requête (`replaces`) que
// RIEN d'autre sur cet écran n'envoie. Le mêler à la file ordinaire ferait
// partager, tôt ou tard, un bouton entre « publier une page neuve » et
// « remplacer une page positionnée ».
import { RefreshPanel } from './RefreshPanel'
// Le second canal de publication du produit. Il vit dans CE contenant, en
// onglet, et pas dans un écran à lui : une fiche Google et un site sont deux
// destinations de la même étape 5, et un opérateur qui publie n'a pas à
// apprendre deux grammaires d'écran.
//
// POURQUOI `Tabs` ET NON `TabNav`. `TabNav` (components/ui.tsx) rend des liens ;
// lire l'onglet actif imposerait `useSearchParams()`, donc un `<Suspense>` et la
// scission de cette page en une coquille serveur plus un enfant client. Cette
// page est `'use client'` depuis sa première ligne, le seul précédent du dépôt
// (dashboard/page.tsx) ne fonctionne que parce qu'il s'agit d'un composant
// SERVEUR, et rien dans ce chantier ne demande ce refactor. `Tabs` est de l'état
// client, ne touche pas au routage, et c'est déjà le composant d'onglets de
// /calendar.
import { GbpTab } from './GbpTab'

const EMPTY_COUNTS: GenerationCounts = {
  pending: 0,
  generating: 0,
  generated: 0,
  publishing: 0,
  published: 0,
  failed: 0,
  rejected: 0,
  total: 0,
}

/** Everything step 5 is about: nothing before `generated` belongs here. */
const SCOPE = 'generated,publishing,published,rejected,failed'

/** Published pages are history, not a queue — the recent ones are enough. */
const PUBLISHED_SHOWN = 20

interface RowError {
  message: string
  reasons?: string[]
}

/** Les deux canaux de l'étape 5. Une page de site, ou un post de fiche. */
type Channel = 'pages' | 'fiche'

export default function PublishPage() {
  const [channel, setChannel] = useState<Channel>('pages')
  const [generations, setGenerations] = useState<FeedGeneration[]>([])
  const [counts, setCounts] = useState<GenerationCounts>(EMPTY_COUNTS)
  const [sites, setSites] = useState<FeedSite[]>([])
  const [siteId, setSiteId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, RowError>>({})
  const [inventory, setInventory] = useState<InventorySummary | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const params = new URLSearchParams({ status: SCOPE, limit: '150' })
    if (siteId) params.set('site_id', siteId)

    try {
      const res = await fetch(`/api/generate?${params.toString()}`)
      const data: GenerationFeedResponse & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error || 'Lecture impossible')

      setGenerations(data.generations ?? [])
      setCounts(data.counts ?? EMPTY_COUNTS)
      setSites(data.sites ?? [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    load()
  }, [load])

  // Le régime de connaissance du SEUL site sélectionné, lu une fois par
  // sélection — jamais dans `load()`, qui se rejoue à chaque filtre et à chaque
  // tour de scrutin : la fraîcheur d'un inventaire ne bouge pas toutes les
  // quinze secondes. `fields=paths` est le mode le plus léger de cette route ;
  // seul `summary` est lu ici.
  //
  // Un échec de lecture laisse `null`, donc AUCUN bandeau : décrire une cécité
  // qu'on n'a pas mesurée serait un second mensonge par-dessus le premier.
  useEffect(() => {
    if (!siteId) {
      setInventory(null)
      return
    }

    let cancelled = false
    fetch(`/api/sites/${siteId}/inventory?fields=paths`)
      .then((res) => (res.ok ? (res.json() as Promise<InventoryResponse>) : null))
      .then((data) => {
        if (!cancelled) setInventory(data?.summary ?? null)
      })
      .catch(() => {
        if (!cancelled) setInventory(null)
      })

    return () => {
      cancelled = true
    }
  }, [siteId])

  const publish = async (id: string) => {
    setBusyId(id)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

    try {
      const res = await fetch('/api/publish/generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId: id }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [id]: { message: data.error || 'Publication impossible', reasons: data.rejected?.reasons },
        }))
      }
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [id]: { message: error instanceof Error ? error.message : 'Erreur réseau' },
      }))
    } finally {
      setBusyId(null)
      load()
    }
  }

  const freshness = freshnessNotice(inventory)

  // ── Le partage, et la seule règle qui le gouverne ──────────────────────────
  //
  // UNE LIGNE, UNE FILE. Une génération qui remplace une page existante n'attend
  // pas la même chose qu'une page neuve : elle attend une LECTURE, puis un clic
  // dans une modale qui nomme la page écrasée. La laisser dans « File d'attente »
  // ferait valider un remplacement par le bouton « Publier maintenant », c'est-à-
  // dire sans avoir rien lu.
  //
  // `status === 'publishing'` reste dans la file ordinaire, quel que soit
  // `intent` : une ligne déjà en vol n'attend plus de décision.
  // Le partage lui-même vit dans ./counts, hors de ce composant : c'est la seule
  // règle de cet écran qui puisse mentir sans planter, et un composant client ne
  // se teste pas sans navigateur.
  const { refreshPending, queue } = splitPublishQueue(generations)
  const refused = generations.filter((g) => g.status === 'rejected' || g.status === 'failed')
  const published = generations.filter((g) => g.status === 'published').slice(0, PUBLISHED_SHOWN)

  // ── Les compteurs, et pourquoi ils se SOUSTRAIENT ──────────────────────────
  //
  // `counts.generated` est le seul chiffre autoritaire (sept comptages
  // `head: true` côté route, filtrés par site) : il vaut 5 sur 3 mises à jour et
  // 2 pages neuves. Poser 5 sur « À publier » ET 3 sur « Mises à jour à valider »
  // compterait trois lignes deux fois et annoncerait huit gestes là où il y en a
  // cinq. Les deux tuiles se partagent donc EXACTEMENT le même total.
  //
  // LIMITE CONNUE, et elle ne peut pas se corriger ici : `refreshPending` se
  // compte sur la liste chargée, plafonnée à 150 lignes tous statuts confondus.
  // Au-delà, la tuile de mises à jour SOUS-estime et l'autre sur-estime — la
  // somme reste juste, jamais gonflée. Le correctif propre est un champ frère
  // `refreshPending` compté `head: true` par GET /api/generate, hors périmètre.
  const toPublish = toPublishCount(counts.generated, refreshPending.length)

  return (
    <div>
      <PageHeader
        icon={Send}
        badge="Étape 5"
        title="Publication"
        subtitle="Ce qui attend une publication, ce qui est en ligne, et ce que le contrôle qualité a refusé"
        actions={
          // Le bouton n'apparaît que sur l'onglet qu'il actualise. Sur l'autre,
          // il rechargerait en silence une file qui n'est pas à l'écran.
          channel === 'pages' ? (
            <button className="btn-ghost" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={counts.publishing > 0 ? 'animate-spin' : undefined} />
              Actualiser
            </button>
          ) : undefined
        }
      >
        {/* L'onglet « Fiche Google » ne porte AUCUN compteur : cette coquille ne
            sait pas si une fiche est rattachée à ce site, et un « 0 » posé sur
            une fiche absente ferait passer une absence de connexion pour une
            absence de posts. Le compteur vit dans l'onglet, où le fait est
            connu. */}
        <Tabs
          variant="underline"
          ariaLabel="Canal de publication"
          value={channel}
          onChange={(id) => setChannel(id === 'fiche' ? 'fiche' : 'pages')}
          items={[
            { id: 'pages', label: 'Pages du site', count: toPublish },
            { id: 'fiche', label: 'Fiche Google' },
          ]}
        />
      </PageHeader>

      {channel === 'fiche' ? (
        <GbpTab initialSiteId={siteId || null} />
      ) : (
        <>
          <div className="toolbar">
            <SiteSwitcher sites={sites} value={siteId || null} onChange={(id) => setSiteId(id ?? '')} />
          </div>

          {/* Ce que le moteur ne voit pas de ce site, dit avant qu'on ne publie
              contre. Le bandeau AVERTIT et ne désactive rien : aucun bouton de cette
              page ne dépend de la fraîcheur de l'inventaire. */}
          {freshness && (
            <Notice
              tone={freshness.tone}
              title={freshness.title}
              body={freshness.body}
              action={{ label: 'Voir les pages connues', href: `/sites/${siteId}/existing` }}
            />
          )}

          <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
            <StatTile label="À publier" value={toPublish} icon={Clock} />
            <StatTile label="Mises à jour à valider" value={refreshPending.length} icon={RefreshCw} />
            <StatTile label="En cours" value={counts.publishing} icon={Send} />
            <StatTile label="Publiées" value={counts.published} icon={CheckCircle} />
            <StatTile label="Refusées" value={counts.rejected} icon={ShieldAlert} />
            <StatTile label="Échecs" value={counts.failed} icon={AlertCircle} />
          </div>

          {loadError ? (
            <div className="panel">
              <div className="panel__body">
                <EmptyState bare variant="error" description={loadError} action={{ label: 'Réessayer', onClick: load }} />
              </div>
            </div>
          ) : loading ? (
            <div className="panel">
              <div className="panel__body" style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
                <Loader2 size={22} className="animate-spin" color="var(--ink-faint)" />
              </div>
            </div>
          ) : (
            <>
              <Panel title="File d'attente" count={queue.length}>
                {queue.length === 0 ? (
                  <div className="panel__body">
                    <EmptyState
                      bare
                      icon={Send}
                      title="Rien n'attend une publication"
                      description="Les pages acceptées par le contrôle qualité apparaissent ici, prêtes à partir."
                      action={counts.total === 0 ? { label: 'Aller à la génération', href: '/generate' } : undefined}
                    />
                  </div>
                ) : (
                  <div className="panel__body--flush">
                    {queue.map((g, index) => (
                      <QueueRow
                        key={g.id}
                        generation={g}
                        last={index === queue.length - 1}
                        busy={busyId === g.id}
                        disabled={busyId !== null}
                        error={errors[g.id]}
                        onPublish={() => publish(g.id)}
                      />
                    ))}
                  </div>
                )}
              </Panel>

              {/* ENTRE la file et les refus, et jamais ailleurs : c'est ici que
                  l'opérateur décide, et la preuve doit être sous ses yeux au moment
                  du clic. Aucun tableau de bord de duplication, aucun écran de
                  comparaison à part. */}
              <RefreshPanel items={refreshPending} inventory={inventory} onDone={load} />

              {refused.length > 0 && (
                <Panel
                  title="Refusées par le contrôle qualité"
                  count={refused.length}
                  hint="Ces pages existent et sont payées : elles ne sont pas parties, et voici pourquoi."
                >
                  <div className="panel__body--flush">
                    {refused.map((g, index) => (
                      <RefusedRow key={g.id} generation={g} last={index === refused.length - 1} />
                    ))}
                  </div>
                </Panel>
              )}

              {published.length > 0 && (
                <Panel title="En ligne" count={counts.published}>
                  <div className="panel__body--flush">
                    {published.map((g, index) => (
                      <PublishedRow key={g.id} generation={g} last={index === published.length - 1} />
                    ))}
                  </div>
                </Panel>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function QueueRow({
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
  onPublish: () => void
}) {
  const auto = g.campaign?.auto_publish ?? false

  return (
    <div style={rowStyle(last, true)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <RowHead generation={g} extra={auto ? 'publication automatique' : 'publication manuelle'} />
        <StatusBadge status={g.status} />
        <DuplicateFlag verdict={g.duplicate_verdict} />
        <button
          className="btn-secondary btn-sm"
          onClick={onPublish}
          disabled={disabled || g.status === 'publishing'}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {busy ? 'Publication…' : 'Publier maintenant'}
        </button>
      </div>

      {g.status === 'generated' && auto && (
        <p className="meta">
          Cette campagne publie automatiquement : le planificateur poussera cette page au prochain passage.
        </p>
      )}

      {/* La preuve avant le clic, pas après : c'est ici que la décision de
          publier se prend. Le bouton reste actif — le contrôle des doublons
          tourne en observation, et l'interface ne refuse pas à la place du
          moteur. */}
      {hasDuplicateEvidence(g.duplicate_verdict) && <DuplicateEvidence verdict={g.duplicate_verdict} />}

      {error && <ReasonList title={error.message} reasons={error.reasons ?? []} />}
    </div>
  )
}

function RefusedRow({ generation: g, last }: { generation: FeedGeneration; last: boolean }) {
  const reasons = splitReasons(g.error_message)

  return (
    <div style={rowStyle(last, true)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <RowHead generation={g} extra={new Date(g.updated_at).toLocaleDateString('fr-FR')} />
        <StatusBadge status={g.status} />
      </div>

      <ReasonList
        title={
          // Le motif nommé, quand la base en porte un. `REFUSAL_TITLES` est
          // typée `Record<RefusalKind, string>` : aucune valeur ne peut y rendre
          // `undefined`, et le repli générique ne sert qu'aux lignes refusées
          // sans motif enregistré.
          g.refusal_kind
            ? REFUSAL_TITLES[g.refusal_kind]
            : g.status === 'rejected'
              ? 'Refusée par le contrôle qualité'
              : 'Échec'
        }
        reasons={reasons.length > 0 ? reasons : ['Aucune raison enregistrée.']}
      />

      {hasDuplicateEvidence(g.duplicate_verdict) && <DuplicateEvidence verdict={g.duplicate_verdict} />}
    </div>
  )
}

function PublishedRow({ generation: g, last }: { generation: FeedGeneration; last: boolean }) {
  const when = g.published_at || g.updated_at
  const verdict = g.duplicate_verdict

  return (
    <div style={rowStyle(last, hasDuplicateEvidence(verdict))}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <RowHead generation={g} extra={`en ligne le ${new Date(when).toLocaleDateString('fr-FR')}`} />
        <StatusBadge status={g.status} />
        <DuplicateFlag verdict={verdict} />
        {g.published_url && (
          <a
            href={g.published_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon"
            title="Voir la page en ligne"
          >
            <ExternalLink size={15} />
          </a>
        )}
      </div>

      {/* Une page publiée MALGRÉ un verdict ne se montre pas comme une page
          propre. C'est tout l'objet de la période d'observation : le
          propriétaire doit découvrir le volume réel de quasi-doublons de son
          site avant qu'une barrière ne se ferme dessus. */}
      {hasDuplicateEvidence(verdict) && <DuplicateEvidence verdict={verdict} />}
    </div>
  )
}
