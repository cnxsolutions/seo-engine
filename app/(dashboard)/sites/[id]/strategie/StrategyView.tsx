'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Stratégie d'UN site — ses campagnes, et le plan de cycle qu'on décide de lancer
//
// Ce composant était la page /strategy : une liste de TOUTES les campagnes, et
// le plan s'ouvrait dans une modale. Il vit maintenant dans l'onglet
// « Stratégie » de /sites/[id] et ne montre que les campagnes de ce site, avec
// leur plan de cycle rendu À PLAT dans l'onglet : le plan est ce qu'on vient
// relire ici, le cacher derrière un bouton « Voir le plan » faisait un clic de
// trop sur la seule chose que l'onglet sert à montrer.
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
// 2. The plan was presented the same way whether it had been built on SERP
//    that were actually read and Search Console history, or on nothing at all.
//    A guessed brief that looks measured is worse than no brief. The plan
//    header states its provenance (./provenance.ts), and says "inconnue" when
//    it cannot know rather than implying either answer.
//
// PLUS DE MISES À JOUR. Le moteur ne planifie plus la mise à jour de pages
// existantes. Un ANCIEN plan relu depuis la base peut encore en porter : elles
// restent affichées, marquées « ne sera pas produite » (components/PlanBriefList),
// et aucun texte de cet onglet ne présente plus la mise à jour comme une option.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CalendarDays, CheckCircle2, Info, Loader2, Pencil, Plus, RefreshCw, Search, Target, Trash2, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Button, EmptyState, Notice, StatusBadge, formatDay, formatMetric, shortenUrl } from '@/components/ui'
import { PlanBriefList, type AddressVerdict } from '@/components/PlanBriefList'
import { DeleteCampaignDialog } from '@/app/(dashboard)/strategy/DeleteCampaignDialog'
import {
  PAGE_TYPE_LABELS,
  type Campaign,
  type CyclePlan,
  type PlanItemAction,
  type PlanPreviewItem,
  type SlugResolutionDto,
} from '@/lib/types'
import type { CannibalizedQuery } from '@/lib/google/performance'
import { publicationModeOf, rhythmLabel } from '../campaign-summary'
import { isNationalCampaign, plannablePageTypes, targetCommunes } from '@/lib/geo/scope'
import {
  UNKNOWN_PROVENANCE,
  countMeasuredBriefs,
  gradeOf,
  readProvenance,
  type GscProof,
  type MeasuredQuery,
  type PlanProvenance,
  type ProvenanceGrade,
} from './provenance'

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

// ─── Vue ─────────────────────────────────────────────────────────────────────

/** Ce que l'onglet sait d'un plan au-delà de la ligne en base. */
interface PlanContext {
  provenance: PlanProvenance
  /** `true` = just generated, not yet confirmed as active work. */
  preview: boolean
}

