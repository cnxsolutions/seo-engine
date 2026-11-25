'use client'

import { useState } from 'react'
import { Unplug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'

/**
 * `DELETE /api/sites/[id]/google` — drops the stored connection (tokens,
 * property, location) and nothing else.
 *
 * Until now the only way out of a wrong Google account was to reconnect with
 * another one on top of it, or to delete the row by hand. The synchronised
 * data is left where it is: the rows in gsc_performance are facts about the
 * site, not about the account that fetched them, and the next connection
 * continues the series rather than starting it over.
 */
export function DisconnectGoogleButton({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disconnect = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await fetch(`/api/sites/${siteId}/google`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Déconnexion refusée (erreur ${res.status})`)
        return
      }
      setOpen(false)
      // The page is a server component keyed on the stored connection: a
      // refresh is what turns it back into the « non connecté » state.
      router.refresh()
    } catch {
      setError('Impossible de joindre le serveur')
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <Button variant="ghost" icon={Unplug} onClick={() => setOpen(true)}>
        Déconnecter Google
      </Button>
      <ConfirmDialog
        open={open}
        title="Déconnecter Google de ce site ?"
        confirmLabel="Déconnecter Google"
        confirmIcon={Unplug}
        busy={working}
        error={error}
        errorTitle="Google toujours connecté"
        onConfirm={disconnect}
        onClose={() => { setOpen(false); setError(null) }}
      >
        <p>Les données déjà synchronisées sont conservées.</p>
        <p>
          Plus aucune synchronisation ne tournera, et aucun post de fiche ne pourra être publié tant que
          Google n’est pas reconnecté.
        </p>
      </ConfirmDialog>
    </>
  )
}
