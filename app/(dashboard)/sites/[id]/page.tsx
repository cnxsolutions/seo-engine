// ─────────────────────────────────────────────────────────────────────────────
// Le site — un parcours par site, de la connexion aux résultats
//
// Le parcours vivait dans la barre latérale, calculé sur TOUS les sites à la
// fois : « Connecter Google » y était vrai d'un site et faux du suivant, et les
// mêmes actions étaient répétées sur trois écrans. Cette page est le seul
// endroit où un site se lit en entier : cinq étapes dans un ordre fixe, chacune
// avec ses faits et ses actions, et un lien vers l'écran spécialisé quand il en
// existe un (calendrier, publication, Search Console).
//
// Toutes les lectures se font ici, côté serveur, avec la clé de service. Rien
// de ce qui traverse vers un composant client ne dépasse un identifiant de
// site : ni jeton Google, ni mot de passe d'application, ni jeton GitHub.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BarChart3, CalendarDays, Check, Code2, Globe2, Link2, Pencil, Send, Target, TriangleAlert, type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getProductionMetrics, type ProductionMetrics } from '@/app/api/dashboard/metrics'
import { PageHeader, formatDay, formatDayLong, formatMetric } from '@/components/ui'
import { getActiveCyclePlan, listCampaigns, listSites, type SafeCampaign } from '@/lib/db'
import { getGscCoverage, type GscCoverage } from '@/lib/google/performance'
import { getGoogleSyncState, type GoogleSyncState } from '@/lib/google/sync'
import { DEFAULT_SCHEDULE_TIME, listEditorialSlots, todayLocalDate, type SafeEditorialSlot } from '@/lib/scheduler/editorial'
import { createServiceClient } from '@/lib/supabase'
import type { CyclePlan, ScheduleFrequency } from '@/lib/types'
import { AnalyzeRepoButton } from '../AnalyzeRepoButton'
import { DisconnectGoogleButton } from './google/DisconnectGoogleButton'
import { deriveHubSteps, type HubFacts, type HubStep } from './steps'

export const dynamic = 'force-dynamic'

/** Même élargissement que /sites : `listSites()` attache ces deux drapeaux sans les déclarer. */
type SiteRow = Awaited<ReturnType<typeof listSites>>[number] & { has_schema?: boolean; has_credentials?: boolean }

const CONNECTOR = {
  wordpress: { label: 'WordPress', icon: Globe2, color: 'var(--series-1)' },
  nextjs: { label: 'Next.js', icon: Code2, color: 'var(--series-7)' },
} as const

/** Le tick principal du planificateur : toutes les quinze minutes (lib/scheduler/cron.ts). */
const ENGINE_TICK_MINUTES = 15

const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  manual: 'lancement manuel',
  daily: 'une page par jour',
  every_2_days: 'une page tous les 2 jours',
  every_3_days: 'une page tous les 3 jours',
  weekly: 'une page par semaine',
  biweekly: 'une page toutes les 2 semaines',
  monthly: 'une page par mois',
  custom: 'jours choisis',
}

/** Le vocabulaire du calendrier (app/(dashboard)/calendar/page.tsx), repris tel quel. */
const SLOT_STATUS: Record<string, { label: string; badge: string }> = {
  planned: { label: 'Prévu', badge: 'badge badge-muted' },
  generating: { label: 'Génération…', badge: 'badge badge-warning' },
  generated: { label: 'À valider', badge: 'badge badge-info' },
  published: { label: 'En ligne', badge: 'badge badge-success' },
  failed: { label: 'Échec', badge: 'badge badge-danger' },
  skipped: { label: 'Ignoré', badge: 'badge badge-muted' },
}

// ─── Lectures ────────────────────────────────────────────────────────────────

interface CampaignView {
  campaign: SafeCampaign
  cycle: CyclePlan | null
}

interface HubData {
  google: GoogleSyncState
  coverage: GscCoverage | null
  campaigns: CampaignView[]
  /** Les quatre prochains créneaux, toutes campagnes du site confondues. */
  slots: SafeEditorialSlot[]
  metrics: ProductionMetrics | null
  awaitingReview: number | null
  publishedThisMonth: number | null
  facts: HubFacts
}

/**
 * Une lecture en échec ne blanchit jamais la page : la section concernée dit
 * « indisponible », les quatre autres restent justes. Un hub qui tombe parce
 * que `job_executions` est illisible serait un hub qu'on n'ouvre plus.
 */
