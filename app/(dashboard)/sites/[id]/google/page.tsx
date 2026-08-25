// ─────────────────────────────────────────────────────────────────────────────
// Google connection — the state of the link, in plain sight
//
// The founder connected Google, waited, and saw nothing. Nothing in the product
// could tell him whether the synchronisation had run, found nothing, or failed:
// all three rendered as an empty chart. This page exists so the four possible
// situations look different from each other:
//
//   · Google not connected            → connect
//   · connected, no property chosen   → choose one, nothing can be read yet
//   · synchronised, zero row          → a fact about the site, not a bug
//   · synchronisation failed          → the error, and a way to retry
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { AlertTriangle, Clock, Database, Link2, RefreshCw, Search, Store } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  EmptyState,
  Notice,
  PageHeader,
  StatTile,
  UnknownValue,
  formatDayLong,
  formatMetric,
  type NoticeTone,
} from '@/components/ui'
import { getAuthenticatedClient } from '@/lib/google/client'
import { getGscCoverage } from '@/lib/google/performance'
import {
  GBP_QUOTA_MESSAGE,
  SYNC_STALE_AFTER_MS,
  getGoogleSyncState,
  probeGbpAccess,
  type GbpAccessProbe,
  type GoogleSyncState,
} from '@/lib/google/sync'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/** Google's own documentation for Business Profile quotas — it carries the request form. */
const GBP_QUOTA_DOC = 'https://developers.google.com/my-business/content/limits'

