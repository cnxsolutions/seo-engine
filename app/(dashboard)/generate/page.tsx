import { Wand2 } from 'lucide-react'
import { SitePicker } from '../SitePicker'

export const dynamic = 'force-dynamic'

/**
 * Le flux de génération et le lancement manuel vivent dans chaque site, sous
 * l'onglet « Publication », canal « Génération ». Cette adresse n'est plus
 * qu'un sélecteur de site — voir ../SitePicker.tsx.
 */
export default async function GeneratePicker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <SitePicker
      searchParams={await searchParams}
      tab="publication"
      tabQuery={{ canal: 'generation' }}
      title="Génération"
      icon={Wand2}
      description="Ce que le moteur a produit — y compris ce qu’il a refusé — et le lancement manuel se trouvent dans la page de chaque site, onglet Publication."
    />
  )
}
