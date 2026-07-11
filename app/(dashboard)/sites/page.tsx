import { Globe, Plus, Globe2, Code2 } from 'lucide-react'
import Link from 'next/link'
import { listSites } from '@/lib/db'
import { EmptyState, IconBox, StatusBadge } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function SitesPage() {
  const sites = await listSites()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Globe size={20} color="#6366f1" />
            <span style={{ fontSize: '0.8rem', color: '#6366f1', fontWeight: 600 }}>SITES</span>
          </div>
          <h1 className="section-title">Vos sites connectés</h1>
          <p className="section-subtitle">Chaque site sauvegardé peut servir au publish WordPress ou Next.js.</p>
        </div>
        <Link href="/sites/new">
          <button className="btn-primary">
            <Plus size={16} /> Ajouter un site
          </button>
        </Link>
      </div>

      {sites.length === 0 ? (
        <EmptyState
          icons={[
            <IconBox key="wp" icon={Globe2} color="#6366f1" boxSize={56} size={28} />,
            <IconBox key="nxt" icon={Code2} color="#a855f7" boxSize={56} size={28} />,
          ]}
          title="Aucun site connecté"
          description="Ajoutez votre premier site WordPress ou Next.js pour activer la génération et la publication."
          action={{ label: '+ Connecter mon premier site', href: '/sites/new' }}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          {sites.map((site) => (
            <div key={site.id} className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{site.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{site.url}</div>
                </div>
                <StatusBadge status={site.is_active ? 'active' : 'inactive'} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span>Type</span>
                <strong>{site.type}</strong>
              </div>
              {site.type === 'wordpress' ? (
                <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Utilisateur: {site.wp_username || 'non renseigné'}
                </div>
              ) : (
                <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Repo: {site.github_repo || 'à configurer'}
                </div>
              )}
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                {site.google_connected ? (
                  <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                    ✓ Google connecté
                  </span>
                ) : (
                  <Link href={`/api/google/auth?site_id=${site.id}`} style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                    Connecter Google
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
