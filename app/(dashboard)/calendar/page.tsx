import { CalendarDays } from 'lucide-react'
import { SitePicker } from '../SitePicker'

export const dynamic = 'force-dynamic'

/**
 * Le calendrier vit dans chaque site (onglet « Calendrier »). Cette adresse
 * n'est plus qu'un sélecteur de site — voir ../SitePicker.tsx.
 */
export default async function CalendarPicker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <SitePicker
      searchParams={await searchParams}
      tab="calendrier"
      title="Calendrier"
      icon={CalendarDays}
      description="Le calendrier éditorial se lit site par site : ce que le moteur doit publier, ce qu’il a publié, et ce qui a échoué."
    />
  )
}