export default async function SiteGooglePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams

  const { data: site } = await createServiceClient()
    .from('sites')
    .select('id, name, url')
    .eq('id', id)
    .maybeSingle()

  if (!site) notFound()

  // Une lecture de plus ne doit JAMAIS blanchir une page qui fonctionne :
  // `readGbpPostStats` ne jette pas et rend `null` sur le moindre défaut — table
  // absente (migration 019 non appliquée), comptage refusé, réseau. Le panneau
  // écrit alors « comptage indisponible », ce qui est un fait, plutôt que zéro,
  // qui serait un mensonge.
  const [state, coverage, postStats] = await Promise.all([
    getGoogleSyncState(id),
    getGscCoverage(id),
    readGbpPostStats(id),
  ])

  if (!state.connected) {
    return (
      <div>
        <PageHeader
          icon={Link2}
          badge="GOOGLE"
          title={site.name}
          subtitle="Search Console et Business Profile pour ce site"
          backHref="/sites"
        />
        <EmptyState
          variant="not-connected"
          title="Google n'est pas connecté"
          description="Sans connexion Google, le moteur publie à l'aveugle : aucune impression, aucun clic, aucune position ne remonte. La connexion demande un compte ayant accès à la propriété Search Console de ce site."
          action={{ label: 'Connecter Google', href: `/api/google/auth?site_id=${id}` }}
        />
      </div>
    )
  }

  const gscStatus = readGscStatus(state.gsc.status, state.gsc.lastSyncAt)
  const actionNotice = buildActionNotice(query)
  const gbpProbe = await probeGbpWhenAmbiguous(id, state)

  return (
    <div>
      <PageHeader
        icon={Link2}
        badge="GOOGLE"
        title={site.name}
        subtitle={site.url}
        backHref="/sites"
        meta={
          <>
            <span>Compte&nbsp;: {state.email ?? 'inconnu'}</span>
            <span>{state.scopes.length} autorisation{state.scopes.length > 1 ? 's' : ''} accordée{state.scopes.length > 1 ? 's' : ''}</span>
            <Link href={`/sites/${id}/existing`} className="btn-link">Pages connues du site</Link>
          </>
        }
        secondaryAction={{ label: 'Changer de propriété', href: `/sites/${id}/google/select` }}
      />

      {actionNotice && <Notice tone={actionNotice.tone} title={actionNotice.title} body={actionNotice.body} />}

      {!state.historyAvailable && (
        <Notice
          tone="warning"
          title="Historique de synchronisation indisponible"
          body="La migration 013 n'a pas été appliquée : les synchronisations tournent, mais rien n'enregistre leur résultat. Jouez src/adapters/infrastructure/database/migrations/013_google_sync_observability.sql pour retrouver la date, le nombre de lignes et les erreurs."
        />
      )}

      <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Propriété Search Console"
          value={state.gscProperty ? 'Sélectionnée' : 'Aucune'}
          icon={Search}
          hint={state.gscProperty ?? 'Rien ne peut être lu tant qu’aucune propriété n’est choisie'}
          emphasis={!state.gscProperty}
        />
        <StatTile
          label="Dernière synchronisation"
          value={formatDateTime(state.gsc.lastSyncAt)}
          icon={Clock}
          hint={gscStatus.label}
        />
        <StatTile
          label="Lignes au dernier passage"
          value={state.gsc.rows ?? 0}
          format="compact"
          icon={RefreshCw}
          hint={
            state.gsc.rangeStart && state.gsc.rangeEnd
              ? `Période ${formatDayLong(state.gsc.rangeStart)} → ${formatDayLong(state.gsc.rangeEnd)}`
              : 'Aucune période enregistrée'
          }
        />
        <StatTile
          label="Lignes stockées"
          value={coverage.readable ? coverage.rowCount : '—'}
          format="compact"
          icon={Database}
          hint={
            !coverage.readable
              ? 'Table gsc_performance illisible'
              : coverage.firstDate && coverage.lastDate
                ? `Du ${formatDayLong(coverage.firstDate)} au ${formatDayLong(coverage.lastDate)}`
                : 'Aucune donnée conservée'
          }
        />
      </div>

      <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
        <section className="panel">
          <div className="panel__header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
              <Search size={15} color="var(--accent)" />
              <h2 className="card-title">Search Console</h2>
              <span className={`badge ${gscStatus.badge}`}>{gscStatus.label}</span>
            </div>
            <form action="/api/google/sync" method="POST">
              <input type="hidden" name="site_id" value={id} />
              <input type="hidden" name="scope" value="gsc" />
              <button type="submit" className="btn-secondary" disabled={!state.gscProperty}>
                <RefreshCw size={14} /> Synchroniser maintenant
              </button>
            </form>
          </div>

          <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {!state.gscProperty ? (
              <EmptyState
                bare
                variant="no-data"
                icon={Search}
                title="Aucune propriété sélectionnée"
                description="Le compte Google est bien relié, mais le moteur ignore quelle propriété interroger. Tant que ce choix n'est pas fait, aucune synchronisation n'est possible — ce n'est pas une panne."
                action={{ label: 'Choisir la propriété', href: `/sites/${id}/google/select` }}
              />
            ) : (
              <>
                <DetailRow label="Propriété" value={state.gscProperty} />
                <DetailRow
                  label="Période couverte au dernier passage"
                  value={
                    state.gsc.rangeStart && state.gsc.rangeEnd
                      ? `${formatDayLong(state.gsc.rangeStart)} → ${formatDayLong(state.gsc.rangeEnd)}`
                      : 'Aucune synchronisation enregistrée'
                  }
                />
                <DetailRow
                  label="Lignes récupérées"
                  value={`${formatMetric(state.gsc.rows ?? 0, 'number')} au dernier passage · ${
                    coverage.readable ? formatMetric(coverage.rowCount, 'number') : '?'
                  } conservées au total`}
                />

                {state.gsc.status === 'success' && (state.gsc.rows ?? 0) === 0 && (
                  <Notice
                    tone="warning"
                    title="Synchronisation réussie, aucune ligne"
                    body="Google a répondu correctement mais n'a renvoyé aucune impression sur la période. C'est le comportement attendu d'un site récent ou d'une propriété qui ne correspond pas aux URLs publiées — vérifiez que la propriété sélectionnée est bien celle du domaine ci-dessus."
                    inline
                  />
                )}

                {state.gsc.truncated && (
                  <Notice
                    tone="warning"
                    title="Lecture plafonnée"
                    body="Le nombre maximal de lignes a été atteint : Search Console détient davantage de données que ce qui est stocké. Les chiffres affichés sont un plancher, pas un total."
                    inline
                  />
                )}

                {state.gsc.error && (
                  <Notice tone="critical" title="Dernière synchronisation en échec" body={state.gsc.error} inline />
                )}
              </>
            )}
          </div>

          <div className="panel__footer">
            Synchronisation automatique&nbsp;: à la sélection de la propriété, puis chaque nuit à 4h. Les données Search
            Console sont publiées avec environ trois jours de décalage — la période lue s&apos;arrête donc avant aujourd&apos;hui.
          </div>
        </section>

        <GbpPanel
          siteId={id}
          status={state.gbp.status}
          lastSyncAt={state.gbp.lastSyncAt}
          error={state.gbp.error}
          located={Boolean(state.gbpLocationId)}
          liveProbe={gbpProbe}
          // Le CONTENU des autorisations, et non plus seulement leur nombre.
          // `business.manage` était déjà demandé au consentement mais n'était
          // confronté à rien : un compte relié sans lui lit la fiche et ne peut
          // pas y écrire, ce qui se manifestait par un 403 après coup, une fois
          // le post payé.
          canWrite={state.scopes.some((scope) => scope.includes('business.manage'))}
          posts={postStats}
        />
      </div>
    </div>
  )
}

