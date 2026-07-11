'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import {
  Database,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Globe,
  Search,
  Filter,
  Download,
  Copy,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import { PageHeader } from '@/components/ui'
import { ContentTypeCard, SchemaField, SeoConfigBadge } from '@/components/ui'

// Mock data - à remplacer par des données réelles
const MOCK_SCHEMA = {
  id: '1',
  name: 'BoxnFit - Site Principal',
  type: 'wordpress' as const,
  url: 'https://boxnfit.fr',
  extractedAt: 'Il y a 2 heures',
  seoConfig: {
    hasSeoPlugin: true,
    plugin: 'rankmath',
    schemaTypes: ['LocalBusiness', 'FAQPage', 'Article', 'BreadcrumbList'],
    seoFields: [
      { key: 'rank_math_title', label: 'RankMath Title', type: 'text' },
      { key: 'rank_math_description', label: 'RankMath Description', type: 'text' },
      { key: 'rank_math_focus_keyword', label: 'Focus Keyword', type: 'text' },
    ],
  },
  publishConfig: {
    requiresReview: false,
    defaultStatus: 'draft',
    supportedStatuses: ['draft', 'publish', 'pending'],
    autoPublish: false,
  },
  contentTypes: [
    {
      key: 'post',
      label: 'Articles',
      fieldCount: 15,
      requiredCount: 3,
      fields: [
        { key: 'title', label: 'Titre', type: 'text', required: true, description: 'Le titre de l\'article' },
        { key: 'content', label: 'Contenu', type: 'html', required: true, description: 'Corps de l\'article' },
        { key: 'excerpt', label: 'Extrait', type: 'text', required: false, description: 'Résumé de l\'article' },
        { key: 'featured_image', label: 'Image mise en avant', type: 'image', required: false, description: '' },
        { key: 'slug', label: 'Slug', type: 'slug', required: true, description: '' },
        { key: 'acf_hero_title', label: 'Titre du Hero', type: 'text', required: false, description: 'Titre dans la section hero' },
        { key: 'acf_hero_subtitle', label: 'Sous-titre Hero', type: 'text', required: false, description: '' },
        { key: 'acf_hero_cta_text', label: 'Texte du CTA Hero', type: 'text', required: false, description: '' },
        { key: 'acf_faq_section', label: 'Section FAQ', type: 'repeater', required: false, description: 'Questions fréquentes' },
      ],
      taxonomies: [
        { key: 'category', label: 'Catégories', hierarchical: true },
        { key: 'post_tag', label: 'Tags', hierarchical: false },
      ],
    },
    {
      key: 'page',
      label: 'Pages',
      fieldCount: 12,
      requiredCount: 2,
      fields: [
        { key: 'title', label: 'Titre', type: 'text', required: true, description: '' },
        { key: 'content', label: 'Contenu', type: 'html', required: true, description: '' },
        { key: 'slug', label: 'Slug', type: 'slug', required: true, description: '' },
        { key: 'acf_page_template', label: 'Template de page', type: 'select', required: false, options: ['default', 'full-width', 'landing'], description: '' },
      ],
      taxonomies: [],
    },
    {
      key: 'service',
      label: 'Services',
      fieldCount: 20,
      requiredCount: 4,
      fields: [
        { key: 'title', label: 'Titre du service', type: 'text', required: true, description: '' },
        { key: 'content', label: 'Description', type: 'html', required: true, description: '' },
        { key: 'acf_service_price', label: 'Prix', type: 'number', required: false, description: '' },
        { key: 'acf_service_duration', label: 'Durée', type: 'text', required: false, description: '' },
        { key: 'acf_service_features', label: 'Caractéristiques', type: 'repeater', required: false, description: '' },
        { key: 'acf_service_image', label: 'Image du service', type: 'image', required: false, description: '' },
        { key: 'slug', label: 'Slug', type: 'slug', required: true, description: '' },
      ],
      taxonomies: [
        { key: 'service_category', label: 'Catégories de services', hierarchical: true },
      ],
    },
  ],
}

