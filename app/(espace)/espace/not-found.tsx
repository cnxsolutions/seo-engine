import { AuthShell } from '@/components/AuthShell'
import { Button } from '@/components/ui'

/**
 * The 404 of the client space — also what a member sees for a site that is not
 * theirs (lib/client-space/scope.ts): « not found », never « forbidden ».
 */
export default function ClientSpaceNotFound() {
  return (
    <AuthShell
      eyebrow="Erreur 404"
      title="Cette page n’existe pas"
      intro="Le lien est peut-être incomplet, ou la page a été déplacée."
    >
      <Button href="/espace" size="lg" fullWidth>Revenir à mon espace</Button>
    </AuthShell>
  )
}
