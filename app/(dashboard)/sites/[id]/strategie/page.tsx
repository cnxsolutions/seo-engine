// L'onglet « Stratégie » d'un site : la coquille serveur. Les campagnes et leur
// plan de cycle se lisent et se confirment dans ./StrategyView.tsx.
//
// `DEFAULT_SCHEDULE_TIME` traverse en prop : sa source, lib/scheduler/editorial,
// ouvre un client Supabase de service, que le composant client ne doit pas
// tirer dans son paquet pour une simple heure par défaut.

import { Plus } from 'lucide-react'
import Link from 'next/link'
import { DEFAULT_SCHEDULE_TIME } from '@/lib/scheduler/editorial'
import { TabIntro } from '../TabIntro'
import { StrategyView } from './StrategyView'

export default async function SiteStrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <>
      <TabIntro
        title="Stratégie de contenu"
        subtitle="Une campagne décrit quoi écrire et à quel rythme. Le plan de cycle est ce qu’on relit avant de lancer la production."
        actions={
          <Link href={`/strategy/new?site=${id}`} className="btn-primary btn-sm">
            <Plus size={14} aria-hidden="true" /> Nouvelle stratégie
          </Link>
        }
      />
      <StrategyView siteId={id} defaultScheduleTime={DEFAULT_SCHEDULE_TIME} />
    </>
  )
}