// ─── Business Profile ────────────────────────────────────────────────────────

function GbpPanel({
  siteId,
  status,
  lastSyncAt,
  error,
  located,
  liveProbe,
  canWrite,
  posts,
}: {
  siteId: string
  status: string | null
  lastSyncAt: string | null
  error: string | null
  located: boolean
  liveProbe: GbpAccessProbe | null
  canWrite: boolean
  posts: GbpPostStats | null
}) {
  const quotaBlocked = status === 'quota_exhausted' || liveProbe?.status === 'quota_exhausted'
  const waiting = posts ? posts.pending + posts.uncertain : 0

  return (
    <section className="panel">
      <div className="panel__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
          <Store size={15} color="var(--ink-secondary)" />
          <h2 className="card-title">Business Profile</h2>
          <span className={`badge ${quotaBlocked ? 'badge-warning' : gbpBadge(status)}`}>
            {quotaBlocked ? 'Quota Google à zéro' : gbpLabel(status)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Link href={`/publish?site=${siteId}`} className="btn-secondary">Piloter les posts</Link>
          <form action="/api/google/sync" method="POST">
            <input type="hidden" name="site_id" value={siteId} />
            <input type="hidden" name="scope" value="gbp" />
            <button type="submit" className="btn-ghost" disabled={!located}>
              <RefreshCw size={14} /> Réessayer
            </button>
          </form>
        </div>
      </div>

      <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <DetailRow label="Dernière tentative" value={formatDateTime(lastSyncAt)} />

        {/* « Aucune fiche rattachée » et « aucun post publié » sont deux faits
            différents, et deux affichages différents. Un « 0 » sur une fiche
            absente ferait lire une absence de connexion comme une absence
            d'activité, et l'opérateur chercherait pourquoi le moteur ne publie
            pas là où il n'a jamais pu publier. */}
        <DetailRow
          label="Posts publiés par le moteur"
          value={
            !located
              ? <UnknownValue why="Aucune fiche d’établissement n’est rattachée à ce site." />
              : !posts
                ? <UnknownValue why="Le comptage des posts n’a pas pu être établi — la migration 019 n’est peut-être pas appliquée." />
                : posts.published === 0
                  ? 'Aucun'
                  : `${posts.published} — dernier le ${posts.lastPublishedAt ? formatDayLong(posts.lastPublishedAt) : 'date inconnue'}`
          }
        />

        {located && posts && (posts.published > 0 || waiting > 0 || posts.remoteKnown > 0) && (
          <div className="inset" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 1.55 }}>
            {posts.pending} en attente · {posts.remoteKnown} écrit{posts.remoteKnown > 1 ? 's' : ''} à la main
            {posts.remoteKnown > 1 ? ' connus' : ' connu'}. Les posts que le propriétaire a tapés lui-même entrent dans
            le même contrôle anti-duplication que les nôtres : le moteur ne redit pas ce qui vient d’être écrit.
          </div>
        )}

        {posts && posts.uncertain > 0 && (
          <Notice
            inline
            tone="warning"
            title={`${posts.uncertain} écriture${posts.uncertain > 1 ? 's' : ''} incertaine${posts.uncertain > 1 ? 's' : ''}`}
            body="Le moteur n’a pas su si Google avait enregistré ces posts. Rien n’est réécrit à l’aveugle : la prochaine tentative commence par relire la fiche."
            action={{ label: 'Voir la file', href: `/publish?site=${siteId}` }}
          />
        )}

        {/* Un refus AVANT tout appel réseau, plutôt qu'un 403 après coup — et
            après que la rédaction du post a été payée. */}
        {located && !canWrite && (
          <Notice
            inline
            tone="critical"
            title="Autorisation d’écriture absente"
            body="Le compte connecté n’a pas accordé l’autorisation de gérer la fiche : aucun post ne peut être publié. Reconnectez Google pour l’accorder."
            action={{ label: 'Reconnecter Google', href: `/api/google/auth?site_id=${siteId}` }}
          />
        )}

        {quotaBlocked ? (
          <div className="inset" style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <AlertTriangle size={15} color="var(--status-warning)" />
              <strong style={{ fontSize: 'var(--fs-sm)' }}>Quota Google à zéro — démarche administrative, pas un bug</strong>
            </div>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', margin: 0, lineHeight: 1.55 }}>
              {GBP_QUOTA_MESSAGE}
            </p>
            {/* Ce que le quota retient est un fait mesurable, pas une menace :
                aucun post n'est perdu, ils attendent. */}
            {waiting > 0 && (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', margin: 0, lineHeight: 1.55 }}>
                {waiting} post{waiting > 1 ? 's' : ''} attend{waiting > 1 ? 'ent' : ''} que ce quota soit débloqué.
                Aucun n&apos;est perdu.
              </p>
            )}
            <a href={GBP_QUOTA_DOC} target="_blank" rel="noreferrer" className="btn-secondary" style={{ justifySelf: 'start' }}>
              Documentation Google — quotas et formulaire de demande
            </a>
          </div>
        ) : liveProbe && !liveProbe.available ? (
          <Notice tone="warning" title="API Business Profile injoignable" body={liveProbe.message} inline />
        ) : !located ? (
          // PHRASE CORRIGÉE. Elle disait « rien n'en dépend pour générer ou
          // publier » : c'était vrai avant que le canal des posts n'existe, et
          // c'est faux depuis. Une phrase de l'interface qui devient fausse à
          // cause d'une fonctionnalité nouvelle se corrige dans le même lot —
          // sinon le produit se met à mentir sur lui-même.
          <p className="meta" style={{ margin: 0 }}>
            Aucune fiche d&apos;établissement rattachée à ce site. Sans fiche rattachée, les pages continuent d&apos;être
            générées et publiées normalement. En revanche, les posts de fiche en dépendent entièrement&nbsp;: ce canal
            reste inactif.
          </p>
        ) : error ? (
          <Notice tone="critical" title="Dernière synchronisation en échec" body={error} inline />
        ) : (
          <p className="meta" style={{ margin: 0 }}>
            Fiche d&apos;établissement synchronisée&nbsp;: avis, horaires, catégories et photos alimentent le contexte local des
            pages générées.
          </p>
        )}
      </div>

      <div className="panel__footer">
        Business Profile reste facultatif pour les pages du site&nbsp;: Search Console, la génération et la publication
        fonctionnent sans lui. Les posts de fiche, eux, ne peuvent pas exister sans lui.
      </div>
    </section>
  )
}

