import { EmptyState } from '@/components/ui'

/**
 * The 404 of the operator's screens, inside the rail: a deleted site or a
 * miscopied id (`notFound()` in /sites/[id]/…), or an old link. The rail stays
 * on screen, so every other way out is already in sight.
 */
export default function DashboardNotFound() {
  return (
    <EmptyState
      variant="no-results"
      title="Cette page n’existe pas"
      description="Le site a peut-être été supprimé, ou le lien est incomplet. Les autres écrans restent accessibles depuis le menu."
      action={{ label: 'Voir les sites', href: '/sites' }}
      secondaryAction={{ label: 'Tableau de bord', href: '/dashboard' }}
    />
  )
}
