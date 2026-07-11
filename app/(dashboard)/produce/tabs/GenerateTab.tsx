'use client'

import { useState } from 'react'
import { FormField } from '@/components/ui'
import { COMMUNES_AUBE } from '@/lib/geo/communes'

const PAGE_TYPE_OPTIONS = [
  { value: 'pillar', label: 'Pilier (exhaustif, 2000+ mots)' },
  { value: 'child', label: 'Fille (sous-aspect, 800+ mots)' },
  { value: 'alternative', label: 'Alternative ("Alternative à X")' },
  { value: 'comparative', label: 'Comparatif ("X vs Y")' },
  { value: 'local_pack', label: 'Local Pack (Google Maps)' },
]

export default function GenerateTab() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({
    city: '', department: 'Aube', businessType: '', businessName: '',
    siteUrl: '', keywords: '', targetLength: '800', model: 'gpt-4o-mini',
    pageType: 'child',
  })

  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))

  const submit = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: form.city,
          department: form.department,
          businessType: form.businessType,
          businessName: form.businessName,
          siteUrl: form.siteUrl,
          keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
          targetLength: parseInt(form.targetLength, 10),
          model: form.model,
        }),
      })
      const data = await res.json()
      if (res.ok) setResult(data.page || data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem' }}>
      <div className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Génère une page SEO unique selon le type choisi (pilier, fille, local pack...).
        </p>
        <FormField label="Type de page">
          <select name="pageType" value={form.pageType} onChange={handle} className="input">
            {PAGE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Ville">
            <select name="city" value={form.city} onChange={handle} className="input">
              <option value="">Choisir</option>
              {COMMUNES_AUBE.map((c) => <option key={c.slug} value={c.name}>{c.name}</option>)}
            </select>
          </FormField>
          <FormField label="Département">
            <input name="department" value={form.department} onChange={handle} className="input" />
          </FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Activité">
            <input name="businessType" value={form.businessType} onChange={handle} className="input" placeholder="plombier" />
          </FormField>
          <FormField label="Business">
            <input name="businessName" value={form.businessName} onChange={handle} className="input" />
          </FormField>
        </div>
        <FormField label="URL du site">
          <input name="siteUrl" value={form.siteUrl} onChange={handle} className="input" placeholder="https://..." />
        </FormField>
        <FormField label="Mots-clés (virgule)">
          <input name="keywords" value={form.keywords} onChange={handle} className="input" placeholder="plombier, urgence, fuite" />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Modèle IA">
            <select name="model" value={form.model} onChange={handle} className="input">
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
              <option value="claude-haiku">Claude Haiku</option>
            </select>
          </FormField>
          <FormField label="Longueur">
            <select name="targetLength" value={form.targetLength} onChange={handle} className="input">
              <option value="600">600 mots</option>
              <option value="800">800 mots</option>
              <option value="1200">1200 mots</option>
              <option value="2000">2000 mots</option>
            </select>
          </FormField>
        </div>
        <button onClick={submit} disabled={loading || !form.city || !form.businessType} className="btn-primary" style={{ justifyContent: 'center', width: '100%' }}>
          {loading ? <><div className="spinner" /> Génération...</> : 'Générer la page'}
        </button>
      </div>

      <div className="glass-card">
        {!result ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontSize: '0.85rem' }}>La page générée apparaîtra ici avec le HTML, les métadonnées SEO et le schema.org.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4 }}>Titre</div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{(result as Record<string, string>).title}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Meta Description</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{(result as Record<string, string>).metaDescription}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Slug</div>
              <code style={{ fontSize: '0.82rem', background: 'var(--bg-primary)', padding: '0.3rem 0.6rem', borderRadius: 4 }}>/{(result as Record<string, string>).slug}</code>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Contenu HTML</div>
              <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', fontSize: '0.8rem' }}
                dangerouslySetInnerHTML={{ __html: (result as Record<string, string>).htmlContent || '' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
