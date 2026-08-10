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
import { EmptyState, PageHeader, StatTile, StatusBadge } from '@/components/ui'
import { SiteSwitcher, Tabs } from '@/components/charts'
import type {
  FeedCampaign,
  FeedGeneration,
  FeedSite,
  GenerationCounts,
  GenerationFeedResponse,
} from '@/app/api/generate/feed-types'

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
              <GenerationRow key={g.id} generation={g} last={index === generations.length - 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function GenerationRow({ generation: g, last }: { generation: FeedGeneration; last: boolean }) {
  const reasons = splitReasons(g.error_message)
  const refused = g.status === 'rejected' || g.status === 'failed'

  return (
    <div
      style={{
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: last ? undefined : '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: refused && reasons.length > 0 ? 'var(--space-3)' : 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>
            {g.title || g.slug || g.focus_keyword || g.city}
          </div>
          <div className="meta" style={{ marginTop: 2 }}>
            {[
              g.page_type,
              g.city,
              g.ai_model,
              g.campaign?.name,
              g.site?.name,
              new Date(g.created_at).toLocaleDateString('fr-FR'),
            ]
              .filter(Boolean)
              .join(' • ')}
          </div>
        </div>

        <StatusBadge status={g.status} />

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
        <ReasonList title="À savoir sur cette publication" reasons={g.publish_notes ?? []} />
      )}

      {refused && reasons.length > 0 && (
        <ReasonList
          title={
            g.status === 'rejected'
              ? 'Refusée par le contrôle qualité'
              : g.refusal_kind
                ? REFUSAL_TITLE[g.refusal_kind] ?? 'Publication refusée'
                : 'Échec'
          }
          reasons={reasons}
        />
      )}

      {/*
        A refusal is a decision waiting on a human, not an accident waiting on a
        retry. It lands in `failed`, which no job reads and which the publication
        screen does not list — so a slug collision parked a finished page for
        good, with nowhere in the product to act on it.
      */}
      {g.refusal_kind && <RefusalActions generation={g} />}
    </div>
  )
}

const REFUSAL_TITLE: Record<string, string> = {
  occupe: 'Publication refusée — l’URL est déjà occupée',
  redirection: 'Publication refusée — l’URL redirige ailleurs',
  identifiants: 'Publication refusée — identifiants manquants',
}

/**
 * The two ways out of a refusal.
 *
 * Retry is for "I fixed it on the site". Taking over is for "that page is
 * actually mine" — offered only for an occupied slug, and worded as what it
 * does, because it overwrites a page the engine did not write.
 */
function RefusalActions({ generation: g }: { generation: FeedGeneration }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const republish = async (force: boolean) => {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/publish/generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId: g.id, force }),
      })
      const data = await res.json()
      setResult(res.ok ? `Publiée : ${data.pageUrl ?? 'sans URL'}` : data.error || 'Nouvelle tentative refusée')
    } catch {
      setResult('Impossible de joindre le serveur')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inset" style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button className="btn-secondary" disabled={busy} onClick={() => republish(false)}>
          Réessayer
        </button>

        {g.refusal_kind === 'occupe' && (
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => republish(true)}
            title="Écrase la page existante. À n’utiliser que si cette page a bien été produite par le moteur."
          >
            Reprendre la page existante
          </button>
        )}
      </div>

      {result && <p className="meta">{result}</p>}
    </div>
  )
}

// ─── Reasons ─────────────────────────────────────────────────────────────────

function ReasonList({ title, reasons }: { title: string; reasons: string[] }) {
  return (
    <div className="inset">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          fontSize: 'var(--fs-2xs)',
          fontWeight: 650,
          textTransform: 'uppercase',
          letterSpacing: 'var(--ls-eyebrow)',
          color: 'var(--status-critical-text)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <ShieldAlert size={12} />
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 1.7 }}>
        {reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
    </div>
  )
}

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

/**
 * `error_message` is written as `Rejete par le pipeline : CODE: raison | CODE: raison`
 * (lib/pipeline/repository.ts). Split it back into the list it started as, and
 * drop the prefix — the badge already says the page was refused.
 */
function splitReasons(message: string | null): string[] {
  if (!message) return []
  return message
    .replace(/^Rejete par le pipeline\s*:\s*/i, '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}
