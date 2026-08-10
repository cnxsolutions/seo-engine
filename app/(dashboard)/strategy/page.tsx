'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Stratégie — les campagnes, et le plan de cycle qu'on décide de lancer
//
// Two things were wrong here and both cost real work.
//
// 1. The only way to LOOK at a plan was to build a new one: the button called
//    POST, which re-reads the SERP, re-calls the model and creates another
//    cycle plan — then confirming it wipes the campaign's planned slots and
//    writes them again. Wanting to see the calendar erased it. Reading now goes
//    through GET /api/campaigns/:id/plan, which returns the active plan and
//    changes nothing; a draft plan can be confirmed straight from that read.
//
// 2. The modal presented every plan the same way, whether it had been built on
//    SERP that were actually read and Search Console history, or on nothing at
//    all. A guessed brief that looks measured is worse than no brief. The plan
//    header now states its provenance, and says "inconnue" when it cannot know
//    rather than implying either answer.
//
// The inline campaign-creation form that used to live in this file is gone: it
// duplicated /strategy/new (which also runs the site analysis and the competitor
// crawl) and was reachable only from the empty state.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CalendarDays, CheckCircle2, Eye, Info, Loader2, Plus, RefreshCw, Search, Target, TriangleAlert, X,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Button, EmptyState, PageHeader, StatusBadge, formatMetric } from '@/components/ui'
import type { Campaign, CyclePlan, PlanPreviewItem } from '@/lib/types'

const CYCLE_DURATIONS = [7, 14, 21, 30]

/** Mirrors the `--z-modal` token: csstype rejects a custom property here. */
const MODAL_Z = 100

const PAGE_TYPE_LABELS: Record<string, string> = {
  pillar: 'Pilier',
  child: 'Fille',
  alternative: 'Alternative',
  comparative: 'Comparatif',
  local_pack: 'Local Pack',
}

const PLAN_STATUS_LABELS: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Plan à confirmer', badge: 'badge badge-warning' },
  confirmed: { label: 'Cycle confirmé', badge: 'badge badge-info' },
  executing: { label: 'Cycle en cours', badge: 'badge badge-success' },
  completed: { label: 'Cycle terminé', badge: 'badge badge-muted' },
  cancelled: { label: 'Plan annulé', badge: 'badge badge-muted' },
}

/**
 * Label for the planning button while it runs.
 *
 * Derived from elapsed time rather than from real server progress: the route
 * answers once, at the end. The thresholds follow the actual sequence — five
 * SERP reads spaced ~4s apart plus competitor crawls, then one LLM call — so
 * the label stays honest without a streaming channel.
 */
function planPhase(seconds: number): string {
  if (seconds < 8) return 'Préparation'
  if (seconds < 75) return 'Lecture des SERP'
  return 'Rédaction des briefs'
}

// ─── Provenance ──────────────────────────────────────────────────────────────
//
// What the planner actually measured, as the plan route reports it: `serpEvidence`
// (the result pages really read) and `signals` (the Search Console history).
// Both are optional by nature — a first cycle has no history, a blocked SERP
// yields nothing — so the shapes below are parsed defensively rather than cast.
// The distinction that matters is three-way, not two-way: measured, blind, and
// "we cannot tell", the last being what a plan re-read from the database is.

interface SerpProof {
  query: string
  fetchedAt: string | null
  competitors: number
  medianWordCount: number | null
  commonSections: number
  peopleAlsoAsk: number
}

interface MeasuredQuery {
  query: string
  pageUrl: string
  position: number
  impressions: number
}

interface GscProof {
  windowStart: string | null
  windowEnd: string | null
  strikingDistance: MeasuredQuery[]
  lowCtrPages: number
  deadPages: number
  cannibalized: number
}

interface PlanProvenance {
  /** false when the response said nothing at all about how the plan was built. */
  reported: boolean
  serp: SerpProof[]
  gsc: GscProof | null
}

