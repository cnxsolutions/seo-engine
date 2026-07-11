'use client'

import { useState } from 'react'
import {
  Library,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Trash2,
  Edit,
  Send,
  Eye,
  MoreVertical,
  Filter,
  Search,
  Download,
  RefreshCw,
} from 'lucide-react'
import { PageHeader, Badge } from '@/src/components/ui'

// Mock data
const MOCK_DRAFTS = [
  {
    id: '1',
    title: 'Restaurant gastronomique Troyes | BoxnFit',
    type: 'post',
    siteName: 'BoxnFit - Site Principal',
    siteType: 'wordpress' as const,
    status: 'draft',
    wordCount: 1250,
    generatedAt: 'Il y a 2 heures',
    validation: { isValid: true, errors: 0, warnings: 2 },
  },
  {
    id: '2',
    title: 'Salle de sport Troyes - Coach personnel',
    type: 'localPage',
    siteName: 'Rénovation Pro',
    siteType: 'sanity' as const,
    status: 'validated',
    wordCount: 980,
    generatedAt: 'Il y a 5 heures',
    validation: { isValid: true, errors: 0, warnings: 1 },
  },
  {
    id: '3',
    title: 'Plombier d\'urgence Paris 5ème',
    type: 'service',
    siteName: 'BoxnFit - Site Principal',
    siteType: 'wordpress' as const,
    status: 'published',
    wordCount: 1450,
    generatedAt: 'Il y a 1 jour',
    publishedAt: 'Il y a 12 heures',
    validation: { isValid: true, errors: 0, warnings: 0 },
  },
  {
    id: '4',
    title: 'Coiffeur salon Troyes centre',
    type: 'post',
    siteName: 'BoxnFit - Site Principal',
    siteType: 'wordpress' as const,
    status: 'failed',
    wordCount: 0,
    generatedAt: 'Il y a 3 heures',
    error: 'API timeout - connexion au site impossible',
    validation: { isValid: false, errors: 1, warnings: 0 },
  },
]

const STATUS_CONFIG = {
  draft: { label: 'Brouillon', color: '#6b7280', icon: Clock },
  validated: { label: 'Validé', color: '#f59e0b', icon: CheckCircle },
  published: { label: 'Publié', color: '#10b981', icon: Send },
  failed: { label: 'Erreur', color: '#ef4444', icon: AlertCircle },
}

