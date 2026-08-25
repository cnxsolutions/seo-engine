// ─────────────────────────────────────────────────────────────────────────────
// Sites — where each connected site stands, and what to do next
//
// The card used to show a repository and a branch. Nothing said whether Google
// was plugged in, whether the site had ever been described, whether a campaign
// existed, or what the operator was supposed to click next — so a site could sit
// there for weeks, connected and completely idle, looking exactly like a working
// one.
//
// Every card now answers five questions from real rows: what kind of site it is
// (with the facts its own connector needs), whether Google is connected, whether
// the site has been described (repository profile for Next.js, CMS schema for
// WordPress), what it has produced, and the single next step.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ArrowRight, CalendarDays, Code2, FileText, Globe, Globe2, Plus, Target, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { EmptyState, IconBox, PageHeader, StatusBadge, formatMetric } from '@/components/ui'
import { listSites } from '@/lib/db'
import { createServiceClient } from '@/lib/supabase'
import { freshnessOf, type BlindReason, type InventoryFreshness } from '@/src/core/domain/existing/inventory'
import { AnalyzeRepoButton } from './AnalyzeRepoButton'

export const dynamic = 'force-dynamic'

/**
 * `listSites()` attaches `has_schema` at runtime but its return type is
 * `SafeSite`, which does not declare it. Widening here rather than in lib/types
 * keeps the read honest without touching a file five workstreams share.
 */
type SiteRow = Awaited<ReturnType<typeof listSites>>[number] & { has_schema?: boolean }

/** Identity hues, from the validated palette — never a status colour. */
const CONNECTOR = {
  wordpress: { label: 'WordPress', icon: Globe2, color: 'var(--series-1)' },
  nextjs: { label: 'Next.js', icon: Code2, color: 'var(--series-7)' },
} as const

function connectorOf(type: string) {
  return type === 'nextjs' ? CONNECTOR.nextjs : CONNECTOR.wordpress
}

// ─── Facts ───────────────────────────────────────────────────────────────────

interface SiteFacts {
  campaigns: number
  publishedPages: number
  /** Editorial slots still waiting: what the site is about to produce. */
  plannedSlots: number
  /**
   * Pages the crawler has actually seen — the same figure /sites/[id]/existing
   * serves as `summary.crawledCount`, so the two screens can never disagree.
   *
   * `null`, never 0, when no analysis has ever completed AND nothing was read:
   * "no crawl, so nothing to count" and "zero page" are two different facts, and
   * a card that prints 0 for the first one is a card that lies.
   */
  crawledCount: number | null
  /** Same derivation as the inventory, so 'fresh' / 'stale' / 'blind' mean one thing. */
  freshness: InventoryFreshness
}

/**
 * The shape of "we read nothing at all". The domain answers that question
 * itself; writing the blind state by hand here would be one more place in the
 * repo deciding what an empty inventory is.
 *
 * The date passed is never read: with no timestamp there is no age to compute,
 * so `freshnessOf` returns on its first branch. Handing it a real clock would
 * suggest this constant depends on when the module was loaded.
 */
const NO_FACTS: SiteFacts = {
  campaigns: 0,
  publishedPages: 0,
  plannedSlots: 0,
  crawledCount: null,
  freshness: freshnessOf(null, false, 0, new Date(0)),
}

/**
 * Counted server-side, one exact count per site rather than one big select.
 *
 * PostgREST caps a plain select at 1000 rows, so counting published pages by
 * reading them back would silently plateau at 1000 the day the engine gets
 * productive. `head: true` counts never do.
 */