const UNKNOWN_PROVENANCE: PlanProvenance = { reported: false, serp: [], gsc: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function size(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) return source[key]
  }
  return undefined
}

function parseSerp(raw: unknown): SerpProof[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((entry) => ({
    query: str(entry.query) ?? '—',
    fetchedAt: str(entry.fetchedAt),
    competitors: size(entry.competitors),
    medianWordCount: num(entry.medianWordCount),
    commonSections: size(entry.commonSections),
    peopleAlsoAsk: size(entry.peopleAlsoAsk),
  }))
}

function parseGsc(raw: unknown): GscProof | null {
  if (!isRecord(raw)) return null
  // `available: false` is the module's way of saying "draw no conclusion".
  if (raw.available === false) return null

  const strikingDistance = (Array.isArray(raw.strikingDistance) ? raw.strikingDistance : [])
    .filter(isRecord)
    .map((entry) => ({
      query: str(entry.query) ?? '',
      pageUrl: str(entry.pageUrl) ?? '',
      position: num(entry.position) ?? 0,
      impressions: num(entry.impressions) ?? 0,
    }))
    .filter((entry) => entry.query && entry.pageUrl)

  return {
    windowStart: str(raw.windowStart),
    windowEnd: str(raw.windowEnd),
    strikingDistance,
    lowCtrPages: size(raw.lowCtrPages),
    deadPages: size(raw.deadPages),
    cannibalized: size(raw.cannibalized),
  }
}

/** Reads provenance off a response body, or off the plan it carries. */
function readProvenance(payload: unknown): PlanProvenance {
  if (!isRecord(payload)) return UNKNOWN_PROVENANCE

  const rawSerp = pick(payload, ['serpEvidence', 'serp_evidence'])
  const rawSignals = pick(payload, ['signals', 'gscSignals', 'gsc_signals'])

  if (rawSerp === undefined && rawSignals === undefined) {
    return isRecord(payload.plan) ? readProvenance(payload.plan) : UNKNOWN_PROVENANCE
  }

  return { reported: true, serp: parseSerp(rawSerp), gsc: parseGsc(rawSignals) }
}

/**
 * The only trace of measurement a STORED plan keeps.
 *
 * `normalizeBriefs` (lib/planning/brief-plan.ts) writes a Search Console
 * citation into `rationale` and into `seo_rules` whenever a brief was built on a
 * measured opportunity or a detected cannibalisation. Counting those citations
 * says something real about a plan re-read from the database — but it is a
 * trace, not proof that the SERP were read, and it is labelled as such. If the
 * wording upstream ever changes, this under-reports, which is the safe way to be
 * wrong: it can never make a blind plan look measured.
 */
const MEASUREMENT_TRACE = /search console|en position \d|cannibalisation/i

function citesMeasurement(item: PlanPreviewItem): boolean {
  const haystack = [item.rationale ?? '', ...(item.seo_rules ?? [])].join(' ')
  return MEASUREMENT_TRACE.test(haystack)
}

type ProvenanceGrade = 'measured' | 'partial' | 'blind' | 'unknown'

function gradeOf(provenance: PlanProvenance): ProvenanceGrade {
  if (!provenance.reported) return 'unknown'
  const serp = provenance.serp.some((proof) => proof.competitors > 0)
  const gsc = provenance.gsc !== null
  if (serp && gsc) return 'measured'
  if (serp || gsc) return 'partial'
  return 'blind'
}

// ─── Page ────────────────────────────────────────────────────────────────────

interface ModalState {
  campaign: Campaign
  plan: CyclePlan
  items: PlanPreviewItem[]
  provenance: PlanProvenance
  /** `preview` = just generated, not yet in the database as active work. */
  mode: 'preview' | 'saved'
}

