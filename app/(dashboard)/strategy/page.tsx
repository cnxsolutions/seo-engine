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
  CalendarDays, CheckCircle2, Eye, Info, Loader2, Plus, RefreshCw, Search, Target, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Button, EmptyState, Notice, PageHeader, StatusBadge, formatDay, formatMetric, shortenUrl } from '@/components/ui'
import { Modal } from '@/components/charts'
import {
  PAGE_TYPE_LABELS,
  type Campaign,
  type CyclePlan,
  type PlanItemAction,
  type PlanPreviewItem,
  type SlugResolutionDto,
} from '@/lib/types'
// `import type`, effacé à la compilation : rien de lib/google/ n'atteint ce
// bundle client. La forme est celle que `detectCannibalization` produit déjà et
// que `getGscPlanningSignals` transporte — on l'affiche, on ne la recopie pas
// sous un second nom qui divergerait.
import type { CannibalizedQuery } from '@/lib/google/performance'

const CYCLE_DURATIONS = [7, 14, 21, 30]

/** The shared dictionary, with the passthrough a stored plan needs: `page_type`
 *  comes back from the database as text and may name a type the union dropped. */
function pageTypeLabel(pageType: string): string {
  return PAGE_TYPE_LABELS[pageType as keyof typeof PAGE_TYPE_LABELS] ?? pageType
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
  /**
   * LES COUPLES, pas leur nombre.
   *
   * « 3 requêtes cannibalisées » ne permet aucune décision : ni laquelle, ni
   * quelle page tient la place, ni lesquelles la lui disputent. Et le compteur
   * valait 0 dans deux situations opposées — « rien de disputé » et « Search
   * Console n'est pas connectée » — ce qui est exactement la façon dont un
   * tableau de bord finit par rassurer sur ce qu'il n'a pas mesuré.
   */
  cannibalized: CannibalizedQuery[]
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

/**
 * La cannibalisation, relue défensivement comme le reste de ce panneau.
 *
 * Une forme absente retombe sur une liste vide, jamais sur une erreur de rendu :
 * ce bloc décrit ce que le plan a mesuré, et il ne doit pas pouvoir casser
 * l'écran qui montre le plan lui-même.
 */
function parseCannibalized(raw: unknown): CannibalizedQuery[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .map((entry) => ({
      query: str(entry.query) ?? '',
      impressions: num(entry.impressions) ?? 0,
      clicks: num(entry.clicks) ?? 0,
      pages: (Array.isArray(entry.pages) ? entry.pages : [])
        .filter(isRecord)
        .map((page) => ({
          pageUrl: str(page.pageUrl) ?? '',
          impressions: num(page.impressions) ?? 0,
          clicks: num(page.clicks) ?? 0,
          position: num(page.position) ?? 0,
        }))
        .filter((page) => page.pageUrl),
      winner: str(entry.winner) ?? '',
      losers: (Array.isArray(entry.losers) ? entry.losers : [])
        .map(str)
        .filter((value): value is string => value !== null),
    }))
    // Un conflit dont on ne sait nommer ni la requête ni la page gagnante n'est
    // pas affichable : le taire vaut mieux qu'une ligne à trous.
    .filter((entry) => entry.query !== '' && entry.winner !== '')
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
    cannibalized: parseCannibalized(raw.cannibalized),
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
            {campaign.communes.length > 1 ? 's' : ''} · {(campaign.page_types ?? ['child']).map(pageTypeLabel).join(', ')}
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

  const words = useMemo(() => items.reduce((sum, item) => sum + (item.estimated_word_count || 0), 0), [items])

  // CE QUE CE PLAN FAIT À L'EXISTANT, vu AVANT le premier jeton. Un plan relu
  // depuis la base ne porte pas `action` : ses briefs tombent tous dans
  // « Nouvelles pages » et aucun verdict n'est inventé pour eux.
  const groups = useMemo(() => groupByAction(items), [items])
  const hasVerdicts = useMemo(() => items.some((item) => item.action !== undefined), [items])

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
    <Modal
      title={`Plan du cycle ${plan.cycle_number} — ${campaign.name}`}
      subtitle={
        <>
          {hasVerdicts ? (
            <>
              <span className="num">{groups.create.length}</span> nouvelle
              {groups.create.length > 1 ? 's' : ''} page{groups.create.length > 1 ? 's' : ''} ·{' '}
              <span className="num">{groups.refresh.length}</span> mise
              {groups.refresh.length > 1 ? 's' : ''} à jour ·{' '}
              <span className="num">{groups.skip.length}</span> écartée{groups.skip.length > 1 ? 's' : ''} sur{' '}
              {items.length} sujet{items.length > 1 ? 's' : ''} ·{' '}
            </>
          ) : (
            <>
              {items.length} page{items.length > 1 ? 's' : ''} sur {plan.cycle_duration_days} jours ·{' '}
            </>
          )}
          {formatMetric(words, 'compact')} mots estimés · plan créé le {formatDate(plan.created_at)}
        </>
      }
      onClose={onClose}
      size="lg"
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 260 }}>
            {running
              ? 'Ce cycle tourne déjà : génération, publication et re-crawl sont automatiques jusqu’à sa date de fin.'
              : 'Confirmer remplace les créneaux encore planifiés de cette campagne. Les pages déjà générées ou publiées ne bougent pas.'}
            {/* La ligne qui manquait avant le bouton : confirmer un plan qui
                contient des mises à jour ne déclenche AUCUN remplacement. */}
            {groups.refresh.length > 0 && (
              <>
                {' '}
                {groups.refresh.length} de ces lignes mettront à jour une page existante — elles ne partiront
                jamais sans votre validation à l’étape 5.
              </>
            )}
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
      }
    >
      {/* The body pads its own regions rather than sitting in a `.panel__body`:
          the plan table is a `.scroll-x` that must reach the panel edges. */}
      <div style={{ padding: 'var(--space-5) var(--space-5) 0' }}>
        <ProvenancePanel provenance={provenance} items={items} />
      </div>

      {/* TROIS GROUPES, ORDRE FIXE. Un tableau unique cachait la seule chose que
          l'opérateur doit voir avant de dépenser : combien de ces lignes vont
          toucher à une page qui existe déjà, et lesquelles ne partiront pas. */}
      <PlanSection
        title="Nouvelles pages"
        count={groups.create.length}
        lede="Aucune page existante ne couvre ces sujets. L’adresse de chacune a été vérifiée au moment du plan."
        show
      >
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
            {groups.create.map((item, index) => {
              const measured = (item.internal_link_targets ?? [])
                .map((target) => measuredByUrl.get(target))
                .find(Boolean)

              return (
                <tr key={item.id || index}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDay(item.scheduled_date)}</td>
                  <td><span className="chip">{pageTypeLabel(item.page_type)}</span></td>
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
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 2 }}
                    >
                      <span className="meta truncate mono" title={item.proposed_slug}>/{item.proposed_slug}</span>
                      <SlugState action={item.action} />
                    </div>
                  </td>
                  <td className="cell-num">~{formatMetric(item.estimated_word_count, 'number')} mots</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </PlanSection>

      <PlanSection
        title="Pages à rafraîchir"
        count={groups.refresh.length}
        lede="Une page couvre déjà ce sujet. Le moteur propose de la mettre à jour plutôt que d’en ajouter une. Rien ne sera remplacé sans votre accord au moment de la publication."
        show={hasVerdicts}
        emptyText={
          provenance.gsc === null
            ? 'Aucune mise à jour proposée. Search Console n’est pas connectée : le moteur ne voit pas quelles pages sont déjà positionnées, il ne peut juger que sur les titres et les adresses.'
            : 'Aucune mise à jour proposée : aucun sujet de ce cycle ne recoupe une page déjà en ligne.'
        }
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Page visée</th>
              <th>Portée</th>
              <th>Pourquoi</th>
              <th>Titre proposé</th>
            </tr>
          </thead>
          <tbody>
            {groups.refresh.map(({ item, action }, index) => (
              <tr key={item.id || index}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDay(item.scheduled_date)}</td>
                <td>
                  <span className="chip mono">{action.targetPath}</span>
                </td>
                <td><span className="badge badge-info">{REFRESH_SCOPE_LABELS[action.scope]}</span></td>
                {/* Les phrases du domaine, RECOPIÉES TELLES QUELLES : elles
                    portent déjà les chiffres qui ont décidé, et les reformuler
                    couperait le seul lien entre la décision et sa mesure. */}
                <td style={{ maxWidth: 340 }}>
                  {action.evidence.length > 0 ? (
                    <ul className="meta" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {action.evidence.map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                  ) : (
                    <span className="meta">Aucun motif enregistré.</span>
                  )}
                </td>
                <td style={{ maxWidth: 260 }}>
                  <div className="truncate" title={item.proposed_title}>{item.proposed_title}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PlanSection>

      <PlanSection
        title="Écartées"
        count={groups.skip.length}
        lede="Ces sujets n’ont pas été retenus, et voici pourquoi. Une ligne écartée sans motif serait une décision invisible."
        show={hasVerdicts}
        emptyText="Aucun sujet écarté : les créneaux de ce cycle produiront tous quelque chose."
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Requête</th>
              <th>Motifs</th>
            </tr>
          </thead>
          <tbody>
            {groups.skip.map(({ item, action }, index) => (
              <tr key={item.id || index}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDay(item.scheduled_date)}</td>
                <td>
                  <div className="cell-strong">{item.target_keyword}</div>
                  <div className="meta">{item.target_city}</div>
                </td>
                <td style={{ maxWidth: 420 }}>
                  {action.reasons.length > 0 ? (
                    <ul className="meta" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {action.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                    </ul>
                  ) : (
                    <span className="meta">Aucun motif enregistré.</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PlanSection>
    </Modal>
  )
}

// ─── Les trois groupes d'un plan ─────────────────────────────────────────────

const REFRESH_SCOPE_LABELS: Record<'metadata' | 'content', string> = {
  metadata: 'Titre et description',
  content: 'Contenu complet',
}

type RefreshAction = Extract<PlanItemAction, { kind: 'refresh' }>
type SkipAction = Extract<PlanItemAction, { kind: 'skip' }>

interface PlanGroups {
  create: PlanPreviewItem[]
  refresh: Array<{ item: PlanPreviewItem; action: RefreshAction }>
  skip: Array<{ item: PlanPreviewItem; action: SkipAction }>
}

/**
 * `item.action?.kind ?? 'create'` — et rien d'autre.
 *
 * Un plan écrit avant ce lot ne porte aucun verdict : ses briefs tombent
 * intégralement dans « Nouvelles pages », ce qui est ce qu'ils étaient. Leur
 * inventer un verdict rétroactif ferait afficher une décision que personne n'a
 * prise.
 */
function groupByAction(items: PlanPreviewItem[]): PlanGroups {
  const groups: PlanGroups = { create: [], refresh: [], skip: [] }

  for (const item of items) {
    const action = item.action
    if (action?.kind === 'refresh') groups.refresh.push({ item, action })
    else if (action?.kind === 'skip') groups.skip.push({ item, action })
    else groups.create.push(item)
  }

  return groups
}

/**
 * Un groupe du plan, ou la phrase qui explique qu'il est vide.
 *
 * `show` distingue « ce plan n'a rien à mettre à jour » de « ce plan ne sait
 * rien de ce qu'il fait à l'existant » : sur un plan relu depuis la base, les
 * deux sections de verdict ne s'affichent pas du tout, parce qu'un « 0 mise à
 * jour » y serait une mesure jamais faite.
 */
function PlanSection({
  title, count, lede, show, emptyText, children,
}: {
  title: string
  count: number
  lede: string
  show: boolean
  emptyText?: string
  children: ReactNode
}) {
  if (!show) return null

  return (
    <section style={{ padding: 'var(--space-5) var(--space-5) 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h3 className="card-title">{title}</h3>
        <span className="badge badge-muted">{count}</span>
      </div>
      <p className="meta" style={{ margin: 'var(--space-1) 0 var(--space-3)' }}>{lede}</p>
      {count === 0
        ? <p className="meta" style={{ margin: 0 }}>{emptyText}</p>
        : <div className="scroll-x">{children}</div>}
    </section>
  )
}

/**
 * Ce que la résolution d'adresse a RÉELLEMENT pu prouver.
 *
 * Trois états et pas deux : le badge vert n'apparaît que sur une vérification
 * qui a eu lieu. En régime aveugle, `takenPaths` ne contient que les adresses
 * posées par ce plan-ci, et écrire « adresse vérifiée libre » ferait passer une
 * ignorance pour une garantie. Un plan sans verdict n'affiche RIEN.
 */
function SlugState({ action }: { action: PlanItemAction | undefined }) {
  if (action?.kind !== 'create') return null

  const slug: SlugResolutionDto = action.slug

  if (slug.status === 'free') {
    return <span className="badge badge-success">adresse vérifiée libre</span>
  }

  if (slug.status === 'disambiguated') {
    return (
      <span
        className="badge badge-info"
        title={`L’adresse proposée était déjà prise (/${slug.from}). Le moteur a ajouté « ${slug.token} » pour la distinguer.`}
      >
        adresse ajustée
      </span>
    )
  }

  return <span className="badge badge-muted" title={slug.reason}>adresse non vérifiée</span>
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
              </>
            )}
          </SourceBlock>
        </div>
      )}

      {provenance.reported && <CannibalizationBlock gsc={provenance.gsc} />}
    </div>
  )
}

/**
 * Les requêtes que deux pages du site se disputent — TROIS ÉTATS, TROIS PHRASES.
 *
 * Le compteur qui vivait ici valait 0 dans deux situations opposées : « aucun
 * conflit » et « Search Console n'est pas connectée, donc on n'en sait rien ».
 * Un zéro qui rassure sur ce qui n'a pas été mesuré est pire que pas de chiffre
 * du tout.
 *
 * AUCUN BOUTON sur les pages perdantes, et ce n'est pas un oubli : le moteur ne
 * supprime, ne fusionne et ne redirige aucune page. Un bouton « Fusionner » ici
 * promettrait une opération qui n'existe nulle part dans ce dépôt.
 */
function CannibalizationBlock({ gsc }: { gsc: GscProof | null }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
        Requêtes que deux pages du site se disputent
      </div>

      {gsc === null ? (
        <p className="meta" style={{ margin: 0 }}>
          Search Console n’est pas connectée&nbsp;: impossible de dire si deux pages du site se disputent une
          requête.
        </p>
      ) : gsc.cannibalized.length === 0 ? (
        <p className="meta" style={{ margin: 0 }}>Aucune requête disputée sur les 28 derniers jours.</p>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {gsc.cannibalized.map((conflict) => (
              <li key={conflict.query}>
                <ConflictLine conflict={conflict} />
              </li>
            ))}
          </ul>
          <p className="meta" style={{ margin: 'var(--space-2) 0 0' }}>
            Le moteur ne supprime, ne fusionne et ne redirige aucune page. Ces conflits sont signalés pour que
            vous décidiez.
          </p>
        </>
      )}
    </div>
  )
}

/** Un couple requête/pages : qui tient la place, et qui la lui dispute. */
function ConflictLine({ conflict }: { conflict: CannibalizedQuery }) {
  const winner = conflict.pages.find((page) => page.pageUrl === conflict.winner)
  const rivals = conflict.losers.length

  return (
    <div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
        <span style={{ color: 'var(--ink-primary)' }}>«&nbsp;{conflict.query}&nbsp;»</span> —{' '}
        <a href={conflict.winner} target="_blank" rel="noopener noreferrer" className="btn-link" title={conflict.winner}>
          {shortenUrl(conflict.winner)}
        </a>{' '}
        tient la place
        {winner ? ` (position ${formatMetric(winner.position, 'position')}, ${winner.clicks} clic${winner.clicks > 1 ? 's' : ''})` : ''}.{' '}
        {rivals === 0
          ? 'Aucune autre page du site ne vise cette requête.'
          : `${rivals} autre${rivals > 1 ? 's' : ''} page${rivals > 1 ? 's' : ''} du site vise${rivals > 1 ? 'nt' : ''} la même requête.`}
      </div>
      {conflict.losers.length > 0 && (
        <ul className="meta" style={{ margin: 'var(--space-1) 0 0', paddingLeft: '1.1rem' }}>
          {conflict.losers.map((url) => (
            <li key={url} className="truncate" title={url}>{shortenUrl(url)}</li>
          ))}
        </ul>
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

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
