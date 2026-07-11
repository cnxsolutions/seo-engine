'use client'

import { useEffect, useState } from 'react'
import { Globe, Megaphone, FileText, CheckCircle, TrendingUp, TrendingDown, MousePointerClick, Eye, Target, BarChart3, RefreshCw, AlertCircle } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardKpis {
  totalSites: number
  totalCampaigns: number
  activeCampaigns: number
  totalGenerations: number
  generationsThisMonth: number
  generationsTrend: number
  totalPublished: number
  publishedThisMonth: number
  publishedTrend: number
  successRate: number
  failureRate: number
  averageGenerationTime: number
  averagePosition: number
  totalClicks: number
  totalImpressions: number
  averageCtr: number
  pageTypesDistribution: Record<string, number>
  recentGenerations: Array<{
    id: string
    title: string
    city: string
    pageType: string
    status: string
    createdAt: string
    campaignName?: string
    siteName?: string
  }>
  recentPublications: Array<{
    id: string
    title: string
    city: string
    publishedUrl?: string
    publishedAt: string
    clicks: number
    impressions: number
    position: number
    siteName?: string
  }>
}

interface CampaignPerformance {
  campaignId: string
  campaignName: string
  siteName: string
  totalGenerated: number
  totalPublished: number
  successRate: number
  averagePosition: number
  totalClicks: number
  totalImpressions: number
}

// ─── Components ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  trend,
  icon: Icon,
  color,
  suffix = '',
}: {
  label: string
  value: number | string
  trend?: number
  icon: React.ElementType
  color: string
  suffix?: string
}) {
  const trendIsPositive = trend !== undefined && trend > 0
  const trendIsNegative = trend !== undefined && trend < 0

  return (
    <div className="glass-card" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{
          width: 44,
          height: 44,
          background: `${color}15`,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Icon size={22} color={color} strokeWidth={2} />
        </div>
        {trend !== undefined && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.75rem',
            fontWeight: 600,
            color: trendIsPositive ? '#10b981' : trendIsNegative ? '#ef4444' : 'var(--text-muted)',
          }}>
            {trendIsPositive ? <TrendingUp size={14} /> : trendIsNegative ? <TrendingDown size={14} /> : null}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        {value}{suffix}
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
        {label}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: '#f3f4f6', color: '#6b7280', label: 'En attente' },
    generating: { bg: '#fef3c7', color: '#d97706', label: 'Génération' },
    generated: { bg: '#dbeafe', color: '#2563eb', label: 'Généré' },
    publishing: { bg: '#f3e8ff', color: '#9333ea', label: 'Publication' },
    published: { bg: '#d1fae5', color: '#059669', label: 'Publié' },
    failed: { bg: '#fee2e2', color: '#dc2626', label: 'Échec' },
    rejected: { bg: '#fee2e2', color: '#991b1b', label: 'Rejeté' },
  }
  const c = config[status] || { bg: '#f3f4f6', color: '#6b7280', label: status }

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0.2rem 0.6rem',
      borderRadius: 9999,
      fontSize: '0.7rem',
      fontWeight: 600,
      background: c.bg,
      color: c.color,
    }}>
      {c.label}
    </span>
  )
}

function PageTypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    pillar: { bg: '#ede9fe', color: '#7c3aed' },
    child: { bg: '#dbeafe', color: '#2563eb' },
    alternative: { bg: '#fef3c7', color: '#d97706' },
    comparative: { bg: '#d1fae5', color: '#059669' },
    local_pack: { bg: '#fce7f3', color: '#db2777' },
  }
  const c = colors[type] || { bg: '#f3f4f6', color: '#6b7280' }

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0.15rem 0.5rem',
      borderRadius: 4,
      fontSize: '0.65rem',
      fontWeight: 700,
      textTransform: 'uppercase',
      background: c.bg,
      color: c.color,
    }}>
      {type.replace('_', ' ')}
    </span>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'quarter'>('month')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [kpisRes, campaignsRes] = await Promise.all([
        fetch('/api/analytics?type=kpis'),
        fetch('/api/analytics?type=campaigns'),
      ])

      if (!kpisRes.ok || !campaignsRes.ok) {
        throw new Error('Failed to fetch analytics data')
      }

      const [kpisData, campaignsData] = await Promise.all([kpisRes.json(), campaignsRes.json()])

      setKpis(kpisData)
      setCampaigns(campaignsData.slice(0, 10))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw size={32} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Chargement des analytics...</p>
        </div>
      </div>
    )
  }

  if (error || !kpis) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <AlertCircle size={48} color="#ef4444" />
          <h2 style={{ marginTop: '1rem', color: 'var(--text-primary)' }}>Erreur de chargement</h2>
          <p style={{ color: 'var(--text-muted)' }}>{error || 'Impossible de charger les données'}</p>
          <button className="btn-primary" onClick={loadData} style={{ marginTop: '1rem' }}>
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  // Calculate total pages by type
  const pageTypeEntries = Object.entries(kpis.pageTypesDistribution)
  const maxPageType = Math.max(...pageTypeEntries.map(([, v]) => v), 1)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
            Analytics
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Performances et KPIs de votre moteur SEO
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value as typeof selectedPeriod)}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          >
            <option value="week">7 derniers jours</option>
            <option value="month">30 derniers jours</option>
            <option value="quarter">90 derniers jours</option>
          </select>
          <button className="btn-secondary" onClick={loadData} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} /> Actualiser
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <KpiCard
          label="Sites connectés"
          value={kpis.totalSites}
          icon={Globe}
          color="#5347ce"
        />
        <KpiCard
          label="Campagnes actives"
          value={kpis.activeCampaigns}
          trend={kpis.totalCampaigns > 0 ? Math.round((kpis.activeCampaigns / kpis.totalCampaigns) * 100) - 50 : 0}
          icon={Megaphone}
          color="#887cfd"
        />
        <KpiCard
          label="Pages générées (mois)"
          value={kpis.generationsThisMonth}
          trend={kpis.generationsTrend}
          icon={FileText}
          color="#4896fe"
        />
        <KpiCard
          label="Pages publiées (mois)"
          value={kpis.publishedThisMonth}
          trend={kpis.publishedTrend}
          icon={CheckCircle}
          color="#16c8c7"
        />
      </div>

      {/* Performance KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <KpiCard
          label="Total publiées"
          value={kpis.totalPublished}
          icon={FileText}
          color="#10b981"
        />
        <KpiCard
          label="Taux de réussite"
          value={`${kpis.successRate}%`}
          icon={Target}
          color={kpis.successRate >= 80 ? '#10b981' : kpis.successRate >= 50 ? '#f59e0b' : '#ef4444'}
        />
        <KpiCard
          label="Total clics (GSC)"
          value={kpis.totalClicks > 999 ? `${(kpis.totalClicks / 1000).toFixed(1)}k` : kpis.totalClicks}
          icon={MousePointerClick}
          color="#f59e0b"
        />
        <KpiCard
          label="CTR moyen"
          value={`${kpis.averageCtr}%`}
          icon={Eye}
          color="#ec4899"
        />
      </div>

      {/* Second Row - Position & Impressions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <KpiCard
          label="Position moyenne"
          value={kpis.averagePosition > 0 ? `#${kpis.averagePosition}` : 'N/A'}
          icon={BarChart3}
          color="#8b5cf6"
        />
        <KpiCard
          label="Impressions totales"
          value={kpis.totalImpressions > 999 ? `${(kpis.totalImpressions / 1000).toFixed(1)}k` : kpis.totalImpressions}
          icon={Eye}
          color="#06b6d4"
        />
        <KpiCard
          label="Taux d'échec"
          value={`${kpis.failureRate}%`}
          icon={AlertCircle}
          color={kpis.failureRate > 20 ? '#ef4444' : '#6b7280'}
        />
      </div>

      {/* Content Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Page Types Distribution */}
        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={18} color="var(--accent)" />
            Distribution par type de page
          </h3>
          {pageTypeEntries.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
              Aucune donnée disponible
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {pageTypeEntries.map(([type, count]) => (
                <div key={type}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <PageTypeBadge type={type} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {count} pages ({Math.round((count / kpis.totalPublished) * 100)}%)
                    </span>
                  </div>
                  <div style={{
                    height: 8,
                    background: 'var(--bg-secondary)',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${(count / maxPageType) * 100}%`,
                      background: type === 'pillar' ? '#7c3aed' :
                        type === 'child' ? '#2563eb' :
                          type === 'alternative' ? '#d97706' :
                            type === 'comparative' ? '#059669' : '#db2777',
                      borderRadius: 4,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Campaign Performance */}
        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={18} color="var(--accent)" />
            Performance par campagne
          </h3>
          {campaigns.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
              Aucune campagne active
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: 300, overflowY: 'auto' }}>
              {campaigns.map((campaign) => (
                <div key={campaign.campaignId} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem',
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 2 }}>
                      {campaign.campaignName}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {campaign.siteName}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#10b981' }}>
                        {campaign.successRate}%
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Succès</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                        {campaign.totalPublished}/{campaign.totalGenerated}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Publiés</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Recent Generations */}
        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={18} color="var(--accent)" />
            Générations récentes
          </h3>
          {kpis.recentGenerations.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
              Aucune génération récente
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {kpis.recentGenerations.slice(0, 8).map((gen) => (
                <div key={gen.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.6rem 0',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {gen.title || 'Sans titre'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {gen.city} • {gen.campaignName || 'Sans campagne'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <PageTypeBadge type={gen.pageType} />
                    <StatusBadge status={gen.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Publications */}
        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={18} color="var(--accent)" />
            Publications récentes
          </h3>
          {kpis.recentPublications.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
              Aucune publication récente
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {kpis.recentPublications.slice(0, 8).map((pub) => (
                <div key={pub.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.6rem 0',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {pub.title || 'Sans titre'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {pub.city} • {pub.siteName || ''}
                    </div>
                  </div>
                  {pub.publishedUrl && (
                    <a
                      href={pub.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: 'var(--accent)',
                        color: 'white',
                        fontSize: '0.7rem',
                        textDecoration: 'none',
                      }}
                    >
                      ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CSS for spin animation */}
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
