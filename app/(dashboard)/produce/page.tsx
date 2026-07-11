'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PenTool } from 'lucide-react'
import { PageHeader } from '@/components/ui'
import dynamic from 'next/dynamic'

const GenerateTab = dynamic(() => import('./tabs/GenerateTab'), { ssr: false })
const ClusterTab = dynamic(() => import('./tabs/ClusterTab'), { ssr: false })
const OptimizerTab = dynamic(() => import('./tabs/OptimizerTab'), { ssr: false })

type Tab = 'single' | 'cluster' | 'optimize'

const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'cluster', label: 'Cluster', desc: 'Pilier + filles avec maillage' },
  { key: 'single', label: 'Page unique', desc: 'Générer une page SEO' },
  { key: 'optimize', label: 'Optimiser', desc: 'Améliorer un title existant' },
]

export default function ProducePage() {
  return (
    <Suspense fallback={<div className="spinner" style={{ margin: '3rem auto' }} />}>
      <ProduceContent />
    </Suspense>
  )
}

function ProduceContent() {
  const [tab, setTab] = useState<Tab>('cluster')
  const searchParams = useSearchParams()

  const campaignParams = searchParams.get('campaign_id') ? {
    campaignId: searchParams.get('campaign_id') || '',
    mainKeyword: searchParams.get('mainKeyword') || '',
    keywords: searchParams.get('keywords') || '',
    businessType: searchParams.get('businessType') || '',
    businessName: searchParams.get('businessName') || '',
    city: searchParams.get('city') || 'Troyes',
    department: searchParams.get('department') || 'Aube',
    siteId: searchParams.get('siteId') || '',
    siteUrl: searchParams.get('siteUrl') || '',
  } : undefined

  return (
    <div>
      <PageHeader
        icon={PenTool}
        iconColor="#5347ce"
        badge="Étape 3"
        title="Générer du contenu"
        subtitle={campaignParams ? 'Pré-rempli depuis votre stratégie — ajustez et lancez la génération' : 'Créez des clusters, des pages individuelles ou optimisez vos titles'}
      />

      {/* Tabs */}
      <div className="tab-list">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`tab-item ${tab === t.key ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'cluster' && <ClusterTab prefill={campaignParams} />}
      {tab === 'single' && <GenerateTab />}
      {tab === 'optimize' && <OptimizerTab />}
    </div>
  )
}
