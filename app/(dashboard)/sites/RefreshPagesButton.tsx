'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui'
import type { RefreshJob } from '@/lib/existing/refresh'
import './sites.css'

const POLL_MS = 3000

/**
 * « Rafraîchir les pages » : re-read the site's pages, nothing else
 * (POST /api/sites/:id/crawl).
 *
 * The crawl runs in the background on the server — minutes on a real site — so
 * this polls its state, picks up a refresh another tab started, and reloads the
 * screen's data once the inventory is written.
 */
export function RefreshPagesButton({ siteId, compact = false }: { siteId: string; compact?: boolean }) {
  const router = useRouter()
  const [job, setJob] = useState<RefreshJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Seen running: only then does « done » mean new data to reload. */
  const watched = useRef(false)

  const poll = useCallback(async function tick(): Promise<void> {
    try {
      const res = await fetch(`/api/sites/${siteId}/crawl`, { cache: 'no-store' })
      const data = (await res.json()) as { job: RefreshJob | null }
      setJob(data.job)
      if (data.job?.state === 'running') {
        watched.current = true
        timer.current = setTimeout(tick, POLL_MS)
      } else if (data.job?.state === 'done' && watched.current) {
        watched.current = false
        router.refresh()
      }
    } catch {
      setError('Impossible de suivre la lecture du site')
    }
  }, [router, siteId])

  // A refresh started elsewhere (another tab, a previous visit) is shown, not restarted.
  useEffect(() => {
    void poll()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [poll])

  const start = async () => {
    setError(null)
    try {
      const res = await fetch(`/api/sites/${siteId}/crawl`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `Erreur ${res.status}`)
        return
      }
      setJob(data.job)
      timer.current = setTimeout(poll, POLL_MS)
    } catch {
      setError('Impossible de joindre le serveur')
    }
  }

  const running = job?.state === 'running'
  const failed = Boolean(error) || job?.state === 'failed'
  const message = error
    ?? (job?.state === 'failed' ? job.error ?? 'La lecture du site a échoué' : null)
    ?? (job?.state === 'done' && !compact
      ? `${job.pagesRead} page${(job.pagesRead ?? 0) > 1 ? 's' : ''} lue${(job.pagesRead ?? 0) > 1 ? 's' : ''}${job.truncated ? ', plafond atteint' : ''}`
      : null)

  return (
    <span className={`refresh-pages${compact ? ' refresh-pages--compact' : ''}`}>
      <Button variant="secondary" size="sm" icon={RefreshCw} loading={running} onClick={start} disabled={running}>
        {running ? 'Lecture du site…' : compact ? 'Rafraîchir' : 'Rafraîchir les pages'}
      </Button>
      {message && (
        <span
          className={`meta refresh-pages__message${failed ? ' refresh-pages__message--failed' : ''}`}
          role={failed ? 'alert' : undefined}
        >
          {failed
            ? <TriangleAlert size={12} className="refresh-pages__icon" />
            : <CheckCircle2 size={12} className="refresh-pages__icon" />}
          {message}
        </span>
      )}
    </span>
  )
}