export default function ContentLibraryPage() {
  const [drafts, setDrafts] = useState(MOCK_DRAFTS)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [siteFilter, setSiteFilter] = useState<string>('all')

  const filteredDrafts = drafts.filter(draft => {
    const matchesSearch = !searchQuery ||
      draft.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      draft.type.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = statusFilter === 'all' || draft.status === statusFilter
    const matchesSite = siteFilter === 'all' || draft.siteName === siteFilter

    return matchesSearch && matchesStatus && matchesSite
  })

  const uniqueSites = [...new Set(drafts.map(d => d.siteName))]

  const stats = {
    total: drafts.length,
    draft: drafts.filter(d => d.status === 'draft').length,
    validated: drafts.filter(d => d.status === 'validated').length,
    published: drafts.filter(d => d.status === 'published').length,
    failed: drafts.filter(d => d.status === 'failed').length,
  }

  return (
    <div>
      <PageHeader
        icon={Library}
        iconColor="#059669"
        badge="Bibliothèque"
        title="Bibliothèque de contenu"
        subtitle="Gérez vos brouillons, contenus validés et publiés."
        action={{
          label: 'Nouveau contenu',
          href: '/produce/schema',
        }}
      />

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem',
      }}>
        {[
          { label: 'Total', value: stats.total, color: '#6366f1' },
          { label: 'Brouillons', value: stats.draft, color: '#6b7280' },
          { label: 'Validés', value: stats.validated, color: '#f59e0b' },
          { label: 'Publiés', value: stats.published, color: '#10b981' },
          { label: 'Erreurs', value: stats.failed, color: '#ef4444' },
        ].map(stat => (
          <div key={stat.label} className="stat-card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 250, position: 'relative' }}>
          <Search size={16} style={{
            position: 'absolute',
            left: '0.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
          }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un contenu..."
            className="input"
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input"
          style={{ width: 'auto', minWidth: 150 }}
        >
          <option value="all">Tous les statuts</option>
          <option value="draft">Brouillons</option>
          <option value="validated">Validés</option>
          <option value="published">Publiés</option>
          <option value="failed">Erreurs</option>
        </select>

        <select
          value={siteFilter}
          onChange={(e) => setSiteFilter(e.target.value)}
          className="input"
          style={{ width: 'auto', minWidth: 200 }}
        >
          <option value="all">Tous les sites</option>
          {uniqueSites.map(site => (
            <option key={site} value={site}>{site}</option>
          ))}
        </select>

        <button className="btn-ghost">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Drafts List */}
      {filteredDrafts.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredDrafts.map(draft => {
            const status = STATUS_CONFIG[draft.status as keyof typeof STATUS_CONFIG]
            const StatusIcon = status.icon

            return (
              <div
                key={draft.id}
                className="glass-card"
                style={{
                  padding: '1.25rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: `${status.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <StatusIcon size={22} color={status.color} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    <h3 style={{
                      fontSize: '1rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      margin: 0,
                    }}>
                      {draft.title}
                    </h3>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 4,
                      background: `${status.color}15`,
                      color: status.color,
                      fontWeight: 600,
                    }}>
                      {status.label}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: '0.2rem 0.5rem',
                      background: draft.siteType === 'wordpress' ? 'rgba(33, 117, 155, 0.15)' : 'rgba(255, 107, 107, 0.15)',
                      borderRadius: 4,
                      color: draft.siteType === 'wordpress' ? '#21759b' : '#FF6B6B',
                    }}>
                      {draft.siteType === 'wordpress' ? 'W' : '🔥'} {draft.siteName}
                    </span>

                    <code style={{
                      padding: '0.2rem 0.5rem',
                      background: 'var(--bg-secondary)',
                      borderRadius: 4,
                    }}>
                      {draft.type}
                    </code>

                    {draft.wordCount > 0 && (
                      <span>{draft.wordCount.toLocaleString()} mots</span>
                    )}

                    <span>Généré {draft.generatedAt}</span>

                    {draft.publishedAt && (
                      <span style={{ color: '#10b981' }}>Publié {draft.publishedAt}</span>
                    )}
                  </div>

                  {draft.error && (
                    <div style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      background: 'rgba(239, 68, 68, 0.1)',
                      borderRadius: 6,
                      fontSize: '0.8rem',
                      color: '#ef4444',
                    }}>
                      {draft.error}
                    </div>
                  )}

                  {/* Validation badges */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    {draft.validation.errors > 0 && (
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#ef4444',
                        borderRadius: 4,
                      }}>
                        {draft.validation.errors} erreur{draft.validation.errors > 1 ? 's' : ''}
                      </span>
                    )}
                    {draft.validation.warnings > 0 && (
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: '#f59e0b',
                        borderRadius: 4,
                      }}>
                        {draft.validation.warnings} avertissement{draft.validation.warnings > 1 ? 's' : ''}
                      </span>
                    )}
                    {draft.validation.isValid && draft.validation.errors === 0 && draft.validation.warnings === 0 && (
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#10b981',
                        borderRadius: 4,
                      }}>
                        ✓ Valide
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                  {draft.status === 'failed' && (
                    <button className="btn-ghost" style={{ fontSize: '0.8rem' }}>
                      <RefreshCw size={14} />
                      Réessayer
                    </button>
                  )}
                  {draft.status === 'draft' && (
                    <button className="btn-ghost" style={{ fontSize: '0.8rem' }}>
                      <Edit size={14} />
                      Éditer
                    </button>
                  )}
                  {(draft.status === 'draft' || draft.status === 'validated') && (
                    <button className="btn-primary" style={{ fontSize: '0.8rem' }}>
                      <Send size={14} />
                      Publier
                    </button>
                  )}
                  {draft.status === 'published' && (
                    <button className="btn-ghost" style={{ fontSize: '0.8rem' }}>
                      <Eye size={14} />
                      Voir
                    </button>
                  )}
                  <button className="btn-ghost" style={{ fontSize: '0.8rem' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border)',
        }}>
          <Library size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            {searchQuery || statusFilter !== 'all' || siteFilter !== 'all'
              ? 'Aucun contenu trouvé'
              : 'Aucun contenu généré'
            }
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            {searchQuery || statusFilter !== 'all' || siteFilter !== 'all'
              ? 'Essayez de modifier vos filtres.'
              : 'Commencez par générer du contenu pour ce site.'
            }
          </p>
          {!searchQuery && statusFilter === 'all' && siteFilter === 'all' && (
            <a href="/produce/schema" className="btn-primary">
              Générer du contenu
            </a>
          )}
        </div>
      )}
    </div>
  )
}