export function StrategyView({ siteId, defaultScheduleTime }: { siteId: string; defaultScheduleTime: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [plans, setPlans] = useState<Record<string, CyclePlan | null>>({})
  const [contexts, setContexts] = useState<Record<string, PlanContext>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // `calendar` est optionnel : la bannière « Cycle lancé » garde son lien vers
  // le calendrier, et une suppression réussie n'en a pas besoin — il n'y a plus
  // rien à y voir pour cette campagne.
  const [notice, setNotice] = useState<{ tone: 'good' | 'critical'; message: string; title?: string; calendar?: boolean } | null>(null)

  const [planning, setPlanning] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  /** La campagne dont la suppression attend confirmation. */
  const [deleting, setDeleting] = useState<Campaign | null>(null)

  const calendarHref = `/sites/${siteId}/calendrier`

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

      // La route rend toutes les campagnes ; l'onglet ne garde que celles du
      // site. Filtrer ici plutôt qu'ajouter un paramètre à la route : la liste
      // est courte, et le même appel sert déjà le formulaire de création.
      const all: Campaign[] = Array.isArray(data.campaigns) ? data.campaigns : []
      const list = all.filter((campaign) => campaign.site_id === siteId)
      setCampaigns(list)
      setLoading(false)

      // Plans are read after the list is on screen: one slow read must not
      // hold the whole view back.
      await Promise.all(list.map((campaign) => loadPlan(campaign.id).catch(() => null)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      setLoading(false)
    }
  }, [loadPlan, siteId])

  useEffect(() => {
    load()
  }, [load])

  // ── Actions ──
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
      setContexts((prev) => ({ ...prev, [campaign.id]: { provenance: readProvenance(data), preview: true } }))
    } catch {
      setNotice({ tone: 'critical', message: 'Erreur réseau pendant la planification' })
    } finally {
      clearInterval(ticker)
      setPlanning(null)
    }
  }

  const confirmPlan = async (campaign: Campaign, plan: CyclePlan) => {
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', plan_id: plan.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice({ tone: 'critical', message: data.error || 'Confirmation impossible' })
        return
      }
      const items = Array.isArray(plan.plan_data) ? plan.plan_data : []
      setNotice({
        tone: 'good',
        title: 'Cycle lancé',
        calendar: true,
        message: `Cycle lancé : ${items.length} pages sur ${plan.cycle_duration_days} jours.`,
      })
      // La provenance mesurée reste affichée : confirmer ne change pas ce sur
      // quoi le plan a été construit, seulement son statut.
      setContexts((prev) => (prev[campaign.id] ? { ...prev, [campaign.id]: { ...prev[campaign.id], preview: false } } : prev))
      await loadPlan(campaign.id).catch(() => null)
    } catch {
      setNotice({ tone: 'critical', message: 'Erreur réseau pendant la confirmation' })
    }
  }

  return (
    <div>
      {notice && (
        <Notice
          tone={notice.tone}
          title={notice.title ?? (notice.tone === 'good' ? 'Terminé' : 'Action impossible')}
          body={notice.message}
          onDismiss={() => setNotice(null)}
          action={notice.calendar ? { label: 'Voir le calendrier', href: calendarHref } : undefined}
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
          title="Aucune stratégie pour ce site"
          description="Une stratégie analyse le site et ses concurrents, puis produit un plan de briefs daté. C’est le point de départ de toute génération."
          action={{ label: 'Créer une stratégie', href: `/strategy/new?site=${siteId}`, icon: Plus }}
        />
      )}

      {!loading && !error && campaigns.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          {campaigns.map((campaign) => (
            <CampaignPanel
              key={campaign.id}
              campaign={campaign}
              plan={plans[campaign.id]}
              context={contexts[campaign.id] ?? { provenance: UNKNOWN_PROVENANCE, preview: false }}
              defaultScheduleTime={defaultScheduleTime}
              calendarHref={calendarHref}
              planning={planning === campaign.id}
              busy={planning !== null}
              elapsed={elapsed}
              onGenerate={(days) => generatePlan(campaign, days)}
              onConfirm={(plan) => confirmPlan(campaign, plan)}
              onDelete={() => setDeleting(campaign)}
            />
          ))}
        </div>
      )}

      {deleting && (
        <DeleteCampaignDialog
          campaign={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            const name = deleting.name
            setDeleting(null)
            setNotice({ tone: 'good', title: 'Campagne supprimée', message: `« ${name} » a été supprimée. Les pages déjà générées sont conservées.` })
            // Relecture complète plutôt qu'un filtre local : c'est la base qui
            // dit ce qui reste, et la liste doit le refléter telle quelle.
            await load()
          }}
        />
      )}
    </div>
  )
}

// ─── Une campagne ────────────────────────────────────────────────────────────