// ─── Les posts de fiche, comptés ─────────────────────────────────────────────

/**
 * Ce que le moteur a écrit sur cette fiche, et ce qui attend.
 *
 * Chaque nombre vient d'un comptage `head: true` : PostgREST plafonne un select
 * ordinaire à mille lignes et ne dit rien du reste, alors qu'un comptage exact
 * ne transfère aucune ligne et ne peut pas se tromper.
 */
interface GbpPostStats {
  /** Posts du MOTEUR réellement en ligne. Les posts 'remote' sont comptés à part. */
  published: number
  lastPublishedAt: string | null
  /** Écrits, pas encore partis. */
  pending: number
  /** Ni partis ni refusés : le doute d'écriture, le seul état qui demande un humain. */
  uncertain: number
  /** Posts que le propriétaire a tapés lui-même, connus du corpus anti-duplication. */
  remoteKnown: number
}

const PENDING_STATUSES = ['pending', 'generating', 'generated', 'publishing']

/**
 * Ne jette jamais, ne blanchit jamais la page.
 *
 * `null` veut dire « nous n'avons pas pu compter », et l'appelant l'écrit tel
 * quel. C'est le cas normal tant que la migration 019 n'est pas appliquée : la
 * table n'existe pas, et le reste de cet écran — Search Console, la connexion,
 * la fiche — n'en dépend en rien.
 *
 * OÙ CETTE LECTURE DEVRAIT VIVRE : lib/gbp/posts, aux côtés de la politique.
 * Elle est écrite ici parce que ce module n'expose aujourd'hui aucun compteur et
 * qu'il n'appartient pas à ce lot. Elle ne décide RIEN — cinq nombres, aucune
 * règle — donc la faire remonter plus tard ne déplacera aucune politique.
 */
