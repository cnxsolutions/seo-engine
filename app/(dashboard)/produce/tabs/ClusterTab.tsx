'use client'

import { useState } from 'react'
import { FormField } from '@/components/ui'
import type { GeneratedPage } from '@/lib/ai/openai'

interface CampaignPrefill {
  campaignId: string
  mainKeyword: string
  keywords: string
  businessType: string
  businessName: string
  city: string
  department: string
  siteId: string
  siteUrl: string
}

interface ClusterResult {
  pillarPage: GeneratedPage
  satellitePages: GeneratedPage[]
  alternativePages: GeneratedPage[]
  comparativePages: GeneratedPage[]
  localPackPage: GeneratedPage | null
  stats: {
    totalPages: number
    totalEstimatedWords: number
    pageTypes: Record<string, number>
  }
}

export default function ClusterTab({ prefill }: { prefill?: CampaignPrefill }) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<ClusterResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    mainKeyword: prefill?.mainKeyword || '',
    satellites: prefill?.keywords || '',
    businessType: prefill?.businessType || '',
    businessName: prefill?.businessName || '',
    city: prefill?.city || 'Troyes',
    department: prefill?.department || 'Aube',
    siteUrl: prefill?.siteUrl || '',
    enableAlternatives: true,
    enableComparatives: true,
    enableLocalPack: true,
  })

  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))

  const toggle = (key: 'enableAlternatives' | 'enableComparatives' | 'enableLocalPack') =>
    setForm((prev) => ({ ...prev, [key]: !prev[key] }))

  const submit = async () => {
    setLoading(true)
    setError(null)
    setProgress('Génération du cluster complet en cours...')
    try {
      const res = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainKeyword: form.mainKeyword,
          satelliteKeywords: form.satellites.split(',').map((s) => s.trim()).filter(Boolean),
          businessType: form.businessType,
          businessName: form.businessName,
          city: form.city,
          department: form.department,
          siteUrl: form.siteUrl,
          campaignId: prefill?.campaignId || undefined,
          siteId: prefill?.siteId || undefined,
          enableAlternatives: form.enableAlternatives,
          enableComparatives: form.enableComparatives,
          enableLocalPack: form.enableLocalPack,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult(data.cluster)
        setProgress('')
      } else {
        setError(data.error || 'Erreur lors de la génération')
        setProgress('')
      }
    } catch {
      setError('Impossible de contacter le serveur')
      setProgress('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '1.5rem' }}>
      <div className="glass-card" style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Génère un cluster SEO complet : pilier + filles + alternatives + comparatifs + local pack avec maillage interne automatique.
        </p>
        {prefill && (
          <div style={{ padding: '0.5rem 0.75rem', borderRadius: 8, background: 'var(--accent-lighter)', fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>
            Pré-rempli depuis votre stratégie
          </div>
        )}
        <FormField label="Mot-clé pilier (sujet principal)">
          <input name="mainKeyword" value={form.mainKeyword} onChange={handle} className="input" placeholder="plombier Troyes" />
        </FormField>
        <FormField label="Mots-clés filles (virgule)">
          <textarea name="satellites" value={form.satellites} onChange={handle} className="input" rows={4} placeholder="fuite Troyes, chauffe-eau Troyes, débouchage Troyes..." />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Business">
            <input name="businessName" value={form.businessName} onChange={handle} className="input" placeholder="Mon Entreprise" />
          </FormField>
          <FormField label="Activité">
            <input name="businessType" value={form.businessType} onChange={handle} className="input" placeholder="plombier" />
          </FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Ville">
            <input name="city" value={form.city} onChange={handle} className="input" />
          </FormField>
          <FormField label="URL du site">
            <input name="siteUrl" value={form.siteUrl} onChange={handle} className="input" placeholder="https://..." />
          </FormField>
        </div>

        {/* Types de pages avancés */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
            Pages avancées à générer
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {([
              { key: 'enableAlternatives' as const, label: 'Alternative', desc: 'Alternative à X — capte le trafic concurrent' },
              { key: 'enableComparatives' as const, label: 'Comparatif', desc: 'Meilleur X à Y — tableau + verdict' },
              { key: 'enableLocalPack' as const, label: 'Local Pack', desc: 'Google Maps — NAP, avis, zones' },
            ]).map(({ key, label, desc }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.4rem 0.5rem', borderRadius: 6, background: form[key] ? 'var(--accent-lighter)' : 'transparent' }}>
                <input type="checkbox" checked={form[key]} onChange={() => toggle(key)} style={{ accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.78rem' }}>
                  <strong>{label}</strong> — <span style={{ color: 'var(--text-muted)' }}>{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ padding: '0.5rem 0.75rem', borderRadius: 8, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: '0.78rem' }}>
            {error}
          </div>
        )}

        <button onClick={submit} disabled={loading || !form.mainKeyword || !form.siteUrl} className="btn-primary" style={{ justifyContent: 'center', width: '100%' }}>
          {loading ? <><div className="spinner" /> {progress}</> : 'Générer le cluster complet'}
        </button>
      </div>

      <div className="glass-card" style={{ overflow: 'auto', maxHeight: '80vh' }}>
        {!result ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontSize: '0.85rem' }}>Le cluster SEO complet apparaîtra ici :</p>
            <div style={{ fontSize: '0.78rem', textAlign: 'left', maxWidth: 320, margin: '1rem auto 0', lineHeight: 1.8 }}>
              <strong>1.</strong> Page Pilier (cornerstone, exhaustive)<br/>
              <strong>2.</strong> Pages Filles (sous-sujets spécifiques)<br/>
              <strong>3.</strong> Page Alternative (&quot;Alternative à X&quot;)<br/>
              <strong>4.</strong> Page Comparative (&quot;Meilleur X à Y&quot;)<br/>
              <strong>5.</strong> Page Local Pack (Google Maps, NAP)
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {/* Stats */}
            <div style={{ display: 'flex', gap: '1rem', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem' }}><strong>{result.stats.totalPages}</strong> pages</div>
              <div style={{ fontSize: '0.75rem' }}><strong>~{result.stats.totalEstimatedWords.toLocaleString()}</strong> mots</div>
              <div style={{ fontSize: '0.75rem' }}>
                {Object.entries(result.stats.pageTypes).map(([type, count]) => `${type}:${count}`).join(' · ')}
              </div>
            </div>

            {/* Pilier */}
            <PageCard page={result.pillarPage} type="pillar" label="Page Pilier" color="var(--accent)" />

            {/* Filles */}
            {result.satellitePages.length > 0 && (
              <>
                <SectionTitle label="Pages Filles" count={result.satellitePages.length} />
                {result.satellitePages.map((page) => (
                  <PageCard key={page.slug} page={page} type="child" label="Fille" />
                ))}
              </>
            )}

            {/* Alternatives */}
            {result.alternativePages.length > 0 && (
              <>
                <SectionTitle label="Pages Alternatives" count={result.alternativePages.length} />
                {result.alternativePages.map((page) => (
                  <PageCard key={page.slug} page={page} type="alternative" label="Alternative" color="#e67e22" />
                ))}
              </>
            )}

            {/* Comparatifs */}
            {result.comparativePages.length > 0 && (
              <>
                <SectionTitle label="Pages Comparatives" count={result.comparativePages.length} />
                {result.comparativePages.map((page) => (
                  <PageCard key={page.slug} page={page} type="comparative" label="Comparatif" color="#9b59b6" />
                ))}
              </>
            )}

            {/* Local Pack */}
            {result.localPackPage && (
              <>
                <SectionTitle label="Page Local Pack" count={1} />
                <PageCard page={result.localPackPage} type="local_pack" label="Local Pack" color="#27ae60" />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '0.5rem' }}>
      {label} ({count})
    </div>
  )
}

function PageCard({ page, type, label, color }: { page: GeneratedPage; type: string; label: string; color?: string }) {
  const borderColor = color || 'var(--border)'
  const isPillar = type === 'pillar'
  return (
    <div style={{
      padding: isPillar ? '1rem' : '0.75rem 1rem',
      borderRadius: 10,
      background: isPillar ? 'var(--accent-lighter)' : 'transparent',
      borderLeft: `4px solid ${borderColor}`,
      border: isPillar ? undefined : `1px solid var(--border)`,
      borderLeftColor: borderColor,
      borderLeftWidth: 4,
      borderLeftStyle: 'solid',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 4 }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: borderColor, textTransform: 'uppercase', background: `${borderColor}15`, padding: '2px 6px', borderRadius: 4 }}>
          {label}
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: isPillar ? '0.95rem' : '0.85rem' }}>{page.title}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
        /{page.slug} — ~{page.estimatedWordCount} mots
      </div>
      {page.metaDescription && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
          {page.metaDescription}
        </div>
      )}
    </div>
  )
}
