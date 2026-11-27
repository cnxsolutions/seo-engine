'use client'

import { EmptyState } from '@/components/ui'
import './globals.css'
import '@/components/ui.css'

/**
 * The last resort: an error in a layout itself (the rail's, the client
 * space's), which no screen's error.tsx can catch. It replaces the root layout,
 * hence its own <html> and <body> and its own stylesheets. Without it, Next
 * prints an English « Application error » on a blank page.
 *
 * It serves the operator and the client alike, so it names nothing internal
 * and sends nowhere but to a full reload.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="fr">
      <body>
        <main id="contenu" className="error-page">
          <EmptyState
            variant="error"
            title="La page n’a pas pu s’afficher"
            description={`Une erreur s’est produite de notre côté. Rechargez la page dans un instant${error.digest ? ` ; si elle revient, la référence ${error.digest} aide à la retrouver` : ''}.`}
            action={{ label: 'Recharger la page', onClick: () => window.location.reload() }}
          />
        </main>
      </body>
    </html>
  )
}