export default function StrategyPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [plans, setPlans] = useState<Record<string, CyclePlan | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'good' | 'critical'; message: string } | null>(null)

  const [planning, setPlanning] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [modal, setModal] = useState<ModalState | null>(null)

  /** Read-only: never creates a plan, never touches the calendar. */
  const loadPlan = useCallback(async (campaignId: string): Promise<CyclePlan | null> => {
    const res = await fetch(`/api/campaigns/${campaignId}/plan`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
    const plan = (data.plan ?? null) as CyclePlan | null
    setPlans((prev) => ({ ...prev, [campaignId]: plan }))
    return plan
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/campaigns')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)

      const list: Campaign[] = Array.isArray(data.campaigns) ? data.campaigns : []
      setCampaigns(list)
      setLoading(false)

      // Plans are read after the list is on screen: they decorate the rows, they
      // are not what the page is about, and one slow read must not hold the
      // whole view back.
      await Promise.all(list.map((campaign) => loadPlan(campaign.id).catch(() => null)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      setLoading(false)
    }
  }, [loadPlan])

  useEffect(() => {
    load()
  }, [load])

  // ── Actions ──
  const openPlan = async (campaign: Campaign) => {
    setOpening(campaign.id)
    setNotice(null)
    try {
      const plan = await loadPlan(campaign.id)
      if (!plan) {
        setNotice({ tone: 'critical', message: 'Aucun plan enregistré pour cette campagne.' })
        return
      }
      setModal({
        campaign,
        plan,
        items: Array.isArray(plan.plan_data) ? plan.plan_data : [],
        // A stored plan carries its briefs, not the evidence they were written
        // from: saying "inconnue" is the only honest reading.
        provenance: UNKNOWN_PROVENANCE,
        mode: 'saved',
      })
    } catch (err) {
      setNotice({ tone: 'critical', message: err instanceof Error ? err.message : 'Lecture du plan impossible' })
    } finally {
      setOpening(null)
    }
  }

  const generatePlan = async (campaign: Campaign, days?: number) => {
    const cycleDays = days ?? campaign.cycle_duration_days ?? 14
    setPlanning(campaign.id)
    setElapsed(0)
    setNotice(null)

    // Planning reads the SERP and crawls competitor pages: a minute or more of
    // silence otherwise, which reads as a freeze. The elapsed counter and the
    // phase label are client-side guesses at the server's timeline — the server
    // logs the real one — but they are enough to tell "working" from "stuck".
    const startedAt = Date.now()
    const ticker = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000)

    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle_duration_days: cycleDays }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.plan) {
        setNotice({ tone: 'critical', message: data.error || `Plan impossible (erreur ${res.status})` })
        return
      }

      const plan = data.plan as CyclePlan
      setPlans((prev) => ({ ...prev, [campaign.id]: plan }))
      setModal({
        campaign,
        plan,
        items: Array.isArray(plan.plan_data) ? plan.plan_data : [],
        provenance: readProvenance(data),
        mode: 'preview',
      })
    } catch {
      setNotice({ tone: 'critical', message: 'Erreur réseau pendant la planification' })
    } finally {
      clearInterval(ticker)
      setPlanning(null)
    }
  }

  const confirmPlan = async (state: ModalState) => {
    try {
      const res = await fetch(`/api/campaigns/${state.campaign.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', plan_id: state.plan.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice({ tone: 'critical', message: data.error || 'Confirmation impossible' })
        return
      }
      setModal(null)
      setNotice({
        tone: 'good',
        message: `Cycle lancé : ${state.items.length} pages sur ${state.plan.cycle_duration_days} jours.`,
      })
      await loadPlan(state.campaign.id).catch(() => null)
    } catch {
      setNotice({ tone: 'critical', message: 'Erreur réseau pendant la confirmation' })
    }
  }

  return (
    <div>
      <PageHeader
        icon={Target}
        badge="Étape 3"
        title="Stratégie de contenu"
        subtitle="Une campagne décrit quoi écrire et à quel rythme. Le plan de cycle est ce qu’on relit avant de lancer la production."
        meta={campaigns.length > 0 ? <span>{campaigns.length} campagne{campaigns.length > 1 ? 's' : ''}</span> : undefined}
        action={{ label: 'Nouvelle stratégie', href: '/strategy/new', icon: Plus }}
      />

      {notice && (
        <Notice
          tone={notice.tone}
          title={notice.tone === 'good' ? 'Cycle lancé' : 'Action impossible'}
          body={notice.message}
          onDismiss={() => setNotice(null)}
          action={notice.tone === 'good' ? { label: 'Voir le calendrier', href: '/calendar' } : undefined}
        />
      )}

      {loading && <LoadingPanel label="Chargement des campagnes…" />}

      {!loading && error && (
        <EmptyState
          variant="error"
          title="Campagnes indisponibles"
          description={error}
          action={{ label: 'Réessayer', onClick: () => load() }}
        />
      )}

      {!loading && !error && campaigns.length === 0 && (
        <EmptyState
          icon={Target}
          variant="no-data"
          title="Aucune stratégie"
          description="Une stratégie analyse le site et ses concurrents, puis produit un plan de briefs daté. C’est le point de départ de toute génération."
          action={{ label: 'Créer une stratégie', href: '/strategy/new', icon: Plus }}
        />
      )}

      {!loading && !error && campaigns.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.id}
              campaign={campaign}
              plan={plans[campaign.id]}
              planning={planning === campaign.id}
              opening={opening === campaign.id}
              elapsed={elapsed}
              onOpen={() => openPlan(campaign)}
              onGenerate={() => generatePlan(campaign)}
            />
          ))}
        </div>
      )}

      {modal && (
        <PlanModal
          state={modal}
          onClose={() => setModal(null)}
          onConfirm={() => confirmPlan(modal)}
          onRegenerate={(days) => {
            setModal(null)
            return generatePlan(modal.campaign, days)
          }}
        />
      )}
    </div>
  )
}

// ─── Campaign row ────────────────────────────────────────────────────────────

function CampaignRow({
  campaign, plan, planning, opening, elapsed, onOpen, onGenerate,
}: {
  campaign: Campaign
  plan: CyclePlan | null | undefined
  planning: boolean
  opening: boolean
  elapsed: number
  onOpen: () => void
  onGenerate: () => void
}) {
  const status = plan ? PLAN_STATUS_LABELS[plan.status] ?? { label: plan.status, badge: 'badge badge-muted' } : null
  const draft = plan?.status === 'draft'

  return (
    <section className="panel">
      <div className="panel__body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span className="card-title">{campaign.name}</span>
            <StatusBadge status={campaign.is_active ? 'active' : 'inactive'} />
            {status && <span className={status.badge}>{status.label}</span>}
          </div>
          <div className="meta" style={{ marginTop: 'var(--space-1)' }}>
            {campaign.site?.name ?? 'site inconnu'} · {campaign.business_type} · {campaign.communes.length} commune
            {campaign.communes.length > 1 ? 's' : ''} · {(campaign.page_types ?? ['child']).map((type) => PAGE_TYPE_LABELS[type] ?? type).join(', ')}
          </div>
          <div className="meta" style={{ marginTop: 'var(--space-1)' }}>
            {plan === undefined
              ? 'Lecture du plan en cours…'
              : plan === null
                ? 'Aucun plan enregistré — cette campagne n’a jamais été planifiée.'
                : `Cycle ${plan.cycle_number} · ${plan.total_pages} pages sur ${plan.cycle_duration_days} jours · ${formatMetric(plan.total_estimated_words, 'compact')} mots`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
          {plan && (
            <Button variant={draft ? 'primary' : 'secondary'} icon={Eye} loading={opening} onClick={onOpen}>
              {draft ? 'Ouvrir le plan à confirmer' : 'Voir le plan'}
            </Button>
          )}
          <Button
            variant={plan ? 'ghost' : 'primary'}
            icon={plan ? RefreshCw : CalendarDays}
            loading={planning}
            onClick={onGenerate}
            title={plan ? 'Construit un NOUVEAU plan : nouvelle lecture des SERP, nouveaux briefs.' : undefined}
          >
            {planning
              ? `${planPhase(elapsed)} — ${elapsed}s`
              : plan ? 'Régénérer un plan' : 'Planifier un cycle'}
          </Button>
        </div>
      </div>
    </section>
  )
}

// ─── Plan modal ──────────────────────────────────────────────────────────────

function PlanModal({
  state, onClose, onConfirm, onRegenerate,
}: {
  state: ModalState
  onClose: () => void
  onConfirm: () => Promise<void>
  onRegenerate: (days: number) => void
}) {
  const { campaign, plan, items, provenance } = state
  const [days, setDays] = useState(plan.cycle_duration_days || 14)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const words = useMemo(() => items.reduce((sum, item) => sum + (item.estimated_word_count || 0), 0), [items])

  // A brief is backed by Search Console when it links to a page the data showed
  // ranking 5-20. That is a join on two real values, not a guess at intent.
  const measuredByUrl = useMemo(() => {
    const map = new Map<string, MeasuredQuery>()
    for (const entry of provenance.gsc?.strikingDistance ?? []) map.set(entry.pageUrl, entry)
    return map
  }, [provenance])

  const confirmable = plan.status === 'draft' || state.mode === 'preview'
  const running = plan.status === 'executing' || plan.status === 'confirmed'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Plan du cycle ${plan.cycle_number} — ${campaign.name}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: MODAL_Z,
        background: 'var(--surface-scrim)', padding: 'var(--space-6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        className="panel"
        onClick={(event) => event.stopPropagation()}
        style={{ width: '100%', maxWidth: 1000, maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="panel__header">
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title">Plan du cycle {plan.cycle_number} — {campaign.name}</h2>
            <div className="meta">
              {items.length} page{items.length > 1 ? 's' : ''} sur {plan.cycle_duration_days} jours ·{' '}
              {formatMetric(words, 'compact')} mots estimés · plan créé le {formatDate(plan.created_at)}
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fermer">
            <X size={15} />
          </button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          <div style={{ padding: 'var(--space-5) var(--space-5) 0' }}>
            <ProvenancePanel provenance={provenance} items={items} />
          </div>

          <div className="scroll-x" style={{ padding: 'var(--space-5)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Requête cible</th>
                  <th>Intention</th>
                  <th>Titre proposé</th>
                  <th style={{ textAlign: 'right' }}>Longueur</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const measured = (item.internal_link_targets ?? [])
                    .map((target) => measuredByUrl.get(target))
                    .find(Boolean)

                  return (
                    <tr key={item.id || index}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDay(item.scheduled_date)}</td>
                      <td><span className="chip">{PAGE_TYPE_LABELS[item.page_type] ?? item.page_type}</span></td>
                      <td>
                        <div className="cell-strong">{item.target_keyword}</div>
                        <div className="meta">
                          {item.target_city}
                          {measured && (
                            <span
                              className="badge badge-success"
                              style={{ marginLeft: 'var(--space-2)' }}
                              title={`Search Console : "${measured.query}" en position ${measured.position.toFixed(1)}, ${measured.impressions} impressions sur ${measured.pageUrl}`}
                            >
                              mesuré
                            </span>
                          )}
                        </div>
                      </td>
                      <td>{item.search_intent || '—'}</td>
                      <td style={{ maxWidth: 280 }}>
                        <div className="truncate" title={item.proposed_title}>{item.proposed_title}</div>
                        <div className="meta truncate" title={item.proposed_slug}>/{item.proposed_slug}</div>
                      </td>
                      <td className="cell-num">~{formatMetric(item.estimated_word_count, 'number')} mots</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel__footer" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 260 }}>
            {running
              ? 'Ce cycle tourne déjà : génération, publication et re-crawl sont automatiques jusqu’à sa date de fin.'
              : 'Confirmer remplace les créneaux encore planifiés de cette campagne. Les pages déjà générées ou publiées ne bougent pas.'}
          </span>

          {confirmable && (
            <>
              <label className="meta" htmlFor="cycle-days">Durée</label>
              <select
                id="cycle-days"
                className="input"
                style={{ width: 110 }}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              >
                {CYCLE_DURATIONS.map((value) => <option key={value} value={value}>{value} jours</option>)}
              </select>
              <Button variant="ghost" icon={RefreshCw} onClick={() => onRegenerate(days)}>
                Régénérer
              </Button>
              <Button
                icon={CheckCircle2}
                loading={confirming}
                onClick={async () => {
                  setConfirming(true)
                  try { await onConfirm() } finally { setConfirming(false) }
                }}
              >
                Confirmer et lancer le cycle
              </Button>
            </>
          )}

          {running && (
            <Link href="/calendar" className="btn-primary">
              <CalendarDays size={15} /> Voir le calendrier
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Provenance panel ────────────────────────────────────────────────────────

const GRADE_META: Record<ProvenanceGrade, { title: string; color: string; badge: string; icon: LucideIcon }> = {
  measured: { title: 'Plan mesuré', color: 'var(--status-good)', badge: 'badge badge-success', icon: CheckCircle2 },
  partial: { title: 'Plan partiellement mesuré', color: 'var(--status-warning)', badge: 'badge badge-warning', icon: TriangleAlert },
  blind: { title: 'Plan construit à l’aveugle', color: 'var(--status-critical)', badge: 'badge badge-danger', icon: TriangleAlert },
  unknown: { title: 'Origine des mesures inconnue', color: 'var(--ink-faint)', badge: 'badge badge-muted', icon: Info },
}

function ProvenancePanel({ provenance, items }: { provenance: PlanProvenance; items: PlanPreviewItem[] }) {
  const grade = gradeOf(provenance)
  const meta = GRADE_META[grade]
  const Icon = meta.icon
  const usableSerp = provenance.serp.filter((proof) => proof.competitors > 0)
  const cited = items.filter(citesMeasurement).length

  return (
    <div className="inset" style={{ borderLeft: `3px solid ${meta.color}`, display: 'grid', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Icon size={16} color={meta.color} />
        <strong style={{ fontSize: 'var(--fs-sm)' }}>{meta.title}</strong>
        <span className={meta.badge}>{grade === 'unknown' ? 'non enregistrée' : grade === 'blind' ? 'aucune mesure' : 'sources ci-dessous'}</span>
      </div>

      {grade === 'unknown' && (
        <>
          <p className="meta" style={{ margin: 0 }}>
            Ce plan a été relu depuis la base. Elle conserve les briefs, pas les preuves qui ont servi à les écrire :
            impossible de dire ici s’il a été construit sur des SERP réellement lues ou à l’aveugle. Régénérer un plan
            affiche ses sources.
          </p>
          <p className="meta" style={{ margin: 0 }}>
            {cited > 0
              ? `Seule trace conservée : ${cited} brief${cited > 1 ? 's' : ''} sur ${items.length} cite${cited > 1 ? 'nt' : ''} une mesure Search Console (position, impressions ou cannibalisation).`
              : `Aucun des ${items.length} briefs ne cite de mesure Search Console : rien dans ce plan ne prouve qu’il ait été construit sur des données.`}
          </p>
        </>
      )}

      {grade === 'blind' && (
        <p className="meta" style={{ margin: 0 }}>
          Aucune SERP n’a pu être lue et le site n’a aucun historique Search Console exploitable. Les longueurs, les
          intentions et les trames de ce plan sont des propositions du modèle, <strong>pas des mesures</strong> — à
          traiter comme des hypothèses.
        </p>
      )}

      {provenance.reported && (
        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <SourceBlock
            icon={Search}
            title="SERP lues"
            measured={usableSerp.length > 0}
            empty="Aucune SERP exploitable : les longueurs cibles ne sont calées sur rien d’observé."
          >
            {usableSerp.map((proof) => (
              <li key={proof.query} style={{ marginBottom: 'var(--space-1)' }}>
                <span style={{ color: 'var(--ink-primary)' }}>« {proof.query} »</span> —{' '}
                {proof.competitors} concurrent{proof.competitors > 1 ? 's' : ''} mesuré{proof.competitors > 1 ? 's' : ''}
                {proof.medianWordCount ? `, médiane ${formatMetric(proof.medianWordCount, 'number')} mots` : ''}
                {proof.commonSections ? `, ${proof.commonSections} sections communes` : ''}
                {proof.peopleAlsoAsk ? `, ${proof.peopleAlsoAsk} questions PAA` : ''}
                {proof.fetchedAt ? ` (lue le ${formatDay(proof.fetchedAt.slice(0, 10))})` : ''}
              </li>
            ))}
          </SourceBlock>

          <SourceBlock
            icon={CalendarDays}
            title="Search Console"
            measured={provenance.gsc !== null}
            empty="Aucun historique exploitable : le plan ne tient compte d’aucun résultat déjà obtenu."
          >
            {provenance.gsc && (
              <>
                <li>
                  Fenêtre {provenance.gsc.windowStart ? formatDay(provenance.gsc.windowStart) : '?'} →{' '}
                  {provenance.gsc.windowEnd ? formatDay(provenance.gsc.windowEnd) : '?'}
                </li>
                <li>{provenance.gsc.strikingDistance.length} requêtes en position 5-20 exploitables</li>
                <li>{provenance.gsc.lowCtrPages} pages vues sans clic · {provenance.gsc.deadPages} sujets sans demande</li>
                <li>{provenance.gsc.cannibalized} requêtes cannibalisées, interdites de nouvelle page</li>
              </>
            )}
          </SourceBlock>
        </div>
      )}
    </div>
  )
}

function SourceBlock({
  icon: Icon, title, measured, empty, children,
}: {
  icon: LucideIcon
  title: string
  measured: boolean
  empty: string
  children: ReactNode
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
        <Icon size={13} color="var(--ink-muted)" />
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600 }}>{title}</span>
        <span className={measured ? 'badge badge-success' : 'badge badge-warning'}>
          {measured ? 'mesuré' : 'non mesuré'}
        </span>
      </div>
      {measured
        ? <ul className="meta" style={{ margin: 0, paddingLeft: '1.1rem' }}>{children}</ul>
        : <p className="meta" style={{ margin: 0 }}>{empty}</p>}
    </div>
  )
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="glass-card" style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-12)' }}>
      <Loader2 size={22} className="animate-spin" color="var(--ink-faint)" />
      <span className="meta">{label}</span>
    </div>
  )
}

function Notice({
  tone, title, body, action, onDismiss,
}: {
  tone: 'good' | 'critical'
  title: string
  body: string
  action?: { label: string; href: string }
  onDismiss?: () => void
}) {
  const color = tone === 'good' ? 'var(--status-good)' : 'var(--status-critical)'
  const Icon = tone === 'good' ? CheckCircle2 : TriangleAlert

  return (
    <div
      className="glass-card"
      style={{
        borderLeft: `3px solid ${color}`, marginBottom: 'var(--space-5)',
        display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start',
      }}
    >
      <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 'var(--fs-sm)' }}>{title}</strong>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', margin: '0.25rem 0 0', lineHeight: 1.55 }}>{body}</p>
      </div>
      {action && <Link href={action.href} className="btn-secondary btn-sm">{action.label}</Link>}
      {onDismiss && (
        <button type="button" className="btn-icon" onClick={onDismiss} aria-label="Fermer">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

function formatDay(date: string): string {
  const [year, month, day] = date.split('-')
  return day && month && year ? `${day}/${month}/${year}` : date
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
