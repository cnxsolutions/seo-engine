'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — WordPress schema, per site
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS PAGE NO LONGER READS ON ARRIVAL
//
// `GET /api/schema/extract/[siteId]` is not a database read. It authenticates
// against the client's WordPress, enumerates every registered content type, then
// pulls the fields and ACF groups of each one — several round-trips to a remote
// site, and nothing about it is cached (see the note at the top of that route).
// Opening this page therefore hit the client's production server, and coming
// here from the list right after pressing "Lire le schéma" did the whole thing
// twice for the same result.
//
// The extraction now happens when, and only when, the operator asks for it. The
// site identity below comes from our own `sites` table, so the page still knows
// what it is about before anything touches the network.

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  RefreshCw,
  Search,
  Copy,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Database,
  ArrowLeft,
} from 'lucide-react'
import { ContentTypeCard, SchemaField, SeoConfigBadge } from '@/components/ui'

// Miroir du DTO renvoyé par GET /api/schema/extract/[siteId]
interface FieldDto {
  key: string
  label: string
  type: string
  required: boolean
  description?: string
  options?: string[]
  isAcf: boolean
}

interface ContentTypeDto {
  key: string
  label: string
  fieldCount: number
  requiredCount: number
  fields: FieldDto[]
  taxonomies: Array<{ key: string; label: string; hierarchical: boolean }>
}

interface SchemaDto {
  name: string
  label: string
  extractedAt: string
  seoPlugin: string | null
  schemaTypes: string[]
  seoFields: string[]
  contentTypes: ContentTypeDto[]
}

interface SiteDto {
  id: string
  name: string
  url: string
  type?: string
  /** The last schema read from this site, kept since migration 017. */
  cms_schema?: SchemaDto | null
  cms_schema_read_at?: string | null
}

