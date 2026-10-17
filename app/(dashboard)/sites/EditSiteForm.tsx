'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Le formulaire d'un site — section « Identité et accès » de l'onglet Réglages
//
// Il vivait seul sur /sites/[id]/edit et renvoyait vers la liste des sites
// après l'enregistrement. Il est maintenant une section des réglages du site :
// enregistrer RESTE sur le site (l'en-tête du layout se relit, le nom changé y
// apparaît), et la zone de suppression est rendue par la page, en dernier, sous
// la connexion Google et le schéma — un formulaire n'a pas à décider de ce qui
// le suit.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Eye, EyeOff, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button, FormField, Notice } from '@/components/ui'
import type { SiteType } from '@/lib/types'

/**
 * Everything the form needs, and NOTHING the page must not have.
 *
 * Built by the server page from `listSites()`, which selects
 * `SITE_SAFE_COLUMNS` — the two secret columns are not in it, so they cannot
 * leak into the HTML even by accident. The form therefore starts every secret
 * field EMPTY and the API treats an empty secret as « unchanged ».
 */
export interface EditableSite {
  id: string
  name: string
  type: SiteType
  url: string
  is_active: boolean
  wp_username: string
  wp_page_template: string
  github_repo: string
  github_branch: string
  auto_promote: boolean
}

/** Le formulaire tel que la page l'ouvre : les secrets toujours vides. */
function initialForm(site: EditableSite) {
  return {
    name: site.name,
    url: site.url,
    is_active: site.is_active,
    wp_username: site.wp_username,
    // Never prefilled: the page does not have it, and must not.
    wp_app_password: '',
    wp_page_template: site.wp_page_template,
    github_repo: site.github_repo,
    github_token: '',
    github_branch: site.github_branch,
    auto_promote: site.auto_promote,
  }
}