export default function SchemaViewPage() {
  const params = useParams()
  const siteId = params.siteId as string

  const [schema, setSchema] = useState<typeof MOCK_SCHEMA | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    // Simuler le chargement
    const timer = setTimeout(() => {
      setSchema(MOCK_SCHEMA)
      setLoading(false)
    }, 1000)

    return () => clearTimeout(timer)
  }, [siteId])

  const toggleExpanded = (key: string) => {
    setExpandedTypes(prev => {
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

  const filteredContentTypes = schema?.contentTypes.filter(ct => {
    const matchesSearch = !searchQuery ||
      ct.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ct.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ct.fields.some(f =>
        f.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.label.toLowerCase().includes(searchQuery.toLowerCase())
      )

    const matchesFilter = filterType === 'all' ||
      (filterType === 'with-required' && ct.requiredCount > 0) ||
      (filterType === 'with-tax' && ct.taxonomies.length > 0) ||
      (filterType === 'with-acf' && ct.fields.some(f => f.key.startsWith('acf_')))

    return matchesSearch && matchesFilter
  }) || []

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '50vh',
        flexDirection: 'column',
        gap: '1rem',
      }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
        <p style={{ color: 'var(--text-muted)' }}>Chargement du schéma...</p>
      </div>
    )
  }

  if (!schema) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Schéma non trouvé</h2>
        <p style={{ color: 'var(--text-muted)' }}>Ce site n&apos;a pas encore été extrait.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '2rem',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{
              fontSize: '0.72rem',
              color: schema.type === 'wordpress' ? '#21759b' : '#FF6B6B',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              {schema.type === 'wordpress' ? 'WordPress' : 'Sanity'}
            </span>
          </div>
          <h1 className="section-title">{schema.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
            <a
              href={schema.url}
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
              {schema.url}
              <ExternalLink size={14} />
            </a>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Extrait {schema.extractedAt}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost">
            <RefreshCw size={16} />
            Resynchroniser
          </button>
          <button className="btn-secondary">
            <Download size={16} />
            Exporter JSON
          </button>
        </div>
      </div>

      {/* SEO Config */}
      <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              Configuration SEO
            </h3>
            <SeoConfigBadge
              plugin={schema.seoConfig.plugin}
              schemaTypes={schema.seoConfig.schemaTypes}
            />
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
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ef4444' }}>
                {schema.contentTypes.reduce((sum, ct) => sum + ct.requiredCount, 0)}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Requis</div>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filter */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
      }}>
        <div style={{
          flex: 1,
          minWidth: 250,
          position: 'relative',
        }}>
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
          filteredContentTypes.map(contentType => (
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
                <div style={{
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                }}>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    marginBottom: '0.5rem',
                  }}>
                    Taxonomies
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {contentType.taxonomies.map(tax => (
                      <span
                        key={tax.key}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.5rem',
                          background: 'rgba(99, 102, 241, 0.15)',
                          color: '#818cf8',
                          borderRadius: 4,
                          fontWeight: 500,
                        }}
                      >
                        {tax.label}
                      </span>
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
                    {/* ACF badge */}
                    {field.key.startsWith('acf_') && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.65rem',
                        padding: '0.15rem 0.4rem',
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: '#fbbf24',
                        borderRadius: 4,
                        fontWeight: 600,
                        marginLeft: '0.5rem',
                      }}>
                        ACF
                      </span>
                    )}

                    {/* Copy button */}
                    <button
                      onClick={() => copyFieldKey(field.key)}
                      style={{
                        marginLeft: 'auto',
                        background: 'transparent',
                        border: 'none',
                        color: copiedField === field.key ? '#10b981' : 'var(--text-muted)',
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

                    {/* Options for select/repeater */}
                    {'options' in field && field.options && (
                      <div style={{
                        marginTop: '0.5rem',
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                      }}>
                        Options: {field.options.join(', ')}
                      </div>
                    )}
                  </SchemaField>
                ))}
              </div>

              {/* Generate Content CTA */}
              <div style={{
                marginTop: '1rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}>
                <a
                  href={`/produce?site=${siteId}&type=${contentType.key}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1rem',
                    background: 'var(--accent)',
                    color: 'white',
                    borderRadius: 8,
                    textDecoration: 'none',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                  }}
                >
                  Générer du contenu
                  <ChevronRight size={14} />
                </a>
              </div>
            </ContentTypeCard>
          ))
        ) : (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: 'var(--bg-card)',
            borderRadius: 12,
            border: '1px solid var(--border)',
          }}>
            <Search size={32} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
            <p style={{ color: 'var(--text-muted)' }}>
              Aucun type de contenu ne correspond à votre recherche.
            </p>
          </div>
        )}
      </div>

      {/* SEO Fields Reference */}
      {schema.seoConfig.seoFields.length > 0 && (
        <div className="glass-card" style={{ padding: '1.25rem', marginTop: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Champs SEO disponibles
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {schema.seoConfig.seoFields.map(field => (
              <div
                key={field.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.5rem 0.75rem',
                  background: 'var(--bg-secondary)',
                  borderRadius: 6,
                }}
              >
                <div>
                  <code style={{ fontSize: '0.8rem', color: '#22c55e' }}>{field.key}</code>
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {field.label}
                  </span>
                </div>
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.15rem 0.4rem',
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: '#818cf8',
                  borderRadius: 4,
                }}>
                  {field.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