async function readSiteFacts(siteIds: string[]): Promise<Map<string, SiteFacts>> {
  const facts = new Map<string, SiteFacts>(siteIds.map((id) => [id, NO_FACTS]))
  if (siteIds.length === 0) return facts

  const supabase = createServiceClient()
  const now = new Date()
  const { data: campaignRows, error } = await supabase.from('campaigns').select('id,site_id').in('site_id', siteIds)
  if (error) throw new Error(error.message)

  const campaignsBySite = new Map<string, string[]>()
  for (const row of campaignRows ?? []) {
    const bucket = campaignsBySite.get(row.site_id)
    if (bucket) bucket.push(row.id)
    else campaignsBySite.set(row.site_id, [row.id])
  }

  await Promise.all(
    siteIds.map(async (siteId) => {
      const campaignIds = campaignsBySite.get(siteId) ?? []

      const [published, planned, crawled, completedRun] = await Promise.all([
        supabase
          .from('generations')
          .select('id', { count: 'exact', head: true })
          .eq('site_id', siteId)
          .eq('status', 'published'),
        campaignIds.length > 0
          ? supabase
            .from('editorial_calendar')
            .select('id', { count: 'exact', head: true })
            .in('campaign_id', campaignIds)
            .eq('status', 'planned')
          : null,
        /*
         * One read, two facts: how many pages the crawler saw, and when it last
         * saw one. `head: true` is impossible here — the date is the payload —
         * but `limit(1)` keeps the transfer to a single row while `count:
         * 'exact'` still counts the whole set server-side.
         *
         * `origin = 'crawl'` is not optional. An 'engine' row carries its
         * PUBLICATION date in `crawled_at` (lib/existing/inventory.ts:653-660),
         * so including those rows would report "analysed yesterday" about a site
         * nobody has ever crawled — the exact lie freshness exists to prevent.
         */
        supabase
          .from('site_pages')
          .select('crawled_at', { count: 'exact' })
          .eq('site_id', siteId)
          .eq('origin', 'crawl')
          // nullsFirst: false, or PostgreSQL sorts NULLS FIRST descending and a
          // row with no date would hide the real latest crawl.
          .order('crawled_at', { ascending: false, nullsFirst: false })
          .limit(1),
        // The one fact the pages themselves cannot express: "analysed and found
        // nothing" versus "never analysed". Two different sentences on screen,
        // and two different things for the operator to go and fix.
        supabase
          .from('analysis_runs')
          .select('id', { count: 'exact', head: true })
          .eq('site_id', siteId)
          .eq('status', 'completed'),
      ])

      const crawledCount = crawled.count ?? 0
      const lastCrawlAt = (crawled.data as Array<{ crawled_at: string | null }> | null)?.[0]?.crawled_at ?? null
      const hasCompletedRun = (completedRun.count ?? 0) > 0
      const freshness = freshnessOf(lastCrawlAt, hasCompletedRun, crawledCount, now)

      facts.set(siteId, {
        campaigns: campaignIds.length,
        publishedPages: published.count ?? 0,
        plannedSlots: planned?.count ?? 0,
        /*
         * The rule the inventory API already applies, applied identically here:
         * a count of 0 on a site that was never analysed is not a measurement,
         * it is the absence of one. A crawl that ran and reported nothing keeps
         * its 0 — that IS a measurement, and it points at a sitemap, not at a
         * missing analysis.
         */
        crawledCount:
          crawledCount === 0 && freshness.blindReason === 'jamais-analyse' ? null : crawledCount,
        freshness,
      })
    })
  )

  return facts
}

// ─── Next action ─────────────────────────────────────────────────────────────

interface NextStep {
  label: string
  /** Absent when the control lives in the card itself (repository analysis). */
  href?: string
  why: string
}

/**
 * The one thing to do next for THIS site.
 *
 * Same ladder as the sidebar's workflow (app/api/workflow/state.ts) but scoped
 * to a single site, because "connect Google" is meaningless as an aggregate: it
 * is true of one site and false of the next.
 */
