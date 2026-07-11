'use client'

import { useState } from 'react'
import { Globe2, Code2, CheckCircle, ArrowRight, Eye, EyeOff, Globe } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { PageHeader, FormField } from '@/components/ui'

type SiteType = 'wordpress' | 'nextjs'

const SITE_TYPES = [
  { type: 'wordpress' as SiteType, icon: Globe2, label: 'WordPress', desc: 'REST API + App Password', color: '#6366f1' },
  { type: 'nextjs' as SiteType, icon: Code2, label: 'Next.js', desc: 'GitHub API + MDX', color: '#a855f7' },
]

export default function NewSitePage() {
  const router = useRouter()
  const [siteType, setSiteType] = useState<SiteType>('wordpress')
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({
    name: '', url: '', wp_username: '', wp_app_password: '',
    github_repo: '', github_token: '', github_mdx_path: 'content/pages',
  })

  const handle = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/sites/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: siteType, ...form }),
      })
      const data = await res.json()
      setTestResult({ ok: data.success, message: data.siteName || data.error })
    } catch {
      setTestResult({ ok: false, message: 'Impossible de joindre le serveur' })
    } finally {
      setTesting(false)
    }
  }

  const submit = async () => {
    setLoading(true)
    try {
      await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: siteType, ...form }),
      })
      router.push('/sites')
    } catch {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <PageHeader
        icon={Globe}
        iconColor="#6366f1"
        badge="Sites"
        title="Ajouter un site"
        subtitle="Connectez un site WordPress ou Next.js pour y publier vos pages SEO."
      />

      {/* Type selector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {SITE_TYPES.map(({ type, icon: Icon, label, desc, color }) => (
          <button
            key={type}
            onClick={() => setSiteType(type)}
            style={{
              background: siteType === type ? `${color}15` : 'var(--bg-card)',
              border: `1px solid ${siteType === type ? color : 'var(--border)'}`,
              borderRadius: 12, padding: '1rem', cursor: 'pointer',
              display: 'flex', gap: '0.75rem', alignItems: 'center', textAlign: 'left', transition: 'all 0.2s',
            }}
          >
            <Icon size={22} color={siteType === type ? color : 'var(--text-muted)'} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: siteType === type ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{desc}</div>
            </div>
            {siteType === type && <CheckCircle size={16} color={color} style={{ marginLeft: 'auto' }} />}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <FormField label="Nom du site">
          <input suppressHydrationWarning name="name" value={form.name} onChange={handle} className="input" placeholder="BoxnFit – Site principal" />
        </FormField>

        <FormField label="URL du site">
          <input suppressHydrationWarning name="url" value={form.url} onChange={handle} className="input" placeholder="https://boxnfit.fr" />
        </FormField>

        {siteType === 'wordpress' && (<>
          <FormField label="Nom d'utilisateur WordPress">
            <input suppressHydrationWarning name="wp_username" value={form.wp_username} onChange={handle} className="input" placeholder="admin" />
          </FormField>
          <FormField label="Application Password" hint="← WordPress → Utilisateurs → Votre profil → Application Passwords">
            <div style={{ position: 'relative' }}>
              <input
                suppressHydrationWarning
                name="wp_app_password"
                type={showPassword ? 'text' : 'password'}
                value={form.wp_app_password}
                onChange={handle}
                className="input"
                placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                style={{ paddingRight: '2.5rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </FormField>
        </>)}

        {siteType === 'nextjs' && (<>
          <FormField label="Repo GitHub (format: owner/repo)">
            <input suppressHydrationWarning name="github_repo" value={form.github_repo} onChange={handle} className="input" placeholder="moncompte/mon-site-nextjs" />
          </FormField>
          <FormField label="GitHub Personal Access Token">
            <input suppressHydrationWarning name="github_token" type="password" value={form.github_token} onChange={handle} className="input" placeholder="ghp_xxxxxxxxxxxx" />
          </FormField>
          <FormField label="Dossier MDX (dans le repo)">
            <input suppressHydrationWarning name="github_mdx_path" value={form.github_mdx_path} onChange={handle} className="input" placeholder="content/pages" />
          </FormField>
        </>)}

        {testResult && (
          <div style={{
            padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem',
            background: testResult.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${testResult.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: testResult.ok ? '#10b981' : '#ef4444',
          }}>
            {testResult.ok ? '✅ Connexion réussie : ' : '❌ Erreur : '}{testResult.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button onClick={testConnection} disabled={testing} className="btn-ghost">
            {testing ? <><div className="spinner" /> Test...</> : '🔌 Tester la connexion'}
          </button>
          <button onClick={submit} disabled={loading || !form.name || !form.url} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
            {loading ? <><div className="spinner" /> Sauvegarde...</> : <><ArrowRight size={15} /> Enregistrer le site</>}
          </button>
        </div>
      </div>
    </div>
  )
}