function CampaignPanel({
  campaign, plan, context, defaultScheduleTime, calendarHref, planning, busy, elapsed, onGenerate, onConfirm, onDelete,
}: {
  campaign: Campaign
  plan: CyclePlan | null | undefined
  context: PlanContext
  defaultScheduleTime: string
  calendarHref: string
  planning: boolean
  /** Une planification tourne, sur cette campagne ou une autre. */
  busy: boolean
  elapsed: number
  onGenerate: (days?: number) => void
  onConfirm: (plan: CyclePlan) => Promise<void>
  onDelete: () => void
}) {
  const headingId = `campaign-${campaign.id}`

  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel__header" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', minWidth: 0 }}>
          <h3 id={headingId} className="card-title">{campaign.name}</h3>
          <StatusBadge status={campaign.is_active ? 'active' : 'inactive'} />
        </div>

        {/* Les actions de cycle de vie. Le nom de la campagne est répété dans
            l'étiquette accessible : une liste de « Supprimer » identiques ne dit
            pas lequel est lequel. « Supprimer » reste un bouton gris ici — le
            rouge est réservé au bouton qui confirme, dans le dialogue. */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button
            variant="ghost"
            icon={Pencil}
            href={`/strategy/${campaign.id}/edit`}
            title={`Modifier « ${campaign.name} »`}
            ariaLabel={`Modifier la campagne ${campaign.name}`}
          >
            Modifier la campagne
          </Button>
          <Button
            variant="ghost"
            icon={Trash2}
            onClick={onDelete}
            disabled={planning}
            title={`Supprimer « ${campaign.name} »`}
            ariaLabel={`Supprimer la campagne ${campaign.name}`}
          >
            Supprimer
          </Button>
        </div>
      </div>

      <div className="panel__body">
        <dl className="hub-facts">
          <div><dt>Activité</dt><dd>{campaign.business_type || '—'}</dd></div>
          <div><dt>Mots-clés</dt><dd>{campaign.keywords?.length ? campaign.keywords.join(', ') : '—'}</dd></div>
          {/* What the planner will actually use (lib/geo/scope.ts): « tous » is no
              town, and a national campaign plans no local pack. */}
          <div><dt>Zone</dt><dd>{isNationalCampaign(campaign) ? 'Nationale — toute la France' : targetCommunes(campaign.communes).join(', ')}</dd></div>
          <div><dt>Types de pages</dt><dd>{plannablePageTypes(campaign).map(pageTypeLabel).join(', ')}</dd></div>
          <div>
            <dt>Rythme</dt>
            <dd>
              {rhythmLabel(campaign, defaultScheduleTime)}
              {' · '}
              <span className="chip">{campaign.ai_model}</span>
            </dd>
          </div>
          <div>
            <dt>Publication</dt>
            <dd>{campaign.site ? publicationModeOf(campaign.site, campaign) : campaign.auto_publish ? 'automatique' : 'manuelle, après relecture'}</dd>
          </div>
        </dl>
      </div>

      <PlanSection
        campaign={campaign}
        plan={plan}
        context={context}
        calendarHref={calendarHref}
        planning={planning}
        busy={busy}
        elapsed={elapsed}
        onGenerate={onGenerate}
        onConfirm={onConfirm}
      />
    </section>
  )
}

// ─── Le plan du cycle, à plat ────────────────────────────────────────────────

