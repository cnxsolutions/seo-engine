'use client'

import { useEffect, useState } from 'react'
import { Target, Loader2, Calendar, X } from 'lucide-react'
import { PageHeader, FormField, StatusBadge } from '@/components/ui'
import { COMMUNES_AUBE } from '@/lib/geo/communes'
import type { Site, Campaign, PlanPreviewItem } from '@/lib/types'

const FREQUENCIES = [
  { value: 'manual', label: 'Manuel' },
  { value: 'daily', label: 'Tous les jours' },
  { value: 'every_2_days', label: 'Tous les 2 jours' },
  { value: 'every_3_days', label: 'Tous les 3 jours' },
  { value: 'weekly', label: 'Hebdomadaire' },
]

const FREQUENCY_TO_HOURS: Record<string, number> = {
  manual: 0, daily: 24, every_2_days: 48, every_3_days: 72, weekly: 168,
}

const AI_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'claude-haiku', label: 'Claude Haiku' },
]

const PAGE_TYPES = [
  { value: 'pillar', label: 'Pilier' },
  { value: 'child', label: 'Fille' },
  { value: 'alternative', label: 'Alternative' },
  { value: 'comparative', label: 'Comparatif' },
  { value: 'local_pack', label: 'Local Pack' },
]

type View = 'list' | 'create'

