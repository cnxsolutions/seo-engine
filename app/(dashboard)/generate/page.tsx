'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Generation
// What the engine really produced, per site, including what it refused
// ─────────────────────────────────────────────────────────────────────────────
//
// This page used to read `GET /api/articles` (table `articles`, never written to
// by anything) and look for a `generations` key that response never carried, so
// it displayed an empty list whatever the engine had done. It now reads
// `GET /api/generate`, which serves `generations` — the table the whole pipeline
// actually writes.
//
// The refused pages are the point of the exercise: a page parked in `rejected`
// carries the quality gate's reasons in `error_message`, and until this page
// showed them there was no way, anywhere in the product, to find out why a page
// never shipped.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Wand2,
  Play,
  ExternalLink,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Send,
} from 'lucide-react'
import {
  Button,
  EmptyState,
  Notice,
  PageHeader,
  ReasonList,
  StatTile,
  StatusBadge,
  splitReasons,
  type NoticeTone,
} from '@/components/ui'
import { ConfirmModal, Modal, SiteSwitcher, Tabs } from '@/components/charts'
import { REFUSAL_TITLES } from '@/lib/publishing/refusal-labels'
import type { RefreshScope } from '@/src/core/domain/existing/action'
import type {
  FeedCampaign,
  FeedGeneration,
  FeedSite,
  GenerationCounts,
  GenerationFeedResponse,
} from '@/app/api/generate/feed-types'
import type { InventoryResponse, InventorySummary } from '@/app/api/sites/[id]/inventory/types'
// Un module PARTAGÉ, pas le composant privé de l'autre écran : /publish rend la
// même ligne et la même preuve de doublon. Deux rendus divergeraient au premier
// correctif — et un refus sans son objet n'est pas un refus, c'est une énigme.
import {
  DuplicateEvidence,
  DuplicateFlag,
  RowHead,
  freshnessNotice,
  hasDuplicateEvidence,
  rowStyle,
} from '@/app/(dashboard)/publish/queue-bits'

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

