import { Globe, Megaphone, FileText, Zap, CheckCircle, ScanSearch, CalendarDays, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { getDashboardStats, listCampaigns, listSites } from '@/lib/db'

export const dynamic = 'force-dynamic'

const quickActions = [
  { title: 'Analyser un site', desc: 'Audit + plan de contenu', href: '/strategy/new', icon: ScanSearch, color: '#5347ce' },
  { title: 'Créer une campagne', desc: 'Génération automatique', href: '/campaigns/new', icon: Megaphone, color: '#887cfd' },
  { title: 'Générer maintenant', desc: 'Page SEO instantanée', href: '/generate', icon: Zap, color: '#16c8c7' },
  { title: 'Calendrier', desc: 'Planifier le contenu', href: '/calendar', icon: CalendarDays, color: '#4896fe' },
]

export default async function DashboardPage() {
  const [stats, sites, campaigns] = await Promise.all([
    getDashboardStats(),
    listSites(),
    listCampaigns(),
  ])

  const cards = [
    { label: 'Sites connectés', value: String(stats.sites), icon: Globe, color: '#5347ce' },
    { label: 'Campagnes actives', value: String(stats.activeCampaigns), icon: Megaphone, color: '#887cfd' },
    { label: 'Pages générées', value: String(stats.generatedPages), icon: FileText, color: '#4896fe' },
    { label: 'Pages publiées', value: String(stats.publishedPages), icon: CheckCircle, color: '#16c8c7' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>Dashboard</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Vue d&apos;ensemble de votre moteur SEO</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/strategy/new">
            <button className="btn-primary" style={{ gap: 6 }}>
              <ScanSearch size={16} /> Analyser un site
            </button>
          </Link>
        </div>
      </div>

      {/* Metric cards */}
      <div className="stats-grid" style={{ marginBottom: '2rem' }}>
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="stat-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{
                width: 40, height: 40,
                background: `${color}12`,
                borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={20} color={color} strokeWidth={2} />
              </div>
            </div>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>Actions rapides</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          {quickActions.map(({ title, desc, href, icon: Icon, color }) => (
            <Link key={href} href={href} style={{ textDecoration: 'none' }}>
              <div className="glass-card" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
                <div style={{
                  width: 44, height: 44, minWidth: 44,
                  background: `${color}12`,
                  borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={20} color={color} strokeWidth={2} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                </div>
                <ArrowUpRight size={14} color="var(--text-muted)" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Two column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Sites connectés</h3>
            <Link href="/sites" style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Voir tout</Link>
          </div>
          {sites.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>Aucun site. Ajoutez un site pour commencer.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {sites.slice(0, 5).map((site) => (
                <div key={site.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: site.type === 'wordpress' ? '#4896fe12' : '#16c8c712',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Globe size={15} color={site.type === 'wordpress' ? '#4896fe' : '#16c8c7'} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{site.name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{site.url}</div>
                    </div>
                  </div>
                  <span className={`badge ${site.type === 'wordpress' ? 'badge-info' : 'badge-success'}`}>{site.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Campagnes récentes</h3>
            <Link href="/campaigns" style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Voir tout</Link>
          </div>
          {campaigns.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>Créez votre première campagne pour démarrer.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {campaigns.slice(0, 5).map((campaign) => (
                <div key={campaign.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{campaign.name}</div>
                    <span className={`badge ${campaign.is_active ? 'badge-success' : 'badge-muted'}`}>
                      {campaign.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 3 }}>
                    {campaign.business_type} • {campaign.communes.length} communes • {campaign.ai_model}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