export default function SchemaViewPage() {
  const params = useParams()
  const siteId = params.siteId as string

  const [site, setSite] = useState<SiteDto | null>(null)
  const [schema, setSchema] = useState<SchemaDto | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Local read: our own `sites` row, so the header is filled without ever
  // contacting the client's WordPress.
  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d: { sites?: SiteDto[] }) => {
        const found = (d.sites ?? []).find((s) => s.id === siteId) ?? null
        setSite(found)
        // The last read, from our own table. The screen used to start empty and
        // ask for a fresh extraction every single time — several authenticated
        // round-trips to the client's production site for an answer we already
        // had. "Relire" stays one click away when it really has changed.
        if (found?.cms_schema) setSchema(found.cms_schema)
      })
      .catch(() => null)
  }, [siteId])

  const read = useCallback(async () => {
    setReading(true)
    setError(null)

    try {
      const res = await fetch(`/api/schema/extract/${siteId}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Extraction impossible')
      } else {
        if (data.site) setSite(data.site)
        setSchema(data.schema)
      }
    } catch {
      setError('Erreur réseau')
    } finally {
      setReading(false)
    }
  }, [siteId])

  const toggleExpanded = (key: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const copyFieldKey = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopiedField(key)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const filteredContentTypes = schema?.contentTypes.filter((ct) => {
    const query = searchQuery.toLowerCase()
    // Every field is treated as possibly absent.
    //
    // `ct.label.toLowerCase()` threw on the first real WordPress site connected:
    // the extractor read `label` from an endpoint that only sends `name`, so the
    // label was undefined on all fifteen content types and the whole screen came
    // down with a client-side exception. The extractor is fixed; this makes the
    // screen survive the next field a CMS decides not to send.
    const text = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '')
    const fields = ct.fields ?? []

    const matchesSearch =
      !query ||
      text(ct.key).includes(query) ||
      text(ct.label).includes(query) ||
      fields.some((f) => text(f.key).includes(query) || text(f.label).includes(query))

    const matchesFilter =
      filterType === 'all' ||
      (filterType === 'with-required' && (ct.requiredCount ?? 0) > 0) ||
      (filterType === 'with-tax' && (ct.taxonomies ?? []).length > 0) ||
      (filterType === 'with-acf' && fields.some((f) => f.isAcf))

    return matchesSearch && matchesFilter
  }) || []

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '2rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <Link
            href="/schema"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              textDecoration: 'none',
              marginBottom: '0.5rem',
            }}
          >
            <ArrowLeft size={13} />
            Schéma CMS
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span className="eyebrow" style={{ color: 'var(--accent-text)' }}>WordPress</span>
          </div>
          <h1 className="section-title">{site?.name ?? schema?.name ?? 'Site'}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            {site && (
              <a
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                }}
              >
                {site.url}
                <ExternalLink size={14} />
              </a>
            )}
            {schema && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Lu le {new Date(schema.extractedAt).toLocaleString('fr-FR')}
              </span>
            )}
          </div>
        </div>

        {schema && (
          <button className="btn-ghost" onClick={read} disabled={reading}>
            <RefreshCw size={16} className={reading ? 'animate-spin' : undefined} />
            Relire le schéma
          </button>
        )}
      </div>

      {/* Nothing read yet: the extraction is a live call to the client's site,
          so it waits for an explicit order. */}
      {!schema && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          {error ? (
            <AlertTriangle size={40} style={{ color: 'var(--status-critical-text)', margin: '0 auto 1rem' }} />
          ) : (
            <Database size={40} style={{ color: 'var(--ink-faint)', margin: '0 auto 1rem' }} />
          )}

          <h2 style={{ fontWeight: 650, marginBottom: 'var(--space-2)' }}>
            {error ? 'Schéma indisponible' : 'Schéma non lu'}
          </h2>

          <p
            style={{
              color: error ? 'var(--status-critical-text)' : 'var(--ink-muted)',
              fontSize: 'var(--fs-sm)',
              maxWidth: 520,
              margin: '0 auto var(--space-5)',
              lineHeight: 'var(--lh-normal)',
            }}
          >
            {error ??
              "La lecture interroge directement l'API REST de ce WordPress — types de contenu, champs, groupes ACF, plugin SEO. Rien n'est mis en cache : chaque lecture est un aller-retour vers le site."}
          </p>

          <button className="btn-primary" onClick={read} disabled={reading}>
            {reading ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
            {reading ? 'Lecture en cours…' : error ? 'Réessayer' : 'Lire le schéma'}
          </button>
        </div>
      )}

      {schema && (
        <>
          {/* SEO Config */}
          <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  Configuration SEO
                </h3>
                <SeoConfigBadge plugin={schema.seoPlugin ?? undefined} schemaTypes={schema.schemaTypes} />
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {schema.contentTypes.length}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Types</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {schema.contentTypes.reduce((sum, ct) => sum + ct.fieldCount, 0)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Champs</div>
                </div>
                {/* "Requis" is a property of a field, not an alarm: a reserved
                    status hue here would read as "something is wrong". */}
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--ink-primary)' }}>
                    {schema.contentTypes.reduce((sum, ct) => sum + ct.requiredCount, 0)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Requis</div>
                </div>
              </div>
            </div>
          </div>

          {/* Search & Filter */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 250, position: 'relative' }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un type ou un champ..."
                className="input"
                style={{ paddingLeft: '2.5rem' }}
              />
            </div>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input"
              style={{ width: 'auto', minWidth: 180 }}
            >
              <option value="all">Tous les types</option>
              <option value="with-required">Avec champs requis</option>
              <option value="with-tax">Avec taxonomies</option>
              <option value="with-acf">Avec ACF</option>
            </select>
          </div>

          {/* Content Types */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredContentTypes.length > 0 ? (
              filteredContentTypes.map((contentType) => (
                <ContentTypeCard
                  key={contentType.key}
                  name={contentType.key}
                  label={contentType.label}
                  fieldCount={contentType.fieldCount}
                  requiredCount={contentType.requiredCount}
                  isExpanded={expandedTypes.has(contentType.key)}
                  onToggle={() => toggleExpanded(contentType.key)}
                >
                  {/* Taxonomies */}
                  {contentType.taxonomies.length > 0 && (
                    <div
                      style={{
                        marginBottom: '1rem',
                        padding: '0.75rem',
                        background: 'var(--bg-secondary)',
                        borderRadius: 8,
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          marginBottom: '0.5rem',
                        }}
                      >
                        Taxonomies
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {contentType.taxonomies.map((tax) => (
                          <span key={tax.key} className="chip">{tax.label}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fields */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {contentType.fields.map((field) => (
                      <SchemaField
                        key={field.key}
                        name={field.key}
                        type={field.type}
                        required={field.required}
                        description={field.description}
                      >
                        {field.isAcf && (
                          <span className="badge badge-info" style={{ marginLeft: 'var(--space-2)' }}>ACF</span>
                        )}

                        <button
                          onClick={() => copyFieldKey(field.key)}
                          style={{
                            marginLeft: 'auto',
                            background: 'transparent',
                            border: 'none',
                            color: copiedField === field.key ? 'var(--status-good-text)' : 'var(--ink-muted)',
                            cursor: 'pointer',
                            padding: '0.25rem',
                            fontSize: '0.7rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          {copiedField === field.key ? (
                            <>
                              <CheckCircle size={12} />
                              Copié
                            </>
                          ) : (
                            <>
                              <Copy size={12} />
                              Copier
                            </>
                          )}
                        </button>

                        {field.options && field.options.length > 0 && (
                          <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            Options: {field.options.join(', ')}
                          </div>
                        )}
                      </SchemaField>
                    ))}
                  </div>
                </ContentTypeCard>
              ))
            ) : (
              <div
                style={{
                  textAlign: 'center',
                  padding: '3rem 2rem',
                  background: 'var(--bg-card)',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                }}
              >
                <Search size={32} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
                <p style={{ color: 'var(--text-muted)' }}>Aucun type de contenu ne correspond à votre recherche.</p>
              </div>
            )}
          </div>

          {/* SEO Fields Reference */}
          {schema.seoFields.length > 0 && (
            <div className="glass-card" style={{ padding: '1.25rem', marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
                Champs SEO disponibles
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {schema.seoFields.map((fieldKey) => (
                  <div
                    key={fieldKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0.5rem 0.75rem',
                      background: 'var(--bg-secondary)',
                      borderRadius: 6,
                    }}
                  >
                    <code style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>{fieldKey}</code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
