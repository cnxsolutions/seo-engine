'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Publication d'UN site — ce qui attend, ce qui est en ligne, ce qui est refusé
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce composant était la page /publish, qui ouvrait sur la file de tous les sites
// et faisait choisir le site dans un sélecteur. Il vit maintenant dans l'onglet
// « Publication » de /sites/[id] et reçoit `siteId` : la file, les compteurs et
// la fraîcheur de l'inventaire sont ceux de CE site, sans sélecteur à régler.
//
// Il lit le vrai flux (GET /api/generate, table `generations`) et peut agir
// dessus. Le job de publication différée ne prend que les générations dont la
// campagne a `auto_publish = true` : une page produite par une campagne
// manuelle resterait en `generated` pour toujours sans le bouton
// « Publier maintenant » (POST /api/publish/generation).
//
// PLUS DE MISES À JOUR. Le propriétaire ne veut plus que le moteur remplace des
// pages existantes : le panneau de validation des mises à jour a disparu, et
// les anciennes demandes encore en base sont tenues hors de la file
// (./counts.ts). Elles ne sont pas publiées par le planificateur non plus.

import { useRouter } from 'next/navigation'
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
import { EmptyState, Notice, ReasonList, StatTile, StatusBadge, splitReasons } from '@/components/ui'
import { REFUSAL_TITLES } from '@/lib/publishing/refusal-labels'
import type { FeedGeneration, GenerationCounts, GenerationFeedResponse } from '@/app/api/generate/feed-types'
import type { InventoryResponse, InventorySummary } from '@/app/api/sites/[id]/inventory/types'
// Les pièces de file vivent dans un module frère : le flux de génération rend
// exactement la même ligne, et la preuve de doublon doit avoir UN seul rendu.
// Deux copies divergent au premier correctif de formulation.
import {
  DuplicateEvidence,
  DuplicateFlag,
  Panel,
  RowHead,
  freshnessNotice,
  hasDuplicateEvidence,
  rowStyle,
} from './queue-bits'
// Le partage de la file et le compteur qui s'en déduit : un module de données
// pur, testé sans rendu (./counts.test.ts).
import { splitPublishQueue, toPublishCount } from './counts'

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

/** Everything publication is about: nothing before `generated` belongs here. */
const SCOPE = 'generated,publishing,published,rejected,failed'

/** Published pages are history, not a queue — the recent ones are enough. */
const PUBLISHED_SHOWN = 20

interface RowError {
  message: string
  reasons?: string[]
}

export function PublishQueue({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [generations, setGenerations] = useState<FeedGeneration[]>([])
  const [counts, setCounts] = useState<GenerationCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, RowError>>({})
  const [inventory, setInventory] = useState<InventorySummary | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const params = new URLSearchParams({ status: SCOPE, limit: '150', site_id: siteId })

    try {
      const res = await fetch(`/api/generate?${params.toString()}`)
      const data: GenerationFeedResponse & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error || 'Lecture impossible')

      setGenerations(data.generations ?? [])
      setCounts(data.counts ?? EMPTY_COUNTS)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    load()
  }, [load])

  // Le régime de connaissance du site, lu une fois — jamais dans `load()`, qui
  // se rejoue à chaque publication : la fraîcheur d'un inventaire ne bouge pas
  // d'un clic à l'autre. `fields=paths` est le mode le plus léger de cette
  // route ; seul `summary` est lu ici.
  //
  // Un échec de lecture laisse `null`, donc AUCUN bandeau : décrire une cécité
  // qu'on n'a pas mesurée serait un second mensonge par-dessus le premier.
  useEffect(() => {
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
      // Le compteur du sous-onglet « Pages du site » est compté côté serveur :
      // sans ce rafraîchissement, il annoncerait encore la page qui vient de
      // partir. `refresh()` relit la coquille sans démonter cette liste.
      router.refresh()
    }
  }

  const freshness = freshnessNotice(inventory)

  // ── Le partage, et la seule règle qui le gouverne ──────────────────────────
  //
  // Une ancienne demande de mise à jour n'est PAS une page neuve : « Publier
  // maintenant » la ferait remplacer une page existante, ce que le produit ne
  // fait plus. Elle reste donc hors de la file, et le partage vit dans
  // ./counts, hors de ce composant : c'est la seule règle de cet écran qui
  // puisse mentir sans planter, et un composant client ne se teste pas sans
  // navigateur.
  //
  // `status === 'publishing'` reste dans la file ordinaire, quel que soit
  // `intent` : une ligne déjà en vol n'attend plus de décision.
  const { legacyRefresh, queue } = splitPublishQueue(generations)
  const refused = generations.filter((g) => g.status === 'rejected' || g.status === 'failed')
  const published = generations.filter((g) => g.status === 'published').slice(0, PUBLISHED_SHOWN)

  // `counts.generated` est le seul chiffre autoritaire (comptages `head: true`
  // côté route, filtrés par site) ; les anciennes demandes en sont retirées.
  // LIMITE CONNUE : `legacyRefresh` se compte sur la liste chargée, plafonnée
  // à 150 lignes tous statuts confondus — au-delà, la tuile peut sur-estimer,
  // jamais compter une ligne deux fois.
  const toPublish = toPublishCount(counts.generated, legacyRefresh.length)

  return (
    <div>
      <div className="toolbar">
        <span className="meta">
          {toPublish === 0 ? 'Aucune page n’attend' : `${toPublish} page${toPublish > 1 ? 's' : ''} à publier`}
        </span>
        <span className="toolbar__spacer" />
        <button type="button" className="btn-ghost" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={counts.publishing > 0 ? 'animate-spin' : undefined} />
          Actualiser
        </button>
      </div>

      {/* Ce que le moteur ne voit pas de ce site, dit avant qu'on ne publie
          contre. Le bandeau AVERTIT et ne désactive rien : aucun bouton de cet
          écran ne dépend de la fraîcheur de l'inventaire. */}
      {freshness && (
        <Notice
          tone={freshness.tone}
          title={freshness.title}
          body={freshness.body}
          action={{ label: 'Voir les pages connues', href: `/sites/${siteId}/pages` }}
        />
      )}

      <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="À publier" value={toPublish} icon={Clock} />
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
                  action={
                    counts.total === 0
                      ? { label: 'Lancer une génération', href: `/sites/${siteId}/publication?canal=generation` }
                      : undefined
                  }
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

          {/* Dites, jamais montrées comme publiables : elles ne partiront pas,
              et une ligne sans bouton au milieu de la file se lirait comme une
              panne du bouton. */}
          {legacyRefresh.length > 0 && (
            <p className="meta" style={{ margin: 'calc(-1 * var(--space-3)) 0 var(--space-6)' }}>
              {legacyRefresh.length === 1
                ? 'Une ancienne demande de mise à jour est ignorée : le moteur ne remplace plus les pages existantes, elle ne sera pas publiée.'
                : `${legacyRefresh.length} anciennes demandes de mise à jour sont ignorées : le moteur ne remplace plus les pages existantes, elles ne seront pas publiées.`}
            </p>
          )}

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
