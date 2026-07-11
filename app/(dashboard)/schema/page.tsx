'use client'

import { useEffect, useState } from 'react'
import { Database, Globe, CheckCircle, Loader2, ExternalLink, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { PageHeader, StatusBadge } from '@/components/ui'

interface Site {
  id: string
  name: string
  url: string
  type: string
  is_active: boolean
  has_schema: boolean
  last_sync_at?: string
}

export default function SchemaPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState<string | null>(null)

  const load = () => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        setSites(d.sites ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const extract = async (siteId: string) => {
    setExtracting(siteId)
    try {
      const res = await fetch(`/api/schema/extract/${siteId}`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        load()
      } else {
        alert(data.error || 'Erreur extraction')
      }
    } catch {
      alert('Erreur réseau')
    } finally {
      setExtracting(null)
    }
  }

  const sitesWithSchema = sites.filter((s) => s.has_schema)
  const sitesWithoutSchema = sites.filter((s) => !s.has_schema)

  return (
    <div>
      <PageHeader
        icon={Database}
        iconColor="#5347ce"
        badge="Étape 2"
        title="Schéma CMS"
        subtitle="Extrayez la structure de vos sites WordPress/Sanity pour créer des templates de génération"
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <MiniStat icon={Globe} label="Sites" value={sites.length} color="#6366f1" />
        <MiniStat icon={CheckCircle} label="Schéma extrait" value={sitesWithSchema.length} color="#10b981" />
        <MiniStat icon={Database} label="En attente" value={sitesWithoutSchema.length} color="#f59e0b" />
      </div>

      {/* Sites sans schéma */}
      {sitesWithoutSchema.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-secondary)' }}>
            À configurer ({sitesWithoutSchema.length})
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1rem' }}>
            {sitesWithoutSchema.map((site) => (
              <div key={site.id} className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{site.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{site.url}</div>
                  </div>
                  <StatusBadge status="pending" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Cliquez pour extraire le schéma {site.type}
                  </span>
                  <button
                    onClick={() => extract(site.id)}
                    disabled={extracting === site.id}
                    className="btn-primary"
                    style={{ padding: '0.5rem 1rem', fontSize: '0.78rem', gap: 6 }}
                  >
                    {extracting === site.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Extraire le schéma
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sites avec schéma */}
      {sitesWithSchema.length > 0 && (
        <div>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-secondary)' }}>
            Configurés ({sitesWithSchema.length})
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1rem' }}>
            {sitesWithSchema.map((site) => (
              <div key={site.id} className="glass-card" style={{ borderColor: '#10b98140' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{site.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{site.url}</div>
                  </div>
                  <StatusBadge status="active" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#10b981' }}>
                    <CheckCircle size={14} />
                    Schéma extrait
                  </div>
                  <Link href={`/schema/${site.id}`}>
                    <button className="btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.78rem' }}>
                      <ExternalLink size={14} /> Voir le détail
                    </button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
        </div>
      )}

      {!loading && sites.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Database size={40} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
          <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Aucun site</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Ajoutez d&apos;abord un site dans la section Sites.
          </p>
          <Link href="/sites">
            <button className="btn-primary">Aller aux sites</button>
          </Link>
        </div>
      )}
    </div>
  )
}

function MiniStat({ icon: Icon, label, value, color }: { icon: typeof Database; label: string; value: number; color: string }) {
  return (
    <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem' }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} color={color} />
      </div>
      <div>
        <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{value}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</div>
      </div>
    </div>
  )
}
