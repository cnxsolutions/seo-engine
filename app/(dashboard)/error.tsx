'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useTransition } from 'react'
import { EmptyState } from '@/components/ui'

/**
 * The 500 of the operator's screens, inside the rail: the menu survives the
 * screen that failed. A sentence, never the error itself — the detail is in the
 * server log, and the digest finds it there.
 *
 * « Réessayer » re-reads the server before resetting the boundary: a server
 * component that threw is not rendered again by `reset()` alone.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  useEffect(() => {
    console.error('[dashboard] écran en erreur', error.digest ?? '', error)
  }, [error])

  const retry = () => startTransition(() => {
    router.refresh()
    reset()
  })

  return (
    <EmptyState
      variant="error"
      title="Cet écran n’a pas pu s’afficher"
      description={`Une erreur s’est produite en le préparant. Réessayer suffit souvent ; si elle revient, le journal du serveur en garde le détail${error.digest ? ` (référence ${error.digest})` : ''}.`}
      action={{ label: 'Réessayer', onClick: retry }}
      secondaryAction={{ label: 'Tableau de bord', href: '/dashboard' }}
    />
  )
}
