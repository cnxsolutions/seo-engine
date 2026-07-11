'use client'

import { useEffect, useState } from 'react'
import { Wand2, Play, Eye, Clock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { PageHeader, StatusBadge } from '@/components/ui'

interface Generation {
  id: string
  title?: string
  slug?: string
  city: string
  status: 'pending' | 'generating' | 'generated' | 'failed'
  published_url?: string
  ai_model: string
  page_type?: string
  created_at: string
  site?: { name: string; type: string }
  keywords?: string[]
}

export default function GeneratePage() {
  const [generations, setGenerations] = useState<Generation[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const load = () => {
    fetch('/api/articles?include_generations=true')
      .then((r) => r.json())
      .then((d) => {
        setGenerations(d.generations ?? d.articles ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const quickGenerate = async () => {
    setGenerating(true)
    try {
      await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      load()
    } finally {
      setGenerating(false)
    }
  }

  const pending = generations.filter((g) => g.status === 'pending')
  const generating_ = generations.filter((g) => g.status === 'generating')
  const generated = generations.filter((g) => g.status === 'generated')
  const failed = generations.filter((g) => g.status === 'failed')

  return (
    <div>
      <PageHeader
        icon={Wand2}
        iconColor="#5347ce"
        badge="Étape 4"
        title="Génération IA"
        subtitle="Générez des pages SEO optimisées avec RAG contextuel — lancez manuellement ou via campagne"
        action={{ label: 'Générer maintenant', onClick: quickGenerate, icon: Play }}
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <MiniStat icon={Clock} label="En attente" value={pending.length} color="#f5a623" />
        <MiniStat icon={Loader2} label="En cours" value={generating_.length} color="#4896fe" />
        <MiniStat icon={CheckCircle} label="Générées" value={generated.length} color="#16c8c7" />
        <MiniStat icon={AlertCircle} label="Erreurs" value={failed.length} color="#ef4444" />
      </div>

      {/* Recent generations */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          Générations récentes
        </h2>
        {generations.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
            <Wand2 size={40} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
            <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Aucune génération</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Créez une campagne ou lancez une génération rapide.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {generations.slice(0, 20).map((g) => (
              <div key={g.id} className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.5rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{g.title || g.slug || g.city}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {g.page_type} • {g.ai_model} • {g.site?.name || 'sans site'}
                  </div>
                </div>
                <StatusBadge status={g.status} />
                <button style={{ padding: '0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>
                  <Eye size={14} color="var(--text-muted)" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ icon: Icon, label, value, color }: { icon: typeof Wand2; label: string; value: number; color: string }) {
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