function nextStep(site: SiteRow, facts: SiteFacts | null): NextStep | null {
  if (!site.is_active) return null

  if (site.type === 'nextjs' && !site.repo_profile) {
    return {
      label: 'Analyser le dépôt',
      why: 'Sans profil de dépôt, les pages sont écrites au format générique, hors de l’architecture du site.',
    }
  }

  // `has_schema` says the CMS schema is READABLE (credentials on file), not that
  // it was read once: the extractor persists nothing, so "already extracted" is
  // not a fact this product holds. Without credentials nothing can be published
  // to WordPress either, which is why this outranks the Google rung.
  if (site.type === 'wordpress' && !site.has_schema) {
    return {
      label: 'Compléter les identifiants WordPress',
      href: '/sites/new',
      why: 'Sans utilisateur ni mot de passe d’application, ni la lecture du schéma ni la publication ne sont possibles.',
    }
  }

  if (!site.google_connected) {
    return {
      label: 'Connecter Google',
      href: `/api/google/auth?site_id=${site.id}`,
      why: 'Sans Search Console, le moteur publie à l’aveugle : aucune position, aucune impression ne remonte.',
    }
  }

  // Beyond this point every rung is a count. Without them, saying "create a
  // campaign" could be plain wrong — better to say nothing than to invent zero.
  if (!facts) return null

  /*
   * The only point in the journey where a blind inventory is named BEFORE any
   * token is spent. It is a rung, not a barrier: the engine keeps producing on a
   * site it has never read — it just checks each address against the live site
   * instead of against what it knows.
   *
   * The trigger is "the engine knows no page", which covers both blind reasons
   * that matter here: never analysed, and analysed without finding anything. A
   * crawl merely gone stale is not one of them — those pages are still known.
   */
  if ((facts.crawledCount ?? 0) === 0) {
    return {
      label: 'Analyser le site',
      href: '/strategy/new',
      why: 'Le moteur ne connaît aucune page de ce site : il générera sans savoir ce qui est déjà en ligne, et peut doubler une page qui vous positionne.',
    }
  }

  if (facts.campaigns === 0) {
    return {
      label: 'Créer une stratégie',
      href: '/strategy/new',
      why: 'Une campagne fixe les mots-clés, les communes et le rythme de publication.',
    }
  }

  if (facts.plannedSlots === 0) {
    return {
      label: 'Planifier un cycle',
      href: '/strategy',
      why: 'Aucun créneau n’attend : ce site ne produira rien tant qu’un cycle n’est pas lancé.',
    }
  }

  return {
    label: 'Voir le calendrier',
    href: '/calendar',
    why: `${facts.plannedSlots} créneau${facts.plannedSlots > 1 ? 'x' : ''} en attente de génération.`,
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function SitesPage() {
  const sites = (await listSites()) as SiteRow[]

  // A failed count must not blank the list: the sites themselves are the point,
  // the counters are context.
  const facts = await readSiteFacts(sites.map((site) => site.id)).catch((error) => {
    console.warn('[sites] comptage indisponible :', error instanceof Error ? error.message : error)
    return new Map<string, SiteFacts>()
  })

  const active = sites.filter((site) => site.is_active).length

  return (
    <div>
      <PageHeader
        icon={Globe}
        badge="Étape 1"
        title="Sites connectés"
        subtitle="Chaque site reçoit les pages générées. Un site n’est prêt que lorsqu’il est décrit et relié à Google."
        meta={
          sites.length > 0 ? (
            <>
              <span>{sites.length} site{sites.length > 1 ? 's' : ''} enregistré{sites.length > 1 ? 's' : ''}</span>
              <span>{active} actif{active > 1 ? 's' : ''}</span>
            </>
          ) : undefined
        }
        action={{ label: 'Ajouter un site', href: '/sites/new', icon: Plus }}
      />

      {sites.length === 0 ? (
        <EmptyState
          icons={[
            <IconBox key="wp" icon={Globe2} color={CONNECTOR.wordpress.color} boxSize={56} size={28} />,
            <IconBox key="nxt" icon={Code2} color={CONNECTOR.nextjs.color} boxSize={56} size={28} />,
          ]}
          title="Aucun site connecté"
          description="Ajoutez un site WordPress ou Next.js : c’est lui qui reçoit les pages générées. Rien ne peut être planifié ni publié avant."
          action={{ label: 'Connecter mon premier site', href: '/sites/new', icon: Plus }}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} facts={facts.get(site.id) ?? null} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

function SiteCard({ site, facts }: { site: SiteRow; facts: SiteFacts | null }) {
  const connector = connectorOf(site.type)
  const step = nextStep(site, facts)
  const described = site.type === 'nextjs' ? Boolean(site.repo_profile) : Boolean(site.has_schema)

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
          <IconBox icon={connector.icon} color={connector.color} boxSize={32} size={16} />
          <div style={{ minWidth: 0 }}>
            <div className="card-title truncate">{site.name}</div>
            <a
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="meta truncate"
              style={{ display: 'block', color: 'var(--ink-muted)' }}
            >
              {site.url}
            </a>
          </div>
        </div>
        <StatusBadge status={site.is_active ? 'active' : 'inactive'} />
      </div>

      <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)', flex: 1 }}>
        {!site.is_active && (
          <p className="meta" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', color: 'var(--status-warning-text)' }}>
            <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            Site désactivé : le planificateur l’ignore, rien n’y sera généré ni publié.
          </p>
        )}

        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <FactRow label="Connecteur" value={<span className="chip">{connector.label}</span>} />
          {site.type === 'wordpress' ? <WordPressFacts site={site} /> : <NextJsFacts site={site} />}
          <FactRow label="Pages connues" value={<KnownPages siteId={site.id} facts={facts} />} />
          <FactRow
            label="Google"
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <StatusBadge status={site.google_connected ? 'connected' : 'disconnected'} />
                {site.google_connected
                  ? <Link href={`/sites/${site.id}/google`} className="btn-link">Détail</Link>
                  : <Link href={`/api/google/auth?site_id=${site.id}`} className="btn-link">Connecter</Link>}
              </span>
            }
          />
        </div>

        <div className="inset" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          <Counter icon={Target} label="Campagnes" value={facts?.campaigns ?? null} />
          <Counter icon={FileText} label="Pages publiées" value={facts?.publishedPages ?? null} />
          <Counter icon={CalendarDays} label="Créneaux à venir" value={facts?.plannedSlots ?? null} />
        </div>

        {site.type === 'nextjs' && site.github_repo && (
          <AnalyzeRepoButton siteId={site.id} hasProfile={described} />
        )}
      </div>

      <div className="panel__footer">
        {step ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <span style={{ minWidth: 0 }}>
              <strong style={{ color: 'var(--ink-primary)', display: 'block' }}>À faire : {step.label}</strong>
              {step.why}
            </span>
            {step.href && (
              <Link href={step.href} className="btn-primary btn-sm" style={{ flexShrink: 0 }}>
                {step.label} <ArrowRight size={13} />
              </Link>
            )}
          </div>
        ) : (
          <span>
            {site.is_active
              ? 'Compteurs indisponibles : la suite du parcours ne peut pas être déduite pour ce site.'
              : 'Site désactivé : réactivez-le en base pour le remettre dans le parcours.'}
          </span>
        )}
      </div>
    </section>
  )
}

function WordPressFacts({ site }: { site: SiteRow }) {
  return (
    <>
      <FactRow label="Utilisateur" value={site.wp_username || <span className="meta">non renseigné</span>} />
      <FactRow
        label="Schéma CMS"
        // Never stored, always re-read live from the WordPress REST API: the
        // honest statement is whether it CAN be read, not whether it was.
        value={
          site.has_schema
            ? <Link href="/schema" className="btn-link">Lisible — ouvrir</Link>
            : <span className="badge badge-warning">Identifiants manquants</span>
        }
      />
    </>
  )
}

function NextJsFacts({ site }: { site: SiteRow }) {
  return (
    <>
      <FactRow
        label="Dépôt"
        value={site.github_repo ? <span className="chip">{site.github_repo}</span> : <span className="meta">à configurer</span>}
      />
      <FactRow
        label="Branche"
        value={
          site.github_branch
            ? <span className="chip">{site.github_branch}</span>
            : (
              <span className="badge badge-warning">
                <TriangleAlert size={11} /> Défaut — publie en production
              </span>
            )
        }
      />
      <FactRow
        label="Profil du dépôt"
        value={
          site.repo_profile
            ? <StatusBadge status="completed" label="Analysé" />
            : <span className="badge badge-warning">Jamais analysé</span>
        }
      />
    </>
  )
}

/**
 * Only the 'blind' labels are overridden.
 *
 * `STATUS_STYLES.blind` reads "Site jamais analysé", which is true of exactly
 * one of the three ways to be blind and false of the other two: a crawl that ran
 * and found nothing, and a crawl too old to describe today's site, both send the
 * operator to a completely different place. 'fresh' and 'stale' keep the shared
 * wording — a screen that renames every badge is a translation table growing
 * back.
 */
const BLIND_LABELS: Record<BlindReason, string> = {
  'jamais-analyse': 'Site jamais analysé',
  'aucune-page-trouvee': 'Analysé, aucune page trouvée',
  'crawl-trop-vieux': 'Inventaire trop ancien',
}

/** The sentence behind the badge — a greyed fact with no explanation is a dead end. */
function freshnessTitle(freshness: InventoryFreshness): string {
  const age = freshness.ageDays === null ? null : `analysé il y a ${freshness.ageDays} jour${freshness.ageDays > 1 ? 's' : ''}`

  switch (freshness.blindReason) {
    case 'jamais-analyse':
      return 'Aucune analyse enregistrée : le moteur ne sait rien de ce qui est déjà en ligne.'
    case 'aucune-page-trouvee':
      return 'Une analyse a bien tourné et n’a rapporté aucune page — sitemap injoignable, ou site rendu entièrement côté client.'
    case 'crawl-trop-vieux':
      return `${age ?? 'Analysé il y a longtemps'} : ces pages ne décrivent plus le site d’aujourd’hui.`
    default:
      return age ? `Inventaire ${age}.` : 'Inventaire à jour.'
  }
}

/**
 * What the engine knows of this site, and how to go and look at it.
 *
 * The link stays reachable in every case, including when the count could not be
 * read: /sites/[id]/existing says "never analysed" better than a card can, and
 * removing the only way in would make an unreadable counter look like a broken
 * site.
 */
function KnownPages({ siteId, facts }: { siteId: string; facts: SiteFacts | null }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
      {facts === null ? (
        <span className="meta">comptage indisponible</span>
      ) : (
        <>
          {/* No number at all rather than a 0 nobody measured. The badge beside
              it carries the reason, so the row still says something. */}
          {facts.crawledCount !== null && <span className="num">{formatMetric(facts.crawledCount, 'compact')}</span>}
          <span title={freshnessTitle(facts.freshness)}>
            <StatusBadge
              status={facts.freshness.state}
              label={facts.freshness.blindReason ? BLIND_LABELS[facts.freshness.blindReason] : undefined}
            />
          </span>
        </>
      )}
      <Link href={`/sites/${siteId}/existing`} className="btn-link">Voir</Link>
    </span>
  )
}

function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
      <span className="meta" style={{ flexShrink: 0 }}>{label}</span>
      <span className="truncate" style={{ fontSize: 'var(--fs-sm)', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function Counter({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | null }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        <Icon size={12} color="var(--ink-faint)" />
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--ink-primary)' }} className="num">
          {value === null ? '—' : formatMetric(value, 'compact')}
        </span>
      </div>
      <div className="meta">{label}</div>
    </div>
  )
}
