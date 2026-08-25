'use client'

import { useState } from 'react'
import { CheckCircle2, ScanSearch, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui'
import type { RepoProfile } from '@/lib/publishers/nextjs-analyzer'

/**
 * Triggers `POST /api/sites/:id/analyze`.
 *
 * The route already existed; nothing called it. Without a stored `repo_profile`
 * the publisher falls back to a light heuristic and writes a generic `page.tsx`
 * — a page that renders, but that looks nothing like the rest of the site. The
 * analysis reads the real tree (App or Pages router, `src/` prefix, where the
 * sitemap lives, an existing page used as a template) and is what makes a
 * generated page fit in.
 */
export function AnalyzeRepoButton({ siteId, hasProfile }: { siteId: string; hasProfile: boolean }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const run = async () => {
    setRunning(true)
    setResult(null)
    try {
      const response = await fetch(`/api/sites/${siteId}/analyze`, { method: 'POST' })
      const data = await response.json()

      if (!response.ok) {
        setResult({ ok: false, message: data.error || `Erreur ${response.status}` })
        return
      }

      const profile = data.profile as RepoProfile
      // Naming what was detected, not just "success": the whole point of this
      // step is the profile, and a wrong pageFolder is the kind of thing that
      // only shows up as a page committed in the wrong place, days later.
      const parts = [
        `router ${profile.router}`,
        `pages dans ${profile.pageFolder}`,
        profile.sitemapPath ? `sitemap ${profile.sitemapPath}` : 'aucun sitemap détecté',
      ]

      // What decides how a published page will LOOK is the chrome, not the
      // stored template — the scaffold takes precedence over it. So the chrome
      // is what this reports. Naming the mounted components matters: it is the
      // difference between "analysed" and "I can see it found my navbar".
      const chrome = [...(profile.chrome?.before ?? []), ...(profile.chrome?.after ?? [])]

      if (chrome.length > 0) {
        parts.push(`charpente : ${chrome.join(', ')}`)
        setResult({ ok: true, message: parts.join(' · ') })
        return
      }

      // No shared chrome is not automatically a problem. A site whose layout.tsx
      // wraps every page in a header and a footer has nothing for its pages to
      // share — and its generated pages render complete anyway. Reporting that
      // as a failure sent the operator looking for a fault that did not exist.
      if (profile.layoutShell?.wraps) {
        parts.push(`habillage fourni par le layout (${profile.layoutShell.components.join(', ') || 'sans composant'})`)
        setResult({ ok: true, message: parts.join(' · ') })
        return
      }

      setResult({
        ok: false,
        message:
          `${parts.join(' · ')} · aucune charpente commune, et le layout n’enveloppe rien. ` +
          `Les pages seront publiées sans en-tête ni pied de page. ` +
          `Il faut au moins deux pages comparables dans ${profile.pageFolder}, ou un layout qui habille les pages.`,
      })
    } catch {
      setResult({ ok: false, message: 'Impossible de joindre le serveur' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <Button
        variant="secondary"
        size="sm"
        icon={ScanSearch}
        loading={running}
        onClick={run}
        fullWidth
      >
        {running ? 'Analyse du dépôt…' : hasProfile ? 'Ré-analyser le dépôt' : 'Analyser le dépôt'}
      </Button>

      {!hasProfile && !result && (
        <p className="meta">
          Non analysé : les pages publiées ne suivront pas l’architecture du dépôt.
        </p>
      )}

      {result && (
        <p
          className="meta"
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            alignItems: 'flex-start',
            color: result.ok ? 'var(--status-good-text)' : 'var(--status-critical-text)',
          }}
        >
          {result.ok
            ? <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            : <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span style={{ wordBreak: 'break-word' }}>{result.message}</span>
        </p>
      )}
    </div>
  )
}
