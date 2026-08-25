// ─────────────────────────────────────────────────────────────────────────────
// Choosing what to read from Google
//
// This is the step that makes synchronisation possible at all: a valid OAuth
// token says WHO we are, not WHICH property to query. Submitting this form
// therefore does two things — it records the choice, and it fires the first
// Search Console read (see app/api/google/select/route.ts).
//
// The Business Profile half is allowed to be unavailable. On a recent Google
// Cloud project those APIs start with a quota of zero and answer 429 to every
// call; the page says so, in words, instead of showing an empty list that reads
// as "you own no business listing".
// ─────────────────────────────────────────────────────────────────────────────

import { AlertTriangle, Search, Store } from 'lucide-react'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { EmptyState, PageHeader } from '@/components/ui'
import { getAuthenticatedClient, getGoogleConnection } from '@/lib/google/client'
import { listAllLocations, type GbpAccount, type GbpLocation } from '@/lib/google/gbp'
import { listProperties, type GscProperty } from '@/lib/google/gsc'
import { GBP_QUOTA_MESSAGE, probeGbpAccess } from '@/lib/google/sync'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const GBP_QUOTA_DOC = 'https://developers.google.com/my-business/content/limits'

export default async function GoogleSelectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: site } = await createServiceClient().from('sites').select('id, name, url').eq('id', id).maybeSingle()
  if (!site) redirect('/sites')

  const connection = await getGoogleConnection(id)
  // Reaching this page without a connection means the OAuth round-trip failed
  // silently; the status page is where that gets explained.
  if (!connection) redirect(`/sites/${id}/google`)

  // A refresh token Google has revoked makes this throw. Rendering a 500 there
  // would tell the operator nothing; the status page names the problem.
  const client = await loadGoogleClient(id)
  if (!client) {
    redirect(
      `/sites/${id}/google?error=${encodeURIComponent(
        'Jeton Google refusé — reconnectez le compte Google de ce site.'
      )}`
    )
  }
  const googleFetch = client.fetch

  // Search Console first, and on its own: it is the half the product actually
  // depends on, and it must not be delayed or hidden by a Business Profile
  // failure that has nothing to do with it.
  const gscProperties = await safeList(() => listProperties(googleFetch))

  // Probing without the scope would report a 403 as if the API were down, when
  // the real answer is "this connection never asked for Business Profile".
  const hasGbpScope = (connection.scopes ?? []).some((scope) => scope.includes('business.manage'))
  const gbpProbe = hasGbpScope ? await probeGbpAccess(googleFetch) : null
  const gbpLocations = gbpProbe?.available ? await safeList(() => listAllLocations(googleFetch)) : []

  // Pre-checking the obvious answer removes the one click that stands between a
  // fresh connection and its first data. Computed once so two matching
  // properties cannot both come back checked.
  const preselectedGsc =
    connection.gsc_site_url ??
    gscProperties.find((property) => matchesSite(property.siteUrl, site.url))?.siteUrl ??
    (gscProperties.length === 1 ? gscProperties[0].siteUrl : null)

  return (
    <div>
      <PageHeader
        icon={Search}
        badge="GOOGLE"
        title="Choisir les ressources à lire"
        subtitle={`Ce que le moteur interrogera pour ${site.name}`}
        backHref={`/sites/${id}/google`}
      />

      <form action="/api/google/select" method="POST" style={{ display: 'grid', gap: 'var(--space-5)' }}>
        <input type="hidden" name="site_id" value={id} />

        <section className="panel">
          <div className="panel__header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Search size={15} color="var(--accent)" />
              <h2 className="card-title">Search Console</h2>
              <span className="badge badge-info">Requis</span>
            </div>
          </div>

          <div className="panel__body">
            {gscProperties.length === 0 ? (
              <EmptyState
                bare
                variant="no-results"
                title="Aucune propriété Search Console"
                description="Le compte Google connecté n'est propriétaire ou utilisateur d'aucune propriété. Vérifiez dans Search Console que ce compte a bien accès au domaine, puis reconnectez-le."
                action={{ label: 'Reconnecter Google', href: `/api/google/auth?site_id=${id}` }}
              />
            ) : (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {gscProperties.map((property: GscProperty) => (
                  <RadioRow
                    key={property.siteUrl}
                    name="gsc_site"
                    value={property.siteUrl}
                    defaultChecked={property.siteUrl === preselectedGsc}
                    title={property.siteUrl}
                    detail={`Accès ${property.permissionLevel}`}
                    recommended={matchesSite(property.siteUrl, site.url)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="panel__footer">
            La synchronisation démarre dès l&apos;enregistrement&nbsp;: les 90 derniers jours d&apos;impressions, de clics et de
            positions sont récupérés en arrière-plan, sans bloquer cette page.
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Store size={15} color="var(--ink-secondary)" />
              <h2 className="card-title">Business Profile</h2>
              <span className="badge badge-muted">Facultatif</span>
            </div>
          </div>

          <div className="panel__body">
            {!hasGbpScope ? (
              <p className="meta" style={{ margin: 0 }}>
                Cette connexion Google n&apos;a pas demandé l&apos;autorisation Business Profile. Reconnectez le compte si vous
                souhaitez rattacher une fiche d&apos;établissement à ce site.
              </p>
            ) : gbpProbe && !gbpProbe.available ? (
              <div className="inset" style={{ display: 'grid', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <AlertTriangle size={15} color="var(--status-warning)" />
                  <strong style={{ fontSize: 'var(--fs-sm)' }}>
                    {gbpProbe.status === 'quota_exhausted'
                      ? 'Quota Google à zéro — démarche administrative, pas un bug'
                      : 'Business Profile injoignable'}
                  </strong>
                </div>
                <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', margin: 0, lineHeight: 1.55 }}>
                  {gbpProbe.status === 'quota_exhausted' ? GBP_QUOTA_MESSAGE : gbpProbe.message}
                </p>
                {gbpProbe.status === 'quota_exhausted' && (
                  <a href={GBP_QUOTA_DOC} target="_blank" rel="noreferrer" className="btn-secondary" style={{ justifySelf: 'start' }}>
                    Documentation Google — quotas et formulaire de demande
                  </a>
                )}
              </div>
            ) : gbpLocations.length === 0 ? (
              <p className="meta" style={{ margin: 0 }}>
                Aucune fiche d&apos;établissement trouvée sur ce compte. Vous devez en être propriétaire ou administrateur dans
                Google Business Profile Manager. Ce site peut fonctionner sans.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {gbpLocations.map(({ account, location }: { account: GbpAccount; location: GbpLocation }) => {
                  const locationId = location.name.split('/')[3]
                  const accountId = account.name.split('/')[1]
                  return (
                    <RadioRow
                      key={location.name}
                      name="gbp_location"
                      value={locationId}
                      defaultChecked={connection.gbp_location_id === locationId}
                      title={location.title}
                      detail={[location.websiteUri, `via ${account.accountName}`].filter(Boolean).join(' · ')}
                    >
                      <input type="hidden" name={`gbp_account_${locationId}`} value={accountId} />
                    </RadioRow>
                  )
                })}
              </div>
            )}
          </div>

          <div className="panel__footer">
            La fiche d&apos;établissement enrichit le contexte local des pages générées (avis, horaires, catégories). Rien
            n&apos;en dépend pour générer ni pour publier.
          </div>
        </section>

        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn-primary">Enregistrer et synchroniser</button>
        </div>
      </form>
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function RadioRow({
  name,
  value,
  title,
  detail,
  defaultChecked,
  recommended,
  children,
}: {
  name: string
  value: string
  title: string
  detail?: string
  defaultChecked?: boolean
  recommended?: boolean
  children?: ReactNode
}) {
  return (
    <label
      className="card card--interactive"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-4)' }}
    >
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} style={{ marginTop: 3 }} />
      {children}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 'var(--fs-sm)', wordBreak: 'break-word' }}>{title}</strong>
          {recommended && <span className="badge badge-success">Correspond au domaine</span>}
        </span>
        {detail && <span className="meta" style={{ display: 'block', marginTop: 2 }}>{detail}</span>}
      </span>
    </label>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadGoogleClient(siteId: string) {
  try {
    return await getAuthenticatedClient(siteId)
  } catch (err) {
    console.error('[ERROR] [google-select] Jeton Google inutilisable', {
      siteId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * A listing failure must not take the whole page down: the other half of the
 * form is still usable, and an empty list already has a dedicated message.
 */
async function safeList<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read()
  } catch (err) {
    console.error('[WARN] [google-select] Listing Google impossible', err instanceof Error ? err.message : err)
    return []
  }
}

/** Highlights the property that matches the site's own domain — the usual right answer. */
function matchesSite(propertyUrl: string, siteUrl: string): boolean {
  const host = (value: string) =>
    value
      .replace(/^sc-domain:/, '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
      .toLowerCase()

  return host(propertyUrl) === host(siteUrl)
}
