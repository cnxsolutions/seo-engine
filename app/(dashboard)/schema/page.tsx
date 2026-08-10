'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — WordPress schema
// ─────────────────────────────────────────────────────────────────────────────
//
// Reading a schema is a live call to the client's WordPress and nothing is
// persisted afterwards (see the note at the top of
// app/api/schema/extract/[siteId]/route.ts). Two consequences the page has to
// state rather than hide: the counter below only knows about this session, and
// leaving the page loses every summary shown here.

import { useEffect, useState } from 'react'
import { Database, Globe, CheckCircle, Loader2, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { EmptyState, PageHeader, StatTile } from '@/components/ui'

interface Site {
  id: string
  name: string
  url: string
  type: string
}

interface ExtractSummary {
  contentTypes: number
  fields: number
  taxonomies: number
  seoPlugin: string | null
}

export default function SchemaPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<Record<string, ExtractSummary>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        setSites(d.sites ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const extract = async (siteId: string) => {
    setExtracting(siteId)
    setErrors((prev) => ({ ...prev, [siteId]: '' }))

    try {
      const res = await fetch(`/api/schema/extract/${siteId}`, { method: 'POST' })
      const data = await res.json()

      if (res.ok) {
        setSummaries((prev) => ({ ...prev, [siteId]: data.summary }))
      } else {
        setErrors((prev) => ({ ...prev, [siteId]: data.error || 'Erreur extraction' }))
      }
    } catch {
      setErrors((prev) => ({ ...prev, [siteId]: 'Erreur réseau' }))
    } finally {
      setExtracting(null)
    }
  }

  const wordpressSites = sites.filter((s) => s.type === 'wordpress')
  const otherSites = sites.filter((s) => s.type !== 'wordpress')

  return (
    <div>
      <PageHeader
        icon={Database}
        badge="Étape 2"
        title="Schéma CMS"
        subtitle="Lisez la structure de vos sites WordPress (types de contenu, champs ACF, plugin SEO) pour cadrer la génération"
      />

      {/* Stats */}
      <div className="kpi-row" style={{ marginBottom: 'var(--space-3)' }}>
        <StatTile label="Sites" value={sites.length} icon={Globe} />
        <StatTile label="WordPress" value={wordpressSites.length} icon={Database} />
        <StatTile
          label="Lus dans cette session"
          value={Object.keys(summaries).length}
          icon={CheckCircle}
          hint="non persisté"
        />
      </div>

      <p className="meta" style={{ marginBottom: 'var(--space-6)' }}>
        Le schéma n&apos;est pas stocké : chaque lecture interroge l&apos;API REST du site. Ce compteur ne
        décrit donc que cette session, et non un état enregistré.
      </p>

      {wordpressSites.length > 0 && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <h2 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
            Sites WordPress ({wordpressSites.length})
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-3)' }}>
            {wordpressSites.map((site) => {
              const summary = summaries[site.id]
              const error = errors[site.id]

              return (
                <div key={site.id} className="card" style={summary ? { borderColor: 'var(--status-good)' } : undefined}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{site.name}</div>
                      <div className="meta truncate">{site.url}</div>
                    </div>
                    {/* Not a StatusBadge: nothing is "pending" here — the schema
                        has simply not been read yet, in this session. */}
                    <span className={summary ? 'badge badge-success' : 'badge badge-muted'}>
                      {summary ? 'Lu' : 'Non lu'}
                    </span>
                  </div>

                  {summary && (
                    <div className="meta" style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
                      <span><strong style={{ color: 'var(--ink-primary)' }}>{summary.contentTypes}</strong> types</span>
                      <span><strong style={{ color: 'var(--ink-primary)' }}>{summary.fields}</strong> champs</span>
                      <span><strong style={{ color: 'var(--ink-primary)' }}>{summary.taxonomies}</strong> taxonomies</span>
                      <span>SEO&nbsp;: {summary.seoPlugin ?? 'aucun plugin détecté'}</span>
                    </div>
                  )}

                  {error && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-1)',
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--status-critical-text)',
                        marginBottom: 'var(--space-3)',
                      }}
                    >
                      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      {error}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                    <button
                      onClick={() => extract(site.id)}
                      disabled={extracting === site.id}
                      className="btn-primary btn-sm"
                    >
                      {extracting === site.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      {summary ? 'Relire le schéma' : 'Lire le schéma'}
                    </button>

                    {/* "Ouvrir la fiche", not "Voir le détail": the detail page
                        no longer extracts on arrival, so the label must not
                        promise data that is not there yet. */}
                    <Link href={`/schema/${site.id}`} className="btn-ghost btn-sm">
                      <ExternalLink size={14} /> Ouvrir la fiche
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {otherSites.length > 0 && (
        <div>
          <h2 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
            Sans schéma lisible ({otherSites.length})
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-3)' }}>
            {otherSites.map((site) => (
              <div key={site.id} className="card">
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{site.name}</div>
                <div className="meta truncate" style={{ marginBottom: 'var(--space-3)' }}>{site.url}</div>
                <p className="meta">
                  Site {site.type}&nbsp;: la structure se lit dans le dépôt, pas via un CMS.
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
          <Loader2 size={22} className="animate-spin" color="var(--ink-faint)" />
        </div>
      )}

      {!loading && sites.length === 0 && (
        <EmptyState
          icon={Database}
          title="Aucun site"
          description="Ajoutez d'abord un site : le schéma se lit sur un WordPress connecté."
          action={{ label: 'Aller aux sites', href: '/sites' }}
        />
      )}
    </div>
  )
}
