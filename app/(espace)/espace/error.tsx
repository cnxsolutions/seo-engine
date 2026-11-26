'use client'

import { AuthShell } from '@/components/AuthShell'
import { Button } from '@/components/ui'

/**
 * The 500 of the client space. A generic sentence, never the error itself
 * (§ 3.7): the detail is in the server logs, the digest lets CNX find it.
 */
export default function ClientSpaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthShell
      eyebrow="Erreur"
      title="Un souci de notre côté"
      intro={
        <>
          La page n’a pas pu s’afficher. Réessayez dans un instant ; si cela persiste, écrivez à contact@cnx-solutions.fr
          {error.digest ? ` en citant la référence ${error.digest}` : ''}.
        </>
      }
    >
      <div className="auth-form">
        <Button size="lg" fullWidth onClick={reset}>Réessayer</Button>
        <Button href="/espace" variant="ghost" size="lg" fullWidth>Revenir à mon espace</Button>
      </div>
    </AuthShell>
  )
}
