'use client'

import { useState } from 'react'
import { Globe, Plus, TestTube, RefreshCw, CheckCircle, XCircle, ChevronRight, AlertCircle } from 'lucide-react'
import { PageHeader, FormField } from '@/components/ui'
import { SiteCard } from '@/components/ui'
import { EmptyState } from '@/components/ui'

// Mock data - à remplacer par des données réelles depuis l'API
const MOCK_SITES = [
  {
    id: '1',
    name: 'BoxnFit - Site Principal',
    url: 'https://boxnfit.fr',
    type: 'wordpress' as const,
    schemaStatus: 'extracted' as const,
    lastSync: 'Il y a 2 heures',
    contentTypesCount: 8,
  },
  {
    id: '2',
    name: 'Rénovation Pro',
    url: 'https://renovation-pro.com',
    type: 'sanity' as const,
    schemaStatus: 'extracted' as const,
    lastSync: 'Il y a 1 jour',
    contentTypesCount: 12,
  },
  {
    id: '3',
    name: 'Blog Cuisine',
    url: 'https://cuisine-facile.fr',
    type: 'wordpress' as const,
    schemaStatus: 'not_extracted' as const,
  },
]

type SiteType = 'wordpress' | 'sanity'
type SchemaStatus = 'not_extracted' | 'extracting' | 'extracted' | 'error'

