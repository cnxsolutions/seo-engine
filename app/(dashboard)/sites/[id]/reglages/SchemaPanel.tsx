'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Schéma CMS d'un site WordPress — section de l'onglet Réglages
// ─────────────────────────────────────────────────────────────────────────────
//
// Elle était la page /schema/[siteId] (qui redirige désormais vers les réglages
// du site). Le nom et l'adresse du site sont dans l'en-tête du layout : la
// section ne garde que ce qui lui est propre — le schéma lu, et l'ordre de le
// relire.
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
// last schema read comes from our own `sites` table, so the section shows it
// before anything touches the network.

import { useCallback, useEffect, useState } from 'react'
import {
  RefreshCw,
  Search,
  Copy,
  CheckCircle,
  AlertTriangle,
  Database,
} from 'lucide-react'
import { ContentTypeCard, SchemaField, SeoConfigBadge } from '@/components/ui'
import '../../sites.css'

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
  /** The last schema read from this site, kept since migration 017. */
  cms_schema?: SchemaDto | null
}

export function SchemaPanel({ siteId }: { siteId: string }) {
  const [schema, setSchema] = useState<SchemaDto | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null)

  // Local read: our own `sites` row, without ever contacting the client's
  // WordPress.
  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d: { sites?: SiteDto[] }) => {
        const found = (d.sites ?? []).find((s) => s.id === siteId) ?? null
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

  // The browser may refuse the clipboard (permission, a page served without
  // HTTPS). Saying « Copié » regardless sent the operator to paste a key that
  // was never copied.
  const copyFieldKey = async (key: string) => {
    let ok = true
    try {
      await navigator.clipboard.writeText(key)
    } catch {
      ok = false
    }
    setCopied({ key, ok })
    setTimeout(() => setCopied(null), 2000)
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
    <section id="schema" className="settings-section" aria-labelledby="h-schema">
      <div className="settings-section__head">
        <h3 id="h-schema" className="settings-section__title">
          <Database size={15} color="var(--accent)" aria-hidden="true" /> Schéma CMS
        </h3>
        {schema && (
          <div className="settings-section__actions">
            <button type="button" className="btn-ghost btn-sm" onClick={read} disabled={reading}>
              <RefreshCw size={14} className={reading ? 'animate-spin' : undefined} />
              Relire le schéma
            </button>
          </div>
        )}
      </div>

      <p className="meta settings-section__lead">
        Types de contenu, champs et extension SEO de ce WordPress : ils guident la génération.
        {schema && ` Lu le ${new Date(schema.extractedAt).toLocaleString('fr-FR')}.`}
      </p>
      {error && schema && (
        <p className="meta settings-section__lead schema-panel__error" role="alert">
          Relecture impossible : {error}
        </p>
      )}

      {/* Nothing read yet: the extraction is a live call to the client's site,
          so it waits for an explicit order. */}
      {!schema && (
        <div className="glass-card schema-panel__empty">
          {error ? (
            <AlertTriangle size={40} className="schema-panel__empty-icon schema-panel__empty-icon--failed" />
          ) : (
            <Database size={40} className="schema-panel__empty-icon" />
          )}

          <h4 className="schema-panel__empty-title">
            {error ? 'Schéma indisponible' : 'Schéma non lu'}
          </h4>

          <p className={`schema-panel__empty-text${error ? ' schema-panel__empty-text--failed' : ''}`}>
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
          <div className="glass-card schema-panel__card">
            <div className="schema-panel__summary">
              <div>
                <h4 className="schema-panel__card-title">
                  Configuration SEO
                </h4>
                <SeoConfigBadge plugin={schema.seoPlugin ?? undefined} schemaTypes={schema.schemaTypes} />
              </div>

              <div className="schema-panel__counts">
                <div className="schema-panel__count">
                  <div className="schema-panel__count-value">
                    {schema.contentTypes.length}
                  </div>
                  <div className="schema-panel__count-label">Types</div>
                </div>
                <div className="schema-panel__count">
                  <div className="schema-panel__count-value">
                    {schema.contentTypes.reduce((sum, ct) => sum + ct.fieldCount, 0)}
                  </div>
                  <div className="schema-panel__count-label">Champs</div>
                </div>
                {/* "Requis" is a property of a field, not an alarm: a reserved
                    status hue here would read as "something is wrong". */}
                <div className="schema-panel__count">
                  <div className="schema-panel__count-value">
                    {schema.contentTypes.reduce((sum, ct) => sum + ct.requiredCount, 0)}
                  </div>
                  <div className="schema-panel__count-label">Requis</div>
                </div>
              </div>
            </div>
          </div>

          {/* Search & Filter */}
          <div className="schema-panel__filters">
            <div className="schema-panel__search">
              <Search size={16} className="schema-panel__search-icon" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un type ou un champ..."
                aria-label="Rechercher un type ou un champ"
                className="input schema-panel__search-input"
              />
            </div>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input schema-panel__filter"
              aria-label="Filtrer les types de contenu"
            >
              <option value="all">Tous les types</option>
              <option value="with-required">Avec champs requis</option>
              <option value="with-tax">Avec taxonomies</option>
              <option value="with-acf">Avec ACF</option>
            </select>
          </div>

          {/* Content Types */}
          <div className="schema-panel__types">
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
                    <div className="schema-panel__taxonomies">
                      <div className="schema-panel__eyebrow">Taxonomies</div>
                      <div className="schema-panel__chips">
                        {contentType.taxonomies.map((tax) => (
                          <span key={tax.key} className="chip">{tax.label}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fields */}
                  <div className="schema-panel__fields">
                    {contentType.fields.map((field) => (
                      <SchemaField
                        key={field.key}
                        name={field.key}
                        type={field.type}
                        required={field.required}
                        description={field.description}
                      >
                        {field.isAcf && (
                          <span className="badge badge-info schema-panel__acf">ACF</span>
                        )}

                        <button
                          type="button"
                          onClick={() => void copyFieldKey(field.key)}
                          className={`schema-panel__copy${
                            copied?.key !== field.key ? '' : copied.ok ? ' schema-panel__copy--done' : ' schema-panel__copy--failed'
                          }`}
                        >
                          {copied?.key === field.key ? (
                            copied.ok ? (
                              <>
                                <CheckCircle size={12} />
                                Copié
                              </>
                            ) : (
                              <>
                                <AlertTriangle size={12} />
                                Copie refusée par le navigateur
                              </>
                            )
                          ) : (
                            <>
                              <Copy size={12} />
                              Copier
                            </>
                          )}
                        </button>

                        {field.options && field.options.length > 0 && (
                          <div className="schema-panel__options">
                            Options : {field.options.join(', ')}
                          </div>
                        )}
                      </SchemaField>
                    ))}
                  </div>
                </ContentTypeCard>
              ))
            ) : (
              <div className="schema-panel__no-match">
                <Search size={32} className="schema-panel__no-match-icon" />
                <p className="schema-panel__no-match-text">Aucun type de contenu ne correspond à votre recherche.</p>
              </div>
            )}
          </div>

          {/* SEO Fields Reference */}
          {schema.seoFields.length > 0 && (
            <div className="glass-card schema-panel__card">
              <h4 className="schema-panel__card-title schema-panel__card-title--spaced">
                Champs SEO disponibles
              </h4>
              <div className="schema-panel__seo-fields">
                {schema.seoFields.map((fieldKey) => (
                  <div key={fieldKey} className="schema-panel__seo-field">
                    <code className="schema-panel__seo-key">{fieldKey}</code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
