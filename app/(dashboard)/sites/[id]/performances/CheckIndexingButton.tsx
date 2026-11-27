'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ScanSearch, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui'
import type { IndexCheckJob } from '@/lib/indexing/check'
import { summarizeIndexCheck } from '@/lib/indexing/summary'
import './performances.css'

const POLL_MS = 3000

/**
 * « Vérifier maintenant » : inspect the site's pages through Search Console
 * without waiting for the night (POST /api/sites/:id/indexing).
 *
 * A check of a few hundred pages takes minutes, so this polls the job, picks up
 * a check already running (the night's, another tab's), and reloads the
 * screen's data once the results are written.
 */
export function CheckIndexingButton({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [job, setJob] = useState<IndexCheckJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Seen running: only then does « done » mean new data to reload. */
  const watched = useRef(false)

  const poll = useCallback(async function tick(): Promise<void> {
    try {
      const res = await fetch(`/api/sites/${siteId}/indexing`, { cache: 'no-store' })
      const data = (await res.json()) as { job: IndexCheckJob | null }
      setJob(data.job)
      if (data.job?.state === 'running') {
        watched.current = true
        timer.current = setTimeout(tick, POLL_MS)
      } else if (data.job?.state === 'done' && watched.current) {
        watched.current = false
        router.refresh()
      }
    } catch {
      setError('Impossible de suivre la vérification')
    }
  }, [router, siteId])

  useEffect(() => {
    void poll()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [poll])

  const start = async () => {
    setError(null)
    try {
      const res = await fetch(`/api/sites/${siteId}/indexing`, { method: 'POST' })
      const data = (await res.json()) as { job?: IndexCheckJob; error?: string }
      if (!res.ok || !data.job) {
        setError(data.error || `Erreur ${res.status}`)
        return
      }
      setJob(data.job)
      watched.current = true
      timer.current = setTimeout(poll, POLL_MS)
    } catch {
      setError('Impossible de joindre le serveur')
    }
  }

  const running = job?.state === 'running'
  const summary = job?.state === 'done' && job.report ? summarizeIndexCheck(job.report) : null
  const message = error ?? summary?.text ?? null
  const failed = error !== null || summary?.failed === true

  return (
    <span className="index-check">
      <Button variant="secondary" size="sm" icon={ScanSearch} loading={running} onClick={start} disabled={running}>
        {running ? runningLabel(job) : 'Vérifier maintenant'}
      </Button>
      {message && (
        <span
          className={`meta index-check__message${failed ? ' index-check__message--failed' : ''}`}
          role={failed ? 'alert' : undefined}
        >
          {failed
            ? <TriangleAlert size={12} className="index-check__icon" />
            : <CheckCircle2 size={12} className="index-check__icon" />}
          {message}
        </span>
      )}
    </span>
  )
}

/** A count that moves, so a run of a few minutes does not read as a frozen screen. */
function runningLabel(job: IndexCheckJob): string {
  if (!job.progress) return 'Préparation de la liste des pages…'
  const { done, total } = job.progress
  return `Vérification… ${done} / ${total} page${total > 1 ? 's' : ''}`
}