export function EditSiteForm({ site }: { site: EditableSite }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState(() => initialForm(site))

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false)
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))
  }

  /**
   * Sends only the connector's own fields. A WordPress site has no business
   * receiving `github_branch: ''` — the API would accept it, and a stray value
   * on the wrong connector is exactly the kind of row nobody notices until a
   * publication reads it.
   */
  const submit = async () => {
    setSaving(true)
    setError('')
    setSaved(false)

    const body: Record<string, string | boolean> = {
      name: form.name.trim(),
      url: form.url.trim(),
      is_active: form.is_active,
    }
    if (site.type === 'wordpress') {
      body.wp_username = form.wp_username.trim()
      body.wp_page_template = form.wp_page_template.trim()
      // Omitted rather than sent empty: « unchanged » should look like
      // nothing was said, not like an empty password was offered.
      if (form.wp_app_password) body.wp_app_password = form.wp_app_password
    } else {
      body.github_repo = form.github_repo.trim()
      body.github_branch = form.github_branch.trim()
      body.auto_promote = form.auto_promote
      if (form.github_token) body.github_token = form.github_token
    }

    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Enregistrement refusé (erreur ${res.status})`)
        return
      }
      // On reste sur le site. `refresh()` relit les composants serveur — l'en-tête
      // du layout, le rail — qui afficheraient sinon l'ancien nom, l'ancienne
      // adresse ou l'ancien état actif depuis le cache du routeur. Les secrets
      // tapés sont effacés du formulaire : enregistrés, ils ne se relisent plus.
      setForm((prev) => ({ ...prev, wp_app_password: '', github_token: '' }))
      setSaved(true)
      router.refresh()
    } catch {
      setError('Impossible de joindre le serveur')
    } finally {
      setSaving(false)
    }
  }

  // Secrets are optional here (empty = unchanged); the identity fields are not.
  const complete = site.type === 'wordpress'
    ? Boolean(form.name.trim() && form.url.trim() && form.wp_username.trim())
    : Boolean(form.name.trim() && form.url.trim() && form.github_repo.trim())

  return (
    <>
      <div className="panel">
        <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <FormField label="Nom du site" required htmlFor="site-name">
            <input suppressHydrationWarning id="site-name" name="name" value={form.name} onChange={handle} className="input" placeholder="BoxnFit – Site principal" />
          </FormField>

          <FormField label="URL du site" required htmlFor="site-url" hint="avec https://">
            <input suppressHydrationWarning id="site-url" name="url" value={form.url} onChange={handle} className="input" placeholder="https://boxnfit.fr" />
          </FormField>

          <FormField label="État" htmlFor="site-active">
            <label htmlFor="site-active" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                suppressHydrationWarning
                id="site-active"
                name="is_active"
                type="checkbox"
                checked={form.is_active}
                onChange={handle}
                style={{ marginTop: 3 }}
              />
              <span>Site actif</span>
            </label>
            {/* The consequence, not the label: « inactif » reads as a flag;
                « rien n’y sera publié » is what the operator is deciding. */}
            <p className="meta" style={{ marginTop: 'var(--space-2)' }}>
              {form.is_active
                ? 'Le planificateur génère et publie sur ce site selon ses campagnes.'
                : 'Désactivé, le planificateur ignore ce site : rien n’y sera généré ni publié, les campagnes restent en place.'}
            </p>
          </FormField>

          {site.type === 'wordpress' && (
            <>
              <FormField label="Nom d’utilisateur WordPress" required htmlFor="wp-user">
                <input suppressHydrationWarning id="wp-user" name="wp_username" value={form.wp_username} onChange={handle} className="input" placeholder="admin" />
              </FormField>
              <FormField
                label="Application Password"
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
                    placeholder="inchangé si vide"
                    autoComplete="new-password"
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
                <p className="meta" style={{ marginTop: 'var(--space-2)' }}>
                  Le mot de passe enregistré n’est jamais renvoyé par le serveur. Laissez ce champ vide pour le conserver.
                </p>
              </FormField>
              <FormField label="Modèle de page" htmlFor="wp-template" hint="facultatif">
                <input suppressHydrationWarning id="wp-template" name="wp_page_template" value={form.wp_page_template} onChange={handle} className="input" placeholder="page-landing.php" />
                <p className="meta" style={{ marginTop: 'var(--space-2)' }}>
                  Nom du fichier de modèle WordPress appliqué aux pages publiées. Vide, le thème choisit son modèle par défaut.
                </p>
              </FormField>
            </>
          )}

          {site.type === 'nextjs' && (
            <>
              <FormField label="Dépôt GitHub" required htmlFor="gh-repo" hint="format owner/repo">
                <input suppressHydrationWarning id="gh-repo" name="github_repo" value={form.github_repo} onChange={handle} className="input" placeholder="moncompte/mon-site-nextjs" />
              </FormField>
              <FormField label="Personal Access Token" htmlFor="gh-token">
                <input
                  suppressHydrationWarning
                  id="gh-token"
                  name="github_token"
                  type="password"
                  value={form.github_token}
                  onChange={handle}
                  className="input"
                  placeholder="inchangé si vide"
                  autoComplete="new-password"
                />
                <p className="meta" style={{ marginTop: 'var(--space-2)' }}>
                  Le jeton enregistré n’est jamais renvoyé par le serveur. Laissez ce champ vide pour le conserver.
                </p>
              </FormField>
              <FormField label="Branche cible" htmlFor="gh-branch" hint="recommandé">
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
                  {/* Same two sentences as the creation form: the choice has the
                      same consequence whether it is made at creation or later. */}
                  <p className="meta" style={{ marginTop: 'var(--space-2)' }}>
                    {form.auto_promote
                      ? `Chaque page publiée sera reportée sur la branche par défaut, donc déployée. La branche « ${form.github_branch.trim()} » garde la trace et permet de revenir en arrière.`
                      : `Les pages resteront sur « ${form.github_branch.trim()} » jusqu’à une fusion manuelle. Tant qu’elle n’a pas lieu, elles ne sont visibles nulle part.`}
                  </p>
                </FormField>
              )}
            </>
          )}

          {error && <Notice inline tone="critical" title="Modifications non enregistrées" body={error} />}
          {saved && <Notice inline tone="good" title="Modifications enregistrées" body="Le site a été mis à jour." />}
        </div>

        <div className="panel__footer" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* « Annuler » revient aux valeurs enregistrées au lieu de quitter la
              page : le formulaire est une section parmi d'autres, partir
              ferait perdre la connexion Google et le schéma affichés autour. */}
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setForm(initialForm(site))
              setError('')
              setSaved(false)
            }}
          >
            Annuler les changements
          </Button>
          <div style={{ flex: 1 }} />
          <Button icon={Save} loading={saving} onClick={submit} disabled={!complete}>
            Enregistrer les modifications
          </Button>
        </div>
      </div>
    </>
  )
}