async function readGbpPostStats(siteId: string): Promise<GbpPostStats | null> {
  try {
    const supabase = createServiceClient()
    const base = () => supabase.from('gbp_posts').select('id', { count: 'exact', head: true }).eq('site_id', siteId)

    const [published, pending, uncertain, remote, last] = await Promise.all([
      base().eq('source', 'engine').eq('status', 'published'),
      base().eq('source', 'engine').in('status', PENDING_STATUSES),
      base().eq('status', 'incertain'),
      base().eq('source', 'remote'),
      supabase
        .from('gbp_posts')
        .select('published_at')
        .eq('site_id', siteId)
        .eq('source', 'engine')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // UN seul comptage en échec suffit à rendre `null` : une ligne où trois
    // nombres sur cinq sont justes et les deux autres à zéro se lit comme cinq
    // faits mesurés.
    for (const result of [published, pending, uncertain, remote]) {
      if (result.error) throw new Error(result.error.message)
    }

    return {
      published: published.count ?? 0,
      pending: pending.count ?? 0,
      uncertain: uncertain.count ?? 0,
      remoteKnown: remote.count ?? 0,
      // Une date manquante ne rend pas les quatre comptages faux : elle est
      // rendue nulle, et la ligne dit « date inconnue » sans effacer le nombre.
      lastPublishedAt: (last.data?.published_at as string | null | undefined) ?? null,
    }
  } catch (err) {
    console.error('[WARN] [google-status] Comptage des posts de fiche impossible', {
      siteId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ─── Presentational helpers ──────────────────────────────────────────────────

/**
 * `value` est un ReactNode et non une chaîne : la ligne « Posts publiés par le
 * moteur » rend `<UnknownValue/>` quand aucune fiche n'est rattachée, et une
 * prop `string` la refuserait à la compilation. Composant local à cette page,
 * sans autre appelant — l'élargissement est sans risque. (Le `DetailRow`
 * homonyme de /calendar accepte déjà ReactNode ; ce sont deux composants
 * différents du même nom.)
 */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span className="meta" style={{ flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

// The `Notice` this page used to declare is gone; it imports the shared one from
// components/ui, which was written from this very copy and keeps both props this
// page relies on (`inline`, and the four tones it uses). The shared `NoticeTone`
// carries one member more — 'serious' — which nothing here emits.

// ─── State reading ───────────────────────────────────────────────────────────

/**
 * Asks Google whether the Business Profile APIs answer — but only in the one
 * situation where the stored state cannot say.
 *
 * A site with no location selected and no sync ever attempted looks identical
 * whether the account owns no business listing or whether every listing call
 * came back 429. Those two need opposite reactions, so the ambiguity is worth
 * one HTTP call on a page nobody loads in a loop. Every other case is answered
 * from the database, at zero cost.
 */
async function probeGbpWhenAmbiguous(siteId: string, state: GoogleSyncState): Promise<GbpAccessProbe | null> {
  const ambiguous =
    state.gbp.status === null &&
    !state.gbpLocationId &&
    state.scopes.some((scope) => scope.includes('business.manage'))

  if (!ambiguous) return null

  try {
    const { fetch: googleFetch } = await getAuthenticatedClient(siteId)
    return await probeGbpAccess(googleFetch)
  } catch (err) {
    console.error('[WARN] [google-status] Sonde Business Profile impossible', {
      siteId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * A `running` row older than the staleness bound was left behind by a process
 * that died mid-sync. Reporting it as "en cours" forever would recreate exactly
 * the ambiguity this page removes.
 */
function readGscStatus(status: string | null, lastSyncAt: string | null): { label: string; badge: string } {
  if (status === 'running') {
    const startedAt = lastSyncAt ? Date.parse(lastSyncAt) : NaN
    const stale = Number.isFinite(startedAt) && Date.now() - startedAt > SYNC_STALE_AFTER_MS
    return stale
      ? { label: 'Interrompue', badge: 'badge-danger' }
      : { label: 'En cours — rechargez dans quelques secondes', badge: 'badge-info' }
  }

  if (status === 'success') return { label: 'À jour', badge: 'badge-success' }
  if (status === 'failed') return { label: 'En échec', badge: 'badge-danger' }
  if (status === 'skipped') return { label: 'Rien à lire', badge: 'badge-muted' }
  return { label: 'Jamais synchronisée', badge: 'badge-warning' }
}

function gbpBadge(status: string | null): string {
  if (status === 'success') return 'badge-success'
  if (status === 'quota_exhausted') return 'badge-warning'
  if (status === 'failed') return 'badge-danger'
  return 'badge-muted'
}

function gbpLabel(status: string | null): string {
  if (status === 'success') return 'À jour'
  if (status === 'quota_exhausted') return 'Quota Google à zéro'
  if (status === 'failed') return 'En échec'
  if (status === 'skipped') return 'Non configuré'
  return 'Jamais tentée'
}

/** Feedback for the redirect that follows a manual action. */
function buildActionNotice(
  query: Record<string, string | string[] | undefined>
): { tone: NoticeTone; title: string; body: string } | null {
  const first = (key: string): string | null => {
    const value = query[key]
    return Array.isArray(value) ? value[0] ?? null : value ?? null
  }

  const gsc = first('gsc')
  const gbp = first('gbp')
  const error = first('error')

  if (gsc === 'success') {
    const rows = Number(first('rows') ?? 0)
    return {
      tone: rows > 0 ? 'good' : 'warning',
      title: rows > 0 ? 'Synchronisation terminée' : 'Synchronisation terminée sans aucune ligne',
      body: rows > 0
        ? `${formatMetric(rows, 'number')} lignes récupérées depuis Search Console.`
        : "Google a répondu sans erreur mais n'a renvoyé aucune donnée sur la période.",
    }
  }
  if (gsc === 'failed') {
    return { tone: 'critical', title: 'Synchronisation en échec', body: error ?? 'Erreur inconnue.' }
  }
  if (gsc === 'skipped') {
    return { tone: 'warning', title: 'Rien à synchroniser', body: 'Aucune propriété Search Console n’est sélectionnée pour ce site.' }
  }
  if (gbp === 'quota_exhausted') {
    return { tone: 'warning', title: 'Business Profile indisponible', body: GBP_QUOTA_MESSAGE }
  }
  if (gbp === 'success') {
    return { tone: 'good', title: 'Fiche établissement à jour', body: 'Les avis, horaires et catégories ont été rafraîchis.' }
  }
  if (error) {
    return { tone: 'critical', title: 'Action impossible', body: error }
  }
  if (first('selected')) {
    return {
      tone: 'info',
      title: 'Sélection enregistrée',
      body: 'La première synchronisation Search Console a été lancée en arrière-plan. Rechargez la page dans quelques secondes pour voir les lignes arriver.',
    }
  }
  return null
}

// ─── Dates ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Jamais'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Jamais'
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} à ${pad(date.getHours())}h${pad(date.getMinutes())}`
}

// The local `formatDay` that rendered `jj/mm/aaaa` is gone. Its four call sites
// now use the shared `formatDayLong` and NOT the shared `formatDay`: every one of
// them prints the two ends of a Search Console window, and Search Console serves
// sixteen months of history — a range whose endpoints wear no year can read
// backwards. The year was in the string this page used to build; it stays in it.

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