function PlanSection({
  campaign, plan, context, calendarHref, planning, busy, elapsed, onGenerate, onConfirm,
}: {
  campaign: Campaign
  plan: CyclePlan | null | undefined
  context: PlanContext
  calendarHref: string
  planning: boolean
  busy: boolean
  elapsed: number
  onGenerate: (days?: number) => void
  onConfirm: (plan: CyclePlan) => Promise<void>
}) {
  const planningLabel = `${planPhase(elapsed)} — ${elapsed}s`

  if (plan === undefined) {
    return (
      <div className="strategy-plan">
        <p className="meta" style={{ margin: 0 }}>Lecture du plan en cours…</p>
      </div>
    )
  }

  if (plan === null) {
    return (
      <div className="strategy-plan">
        <div className="strategy-plan__head">
          <div style={{ minWidth: 0 }}>
            <h4 className="strategy-plan__title">Plan du cycle</h4>
            <p className="meta" style={{ margin: 0 }}>
              Aucun plan enregistré — cette campagne n’a jamais été planifiée. Rien ne sera produit avant.
            </p>
          </div>
          <Button icon={CalendarDays} loading={planning} disabled={busy && !planning} onClick={() => onGenerate()}>
            {planning ? planningLabel : 'Planifier un cycle'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <PlanBody
      key={plan.id}
      campaign={campaign}
      plan={plan}
      context={context}
      calendarHref={calendarHref}
      planning={planning}
      busy={busy}
      planningLabel={planningLabel}
      onGenerate={onGenerate}
      onConfirm={onConfirm}
    />
  )
}

/**
 * Le corps d'un plan. Monté sous la clé du plan : un plan régénéré repart de
 * son premier brief et de sa propre durée, au lieu d'hériter de la sélection
 * du plan qu'il remplace.
 */
function PlanBody({
  campaign, plan, context, calendarHref, planning, busy, planningLabel, onGenerate, onConfirm,
}: {
  campaign: Campaign
  plan: CyclePlan
  context: PlanContext
  calendarHref: string
  planning: boolean
  busy: boolean
  planningLabel: string
  onGenerate: (days?: number) => void
  onConfirm: (plan: CyclePlan) => Promise<void>
}) {
  const { provenance } = context
  const items = useMemo(() => (Array.isArray(plan.plan_data) ? plan.plan_data : []), [plan])
  const [days, setDays] = useState(plan.cycle_duration_days || campaign.cycle_duration_days || 14)
  const [confirming, setConfirming] = useState(false)
  /** Le brief ouvert dans le panneau ; le premier d'emblée, pour que le panneau
   *  montre tout de suite ce que l'onglet sert à relire. */
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null)

  const words = useMemo(() => items.reduce((sum, item) => sum + (item.estimated_word_count || 0), 0), [items])

  // CE QUE CE PLAN FAIT À L'EXISTANT, vu AVANT le premier jeton. Un plan relu
  // depuis une base antérieure aux verdicts ne porte pas `action` : ses briefs
  // tombent tous dans « nouvelles pages » et aucun verdict n'est inventé.
  const groups = useMemo(() => groupByAction(items), [items])
  const hasVerdicts = useMemo(() => items.some((item) => item.action !== undefined), [items])

  // A brief is backed by Search Console when it links to a page the data showed
  // ranking 5-20. That is a join on two real values, not a guess at intent.
  const measuredByUrl = useMemo(() => {
    const map = new Map<string, MeasuredQuery>()
    for (const entry of provenance.gsc?.strikingDistance ?? []) map.set(entry.pageUrl, entry)
    return map
  }, [provenance])

  const status = PLAN_STATUS_LABELS[plan.status] ?? { label: plan.status, badge: 'badge badge-muted' }
  const confirmable = plan.status === 'draft' || context.preview
  const running = plan.status === 'executing' || plan.status === 'confirmed'

  return (
    <div className="strategy-plan">
      <div className="strategy-plan__head">
        <div style={{ minWidth: 0 }}>
          <h4 className="strategy-plan__title">
            Plan du cycle {plan.cycle_number} <span className={status.badge}>{status.label}</span>
          </h4>
          <p className="meta" style={{ margin: 0 }}>
            {hasVerdicts ? (
              <>
                <span className="num">{groups.create.length}</span> nouvelle{groups.create.length > 1 ? 's' : ''} page
                {groups.create.length > 1 ? 's' : ''} ·{' '}
                <span className="num">{groups.skip.length}</span> sujet{groups.skip.length > 1 ? 's' : ''} écarté
                {groups.skip.length > 1 ? 's' : ''}
                {groups.legacyRefresh.length > 0 && (
                  <>
                    {' '}· <span className="num">{groups.legacyRefresh.length}</span> ancienne
                    {groups.legacyRefresh.length > 1 ? 's' : ''} mise{groups.legacyRefresh.length > 1 ? 's' : ''} à jour non
                    produite{groups.legacyRefresh.length > 1 ? 's' : ''}
                  </>
                )}
                {' '}sur {plan.cycle_duration_days} jours ·{' '}
              </>
            ) : (
              <>
                {items.length} page{items.length > 1 ? 's' : ''} sur {plan.cycle_duration_days} jours ·{' '}
              </>
            )}
            {formatMetric(words, 'compact')} mots estimés · plan créé le {formatDate(plan.created_at)}
          </p>
        </div>

        <div className="strategy-plan__actions">
          {confirmable ? (
            <>
              <label className="meta" htmlFor={`cycle-days-${plan.id}`}>Durée</label>
              <select
                id={`cycle-days-${plan.id}`}
                className="input"
                style={{ width: 110 }}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                disabled={busy}
              >
                {CYCLE_DURATIONS.map((value) => <option key={value} value={value}>{value} jours</option>)}
              </select>
              <Button
                variant="ghost"
                icon={RefreshCw}
                loading={planning}
                disabled={busy && !planning}
                onClick={() => onGenerate(days)}
                title="Construit un NOUVEAU plan : nouvelle lecture des SERP, nouveaux briefs."
              >
                {planning ? planningLabel : 'Régénérer'}
              </Button>
              <Button
                icon={CheckCircle2}
                loading={confirming}
                disabled={busy}
                onClick={async () => {
                  setConfirming(true)
                  try { await onConfirm(plan) } finally { setConfirming(false) }
                }}
              >
                Confirmer et lancer le cycle
              </Button>
            </>
          ) : (
            <>
              {running && (
                <Link href={calendarHref} className="btn-secondary">
                  <CalendarDays size={15} aria-hidden="true" /> Voir le calendrier
                </Link>
              )}
              <Button
                variant="ghost"
                icon={RefreshCw}
                loading={planning}
                disabled={busy && !planning}
                onClick={() => onGenerate()}
                title="Construit un NOUVEAU plan : nouvelle lecture des SERP, nouveaux briefs."
              >
                {planning ? planningLabel : 'Régénérer un plan'}
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="meta" style={{ margin: 0 }}>
        {running
          ? 'Ce cycle tourne déjà : génération et publication sont automatiques jusqu’à sa date de fin.'
          : 'Confirmer remplace les créneaux encore planifiés de cette campagne. Les pages déjà générées ou publiées ne bougent pas.'}
      </p>

      <ProvenancePanel provenance={provenance} items={items} />

      <PlanLede groups={groups} hasVerdicts={hasVerdicts} />

      {/* UNE SEULE LISTE, datée, où chaque ligne porte son verdict — nouvelle
          page ou sujet écarté. Les comptes vivent dans la ligne de résumé
          ci-dessus, et ce que les absences disent d'utile vit dans `PlanLede`. */}
      <PlanBriefList
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        verdictFor={storedAddressVerdict}
        keywordNote={(item) => {
          const measured = (item.internal_link_targets ?? [])
            .map((target) => measuredByUrl.get(target))
            .find(Boolean)
          if (!measured) return null
          return (
            <span
              className="badge badge-success"
              title={`Search Console : "${measured.query}" en position ${measured.position.toFixed(1)}, ${measured.impressions} impressions sur ${measured.pageUrl}`}
            >
              mesuré
            </span>
          )
        }}
      />
    </div>
  )
}

// ─── Les groupes d'un plan ───────────────────────────────────────────────────

type RefreshAction = Extract<PlanItemAction, { kind: 'refresh' }>
type SkipAction = Extract<PlanItemAction, { kind: 'skip' }>

interface PlanGroups {
  create: PlanPreviewItem[]
  /** Les mises à jour d'un ANCIEN plan : affichées, jamais produites. */
  legacyRefresh: Array<{ item: PlanPreviewItem; action: RefreshAction }>
  skip: Array<{ item: PlanPreviewItem; action: SkipAction }>
}

/**
 * `item.action?.kind ?? 'create'` — et rien d'autre.
 *
 * Un plan écrit avant les verdicts n'en porte aucun : ses briefs tombent
 * intégralement dans les nouvelles pages, ce qu'ils étaient. Leur inventer un
 * verdict rétroactif ferait afficher une décision que personne n'a prise.
 */
function groupByAction(items: PlanPreviewItem[]): PlanGroups {
  const groups: PlanGroups = { create: [], legacyRefresh: [], skip: [] }

  for (const item of items) {
    const action = item.action
    if (action?.kind === 'refresh') groups.legacyRefresh.push({ item, action })
    else if (action?.kind === 'skip') groups.skip.push({ item, action })
    else groups.create.push(item)
  }

  return groups
}

/**
 * Ce que la liste ne dit pas d'elle-même : les ABSENCES, et les lignes d'un
 * ancien plan qui ne seront pas produites.
 *
 * Sur un plan relu depuis la base sans aucun verdict, on ne dit rien de plus :
 * un « 0 écarté » y serait une mesure jamais faite.
 */
function PlanLede({ groups, hasVerdicts }: { groups: PlanGroups; hasVerdicts: boolean }) {
  if (!hasVerdicts) {
    return (
      <p className="meta" style={{ margin: 0 }}>
        Ce plan ne porte aucun verdict sur les pages existantes : tous ses briefs s’affichent comme de nouvelles
        pages, ce qu’ils étaient au moment de sa création.
      </p>
    )
  }

  const lines: string[] = []
  if (groups.legacyRefresh.length > 0) {
    lines.push(
      groups.legacyRefresh.length === 1
        ? 'Une ligne de cet ancien plan prévoyait la mise à jour d’une page existante : le moteur ne met plus à jour les pages, elle ne sera pas produite.'
        : `${groups.legacyRefresh.length} lignes de cet ancien plan prévoyaient la mise à jour de pages existantes : le moteur ne met plus à jour les pages, elles ne seront pas produites.`,
    )
  }
  if (groups.skip.length === 0) {
    lines.push('Aucun sujet écarté : les créneaux de ce cycle produiront tous une page.')
  }
  if (lines.length === 0) return null

  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
      {lines.map((line) => <p key={line} className="meta" style={{ margin: 0 }}>{line}</p>)}
    </div>
  )
}

/**
 * Ce que la résolution d'adresse a RÉELLEMENT pu prouver, au moment du plan.
 *
 * Trois états et pas deux : le vert n'apparaît que sur une vérification qui a
 * eu lieu. En régime aveugle, `takenPaths` ne contient que les adresses posées
 * par ce plan-ci, et écrire « adresse vérifiée libre » ferait passer une
 * ignorance pour une garantie. Un plan sans verdict n'affiche RIEN — `null`,
 * pas un verdict inventé pour un plan relu depuis la base.
 */
function storedAddressVerdict(item: PlanPreviewItem): AddressVerdict | null {
  const action = item.action
  if (action?.kind !== 'create') return null

  const slug: SlugResolutionDto = action.slug

  if (slug.status === 'free') {
    return { tone: 'good', inline: 'adresse vérifiée libre', detail: 'Adresse vérifiée libre au moment du plan.' }
  }

  if (slug.status === 'disambiguated') {
    return {
      tone: 'info',
      inline: 'adresse ajustée',
      detail: `L’adresse proposée était déjà prise (/${slug.from}). Le moteur a ajouté « ${slug.token} » pour la distinguer.`,
    }
  }

  return { tone: 'muted', inline: 'adresse non vérifiée', detail: slug.reason }
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
  // Seules comptent les phrases qui portent un CHIFFRE Search Console, jamais
  // celles qui disent qu'il n'y en avait pas (./provenance.ts).
  const cited = countMeasuredBriefs(items)

  return (
    <div className="inset" style={{ borderLeft: `3px solid ${meta.color}`, display: 'grid', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Icon size={16} color={meta.color} aria-hidden="true" />
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
              ? `Seule trace conservée : ${cited} brief${cited > 1 ? 's' : ''} sur ${items.length} cite${cited > 1 ? 'nt' : ''} une mesure Search Console chiffrée (position, impressions, clics ou CTR).`
              : `Aucun des ${items.length} briefs ne cite de mesure Search Console chiffrée : rien dans ce plan ne prouve qu’il ait été construit sur des données.`}
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
        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}>
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
        <Icon size={13} color="var(--ink-muted)" aria-hidden="true" />
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
