import { Send } from 'lucide-react'
import { SitePicker } from '../SitePicker'

export const dynamic = 'force-dynamic'

/**
 * La file de publication vit dans chaque site (onglet « Publication »). Cette
 * adresse n'est plus qu'un sélecteur de site — voir ../SitePicker.tsx. Les
 * liens `?site=<id>` déjà partagés y retombent directement.
 */
export default async function PublishPicker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <SitePicker
      searchParams={await searchParams}
      tab="publication"
      title="Publication"
      icon={Send}
      description="Ce qui attend une publication, ce qui est en ligne et les posts de fiche Google se pilotent dans la page de chaque site."
    />
  )
}