async function soft<T>(label: string, read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read
  } catch (error) {
    console.warn(`[sites/${label}] lecture indisponible :`, error instanceof Error ? error.message : error)
    return fallback
  }
}

/**
 * Compté côté serveur, `head: true` : PostgREST plafonne un select à 1000
 * lignes, un comptage exact ne transfère rien et ne plafonne pas.
 */
async function countGenerations(siteId: string, status: string, since?: string): Promise<number> {
  let query = createServiceClient()
    .from('generations')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('status', status)
  if (since) query = query.gte('published_at', since)
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

const CYCLE_RANK: Record<string, number> = { executing: 3, confirmed: 2, draft: 1 }

async function readHub(site: SiteRow): Promise<HubData> {
  const now = new Date()
  const today = todayLocalDate()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [google, coverage, allCampaigns, metrics, awaitingReview, publishedThisMonth] = await Promise.all([
    getGoogleSyncState(site.id),
    soft('gsc', getGscCoverage(site.id), null),
    soft('campaigns', listCampaigns(), []),
    // Sept jours : la fenêtre des échecs, et celle que `cleanupOldLogs()`
    // laisse de toute façon à `job_executions`.
    soft('metrics', getProductionMetrics(site.id, 7), null),
    soft('awaiting', countGenerations(site.id, 'generated'), null),
    soft('published', countGenerations(site.id, 'published', monthStart), null),
  ])

  const siteCampaigns = allCampaigns.filter((campaign) => campaign.site_id === site.id)

  const [cycles, slotLists] = await Promise.all([
    Promise.all(siteCampaigns.map((campaign) => soft('cycle', getActiveCyclePlan(campaign.id), null))),
    // `editorial_calendar` ne porte pas de site : on passe par chaque campagne.
    Promise.all(siteCampaigns.map((campaign) => soft('slots', listEditorialSlots(campaign.id, today), []))),
  ])

  const campaigns = siteCampaigns.map((campaign, index) => ({ campaign, cycle: cycles[index] }))
  const upcoming = slotLists.flat().sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))

  // Le cycle le plus avancé parmi les campagnes du site : c'est lui qui dit où
  // en est la stratégie, pas la campagne créée en dernier.
  const cycle = cycles
    .filter((plan): plan is CyclePlan => plan !== null)
    .sort((a, b) => (CYCLE_RANK[b.status] ?? 0) - (CYCLE_RANK[a.status] ?? 0))[0] ?? null

  const described = site.type === 'nextjs' ? Boolean(site.repo_profile) : Boolean(site.has_credentials)

  return {
    google,
    coverage,
    campaigns,
    slots: upcoming.slice(0, 4),
    metrics,
    awaitingReview,
    publishedThisMonth,
    facts: {
      siteType: site.type,
      described,
      google: { connected: google.connected, hasProperty: Boolean(google.gscProperty) },
      campaigns: campaigns.length,
      cycle: cycle ? { number: cycle.cycle_number, status: cycle.status } : null,
      nextSlotDate: upcoming.find((slot) => slot.status === 'planned')?.scheduled_date ?? null,
      awaitingReview: awaitingReview ?? 0,
      publishedThisMonth: publishedThisMonth ?? 0,
      failedLast7Days: metrics?.counts.failed ?? 0,
      gsc: {
        rows: coverage && coverage.readable ? coverage.rowCount : null,
        lastSyncAt: google.gsc.lastSyncAt,
      },
    },
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function SiteHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Une lecture de liste plutôt qu'un `select('*')` : la liste est le seul
  // lecteur garanti sans secret (voir sites/[id]/edit/page.tsx).
  const site = ((await listSites()) as SiteRow[]).find((candidate) => candidate.id === id)
  if (!site) notFound()

  const hub = await readHub(site)
  const steps = deriveHubSteps(hub.facts)
  const connector = site.type === 'nextjs' ? CONNECTOR.nextjs : CONNECTOR.wordpress

  return (
    <div className="hub">
      <PageHeader
        icon={connector.icon}
        iconColor={connector.color}
        badge={connector.label}
        title={site.name}
        backHref="/sites"
        meta={
          <>
            <a href={site.url} target="_blank" rel="noopener noreferrer">{site.url}</a>
            {site.type === 'nextjs' && site.github_repo && (
              <span>dépôt {site.github_repo} · branche {site.github_branch || 'par défaut'}</span>
            )}
            {site.type === 'wordpress' && site.wp_username && <span>utilisateur {site.wp_username}</span>}
          </>
        }
        action={{ label: 'Modifier le site', href: `/sites/${site.id}/edit`, icon: Pencil }}
      />

      {!site.is_active && (
        <p className="hub-warning" role="status">
          <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          Site désactivé : le planificateur l’ignore, rien n’y sera généré ni publié. Réactivez-le depuis « Modifier le site ».
        </p>
      )}

      <StepBar steps={steps} />

      <ConnexionSection site={site} google={hub.google} highlighted={toneOf(steps, 'connexion') === 'current'} />
      <StrategieSection site={site} campaigns={hub.campaigns} highlighted={toneOf(steps, 'strategie') === 'current'} />
      <CalendrierSection site={site} slots={hub.slots} hasCampaign={hub.campaigns.length > 0} highlighted={toneOf(steps, 'calendrier') === 'current'} />
      <PublicationSection site={site} hub={hub} highlighted={toneOf(steps, 'publication') === 'current'} />
      <ResultatsSection site={site} google={hub.google} coverage={hub.coverage} highlighted={toneOf(steps, 'resultats') === 'current'} />
    </div>
  )
}

