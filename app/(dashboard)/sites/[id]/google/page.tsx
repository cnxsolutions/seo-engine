import { redirect } from 'next/navigation'
import { appendSearch } from '@/components/site-tabs'

/**
 * Ancienne page « Connexion Google » d'un site, devenue la première section de
 * l'onglet Réglages (../reglages/GoogleConnection.tsx).
 *
 * LA REQUÊTE EST GARDÉE, et c'est la raison d'être de ce fichier plus que les
 * favoris : /api/google/sync et /api/google/select redirigent encore ici avec
 * leur verdict (`?gsc=success&rows=…`, `?selected=1`, `?error=…`), que la
 * section lit pour dire si l'action a abouti. La sous-page `google/select`
 * reste une vraie page : le choix de la propriété est un formulaire à part.
 */
export default async function SiteGoogleRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  redirect(appendSearch(`/sites/${id}/reglages`, await searchParams))
}
