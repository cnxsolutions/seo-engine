import { EmptyState } from '@/components/ui'

/**
 * An address that matches no screen at all. Only an operator can land here:
 * every address outside /espace sits behind the access secret (proxy.ts), and
 * /espace has its own catch-all (app/(espace)/espace/[...introuvable]). There is
 * no rail on this page, so it leads back to the one screen that has it.
 */
export default function NotFound() {
  return (
    <main id="contenu" className="error-page">
      <EmptyState
        variant="no-results"
        title="Cette page n’existe pas"
        description="L’adresse ne correspond à aucun écran du moteur : le lien est peut-être incomplet, ou l’écran a été déplacé."
        action={{ label: 'Ouvrir le tableau de bord', href: '/dashboard' }}
      />
    </main>
  )
}
