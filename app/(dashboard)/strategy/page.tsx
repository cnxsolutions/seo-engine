import { Target } from 'lucide-react'
import { SitePicker } from '../SitePicker'

export const dynamic = 'force-dynamic'

/**
 * Les campagnes et leur plan de cycle vivent dans chaque site (onglet
 * « Stratégie »). Cette adresse n'est plus qu'un sélecteur de site — voir
 * ../SitePicker.tsx. /strategy/new et /strategy/[id]/edit restent des
 * formulaires, atteints depuis le site et qui y ramènent.
 */
export default async function StrategyPicker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <SitePicker
      searchParams={await searchParams}
      tab="strategie"
      title="Stratégie"
      icon={Target}
      description="Une campagne décrit quoi écrire et à quel rythme pour un site ; son plan de cycle se relit et se confirme dans la page du site."
    />
  )
}