export default function StrategyPage() {
  const [view, setView] = useState<View>('list')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selectedCommunes, setSelectedCommunes] = useState<string[]>([])
  const [selectedPageTypes, setSelectedPageTypes] = useState<string[]>(['pillar', 'child', 'local_pack'])
  const [form, setForm] = useState({
    name: '', site_id: '', business_type: '', business_name: '',
    keywords: '', department: 'Aube', schedule_frequency: 'every_2_days',
    schedule_time: '09:00', ai_model: 'gpt-4o-mini', publish_status: 'draft',
    auto_publish: false, target_length: '800', enable_external_links: true,
    external_link_count: '3', enable_images: true, image_per_page: '2',
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/campaigns').then((r) => r.json()),
      fetch('/api/sites').then((r) => r.json()),
    ]).then(([c, s]) => {
      setCampaigns(c.campaigns ?? [])
      setSites(s.sites ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))

  const submit = async () => {
    if (!form.name || !form.business_name || !form.site_id) return
    setCreating(true)
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        communes: selectedCommunes,
        page_types: selectedPageTypes,
        keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
        frequency_hours: FREQUENCY_TO_HOURS[form.schedule_frequency] || 0,
        target_length: parseInt(form.target_length, 10),
        external_link_count: parseInt(form.external_link_count, 10),
        image_per_page: parseInt(form.image_per_page, 10),
        auto_publish: form.auto_publish,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setCampaigns((prev) => [data.campaign, ...prev])
      setView('list')
    }
    setCreating(false)
  }

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // ── Cycle Plan ──────────────────────────────────────────
  const [planModal, setPlanModal] = useState<{ campaign: Campaign; items: PlanPreviewItem[]; planId: string } | null>(null)
  const [planLoading, setPlanLoading] = useState<string | null>(null)
  const [cycleDays, setCycleDays] = useState(14)

  const generatePlan = async (campaign: Campaign) => {
    setPlanLoading(campaign.id)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle_duration_days: cycleDays }),
      })
      const data = await res.json()
      if (res.ok && data.plan) {
        setPlanModal({ campaign, items: data.plan.plan_data, planId: data.plan.id })
      } else {
        setToast({ type: 'error', message: data.error || 'Erreur plan' })
      }
    } catch {
      setToast({ type: 'error', message: 'Erreur réseau' })
    } finally {
      setPlanLoading(null)
    }
  }

  const confirmPlan = async () => {
    if (!planModal) return
    try {
      const res = await fetch(`/api/campaigns/${planModal.campaign.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', plan_id: planModal.planId }),
      })
      const data = await res.json()
      if (res.ok) {
        setToast({ type: 'success', message: `Cycle lancé ! ${planModal.items.length} pages sur ${cycleDays} jours` })
        setPlanModal(null)
      } else {
        setToast({ type: 'error', message: data.error || 'Erreur confirmation' })
      }
    } catch {
      setToast({ type: 'error', message: 'Erreur réseau' })
    }
  }

  if (view === 'create') {
    return (
      <div style={{ maxWidth: 860 }}>
        <PageHeader
          icon={Target}
          iconColor="#5347ce"
          badge="Étape 2"
          title="Nouvelle stratégie de contenu"
          subtitle="Définissez votre campagne SEO : types de pages, fréquence, zones ciblées"
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
            <FormField label="Nom de la stratégie">
              <input name="name" value={form.name} onChange={handle} className="input" placeholder="SEO Plombier Troyes" />
            </FormField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField label="Site cible">
                <select name="site_id" value={form.site_id} onChange={handle} className="input">
                  <option value="">Choisir un site</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}
                </select>
              </FormField>
              <FormField label="Département">
                <input name="department" value={form.department} onChange={handle} className="input" />
              </FormField>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField label="Type d'activité">
                <input name="business_type" value={form.business_type} onChange={handle} className="input" placeholder="plombier, coach..." />
              </FormField>
              <FormField label="Nom du business">
                <input name="business_name" value={form.business_name} onChange={handle} className="input" />
              </FormField>
            </div>
            <FormField label="Mots-clés (virgule)">
              <input name="keywords" value={form.keywords} onChange={handle} className="input" placeholder="plombier, fuite, dépannage" />
            </FormField>
          </div>

          {/* Page types */}
          <div className="glass-card">
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>Types de pages à générer</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {PAGE_TYPES.map((t) => {
                const active = selectedPageTypes.includes(t.value)
                return (
                  <button key={t.value} onClick={() => setSelectedPageTypes((prev) => active ? prev.filter((x) => x !== t.value) : [...prev, t.value])}
                    style={{ padding: '0.5rem 1rem', borderRadius: 8, border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-lighter)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}>
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Schedule + settings */}
          <div className="glass-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <FormField label="Fréquence">
              <select name="schedule_frequency" value={form.schedule_frequency} onChange={handle} className="input">
                {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </FormField>
            <FormField label="Modèle IA">
              <select name="ai_model" value={form.ai_model} onChange={handle} className="input">
                {AI_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </FormField>
            <FormField label="Longueur">
              <select name="target_length" value={form.target_length} onChange={handle} className="input">
                <option value="600">600 mots</option>
                <option value="800">800 mots</option>
                <option value="1200">1200 mots</option>
                <option value="2000">2000 mots</option>
              </select>
            </FormField>
          </div>

          {/* Communes */}
          <div className="glass-card">
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Communes cibles ({selectedCommunes.length})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem' }}>
              {COMMUNES_AUBE.map((c) => {
                const active = selectedCommunes.includes(c.name)
                return (
                  <button key={c.slug} onClick={() => setSelectedCommunes((prev) => active ? prev.filter((x) => x !== c.name) : [...prev, c.name])}
                    style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-lighter)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textAlign: 'left' }}>
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setView('list')} className="btn-ghost">Annuler</button>
            <button onClick={submit} disabled={creating || !form.name || !form.site_id} className="btn-primary">
              {creating ? 'Création...' : 'Créer la stratégie'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        icon={Target}
        iconColor="#5347ce"
        badge="Étape 2"
        title="Stratégie de contenu"
        subtitle="Vos campagnes SEO planifiées — créez-en une après avoir analysé un site"
        action={{ label: '+ Nouvelle stratégie', href: '/strategy/new' }}
      />

      {toast && (
        <div style={{
          padding: '0.75rem 1.25rem',
          borderRadius: 10,
          marginBottom: '1rem',
          background: toast.type === 'success' ? '#ecfdf5' : '#fef2f2',
          border: `1px solid ${toast.type === 'success' ? '#6ee7b7' : '#fca5a5'}`,
          color: toast.type === 'success' ? '#065f46' : '#991b1b',
          fontSize: '0.85rem',
          fontWeight: 500,
        }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.message}
        </div>
      )}

      {loading ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Target size={40} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
          <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Aucune stratégie</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Commencez par analyser un site (étape 1), puis créez votre stratégie ici.
          </p>
          <button onClick={() => setView('create')} className="btn-primary">Créer une stratégie</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {campaigns.map((c) => (
            <div key={c.id} className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.5rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>{c.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {c.business_type} • {c.communes.length} communes • {c.ai_model} • {c.page_types?.join(', ') || 'child'}
                </div>
              </div>
              <StatusBadge status={c.is_active ? 'active' : 'inactive'} />
              <button onClick={() => generatePlan(c)} disabled={planLoading === c.id} className="btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.78rem', gap: 6 }}>
                {planLoading === c.id ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
                Planifier un cycle
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Plan Cycle Modal */}
      {planModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', padding: '2rem' }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 16, maxWidth: 900, width: '100%', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontWeight: 700, fontSize: '1.1rem', margin: 0 }}>Plan du cycle — {planModal.campaign.name}</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  {planModal.items.length} pages sur {cycleDays} jours • ~{planModal.items.reduce((s, i) => s + i.estimated_word_count, 0).toLocaleString()} mots
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <select value={cycleDays} onChange={(e) => setCycleDays(Number(e.target.value))} className="input" style={{ width: 140, fontSize: '0.8rem' }}>
                  <option value={7}>7 jours</option>
                  <option value={14}>14 jours</option>
                  <option value={21}>21 jours</option>
                  <option value={30}>30 jours</option>
                </select>
                <button onClick={() => setPlanModal(null)} className="btn-ghost" style={{ padding: '0.5rem' }}><X size={16} /></button>
              </div>
            </div>
            <div style={{ overflow: 'auto', flex: 1, padding: '1rem 1.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }}>Titre proposé</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }}>Slug</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600 }}>Ville</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem', fontWeight: 600 }}>Mots</th>
                  </tr>
                </thead>
                <tbody>
                  {planModal.items.map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{item.scheduled_date}</td>
                      <td style={{ padding: '0.5rem' }}>
                        <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600, background: typeColor(item.page_type) + '20', color: typeColor(item.page_type) }}>
                          {item.page_type}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem', fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.proposed_title}</td>
                      <td style={{ padding: '0.5rem', color: 'var(--text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.7rem' }}>/{item.proposed_slug}</td>
                      <td style={{ padding: '0.5rem' }}>{item.target_city}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right' }}>~{item.estimated_word_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Après confirmation, le cycle tourne en 100% automatique (génération + publication + re-crawl)
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={() => generatePlan(planModal.campaign)} className="btn-ghost">Régénérer</button>
                <button onClick={confirmPlan} className="btn-primary">Confirmer et lancer le cycle</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const PAGE_TYPE_COLOR: Record<string, string> = {
  pillar: '#6366f1', child: '#10b981', alternative: '#f59e0b', comparative: '#ef4444', local_pack: '#8b5cf6',
}
function typeColor(type: string) { return PAGE_TYPE_COLOR[type] || '#6b7280' }
