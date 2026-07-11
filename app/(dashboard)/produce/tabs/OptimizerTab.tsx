'use client'

import { useState } from 'react'
import { FormField } from '@/components/ui'

export default function OptimizerTab() {
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [form, setForm] = useState({ title: '', keyword: '' })

  const handle = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))

  const submit = async () => {
    setLoading(true)
    setSuggestions([])
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'titles', title: form.title, keyword: form.keyword }),
      })
      const data = await res.json()
      if (res.ok) setSuggestions(data.titles ?? [])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Entrez un title existant et le mot-clé cible — l&apos;IA génère 5 alternatives optimisées pour le CTR.
        </p>
        <FormField label="Title actuel">
          <input name="title" value={form.title} onChange={handle} className="input" placeholder="Plombier Troyes | Mon Entreprise" />
        </FormField>
        <FormField label="Mot-clé cible">
          <input name="keyword" value={form.keyword} onChange={handle} className="input" placeholder="plombier Troyes" />
        </FormField>
        <button onClick={submit} disabled={loading || !form.title} className="btn-primary" style={{ justifyContent: 'center', width: '100%' }}>
          {loading ? <><div className="spinner" /> Optimisation...</> : 'Optimiser le title'}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="glass-card" style={{ marginTop: '1.5rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem' }}>
            Suggestions ({suggestions.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {suggestions.map((s, i) => (
              <div key={i} style={{
                padding: '0.75rem 1rem', borderRadius: 8,
                border: '1px solid var(--border)', background: i === 0 ? 'var(--accent-lighter)' : 'transparent',
                display: 'flex', alignItems: 'center', gap: '0.75rem',
              }}>
                <span style={{ fontWeight: 700, color: i === 0 ? 'var(--accent)' : 'var(--text-muted)', minWidth: 24 }}>#{i + 1}</span>
                <span style={{ fontSize: '0.88rem', fontWeight: i === 0 ? 600 : 400 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