type Site = {
  id: string
  name: string
  url: string
  type: SiteType
  schemaStatus: SchemaStatus
  lastSync?: string
  contentTypesCount?: number
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>(MOCK_SITES)
  const [showAddModal, setShowAddModal] = useState(false)
  const [extractingSiteId, setExtractingSiteId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Form state
  const [form, setForm] = useState({
    name: '',
    url: '',
    type: 'wordpress' as SiteType,
    // WordPress
    wp_username: '',
    wp_app_password: '',
    // Sanity
    sanity_project_id: '',
    sanity_dataset: 'production',
    sanity_token: '',
  })

  const handleFormChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const testConnection = async () => {
    setTestResult(null)
    // Simuler un test de connexion
    await new Promise(resolve => setTimeout(resolve, 1500))
    setTestResult({ success: true, message: 'Connexion réussie !' })
  }

  const extractSchema = async (siteId: string) => {
    setExtractingSiteId(siteId)
    // Simuler l'extraction
    await new Promise(resolve => setTimeout(resolve, 3000))
    setSites(prev => prev.map(s =>
      s.id === siteId
        ? { ...s, schemaStatus: 'extracted' as const, lastSync: 'À l\'instant', contentTypesCount: 8 }
        : s
    ))
    setExtractingSiteId(null)
  }

  const addSite = async () => {
    // Simuler l'ajout
    const newSite = {
      id: Date.now().toString(),
      name: form.name,
      url: form.url,
      type: form.type,
      schemaStatus: 'not_extracted' as const,
    }
    setSites(prev => [...prev, newSite])
    setShowAddModal(false)
    setForm({
      name: '',
      url: '',
      type: 'wordpress',
      wp_username: '',
      wp_app_password: '',
      sanity_project_id: '',
      sanity_dataset: 'production',
      sanity_token: '',
    })
  }

  return (
    <div>
      <PageHeader
        icon={Globe}
        iconColor="#6366f1"
        badge="Configuration"
        title="Sites Connectés"
        subtitle="Gérez vos sites WordPress et Sanity pour la génération de contenu."
        action={{
          label: 'Ajouter un site',
          onClick: () => setShowAddModal(true),
        }}
      />

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem',
      }}>
        <div className="stat-card">
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(99, 102, 241, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}>
            <Globe size={20} color="#6366f1" />
          </div>
          <div className="stat-value">{sites.length}</div>
          <div className="stat-label">Sites connectés</div>
        </div>

        <div className="stat-card">
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(16, 185, 129, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}>
            <CheckCircle size={20} color="#10b981" />
          </div>
          <div className="stat-value">{sites.filter(s => s.schemaStatus === 'extracted').length}</div>
          <div className="stat-label">Schémas extraits</div>
        </div>

        <div className="stat-card">
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(33, 117, 155, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#21759b">
              <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2z"/>
            </svg>
          </div>
          <div className="stat-value">{sites.filter(s => s.type === 'wordpress').length}</div>
          <div className="stat-label">WordPress</div>
        </div>

        <div className="stat-card">
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(255, 107, 107, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}>
            <span style={{ fontSize: '1.25rem' }}>🔥</span>
          </div>
          <div className="stat-value">{sites.filter(s => s.type === 'sanity').length}</div>
          <div className="stat-label">Sanity</div>
        </div>
      </div>

      {/* Sites List */}
      {sites.length > 0 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
          gap: '1rem',
        }}>
          {sites.map(site => (
            <SiteCard
              key={site.id}
              name={site.name}
              url={site.url}
              type={site.type}
              schemaStatus={extractingSiteId === site.id ? 'extracting' : site.schemaStatus}
              lastSync={site.lastSync}
              contentTypesCount={site.contentTypesCount}
              onExtract={() => extractSchema(site.id)}
              onViewSchema={() => window.location.href = `/schema/${site.id}`}
              onEdit={() => console.log('Edit site', site.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icons={[<Globe size={48} key="icon" style={{ color: 'var(--text-muted)' }} />]}
          title="Aucun site connecté"
          description="Connectez votre premier site WordPress ou Sanity pour commencer à générer du contenu structuré."
          action={{
            label: 'Ajouter un site',
            href: '#',
          }}
        />
      )}

      {/* Add Site Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '1rem',
        }}>
          <div className="glass-card" style={{
            width: '100%',
            maxWidth: 600,
            maxHeight: '90vh',
            overflow: 'auto',
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1.5rem',
            }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Ajouter un site
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '1.25rem',
                }}
              >
                ✕
              </button>
            </div>

            {/* Site Type Selector */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
              marginBottom: '1.5rem',
            }}>
              {[
                { type: 'wordpress' as const, label: 'WordPress', icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#21759b">
                    <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zM4.635 12c0-2.587 1.09-4.932 2.836-6.492L5.12 9.94a4.77 4.77 0 0 1-.485 2.06zm7.365 7.365c-2.587 0-4.932-1.09-6.492-2.836l4.432-2.348a4.77 4.77 0 0 1 2.06-.485zm7.365-7.365a10.002 10.002 0 0 1-6.492 2.836l-2.348-4.432a4.77 4.77 0 0 1 .485-2.06z"/>
                  </svg>
                )},
                { type: 'sanity' as const, label: 'Sanity', icon: '🔥' },
              ].map(({ type, label, icon }) => (
                <button
                  key={type}
                  onClick={() => handleFormChange('type', type)}
                  style={{
                    padding: '1rem',
                    borderRadius: 10,
                    border: `2px solid ${form.type === type ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.type === type ? 'var(--accent-lighter)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ fontSize: '1.5rem' }}>{icon}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                  {form.type === type && (
                    <CheckCircle size={16} color="var(--accent)" style={{ marginLeft: 'auto' }} />
                  )}
                </button>
              ))}
            </div>

            {/* Common Fields */}
            <FormField label="Nom du site">
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleFormChange('name', e.target.value)}
                className="input"
                placeholder="BoxnFit - Site principal"
              />
            </FormField>

            <FormField label="URL du site">
              <input
                type="url"
                value={form.url}
                onChange={(e) => handleFormChange('url', e.target.value)}
                className="input"
                placeholder="https://boxnfit.fr"
              />
            </FormField>

            {/* WordPress Fields */}
            {form.type === 'wordpress' && (
              <>
                <FormField label="Nom d'utilisateur WordPress">
                  <input
                    type="text"
                    value={form.wp_username}
                    onChange={(e) => handleFormChange('wp_username', e.target.value)}
                    className="input"
                    placeholder="admin"
                  />
                </FormField>

                <FormField label="Application Password" hint="← WordPress → Utilisateurs → Profil → Application Passwords">
                  <input
                    type="password"
                    value={form.wp_app_password}
                    onChange={(e) => handleFormChange('wp_app_password', e.target.value)}
                    className="input"
                    placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                  />
                </FormField>
              </>
            )}

            {/* Sanity Fields */}
            {form.type === 'sanity' && (
              <>
                <FormField label="Sanity Project ID">
                  <input
                    type="text"
                    value={form.sanity_project_id}
                    onChange={(e) => handleFormChange('sanity_project_id', e.target.value)}
                    className="input"
                    placeholder="abc123xyz"
                  />
                </FormField>

                <FormField label="Dataset" hint="En général 'production'">
                  <input
                    type="text"
                    value={form.sanity_dataset}
                    onChange={(e) => handleFormChange('sanity_dataset', e.target.value)}
                    className="input"
                    placeholder="production"
                  />
                </FormField>

                <FormField label="Sanity Token" hint="Pour lire les schemas. Créez-en un dans sanity.io/manage">
                  <input
                    type="password"
                    value={form.sanity_token}
                    onChange={(e) => handleFormChange('sanity_token', e.target.value)}
                    className="input"
                    placeholder="sk..."
                  />
                </FormField>
              </>
            )}

            {/* Test Result */}
            {testResult && (
              <div style={{
                padding: '0.75rem 1rem',
                borderRadius: 8,
                fontSize: '0.875rem',
                background: testResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                color: testResult.success ? '#10b981' : '#ef4444',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                {testResult.success ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {testResult.message}
              </div>
            )}

            {/* Actions */}
            <div style={{
              display: 'flex',
              gap: '0.75rem',
              marginTop: '1.5rem',
            }}>
              <button
                onClick={testConnection}
                className="btn-ghost"
                disabled={!form.url}
                style={{ flex: 1 }}
              >
                <TestTube size={16} />
                Tester la connexion
              </button>
              <button
                onClick={addSite}
                className="btn-primary"
                disabled={!form.name || !form.url}
                style={{ flex: 2 }}
              >
                <Plus size={16} />
                Ajouter le site
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
