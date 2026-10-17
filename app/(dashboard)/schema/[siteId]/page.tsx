import { redirect } from 'next/navigation'

/**
 * Ancienne fiche « Schéma CMS » d'un site WordPress, devenue une section de
 * l'onglet Réglages du site (sites/[id]/reglages/SchemaPanel.tsx). Gardée pour
 * les favoris : aucune adresse du produit ne doit finir en 404.
 */
export default async function SchemaSiteRedirect({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  redirect(`/sites/${siteId}/reglages`)
}