/** The filters a founder actually asks for, in the order the pipeline runs. */
const FILTERS = [
  { key: 'all', label: 'Tout', statuses: '' },
  { key: 'running', label: 'En cours', statuses: 'pending,generating' },
  { key: 'ready', label: 'Prêtes', statuses: 'generated' },
  { key: 'published', label: 'Publiées', statuses: 'published' },
  { key: 'refused', label: 'Refusées', statuses: 'rejected,failed' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

/** What each filter would show, from the tally of the whole scope. */
function countFor(key: FilterKey, counts: GenerationCounts): number {
  switch (key) {
    case 'running': return counts.pending + counts.generating
    case 'ready': return counts.generated
    case 'published': return counts.published
    case 'refused': return counts.rejected + counts.failed
    default: return counts.total
  }
}

interface RunOutcome {
  ok: boolean
  message: string
  reasons?: string[]
}

export default function GeneratePage() {
  const [generations, setGenerations] = useState<FeedGeneration[]>([])
  const [counts, setCounts] = useState<GenerationCounts>(EMPTY_COUNTS)
  const [sites, setSites] = useState<FeedSite[]>([])
  const [campaigns, setCampaigns] = useState<FeedCampaign[]>([])
  const [siteId, setSiteId] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [inventory, setInventory] = useState<InventorySummary | null>(null)

  const [campaignId, setCampaignId] = useState('')
  const [city, setCity] = useState('')
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const params = new URLSearchParams()
    if (siteId) params.set('site_id', siteId)
    const statuses = FILTERS.find((f) => f.key === filter)?.statuses
    if (statuses) params.set('status', statuses)

    try {
      const res = await fetch(`/api/generate?${params.toString()}`)
      const data: GenerationFeedResponse & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error || 'Lecture impossible')

      setGenerations(data.generations ?? [])
      setCounts(data.counts ?? EMPTY_COUNTS)
      setSites(data.sites ?? [])
      setCampaigns(data.campaigns ?? [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [siteId, filter])

  useEffect(() => {
    load()
  }, [load])

  // A generation takes minutes. Polling only while something is actually in
  // flight keeps the page live without hammering the database the rest of the
  // time.
  const inFlight = counts.generating + counts.publishing
  useEffect(() => {
    if (inFlight === 0) return
    const timer = setInterval(load, 15000)
    return () => clearInterval(timer)
  }, [inFlight, load])

  // Le régime de connaissance du SEUL site sélectionné. Hors de `load()`
  // volontairement : celui-ci se rejoue à chaque filtre et toutes les quinze
  // secondes tant qu'une génération est en vol, alors que la fraîcheur d'un
  // inventaire se mesure en jours. `fields=paths` est le mode le plus léger de
  // la route ; seul `summary` est lu.
  //
  // Un échec de lecture laisse `null`, donc aucun bandeau : on ne décrit pas une
  // cécité qu'on n'a pas mesurée.
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

  const freshness = freshnessNotice(inventory)

  const eligibleCampaigns = useMemo(
    () => campaigns.filter((c) => !siteId || c.site_id === siteId),
    [campaigns, siteId]
  )

  const selectedCampaign = eligibleCampaigns.find((c) => c.id === campaignId) ?? null
  const currentSite = sites.find((s) => s.id === siteId) ?? null

  const launch = async () => {
    if (!campaignId) return
    setRunning(true)
    setOutcome(null)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, city: city.trim() || undefined }),
      })
      const data = await res.json()

      if (!res.ok) {
        setOutcome({ ok: false, message: data.error || 'La génération a échoué.' })
      } else if (data.rejected) {
        setOutcome({
          ok: false,
          message: 'Page produite puis refusée par le contrôle qualité — elle est listée ci-dessous.',
          reasons: data.rejected.reasons ?? [],
        })
      } else {
        setOutcome({
          ok: true,
          message: data.publishedUrl
            ? `Page générée et publiée : ${data.publishedUrl}`
            : `Page générée pour « ${data.city} ». Elle attend une publication (étape 5).`,
        })
      }
    } catch (error) {
      setOutcome({ ok: false, message: error instanceof Error ? error.message : 'Erreur réseau' })
    } finally {
      setRunning(false)
      load()
    }
  }

  return (
    <div>
      <PageHeader
        icon={Wand2}
        badge="Étape 4"
        title="Génération"
        subtitle="Ce que le moteur a réellement produit — y compris les pages qu'il a refusées, et pourquoi"
        actions={
          <button className="btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={inFlight > 0 ? 'animate-spin' : undefined} />
            Actualiser
          </button>
        }
      />

      {/* Scope */}
      <div className="toolbar">
        <SiteSwitcher
          sites={sites}
          value={siteId || null}
          onChange={(id) => {
            setSiteId(id ?? '')
            setCampaignId('')
          }}
        />

        <Tabs
          items={FILTERS.map((f) => ({ id: f.key, label: f.label, count: countFor(f.key, counts) }))}
          value={filter}
          onChange={(id) => setFilter(id as FilterKey)}
          variant="segmented"
          ariaLabel="Filtrer par état"
        />
      </div>

      {/* Counts — the whole scope, not the filtered page */}
      <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="En attente" value={counts.pending} icon={Clock} />
        <StatTile label="En cours" value={counts.generating} icon={Loader2} />
        <StatTile label="Prêtes à publier" value={counts.generated} icon={CheckCircle} />
        <StatTile label="Publiées" value={counts.published} icon={Send} />
        <StatTile label="Refusées" value={counts.rejected} icon={ShieldAlert} />
        <StatTile label="Échecs" value={counts.failed} icon={AlertCircle} />
      </div>

      {/*
        Ce que le moteur ne voit pas de ce site, dit juste au-dessus du bouton
        qui le lance. Il AVERTIT et ne désactive JAMAIS « Lancer » : le moteur ne
        refuse pas de produire sur un site qu'il n'a pas vu — il vérifie chaque
        adresse directement sur le site avant d'écrire — et l'interface n'a pas à
        refuser à sa place.
      */}
      {freshness && (
        <Notice
          tone={freshness.tone}
          title={freshness.title}
          body={freshness.body}
          action={{ label: 'Voir les pages connues', href: `/sites/${siteId}/existing` }}
        />
      )}

      {/* Launch */}
      <div className="panel" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="panel__header">
          <h2 className="card-title">Lancer une génération</h2>
        </div>
        <div className="panel__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {campaigns.length === 0 ? (
            <EmptyState
              bare
              icon={Wand2}
              title="Aucune campagne"
              description="Une génération appartient toujours à une campagne : elle en tire le site, le métier, les communes, le modèle et la longueur cible."
              action={{ label: 'Créer une campagne', href: '/strategy/new' }}
            />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  className="input"
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  aria-label="Campagne"
                  style={{ width: 'auto', minWidth: 260 }}
                >
                  <option value="">Choisir une campagne…</option>
                  {eligibleCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.is_active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>

                <input
                  className="input"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Commune (facultatif)"
                  aria-label="Commune"
                  style={{ width: 'auto', minWidth: 200 }}
                />

                <button className="btn-primary" onClick={launch} disabled={!campaignId || running}>
                  {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {running ? 'Génération en cours…' : 'Lancer'}
                </button>
              </div>

              <p className="meta">
                La page est écrite, mesurée, maillée puis soumise au contrôle qualité — comptez quelques
                minutes. Sans commune, la première commune de la campagne est utilisée.
                {selectedCampaign && (
                  <>
                    {' '}
                    {selectedCampaign.auto_publish
                      ? 'Cette campagne publie automatiquement une page acceptée.'
                      : 'Cette campagne ne publie pas automatiquement : la page attendra à l’étape 5.'}
                  </>
                )}
              </p>
            </>
          )}

          {outcome && <OutcomeBlock outcome={outcome} />}
        </div>
      </div>

      {/* Feed */}
      <div className="panel">
        <div className="panel__header">
          <h2 className="card-title">
            Générations{currentSite ? ` · ${currentSite.name}` : ''}
          </h2>
          <span className="meta">{generations.length} affichée(s) sur {counts.total}</span>
        </div>

        {loadError ? (
          <div className="panel__body">
            <EmptyState bare variant="error" description={loadError} action={{ label: 'Réessayer', onClick: load }} />
          </div>
        ) : loading ? (
          <div className="panel__body" style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
            <Loader2 size={22} className="animate-spin" color="var(--ink-faint)" />
          </div>
        ) : generations.length === 0 ? (
          <div className="panel__body">
            <EmptyState
              bare
              variant={counts.total > 0 ? 'no-results' : 'no-data'}
              icon={Wand2}
              title={counts.total > 0 ? 'Aucun résultat' : 'Aucune génération'}
              description={
                counts.total > 0
                  ? 'Rien ne correspond à ce filtre. Élargissez la sélection ci-dessus.'
                  : 'Lancez une génération ci-dessus, ou laissez une campagne planifiée le faire.'
              }
            />
          </div>
        ) : (
          <div className="panel__body--flush">
            {generations.map((g, index) => (
              <GenerationRow
                key={g.id}
                generation={g}
                last={index === generations.length - 1}
                onChanged={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function GenerationRow({
  generation: g,
  last,
  onChanged,
}: {
  generation: FeedGeneration
  last: boolean
  /** Relit le flux : une bascule en mise à jour change le statut de la ligne. */
  onChanged: () => void
}) {
  const reasons = splitReasons(g.error_message)

  // LE STATUT, PAS `refusal_kind`, dit si la page a été refusée.
  //
  // `persistDuplicateVerdict` (lib/pipeline/repository.ts) pose
  // `refusal_kind = 'duplicat'` dès que les preuves BLOQUERAIENT — y compris en
  // mode observation, sur une page qui part quand même. Brancher le titre de
  // refus et les actions de reprise sur cette seule colonne, comme le faisait
  // cette ligne, annoncerait « Publication refusée » et proposerait « Réessayer »
  // sur une page en ligne : exactement le mensonge que la période d'observation
  // doit éviter.
  const refused = g.status === 'rejected' || g.status === 'failed'
  const verdict = g.duplicate_verdict

  return (
    <div style={rowStyle(last, (refused && reasons.length > 0) || hasDuplicateEvidence(verdict))}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <RowHead generation={g} extra={new Date(g.created_at).toLocaleDateString('fr-FR')} />

        <StatusBadge status={g.status} />
        <DuplicateFlag verdict={verdict} />

        {/*
          "Published" covered four different states and showed one badge. A page
          committed to a branch nobody deploys and a page a visitor can read were
          indistinguishable here — which is how five commits sat unpublished for
          days without anyone noticing.
        */}
        {g.status === 'published' && g.publish_live === false && (
          <span className="badge badge-warning" title={(g.publish_notes ?? []).join('\n')}>
            pas en ligne
          </span>
        )}

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

      {/*
        Notes are things the connector needed to say and which are not errors:
        structured data stripped by WordPress, no SEO plugin installed, a page
        published as a bare article. They used to exist only in a log line.
      */}
      {(g.publish_notes?.length ?? 0) > 0 && (
        // `tone="info"`: these are notes, not refusals. The local copy this
        // replaces painted the heading in --status-critical-text with a
        // ShieldAlert whatever the case, so a stripped JSON-LD block read as a
        // quality failure.
        <ReasonList title="À savoir sur cette publication" reasons={g.publish_notes ?? []} tone="info" />
      )}

      {refused && reasons.length > 0 && (
        <ReasonList
          title={
            // Le vocabulaire du refus est traduit dans lib/publishing, une seule
            // fois. La table locale qui vivait ici était typée
            // `Record<string, string>` et ne connaissait pas 'duplicat' : elle
            // aurait rendu `undefined` en guise de titre sur le motif que ce lot
            // ajoute.
            g.refusal_kind
              ? REFUSAL_TITLES[g.refusal_kind]
              : g.status === 'rejected'
                ? 'Refusée par le contrôle qualité'
                : 'Échec'
          }
          reasons={reasons}
        />
      )}

      {/*
        CONTRE QUOI cette page a été pesée. Rendu sur toutes les lignes, refusées
        comme publiées : en mode observation le verdict tombe sur des pages qui
        SONT parties, et c'est précisément ce volume que le propriétaire doit
        pouvoir mesurer avant qu'une barrière ne se ferme dessus.
      */}
      {hasDuplicateEvidence(verdict) && <DuplicateEvidence verdict={verdict} />}

      {/*
        A refusal is a decision waiting on a human, not an accident waiting on a
        retry. It lands in `failed`, which no job reads and which the publication
        screen does not list — so a slug collision parked a finished page for
        good, with nowhere in the product to act on it.
      */}
      {refused && g.refusal_kind && <RefusalActions generation={g} onChanged={onChanged} />}
    </div>
  )
}

// ─── Les issues d'un refus ───────────────────────────────────────────────────
//
// UN REFUS DE DOUBLON N'A AUCUNE ISSUE DESTRUCTRICE, et c'est la règle qui
// gouverne tout ce bloc. `force: true` écraserait une page du propriétaire —
// possiblement une page qui ranke — en réponse à un simple avertissement de
// ressemblance ; l'offrir ici reviendrait à faire du pire résultat possible la
// sortie la plus rapide. Il reste conditionné à 'occupe', où l'adresse en cause
// est celle que le moteur avait lui-même réservée, et il passe désormais par une
// confirmation qui NOMME ce qui sera remplacé.

/** Jusqu'où va la mise à jour proposée. 'metadata' est le défaut : le moins destructeur. */
const REFRESH_SCOPES: Array<{ value: RefreshScope; label: string }> = [
  { value: 'metadata', label: 'Titre et description seulement' },
  { value: 'content', label: 'Contenu complet' },
]

interface RefusalFeedback {
  tone: NoticeTone
  title: string
  body: string
  action?: { label: string; href: string }
}

/**
 * Les pages que ce refus DÉSIGNE — jamais une adresse devinée.
 *
 * Le verdict de doublon les nomme une par une. À défaut, un refus 'occupe' en
 * connaît exactement une : celle que le slug réservé par cette génération
 * occupe déjà. Sans l'un ni l'autre, il n'y a rien à rafraîchir et le bouton
 * n'apparaît pas — proposer une bascule sans page visée serait un bouton mort.
 */
function refreshTargets(g: FeedGeneration): string[] {
  const named = (g.duplicate_verdict?.matches ?? []).map((match) => match.entryPath).filter(Boolean)
  const unique = [...new Set(named)]
  if (unique.length > 0) return unique
  if (g.refusal_kind === 'occupe' && g.slug) return [g.slug.startsWith('/') ? g.slug : `/${g.slug}`]
  return []
}

/** L'URL servie d'une page en cause, telle que le verdict la porte — ou rien. */
function targetUrlOf(g: FeedGeneration, path: string): string | null {
  return (g.duplicate_verdict?.matches ?? []).find((match) => match.entryPath === path)?.entryUrl ?? null
}

/**
 * Les sorties d'un refus, la destructrice EN DERNIER et jamais sur un doublon.
 *
 * Trois actes, trois endpoints, aucun bouton sans destination :
 *  · « Réécrire le titre et la méta » → POST /api/generate. Le libellé nomme le
 *    BUT ; la confirmation nomme l'ACTE et son coût, parce qu'aucun endpoint de
 *    ce dépôt ne réécrit ces deux champs seuls (vérifié : POST /api/generate
 *    appelle runCampaignNow et refait la page entière). Promettre l'inverse
 *    ferait cliquer sur une dépense non annoncée.
 *  · « Basculer en mise à jour de cette page » → POST /api/generations/refresh.
 *    Le texte déjà payé est CONSERVÉ : ce qui était faux, c'est la destination,
 *    pas le contenu. Rien n'est publié — la ligne rejoint la file des mises à
 *    jour à valider, où elle attend un second clic humain.
 *  · « Écraser la page existante » → POST /api/publish/generation { force }.
 *    Seule action irréversible de l'écran : en `ghost`, en dernier, derrière une
 *    ConfirmModal 'danger' dont le libellé répète le verbe.
 */
function RefusalActions({ generation: g, onChanged }: { generation: FeedGeneration; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<RefusalFeedback | null>(null)
  const [dialog, setDialog] = useState<'relaunch' | 'refresh' | 'overwrite' | null>(null)

  const targets = useMemo(() => refreshTargets(g), [g])
  const [targetPath, setTargetPath] = useState(targets[0] ?? '')
  const [scope, setScope] = useState<RefreshScope>('metadata')

  const duplicate = g.refusal_kind === 'duplicat'
  const canSwitch = Boolean(g.site_id) && targets.length > 0
  const canRelaunch = Boolean(g.campaign_id)
  const chosenPath = targetPath || targets[0] || ''
  const chosenUrl = chosenPath ? targetUrlOf(g, chosenPath) : null

  /** Une seule lecture de réponse pour les trois appels : même forme, même repli. */
  const send = async (url: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setBusy(true)
    setFeedback(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setFeedback({
          tone: 'critical',
          title: 'Action impossible',
          body: typeof data.error === 'string' ? data.error : `Le serveur a répondu ${res.status}.`,
        })
        return null
      }
      return data
    } catch {
      setFeedback({ tone: 'critical', title: 'Action impossible', body: 'Impossible de joindre le serveur.' })
      return null
    } finally {
      setBusy(false)
      setDialog(null)
    }
  }

  const republish = async (force: boolean) => {
    const data = await send('/api/publish/generation', { generationId: g.id, force })
    if (!data) return
    setFeedback({
      tone: 'good',
      title: 'Page publiée',
      body: typeof data.pageUrl === 'string' ? data.pageUrl : 'La publication est passée, sans URL rapportée.',
    })
    onChanged()
  }

  const relaunch = async () => {
    const data = await send('/api/generate', { campaign_id: g.campaign_id, city: g.city || undefined })
    if (!data) return
    setFeedback(
      data.rejected
        ? {
            tone: 'warning',
            title: 'Nouvelle page produite, puis refusée à son tour',
            body: 'Elle apparaît dans la liste ci-dessous avec ses motifs.',
          }
        : {
            tone: 'good',
            title: 'Nouvelle génération lancée',
            body: 'La page vient d’être réécrite, titre et description compris. Elle apparaît dans la liste ci-dessous.',
          }
    )
    onChanged()
  }

  const switchToRefresh = async () => {
    if (!g.site_id || !chosenPath) return
    const data = await send('/api/generations/refresh', {
      siteId: g.site_id,
      targetPath: chosenPath,
      scope,
      sourceGenerationId: g.id,
    })
    if (!data) return
    setFeedback({
      tone: 'good',
      title: `Cette page devient une mise à jour de ${chosenPath}`,
      body: 'Le texte déjà écrit est conservé. Elle attend votre validation à l’étape 5 : rien n’a été remplacé.',
      action: { label: 'Voir la file des mises à jour', href: '/publish' },
    })
    onChanged()
  }

  return (
    <div className="inset" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {/* « Réessayer » n'a de sens que sur un refus de destination : un
            doublon ne se dissout pas en republiant le même texte au même
            endroit, et le proposer ferait tourner l'opérateur en rond. */}
        {!duplicate && (
          <Button variant="secondary" disabled={busy} onClick={() => republish(false)}>
            Réessayer
          </Button>
        )}

        {duplicate && canRelaunch && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setDialog('relaunch')}
            title="Relance une génération complète sur cette commune : de nouveaux jetons sont dépensés."
          >
            Réécrire le titre et la méta
          </Button>
        )}

        {canSwitch && (
          <Button variant={duplicate ? 'primary' : 'secondary'} icon={RefreshCw} disabled={busy} onClick={() => setDialog('refresh')}>
            Basculer en mise à jour de cette page
          </Button>
        )}

        {/* La seule action irréversible de l'écran : jamais principale, jamais
            en premier dans l'ordre de lecture, et jamais offerte sur 'duplicat'. */}
        {g.refusal_kind === 'occupe' && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setDialog('overwrite')}
            title="Remplace le contenu actuel de la page. Le moteur n’en garde aucune copie."
          >
            Écraser la page existante
          </Button>
        )}
      </div>

      {duplicate && (
        <p className="meta" style={{ margin: 0 }}>
          {canRelaunch || canSwitch
            ? 'Aucune de ces issues ne remplace la page en cause. Le moteur ne supprime, ne fusionne et ne redirige aucune page.'
            : 'Ce refus ne nomme aucune page existante et cette génération n’appartient à aucune campagne : il n’y a rien à rafraîchir ni à relancer depuis ici. Les motifs ci-dessus disent ce qui a été relevé.'}
        </p>
      )}

      {feedback && (
        <Notice
          inline
          tone={feedback.tone}
          title={feedback.title}
          body={feedback.body}
          action={feedback.action}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {dialog === 'relaunch' && (
        <ConfirmModal
          onClose={() => setDialog(null)}
          onConfirm={relaunch}
          busy={busy}
          title="Réécrire le titre et la description ?"
          body={
            <>
              Aucun endpoint de ce moteur ne réécrit ces deux champs seuls&nbsp;: la campagne est relancée sur
              {g.city ? ` « ${g.city} »` : ' sa commune'} et la page est REDIGÉE ENTIÈREMENT, titre et
              description compris. De nouveaux jetons sont dépensés, et la page en conflit n’est pas touchée.
            </>
          }
          confirmLabel="Relancer une génération complète"
        />
      )}

      {dialog === 'refresh' && (
        <Modal
          title={`Mettre à jour ${chosenPath}`}
          subtitle="Le texte déjà écrit sera proposé comme mise à jour de cette page"
          onClose={() => setDialog(null)}
          size="md"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
                Annuler
              </Button>
              {/* `primary` et non `danger` : basculer en mise à jour n'écrit
                  rien encore, et peindre en rouge un acte réversible userait
                  le seul signal qui doit rester rare. */}
              <Button variant="primary" loading={busy} onClick={switchToRefresh}>
                Préparer la mise à jour
              </Button>
            </div>
          }
        >
          <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
              Au lieu d’ajouter une page, le contenu déjà écrit sera proposé comme mise à jour de la page
              existante. Vous validerez l’avant/après à l’étape Publier&nbsp;: rien ne part maintenant.
            </p>

            <div className="inset" style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <div className="eyebrow">Page visée</div>
              {targets.length > 1 ? (
                <select
                  className="input mono"
                  value={chosenPath}
                  onChange={(event) => setTargetPath(event.target.value)}
                  aria-label="Page à mettre à jour"
                  disabled={busy}
                >
                  {targets.map((path) => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              ) : (
                <span className="chip">{chosenPath}</span>
              )}
              {chosenUrl ? (
                <a className="btn-link truncate" href={chosenUrl} target="_blank" rel="noopener noreferrer">
                  {chosenUrl} <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                <span className="meta">
                  Adresse en ligne inconnue — le moteur n’a pas retenu d’URL pour cette page.
                </span>
              )}
            </div>

            <label className="field-label" htmlFor={`refresh-scope-${g.id}`}>Ce qui sera réécrit</label>
            <select
              id={`refresh-scope-${g.id}`}
              className="input"
              value={scope}
              onChange={(event) => setScope(event.target.value as RefreshScope)}
              disabled={busy}
            >
              {REFRESH_SCOPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="meta" style={{ margin: 0 }}>
              La portée est enregistrée sur la demande&nbsp;; c’est le moteur qui l’applique à la rédaction.
            </p>
          </div>
        </Modal>
      )}

      {dialog === 'overwrite' && (
        <ConfirmModal
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={() => republish(true)}
          busy={busy}
          title={`Écraser ${chosenPath || 'la page existante'} ?`}
          body="Cette adresse est occupée par une page que le moteur n’a pas écrite. La remplacer efface son contenu actuel, et le moteur n’en garde aucune copie. Si cette page vous appartient et qu’elle est positionnée, préférez la mise à jour."
          confirmLabel="Écraser la page"
          cancelLabel="Annuler"
        />
      )}
    </div>
  )
}

// ─── Reasons ─────────────────────────────────────────────────────────────────

function OutcomeBlock({ outcome }: { outcome: RunOutcome }) {
  return (
    <div
      className="inset"
      style={{
        borderLeft: `2px solid ${outcome.ok ? 'var(--status-good)' : 'var(--status-critical)'}`,
      }}
    >
      <div
        style={{
          fontSize: 'var(--fs-sm)',
          fontWeight: 600,
          color: outcome.ok ? 'var(--status-good-text)' : 'var(--status-critical-text)',
        }}
      >
        {outcome.message}
      </div>
      {outcome.reasons && outcome.reasons.length > 0 && (
        <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: '1.1rem', fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 1.7 }}>
          {outcome.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
