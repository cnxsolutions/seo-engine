import { BarChart3 } from 'lucide-react'
import { SitePicker } from '../SitePicker'

export const dynamic = 'force-dynamic'

/**
 * « Analytics doit être dans chaque site, pas dans une section à part »
 * (le propriétaire, 17/10/2026). Search Console, la fiche Google et la
 * production se lisent dans l'onglet « Performances » de chaque site ; cette
 * adresse n'est plus qu'un sélecteur de site — voir ../SitePicker.tsx.
 * /dashboard?tab=performance y redirige aussi.
 */
export default async function AnalyticsPicker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <SitePicker
      searchParams={await searchParams}
      tab="performances"
      title="Performances"
      icon={BarChart3}
      description="Positions, impressions et clics Search Console, fiche Google et production du moteur se lisent site par site."
    />
  )
}
