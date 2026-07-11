'use client'

import { useEffect, useState } from 'react'
import { BarChart3, CalendarDays, FileText, Link2, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/ui'
import type { Campaign, Site } from '@/lib/types'

type Tab = 'calendar' | 'pages' | 'performance' | 'backlinks'

const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: 'calendar', label: 'Calendrier', icon: CalendarDays },
  { key: 'pages', label: 'Pages publiées', icon: FileText },
  { key: 'performance', label: 'Performance', icon: TrendingUp },
  { key: 'backlinks', label: 'Backlinks', icon: Link2 },
]

const PAGE_TYPE_COLORS: Record<string, string> = {
  pillar: '#5347ce', child: '#16c8c7', alternative: '#f5a623', comparative: '#ef4444', local_pack: '#887cfd',
}

export default function MonitorPage() {
  const [tab, setTab] = useState<Tab>('calendar')

  return (
    <div>
      <PageHeader
        icon={BarChart3}
        iconColor="#5347ce"
        badge="Étape 5"
        title="Suivre"
        subtitle="Calendrier éditorial, pages publiées et backlinks"
      />

      <div className="tab-list">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`tab-item ${tab === t.key ? 'active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'calendar' && <CalendarView />}
      {tab === 'pages' && <PagesView />}
      {tab === 'performance' && <PerformanceView />}
      {tab === 'backlinks' && <BacklinksView />}
    </div>
  )
}

function CalendarView() {
  const [slots, setSlots] = useState<Array<{ id: string; scheduled_date: string; page_type: string; target_keyword: string; target_city?: string; status: string }>>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [currentMonth, setCurrentMonth] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }))

  useEffect(() => {
    fetch('/api/campaigns').then((r) => r.json()).then((d) => setCampaigns(d.campaigns ?? []))
  }, [])

  useEffect(() => {
    const from = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(currentMonth.year, currentMonth.month + 1, 0).getDate()
    const to = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, '0')}-${lastDay}`
    const params = new URLSearchParams({ from, to })
    if (selectedCampaign) params.set('campaign_id', selectedCampaign)
    fetch(`/api/calendar?${params}`).then((r) => r.json()).then((d) => setSlots(d.slots ?? []))
  }, [currentMonth, selectedCampaign])

  const daysInMonth = new Date(currentMonth.year, currentMonth.month + 1, 0).getDate()
  const firstDayOfWeek = (new Date(currentMonth.year, currentMonth.month, 1).getDay() + 6) % 7
  const monthName = new Date(currentMonth.year, currentMonth.month).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  const getSlotsByDay = (day: number) => {
    const dateStr = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return slots.filter((s) => s.scheduled_date === dateStr)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <select value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)} className="input" style={{ maxWidth: 250 }}>
          <option value="">Toutes les campagnes</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={() => setCurrentMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })} className="btn-ghost" style={{ padding: '0.4rem' }}><ChevronLeft size={16} /></button>
          <span style={{ fontWeight: 700, minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{monthName}</span>
          <button onClick={() => setCurrentMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })} className="btn-ghost" style={{ padding: '0.4rem' }}><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
            <div key={d} style={{ padding: '0.6rem', textAlign: 'center', fontWeight: 700, fontSize: '0.72rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{d}</div>
          ))}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`e-${i}`} style={{ minHeight: 80, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const daySlots = getSlotsByDay(day)
            const isToday = new Date().getFullYear() === currentMonth.year && new Date().getMonth() === currentMonth.month && new Date().getDate() === day
            return (
              <div key={day} style={{ padding: '0.3rem', minHeight: 80, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', background: isToday ? 'var(--accent-lighter)' : undefined }}>
                <div style={{ fontSize: '0.72rem', fontWeight: isToday ? 800 : 500, color: isToday ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 3 }}>{day}</div>
                {daySlots.map((s) => (
                  <div key={s.id} style={{ padding: '2px 5px', borderRadius: 3, marginBottom: 2, fontSize: '0.62rem', background: `${PAGE_TYPE_COLORS[s.page_type] || '#6b7280'}10`, borderLeft: `2px solid ${PAGE_TYPE_COLORS[s.page_type] || '#6b7280'}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.target_keyword}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PagesView() {
  const [pages, setPages] = useState<Array<{ id: string; title?: string; slug?: string; published_url?: string; status: string; page_type?: string; created_at: string }>>([])

  useEffect(() => {
    fetch('/api/articles').then((r) => r.json()).then((d) => setPages(d.articles ?? []))
  }, [])

  return (
    <div className="glass-card">
      {pages.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Aucune page publiée. Générez et publiez du contenu depuis les étapes précédentes.</p>
      ) : (
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>Titre</th>
              <th style={{ textAlign: 'left', padding: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>Type</th>
              <th style={{ textAlign: 'left', padding: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>Statut</th>
              <th style={{ textAlign: 'left', padding: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.6rem', fontWeight: 500 }}>{p.title || p.slug || '—'}</td>
                <td style={{ padding: '0.6rem' }}>
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, background: `${PAGE_TYPE_COLORS[p.page_type || ''] || '#6b7280'}12`, color: PAGE_TYPE_COLORS[p.page_type || ''] || '#6b7280', fontWeight: 600 }}>
                    {p.page_type || 'page'}
                  </span>
                </td>
                <td style={{ padding: '0.6rem' }}><span className={`badge badge-${p.status === 'publish' ? 'success' : 'muted'}`}>{p.status}</span></td>
                <td style={{ padding: '0.6rem', color: 'var(--text-muted)' }}>{new Date(p.created_at).toLocaleDateString('fr-FR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PerformanceView() {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [data, setData] = useState<{
    pages: Array<{ page_url: string; clicks: number; impressions: number; ctr: number; position: number }>
    queries: Array<{ query: string; clicks: number; impressions: number; position: number }>
    totals: { clicks: number; impressions: number; ctr: number; position: number }
  } | null>(null)
  const [gbp, setGbp] = useState<{ connected: boolean; profile?: { business_name: string; phone: string; reviews_summary?: { average_rating: number; total_count: number }; last_synced_at: string } } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/sites').then((r) => r.json()).then((d) => {
      const loaded = d.sites ?? []
      setSites(loaded)
      if (loaded.length > 0) setSelectedSite(loaded[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selectedSite) return
    setLoading(true)
    Promise.all([
      fetch(`/api/sites/${selectedSite}/google/gsc?days=28`).then((r) => r.json()),
      fetch(`/api/sites/${selectedSite}/google/gbp`).then((r) => r.json()),
    ]).then(([gscData, gbpData]) => {
      setData(gscData.pages ? gscData : null)
      setGbp(gbpData)
    }).catch(() => {
      setData(null)
      setGbp(null)
    }).finally(() => setLoading(false))
  }, [selectedSite])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <select value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)} className="input" style={{ maxWidth: 250 }}>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!gbp?.connected && selectedSite && (
          <a href={`/api/google/auth?site_id=${selectedSite}`} className="btn-primary" style={{ fontSize: '0.78rem', padding: '0.5rem 1rem' }}>
            Connecter Google
          </a>
        )}
      </div>

      {loading && <div className="glass-card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Chargement...</div>}

      {!loading && !data && !gbp?.connected && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '2rem' }}>
          <TrendingUp size={32} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Connectez Google (Search Console + Business Profile) pour voir les performances de vos pages.
          </p>
        </div>
      )}

      {gbp?.connected && gbp.profile && (
        <div className="glass-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>GBP Note</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{gbp.profile.reviews_summary?.average_rating || '—'}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>/5</span></div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Avis Google</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{gbp.profile.reviews_summary?.total_count || 0}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Clics 28j</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981' }}>{data?.totals.clicks || 0}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Position moy.</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{data?.totals.position || '—'}</div>
          </div>
        </div>
      )}

      {data && data.pages.length > 0 && (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>Pages — Performance Search Console (28j)</h3>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.6rem 1rem', fontWeight: 600, color: 'var(--text-muted)' }}>Page</th>
                  <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Clics</th>
                  <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Impressions</th>
                  <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>CTR</th>
                  <th style={{ textAlign: 'right', padding: '0.6rem 1rem', fontWeight: 600, color: 'var(--text-muted)' }}>Position</th>
                </tr>
              </thead>
              <tbody>
                {data.pages.slice(0, 20).map((p) => (
                  <tr key={p.page_url} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 1rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.page_url.replace(/^https?:\/\/[^/]+/, '')}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>{p.clicks}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: 'var(--text-muted)' }}>{p.impressions}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>{(p.ctr * 100).toFixed(1)}%</td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 600, color: p.position <= 10 ? '#10b981' : p.position <= 20 ? '#f59e0b' : 'var(--text-secondary)' }}>
                      {p.position}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.queries.length > 0 && (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>Top Requetes (28j)</h3>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.6rem 1rem', fontWeight: 600, color: 'var(--text-muted)' }}>Requete</th>
                  <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Clics</th>
                  <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Impressions</th>
                  <th style={{ textAlign: 'right', padding: '0.6rem 1rem', fontWeight: 600, color: 'var(--text-muted)' }}>Position</th>
                </tr>
              </thead>
              <tbody>
                {data.queries.slice(0, 20).map((q) => (
                  <tr key={q.query} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 500 }}>{q.query}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>{q.clicks}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: 'var(--text-muted)' }}>{q.impressions}</td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 600, color: q.position <= 10 ? '#10b981' : q.position <= 20 ? '#f59e0b' : 'var(--text-secondary)' }}>
                      {q.position}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function BacklinksView() {
  const [backlinks, setBacklinks] = useState<Array<{ id: string; source_url: string; anchor_text?: string; link_type: string; domain_authority?: number }>>([])

  useEffect(() => {
    fetch('/api/backlinks').then((r) => r.json()).then((d) => setBacklinks(d.backlinks ?? []))
  }, [])

  return (
    <div className="glass-card">
      {backlinks.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Aucun backlink suivi. Les backlinks permettent de suivre votre profil de liens entrants.</p>
      ) : (
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>Source</th>
              <th style={{ textAlign: 'left', padding: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>Ancre</th>
              <th style={{ textAlign: 'left', padding: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>Type</th>
              <th style={{ textAlign: 'left', padding: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>DA</th>
            </tr>
          </thead>
          <tbody>
            {backlinks.map((b) => (
              <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.6rem' }}><a href={b.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{new URL(b.source_url).hostname}</a></td>
                <td style={{ padding: '0.6rem' }}>{b.anchor_text || '—'}</td>
                <td style={{ padding: '0.6rem' }}><span className="badge badge-info">{b.link_type}</span></td>
                <td style={{ padding: '0.6rem', fontWeight: 600 }}>{b.domain_authority || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
