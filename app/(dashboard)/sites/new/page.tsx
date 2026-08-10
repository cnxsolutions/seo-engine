'use client'

import { useState } from 'react'
import {
  ArrowRight, CheckCircle2, Code2, Eye, EyeOff, Globe, Globe2, PlugZap, TriangleAlert, type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button, FormField, IconBox, PageHeader } from '@/components/ui'
import type { SiteType } from '@/lib/types'

/**
 * Both connectors are alive: WordPress publishes through the REST API with an
 * application password, Next.js publishes by committing a page to a GitHub
 * repository. Neither is legacy — the form simply asks for the credentials the
 * chosen one needs.
 */
const SITE_TYPES: Array<{ type: SiteType; icon: LucideIcon; label: string; desc: string; color: string }> = [
  { type: 'wordpress', icon: Globe2, label: 'WordPress', desc: 'API REST + Application Password', color: 'var(--series-1)' },
  { type: 'nextjs', icon: Code2, label: 'Next.js', desc: 'Publication par commit GitHub', color: 'var(--series-7)' },
]

export default function NewSitePage() {
  const router = useRouter()
  const [siteType, setSiteType] = useState<SiteType>('wordpress')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; details?: string[] } | null>(null)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({
    name: '', url: '', wp_username: '', wp_app_password: '',
    github_repo: '', github_token: '', github_branch: '',
    // On by default whenever a branch is set. Off was the old behaviour and it
    // meant every published page sat in a branch nobody deployed.
    auto_promote: true,
  })

  const handle = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

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

      // The site NAME is not a diagnosis.
      //
      // `data.siteName || data.error` put the name first, so a connection that
      // reached the site and was refused by it displayed « Connexion refusée »
      // followed by the name of the site — the one thing that had worked. The
      // reason, which is the whole point of this button, never appeared.
      setTestResult(
        data.success
          ? { ok: true, message: data.siteName || 'Connexion établie', details: data.details }
          : { ok: false, message: data.error || 'Réponse inattendue', details: data.details }
      )
    } catch {
      setTestResult({ ok: false, message: 'Impossible de joindre le serveur' })
    } finally {
      setTesting(false)
    }
  }

  /**
   * The response used to be discarded: a rejected payload (missing credentials,
   * duplicate URL) still navigated to /sites, where the founder looked for a
   * site that had never been created.
   */
  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: siteType, ...form }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Enregistrement refusé (erreur ${res.status})`)
        return
      }
      router.push('/sites')
    } catch {
      setError('Impossible de joindre le serveur')
    } finally {
      setSaving(false)
    }
  }

  // Testing needs the credentials; saving also needs a name to file the site under.
  const credentialsFilled = siteType === 'wordpress'
    ? Boolean(form.url && form.wp_username && form.wp_app_password)
    : Boolean(form.url && form.github_repo && form.github_token)
  const complete = credentialsFilled && Boolean(form.name)

  return (
    <div style={{ maxWidth: 680 }}>
      <PageHeader
        icon={Globe}
        badge="Étape 1"
        title="Ajouter un site"
        subtitle="Connectez le site qui recevra les pages générées. Les identifiants restent côté serveur : ils ne repartent jamais dans une réponse HTTP."
        backHref="/sites"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        {SITE_TYPES.map(({ type, icon: Icon, label, desc, color }) => {
          const selected = siteType === type
          return (
            <button
              key={type}
              type="button"
              onClick={() => setSiteType(type)}
              aria-pressed={selected}
              className="card card--interactive"
              style={{
                display: 'flex', gap: 'var(--space-3)', alignItems: 'center', textAlign: 'left',
                padding: 'var(--space-4)',
                borderColor: selected ? 'var(--accent)' : 'var(--line)',
                boxShadow: selected ? '0 0 0 1px var(--accent-wash)' : 'var(--shadow-xs)',
              }}
            >
              <IconBox icon={Icon} color={color} boxSize={34} size={17} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, color: 'var(--ink-primary)', fontSize: 'var(--fs-md)' }}>{label}</span>
                <span className="meta">{desc}</span>
              </span>
              {selected && <CheckCircle2 size={16} color="var(--accent)" style={{ marginLeft: 'auto', flexShrink: 0 }} />}
            </button>
          )
        })}
      </div>

      <div className="panel">
        <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <FormField label="Nom du site" required htmlFor="site-name">
            <input suppressHydrationWarning id="site-name" name="name" value={form.name} onChange={handle} className="input" placeholder="BoxnFit – Site principal" />
          </FormField>

          <FormField label="URL du site" required htmlFor="site-url" hint="avec https://">
            <input suppressHydrationWarning id="site-url" name="url" value={form.url} onChange={handle} className="input" placeholder="https://boxnfit.fr" />
          </FormField>

          {siteType === 'wordpress' && (
            <>
              <FormField label="Nom d’utilisateur WordPress" required htmlFor="wp-user">
                <input suppressHydrationWarning id="wp-user" name="wp_username" value={form.wp_username} onChange={handle} className="input" placeholder="admin" />
              </FormField>
              <FormField
                label="Application Password"
                required
                htmlFor="wp-password"
                hint="WordPress → Utilisateurs → Profil → Application Passwords"
              >
                <div style={{ position: 'relative' }}>
                  <input
                    suppressHydrationWarning
                    id="wp-password"
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
                    className="btn-icon"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', border: 0 }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </FormField>
            </>
          )}

          {siteType === 'nextjs' && (
            <>
              <FormField label="Dépôt GitHub" required htmlFor="gh-repo" hint="format owner/repo">
                <input suppressHydrationWarning id="gh-repo" name="github_repo" value={form.github_repo} onChange={handle} className="input" placeholder="moncompte/mon-site-nextjs" />
              </FormField>
              <FormField label="Personal Access Token" required htmlFor="gh-token">
                <input suppressHydrationWarning id="gh-token" name="github_token" type="password" value={form.github_token} onChange={handle} className="input" placeholder="ghp_xxxxxxxxxxxx" />
              </FormField>
              <FormField
                label="Branche cible"
                htmlFor="gh-branch"
                hint="recommandé"
              >
                <input suppressHydrationWarning id="gh-branch" name="github_branch" value={form.github_branch} onChange={handle} className="input" placeholder="seo-engine" />
                <p className="meta" style={{ marginTop: 'var(--space-2)' }}>
                  Laissée vide, les pages sont commitées sur la branche par défaut — en production, sans relecture ni
                  vérification de build. Une branche dédiée permet de relire avant de fusionner.
                </p>
              </FormField>

              {form.github_branch.trim() !== '' && (
                <FormField label="Mise en ligne" htmlFor="auto-promote">
                  <label
                    htmlFor="auto-promote"
                    style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', cursor: 'pointer' }}
                  >
                    <input
                      suppressHydrationWarning
                      id="auto-promote"
                      name="auto_promote"
                      type="checkbox"
                      checked={form.auto_promote}
                      onChange={handle}
                      style={{ marginTop: 3 }}
                    />
                    <span>Fusionner automatiquement dans la branche de production après publication</span>
                  </label>
                  {/*
                    Says what happens either way. Leaving this off silently is
                    what made every page published so far invisible: the branch
                    collected commits while the host kept deploying another one.
                  */}
                  <p className="meta" style={{ marginTop: 'var(--space-2)' }}>
                    {form.auto_promote
                      ? `Chaque page publiée sera reportée sur la branche par défaut, donc déployée. La branche « ${form.github_branch.trim()} » garde la trace et permet de revenir en arrière.`
                      : `Les pages resteront sur « ${form.github_branch.trim()} » jusqu’à une fusion manuelle. Tant qu’elle n’a pas lieu, elles ne sont visibles nulle part.`}
                  </p>
                </FormField>
              )}
            </>
          )}

          {testResult && (
            <Notice
              tone={testResult.ok ? 'good' : 'critical'}
              title={testResult.ok ? 'Connexion réussie' : 'Connexion refusée'}
              body={[testResult.message, ...(testResult.details ?? [])]
                .filter((line, index, all) => line && all.indexOf(line) === index)
                .join(' · ')}
            />
          )}

          {error && <Notice tone="critical" title="Site non enregistré" body={error} />}
        </div>

        <div className="panel__footer" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Button variant="ghost" icon={PlugZap} loading={testing} onClick={testConnection} disabled={!credentialsFilled}>
            Tester la connexion
          </Button>
          <div style={{ flex: 1 }} />
          <Button iconRight={ArrowRight} loading={saving} onClick={submit} disabled={!complete}>
            Enregistrer le site
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Same shape as the notice used on the Google page: one tone, one title, one line. */
function Notice({ tone, title, body }: { tone: 'good' | 'critical'; title: string; body: string }) {
  const color = tone === 'good' ? 'var(--status-good)' : 'var(--status-critical)'
  const Icon = tone === 'good' ? CheckCircle2 : TriangleAlert

  return (
    <div className="inset" style={{ borderLeft: `3px solid ${color}`, display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
      <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: 'var(--fs-sm)' }}>{title}</strong>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', margin: '0.25rem 0 0', lineHeight: 1.55, wordBreak: 'break-word' }}>{body}</p>
      </div>
    </div>
  )
}
