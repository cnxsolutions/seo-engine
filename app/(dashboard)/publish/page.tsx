'use client'

import { useEffect, useState } from 'react'
import { Send, ExternalLink, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import { PageHeader, StatusBadge } from '@/components/ui'

interface Generation {
  id: string
  title?: string
  slug?: string
  city: string
  status: string
  published_url?: string
  ai_model: string
  page_type?: string
  created_at: string
  site?: { name: string; type: string; url: string }
}

export default function PublishPage() {
  const [generations, setGenerations] = useState<Generation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/articles?include_generations=true')
      .then((r) => r.json())
      .then((data) => {
        setGenerations(data.generations ?? data.articles ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const publishablePages = generations.filter((g) => g.status === 'generated')
  const publishingPages = generations.filter((g) => g.status === 'publishing')
  const publishedPages = generations.filter((g) => g.status === 'published')
  const failedPages = generations.filter((g) => g.status === 'failed')

  return (
    <div>
      <PageHeader
        icon={Send}
        iconColor="#5347ce"
        badge="Étape 4"
        title="Publier"
        subtitle="Publiez vos pages générées vers WordPress ou Next.js — indexation automatique"
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <MiniStat icon={Clock} label="À publier" value={publishablePages.length} color="#f5a623" />
        <MiniStat icon={Send} label="En cours" value={publishingPages.length} color="#4896fe" />
        <MiniStat icon={CheckCircle} label="Publiées" value={publishedPages.length} color="#16c8c7" />
        <MiniStat icon={AlertCircle} label="Erreurs" value={failedPages.length} color="#ef4444" />
      </div>

      {loading ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : publishablePages.length === 0 && publishedPages.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Send size={40} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
          <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Rien à publier</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Générez du contenu (étape 3) — les pages prêtes apparaîtront ici pour publication.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[...publishablePages, ...publishingPages, ...publishedPages, ...failedPages].map((g) => (
            <div key={g.id} className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.5rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{g.title || g.slug || g.city}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {g.page_type || 'page'} • {g.ai_model} • {g.site?.name || '—'}
                </div>
              </div>
              <StatusBadge status={g.status} />
              {g.published_url && (
                <a href={g.published_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MiniStat({ icon: Icon, label, value, color }: { icon: typeof Send; label: string; value: number; color: string }) {
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
