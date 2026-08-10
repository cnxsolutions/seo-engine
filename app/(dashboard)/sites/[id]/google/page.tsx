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

import { AlertTriangle, CheckCircle2, Clock, Database, Link2, RefreshCw, Search, Store } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState, PageHeader, StatTile, formatMetric } from '@/components/ui'
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

  const [state, coverage] = await Promise.all([getGoogleSyncState(id), getGscCoverage(id)])

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
              ? `Période ${formatDay(state.gsc.rangeStart)} → ${formatDay(state.gsc.rangeEnd)}`
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
                ? `Du ${formatDay(coverage.firstDate)} au ${formatDay(coverage.lastDate)}`
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
                      ? `${formatDay(state.gsc.rangeStart)} → ${formatDay(state.gsc.rangeEnd)}`
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
}: {
  siteId: string
  status: string | null
  lastSyncAt: string | null
  error: string | null
  located: boolean
  liveProbe: GbpAccessProbe | null
}) {
  const quotaBlocked = status === 'quota_exhausted' || liveProbe?.status === 'quota_exhausted'

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
        <form action="/api/google/sync" method="POST">
          <input type="hidden" name="site_id" value={siteId} />
          <input type="hidden" name="scope" value="gbp" />
          <button type="submit" className="btn-ghost" disabled={!located}>
            <RefreshCw size={14} /> Réessayer
          </button>
        </form>
      </div>

      <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <DetailRow label="Dernière tentative" value={formatDateTime(lastSyncAt)} />

        {quotaBlocked ? (
          <div className="inset" style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <AlertTriangle size={15} color="var(--status-warning)" />
              <strong style={{ fontSize: 'var(--fs-sm)' }}>Quota Google à zéro — démarche administrative, pas un bug</strong>
            </div>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', margin: 0, lineHeight: 1.55 }}>
              {GBP_QUOTA_MESSAGE}
            </p>
            <a href={GBP_QUOTA_DOC} target="_blank" rel="noreferrer" className="btn-secondary" style={{ justifySelf: 'start' }}>
              Documentation Google — quotas et formulaire de demande
            </a>
          </div>
        ) : liveProbe && !liveProbe.available ? (
          <Notice tone="warning" title="API Business Profile injoignable" body={liveProbe.message} inline />
        ) : !located ? (
          <p className="meta" style={{ margin: 0 }}>
            Aucune fiche d&apos;établissement rattachée à ce site. La fiche est facultative&nbsp;: elle enrichit le contexte local
            (avis, horaires, catégories) mais rien n&apos;en dépend pour générer ou publier.
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
        Business Profile est optionnel. Search Console, la génération et la publication fonctionnent sans lui.
      </div>
    </section>
  )
}

// ─── Presentational helpers ──────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span className="meta" style={{ flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

type NoticeTone = 'good' | 'warning' | 'critical' | 'info'

function Notice({ tone, title, body, inline }: { tone: NoticeTone; title: string; body: string; inline?: boolean }) {
  const color =
    tone === 'critical' ? 'var(--status-critical)'
      : tone === 'warning' ? 'var(--status-warning)'
        : tone === 'good' ? 'var(--status-good)'
          : 'var(--accent)'

  const Icon = tone === 'good' ? CheckCircle2 : AlertTriangle

  return (
    <div
      className={inline ? 'inset' : 'glass-card'}
      style={{
        borderLeft: `3px solid ${color}`,
        marginBottom: inline ? 0 : 'var(--space-5)',
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
      }}
    >
      <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: 'var(--fs-sm)' }}>{title}</strong>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', margin: '0.25rem 0 0', lineHeight: 1.55 }}>{body}</p>
      </div>
    </div>
  )
}

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

function formatDay(day: string): string {
  const [year, month, date] = day.split('-')
  return date && month && year ? `${date}/${month}/${year}` : day
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
