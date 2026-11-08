'use client'

// ─────────────────────────────────────────────────────────────────────────────
// La source des SERP, en une ligne — répond-elle, et sinon pourquoi
//
// Trois mois de plans sans une seule page de résultats lue (la dernière date
// du 10/08/2026), et l'écran disait seulement « aucune SERP exploitable ». Clé
// absente, clé refusée, quota épuisé : trois réparations différentes, que
// cette ligne distingue (lib/serp/status.ts). Lue à l'affichage, jamais
// pendant une planification : demander le compte SerpApi ne coûte aucune
// recherche.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { CircleCheck, TriangleAlert } from 'lucide-react'

interface Summary {
  tone: 'good' | 'warning' | 'critical'
  text: string
}

const COLOR: Record<Summary['tone'], string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
}

export function SerpStatusLine() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/serp/status')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { summary?: Summary; status?: { lastSnapshotAt?: string | null } }) => {
        if (!alive) return
        setSummary(data.summary ?? null)
        setLastSnapshotAt(data.status?.lastSnapshotAt ?? null)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (failed) return <p className="meta" style={{ margin: 0 }}>État de la source SERP illisible pour l’instant.</p>
  if (!summary) return <p className="meta" style={{ margin: 0 }}>Vérification de la source SERP…</p>

  const Icon = summary.tone === 'good' ? CircleCheck : TriangleAlert
  return (
    <p className="meta" style={{ margin: 0, display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
      <Icon size={13} color={COLOR[summary.tone]} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <span>
        <strong style={{ color: 'var(--ink-primary)' }}>Source SERP (SerpApi)</strong> — {summary.text}
        {lastSnapshotAt && ` Dernière page de résultats enregistrée le ${new Date(lastSnapshotAt).toLocaleDateString('fr-FR')}.`}
      </span>
    </p>
  )
}
