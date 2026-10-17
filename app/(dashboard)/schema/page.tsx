import { Database } from 'lucide-react'
import { SitePicker } from '../SitePicker'

export const dynamic = 'force-dynamic'

/**
 * Le schéma CMS se lit dans l'onglet « Réglages » de chaque site WordPress.
 * Cette adresse n'est plus qu'un sélecteur de site — voir ../SitePicker.tsx.
 * Seuls les sites WordPress y figurent : un site Next.js se décrit par
 * l'analyse de son dépôt, pas par un CMS.
 */
export default async function SchemaPicker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <SitePicker
      searchParams={await searchParams}
      tab="reglages"
      title="Schéma CMS"
      icon={Database}
      description="Les types de contenu, champs et extension SEO d’un WordPress se lisent dans les réglages du site."
      only={(site) => site.type === 'wordpress'}
      emptyWhenFiltered="Aucun de vos sites n’est un WordPress : un site Next.js se décrit par l’analyse de son dépôt, dans ses réglages."
    />
  )
}
