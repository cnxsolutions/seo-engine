// L'onglet « Calendrier » d'un site : la coquille serveur, le calendrier
// lui-même est un composant client (./CalendarView.tsx) qui reçoit le site.

import { CalendarDays } from 'lucide-react'
import Link from 'next/link'
import { TabIntro } from '../TabIntro'
import { CalendarView } from './CalendarView'

export default async function SiteCalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <>
      <TabIntro
        title="Calendrier éditorial"
        subtitle="Ce que le moteur doit publier sur ce site, ce qu’il a publié, et ce qui a échoué."
        actions={
          <Link href={`/sites/${id}/strategie`} className="btn-secondary btn-sm">
            <CalendarDays size={14} aria-hidden="true" /> Planifier un cycle
          </Link>
        }
      />
      <CalendarView siteId={id} />
    </>
  )
}