function toneOf(steps: HubStep[], id: HubStep['id']) {
  return steps.find((step) => step.id === id)?.tone
}

// ─── Barre d'étapes ──────────────────────────────────────────────────────────

const TONE_SR: Record<HubStep['tone'], string> = {
  done: 'terminée',
  current: 'étape en cours',
  attention: 'à traiter',
  pending: 'à venir',
}

/**
 * Cinq liens d'ancre, pas cinq pastilles : chaque étape mène à sa section plus
 * bas, et un lecteur d'écran entend l'état (« terminée », « à traiter ») que la
 * couleur seule ne dirait pas.
 */
function StepBar({ steps }: { steps: HubStep[] }) {
  return (
    <ol className="hub-steps" aria-label="Étapes du site">
      {steps.map((step) => (
        <li key={step.id} className={`hub-step hub-step--${step.tone}`}>
          <a href={`#${step.id}`} className="hub-step__link">
            <span className="hub-step__num" aria-hidden="true">
              {step.tone === 'done' ? <Check size={14} strokeWidth={3} /> : step.count ?? step.order}
            </span>
            <span className="hub-step__text">
              <span className="hub-step__label">
                {step.label} <span className="sr-only">— {TONE_SR[step.tone]}</span>
              </span>
              <span className="hub-step__detail">{step.detail}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  )
}

// ─── Sections ────────────────────────────────────────────────────────────────

function Section({
  id, title, icon: Icon, actions, highlighted, children,
}: {
  id: HubStep['id']
  title: string
  icon: LucideIcon
  actions?: ReactNode
  highlighted: boolean
  children: ReactNode
}) {
  return (
    <section id={id} className={`hub-section ${highlighted ? 'hub-section--current' : ''}`} aria-labelledby={`h-${id}`}>
      <div className="hub-section__head">
        <h2 id={`h-${id}`} className="hub-section__title">
          <Icon size={15} color={highlighted ? 'var(--accent)' : 'var(--ink-muted)'} aria-hidden="true" />
          {title}
        </h2>
        {actions && <div className="hub-section__actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** Un fait et son action, côte à côte. `tone` colore la phrase, jamais seule : le texte la porte aussi. */
function Fact({
  label, tone = 'neutral', text, action,
}: {
  label: string
  tone?: 'good' | 'warn' | 'neutral'
  text: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="hub-fact">
      <div className="hub-fact__body">
        <span className="hub-fact__label">{label}</span>
        <span className={`hub-fact__text hub-fact__text--${tone}`}>{text}</span>
      </div>
      {action && <div className="hub-fact__action">{action}</div>}
    </div>
  )
}

// ── 1. Connexion ──

function ConnexionSection({ site, google, highlighted }: { site: SiteRow; google: GoogleSyncState; highlighted: boolean }) {
  return (
    <Section
      id="connexion"
      title="Connexion"
      icon={Link2}
      highlighted={highlighted}
      actions={<Link href={`/sites/${site.id}/existing`} className="btn-link">Pages connues</Link>}
    >
      <div className="hub-grid">
        {site.type === 'wordpress' ? (
          <>
            <Fact
              label="Identifiants WordPress"
              tone={site.has_credentials ? 'good' : 'warn'}
              text={
                site.has_credentials
                  ? `Utilisateur ${site.wp_username} · mot de passe d’application enregistré`
                  : 'Manquants : ni la lecture du schéma ni la publication ne sont possibles'
              }
              action={
                <Link href={`/sites/${site.id}/edit`} className="btn-link">
                  {site.has_credentials ? 'Modifier' : 'Compléter'}
                </Link>
              }
            />
            <Fact
              label="Schéma CMS"
              tone={site.has_schema ? 'good' : 'neutral'}
              text={
                site.has_schema
                  ? `Lu le ${site.cms_schema_read_at ? formatDayLong(site.cms_schema_read_at) : 'date inconnue'}`
                  : 'Jamais lu : types de contenu, champs et extension SEO guident la génération'
              }
              action={
                <Link href={`/schema/${site.id}`} className="btn-link">
                  {site.has_schema ? 'Ouvrir' : 'Lire le schéma'}
                </Link>
              }
            />
          </>
        ) : (
          <Fact
            label="Dépôt GitHub"
            tone={site.repo_profile ? 'good' : site.github_repo ? 'warn' : 'neutral'}
            text={
              !site.github_repo
                ? 'Aucun dépôt configuré'
                : site.repo_profile
                  ? `${site.github_repo} · analysé, les pages suivent l’architecture du dépôt`
                  : `${site.github_repo} · jamais analysé : les pages seraient écrites au format générique`
            }
            action={
              site.github_repo
                ? <AnalyzeRepoButton siteId={site.id} hasProfile={Boolean(site.repo_profile)} />
                : <Link href={`/sites/${site.id}/edit`} className="btn-link">Configurer</Link>
            }
          />
        )}

        <Fact
          label="Google"
          tone={google.connected ? (google.gscProperty ? 'good' : 'warn') : 'warn'}
          text={
            google.connected
              ? [
                google.email ?? 'compte inconnu',
                google.gscProperty ? 'Search Console reliée' : 'aucune propriété Search Console choisie',
                google.gbpLocationId ? 'fiche d’établissement reliée' : 'aucune fiche d’établissement',
              ].join(' · ')
              : 'Non connecté : sans Search Console, aucune position ni impression ne remonte'
          }
          action={
            google.connected ? (
              <span className="hub-fact__links">
                <Link href={`/sites/${site.id}/google`} className="btn-link">Détail</Link>
                <Link href={`/api/google/auth?site_id=${site.id}`} className="btn-link">Reconnecter</Link>
                <DisconnectGoogleButton siteId={site.id} />
              </span>
            ) : (
              <Link href={`/api/google/auth?site_id=${site.id}`} className="btn-primary btn-sm">Connecter Google</Link>
            )
          }
        />
      </div>
    </Section>
  )
}

// ── 2. Stratégie ──

function publicationModeOf(site: SiteRow, campaign: SafeCampaign): string {
  if (!campaign.auto_publish) return 'manuelle, après relecture'
  if (site.type === 'nextjs') {
    return site.auto_promote ? 'automatique, fusionnée vers la branche par défaut' : 'automatique, sur la branche du moteur'
  }
  switch (campaign.publish_status) {
    case 'draft': return 'automatique, en brouillon WordPress'
    case 'pending': return 'automatique, en attente de relecture WordPress'
    default: return 'automatique, en ligne directement'
  }
}

function StrategieSection({ site, campaigns, highlighted }: { site: SiteRow; campaigns: CampaignView[]; highlighted: boolean }) {
  if (campaigns.length === 0) {
    return (
      <Section id="strategie" title="Stratégie" icon={Target} highlighted={highlighted}>
        <div className="hub-empty">
          <p>Aucune campagne : une campagne fixe les mots-clés, les communes et le rythme de publication. Rien ne sera planifié avant.</p>
          <Link href={`/strategy/new?site=${site.id}`} className="btn-primary btn-sm">Créer une stratégie</Link>
        </div>
      </Section>
    )
  }

  return (
    <Section
      id="strategie"
      title="Stratégie"
      icon={Target}
      highlighted={highlighted}
      actions={<Link href="/strategy" className="btn-link">Voir le plan du cycle</Link>}
    >
      <div className="hub-stack">
        {campaigns.map(({ campaign, cycle }) => (
          <article key={campaign.id} className="hub-campaign" aria-label={campaign.name}>
            <div className="hub-campaign__head">
              <span className="hub-campaign__name">
                {campaign.name}
                {!campaign.is_active && <span className="badge badge-muted">En pause</span>}
                {cycle && <CycleBadge cycle={cycle} />}
              </span>
              <Link href={`/strategy/${campaign.id}/edit`} className="btn-link">Modifier la campagne</Link>
            </div>
            <dl className="hub-facts">
              <div><dt>Mots-clés</dt><dd>{campaign.keywords?.length ? campaign.keywords.join(', ') : '—'}</dd></div>
              <div><dt>Communes</dt><dd>{campaign.communes?.length ? campaign.communes.join(', ') : campaign.department || '—'}</dd></div>
              <div>
                <dt>Rythme</dt>
                <dd>
                  {FREQUENCY_LABELS[campaign.schedule_frequency ?? 'daily']}
                  {campaign.schedule_frequency !== 'manual' && `, à ${campaign.schedule_time || DEFAULT_SCHEDULE_TIME}`}
                  {' · '}
                  <span className="chip">{campaign.ai_model}</span>
                </dd>
              </div>
              <div><dt>Publication</dt><dd>{publicationModeOf(site, campaign)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </Section>
  )
}

const CYCLE_BADGE: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Plan à confirmer', badge: 'badge badge-warning' },
  confirmed: { label: 'Cycle confirmé', badge: 'badge badge-info' },
  executing: { label: 'Cycle en cours', badge: 'badge badge-success' },
}

function CycleBadge({ cycle }: { cycle: CyclePlan }) {
  const meta = CYCLE_BADGE[cycle.status] ?? { label: cycle.status, badge: 'badge badge-muted' }
  return <span className={meta.badge}>{meta.label} · n° {cycle.cycle_number}</span>
}

// ── 3. Calendrier ──

function slotTitle(slot: SafeEditorialSlot): string {
  if (slot.artifact_kind === 'gbp_post') return 'Post de fiche Google'
  const keyword = slot.target_keyword ?? ''
  return slot.target_city ? `${keyword} à ${slot.target_city}` : keyword || 'Créneau sans sujet'
}

function CalendrierSection({
  site, slots, hasCampaign, highlighted,
}: {
  site: SiteRow
  slots: SafeEditorialSlot[]
  hasCampaign: boolean
  highlighted: boolean
}) {
  return (
    <Section
      id="calendrier"
      title="Calendrier"
      icon={CalendarDays}
      highlighted={highlighted}
      actions={<Link href={`/calendar?site=${site.id}`} className="btn-link">Tout le calendrier</Link>}
    >
      {slots.length === 0 ? (
        <div className="hub-empty">
          <p>
            {hasCampaign
              ? 'Aucun créneau à venir : ce site ne produira rien tant qu’un plan de cycle n’est pas confirmé.'
              : 'Aucun créneau : le calendrier se remplit à la confirmation du premier plan de cycle.'}
          </p>
          {hasCampaign && <Link href="/strategy" className="btn-secondary btn-sm">Ouvrir le plan du cycle</Link>}
        </div>
      ) : (
        <ol className="hub-slots" aria-label="Prochains créneaux">
          {slots.map((slot) => {
            const status = SLOT_STATUS[slot.status] ?? { label: slot.status, badge: 'badge badge-muted' }
            return (
              <li key={slot.id} className="hub-slot">
                <span className="hub-slot__date">{formatDay(slot.scheduled_date)}</span>
                <span className="hub-slot__title">{slotTitle(slot)}</span>
                <span className={status.badge}>{status.label}</span>
              </li>
            )
          })}
        </ol>
      )}
    </Section>
  )
}

// ── 4. Publication ──

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'date inconnue'
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function PublicationSection({ site, hub, highlighted }: { site: SiteRow; hub: HubData; highlighted: boolean }) {
  const awaiting = hub.awaitingReview
  const lastRun = hub.metrics?.runs[0]?.executedAt ?? null
  const minutesToTick = ENGINE_TICK_MINUTES - (new Date().getMinutes() % ENGINE_TICK_MINUTES)

  return (
    <Section
      id="publication"
      title="Publication"
      icon={Send}
      highlighted={highlighted}
      actions={
        <Link href={`/publish?site=${site.id}`} className="btn-link">
          {awaiting ? `Voir ${awaiting > 1 ? `les ${awaiting} pages` : 'la page'} en attente` : 'File de publication'}
        </Link>
      }
    >
      <div className="hub-counters">
        <Counter value={awaiting} label={awaiting === 1 ? 'attend votre avis' : 'attendent votre avis'} tone={awaiting ? 'attention' : 'neutral'} />
        <Counter value={hub.publishedThisMonth} label="en ligne ce mois-ci" tone="neutral" />
        <Counter
          value={hub.metrics ? hub.metrics.counts.failed : null}
          label={hub.metrics && hub.metrics.counts.failed === 1 ? 'erreur sur les 7 derniers jours' : 'erreurs sur les 7 derniers jours'}
          tone={hub.metrics ? (hub.metrics.counts.failed > 0 ? 'attention' : 'good') : 'neutral'}
        />
        <p className="hub-counters__note">
          {/* `job_executions` ne garde que les passages qui ont produit ou publié
              quelque chose : un moteur qui tourne sans rien à faire n'y laisse
              aucune trace, d'où « activité » et non « passage ». */}
          {lastRun ? `Dernière activité du moteur : ${formatDateTime(lastRun)}.` : 'Aucune activité du moteur sur 7 jours.'}
          {' '}
          {site.is_active
            ? `Prochain passage dans ${minutesToTick} min (toutes les ${ENGINE_TICK_MINUTES} minutes).`
            : 'Site désactivé : le moteur ne passe pas.'}
        </p>
      </div>
      {hub.metrics && hub.metrics.unreadable.length > 0 && (
        <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
          Compteurs partiels : {hub.metrics.unreadable.join(', ')} illisible{hub.metrics.unreadable.length > 1 ? 's' : ''}.
        </p>
      )}
    </Section>
  )
}

function Counter({ value, label, tone }: { value: number | null; label: string; tone: 'attention' | 'good' | 'neutral' }) {
  return (
    <div className="hub-counter">
      <span className={`hub-counter__value hub-counter__value--${tone} num`}>
        {value === null ? '—' : formatMetric(value, 'compact')}
      </span>
      <span className="hub-counter__label">{value === null ? 'comptage indisponible' : label}</span>
    </div>
  )
}

// ── 5. Résultats ──

function ResultatsSection({
  site, google, coverage, highlighted,
}: {
  site: SiteRow
  google: GoogleSyncState
  coverage: GscCoverage | null
  highlighted: boolean
}) {
  const hasData = Boolean(coverage?.readable && coverage.rowCount > 0)

  let body: ReactNode
  let action: ReactNode = null

  if (!google.connected) {
    body = 'Google n’est pas connecté : aucune impression, aucun clic, aucune position ne remonte pour ce site.'
    action = <Link href={`/api/google/auth?site_id=${site.id}`} className="btn-primary btn-sm">Connecter Google</Link>
  } else if (!google.gscProperty) {
    body = 'Le compte Google est relié mais aucune propriété Search Console n’est choisie : rien ne peut être lu.'
    action = <Link href={`/sites/${site.id}/google/select`} className="btn-primary btn-sm">Choisir la propriété</Link>
  } else if (hasData && coverage) {
    body = (
      <>
        {formatMetric(coverage.rowCount, 'number')} lignes Search Console conservées
        {coverage.firstDate && coverage.lastDate && `, du ${formatDayLong(coverage.firstDate)} au ${formatDayLong(coverage.lastDate)}`}.
        {google.gsc.lastSyncAt && ` Dernière synchronisation : ${formatDateTime(google.gsc.lastSyncAt)}.`}
      </>
    )
    action = <Link href={`/dashboard?tab=performance&site=${site.id}`} className="btn-primary btn-sm"><BarChart3 size={14} /> Voir la performance</Link>
  } else if (google.gsc.status === 'failed') {
    body = `Dernière synchronisation en échec${google.gsc.error ? ` : ${google.gsc.error}` : ''}.`
  } else {
    body = google.gsc.lastSyncAt
      ? `Search Console reliée, synchronisée le ${formatDateTime(google.gsc.lastSyncAt)} sans aucune ligne. Google met 2 à 3 jours à livrer ses données : les premières positions et impressions apparaîtront ici.`
      : 'Search Console reliée. La première synchronisation tourne à la sélection de la propriété, puis chaque nuit à 4 h.'
  }

  return (
    <Section
      id="resultats"
      title="Résultats"
      icon={BarChart3}
      highlighted={highlighted}
      actions={google.connected && <Link href={`/sites/${site.id}/google`} className="btn-link">Search Console en détail</Link>}
    >
      <div className="hub-empty">
        <p>{body}</p>
        {action}
      </div>
    </Section>
  )
}
