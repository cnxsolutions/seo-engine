import { redirect } from 'next/navigation'
import { appendSearch } from '@/components/site-tabs'

/**
 * Ancienne adresse du formulaire d'un site. Il est maintenant la section
 * « Identité et accès » de l'onglet Réglages (../reglages/page.tsx), à côté de
 * la connexion Google, du schéma et de la zone de suppression qui vivaient sur
 * trois écrans distincts. Gardée pour les favoris et les liens déjà partagés :
 * aucune adresse du produit ne doit finir en 404.
 */
export default async function EditSiteRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  redirect(appendSearch(`/sites/${id}/reglages`, await searchParams))
}
