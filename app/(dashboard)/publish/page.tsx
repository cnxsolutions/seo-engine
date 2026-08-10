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
import { EmptyState, PageHeader, StatTile, StatusBadge } from '@/components/ui'
import { SiteSwitcher } from '@/components/charts'
import type { FeedGeneration, FeedSite, GenerationCounts, GenerationFeedResponse } from '@/app/api/generate/feed-types'

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

export default function PublishPage() {
  const [generations, setGenerations] = useState<FeedGeneration[]>([])
  const [counts, setCounts] = useState<GenerationCounts>(EMPTY_COUNTS)
  const [sites, setSites] = useState<FeedSite[]>([])
  const [siteId, setSiteId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, RowError>>({})

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

  const queue = generations.filter((g) => g.status === 'generated' || g.status === 'publishing')
  const refused = generations.filter((g) => g.status === 'rejected' || g.status === 'failed')
  const published = generations.filter((g) => g.status === 'published').slice(0, PUBLISHED_SHOWN)

  return (
    <div>
      <PageHeader
        icon={Send}
        badge="Étape 5"
        title="Publication"
        subtitle="Ce qui attend une publication, ce qui est en ligne, et ce que le contrôle qualité a refusé"
        actions={
          <button className="btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={counts.publishing > 0 ? 'animate-spin' : undefined} />
            Actualiser
          </button>
        }
      />

      <div className="toolbar">
        <SiteSwitcher sites={sites} value={siteId || null} onChange={(id) => setSiteId(id ?? '')} />
      </div>

      <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="À publier" value={counts.generated} icon={Clock} />
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

// ─── Layout ──────────────────────────────────────────────────────────────────

function Panel({
  title,
  count,
  hint,
  children,
}: {
  title: string
  count: number
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="panel" style={{ marginBottom: 'var(--space-6)' }}>
      <div className="panel__header">
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title">{title}</h2>
          {hint && <p className="meta" style={{ marginTop: 2 }}>{hint}</p>}
        </div>
        <span className="badge badge-muted">{count}</span>
      </div>
      {children}
    </div>
  )
}

function rowStyle(last: boolean, gap: boolean): React.CSSProperties {
  return {
    padding: 'var(--space-4) var(--space-5)',
    borderBottom: last ? undefined : '1px solid var(--line)',
    display: 'flex',
    flexDirection: 'column',
    gap: gap ? 'var(--space-3)' : 0,
  }
}

function RowHead({ generation: g, extra }: { generation: FeedGeneration; extra?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>
        {g.title || g.slug || g.focus_keyword || g.city}
      </div>
      <div className="meta" style={{ marginTop: 2 }}>
        {[g.page_type, g.city, g.ai_model, g.campaign?.name, g.site?.name, extra].filter(Boolean).join(' • ')}
      </div>
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
        title={g.status === 'rejected' ? 'Refusée par le contrôle qualité' : 'Échec'}
        reasons={reasons.length > 0 ? reasons : ['Aucune raison enregistrée.']}
      />
    </div>
  )
}

function PublishedRow({ generation: g, last }: { generation: FeedGeneration; last: boolean }) {
  const when = g.published_at || g.updated_at

  return (
    <div style={{ ...rowStyle(last, false), flexDirection: 'row', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
      <RowHead generation={g} extra={`en ligne le ${new Date(when).toLocaleDateString('fr-FR')}`} />
      <StatusBadge status={g.status} />
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
      {reasons.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 1.7 }}>
          {reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * `error_message` is written as `Rejete par le pipeline : CODE: raison | CODE: raison`
 * (lib/pipeline/repository.ts). Split it back into the list it started as.
 */
function splitReasons(message: string | null): string[] {
  if (!message) return []
  return message
    .replace(/^Rejete par le pipeline\s*:\s*/i, '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}
