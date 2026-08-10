'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarCheck, CheckCircle2, Globe2, Loader2, ScanSearch, Target, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FormField, PageHeader } from '@/components/ui'
import type { AnalysisRun, Campaign, CyclePlan, PageType, PlanItemBrief, Site, SiteType } from '@/lib/types'
import { AI_MODEL_OPTIONS, DEFAULT_GENERATION_MODEL } from '@/lib/ai/provider'

const PAGE_TYPES: Array<{ value: PageType; label: string }> = [
  { value: 'pillar', label: 'Pilier' },
  { value: 'child', label: 'Fille' },
  { value: 'local_pack', label: 'Local Pack' },
  { value: 'alternative', label: 'Alternative' },
  { value: 'comparative', label: 'Comparatif' },
]

/** Same wording as the strategy list and the calendar — one label per page type. */
const PAGE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  PAGE_TYPES.map((type) => [type.value, type.label])
)

const FREQUENCIES = [
  { value: 'daily', label: 'Tous les jours' },
  { value: 'every_2_days', label: 'Tous les 2 jours' },
  { value: 'every_3_days', label: 'Tous les 3 jours' },
  { value: 'weekly', label: 'Hebdomadaire' },
]

type Step = 0 | 1 | 2 | 3

export default function NewStrategyWorkflowPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(0)
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [createSiteMode, setCreateSiteMode] = useState(false)
  const [siteType, setSiteType] = useState<SiteType>('wordpress')
  const [siteForm, setSiteForm] = useState({
    name: '',
    url: '',
    wp_username: '',
    wp_app_password: '',
    github_repo: '',
    github_token: '',
    github_branch: '',
  })
  const [contextForm, setContextForm] = useState({
    name: '',
    business_type: '',
    business_name: '',
    keywords: '',
    department: 'Aube',
    communes: '',
    schedule_frequency: 'every_2_days',
    schedule_time: '09:00',
    ai_model: DEFAULT_GENERATION_MODEL,
    publish_status: 'draft',
    target_length: '800',
    cycle_duration_days: '14',
    competitor_urls: '',
    auto_publish: false,
  })
  const [pageTypes, setPageTypes] = useState<PageType[]>(['pillar', 'child', 'local_pack'])
  const [analysisRun, setAnalysisRun] = useState<AnalysisRun | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [plan, setPlan] = useState<CyclePlan | null>(null)
  const [items, setItems] = useState<PlanItemBrief[]>([])
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/sites').then((res) => res.json()).then((data) => {
      const loadedSites = data.sites ?? []
      setSites(loadedSites)
      setCreateSiteMode(loadedSites.length === 0)
    }).catch(() => null)
  }, [])

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) || null,
    [selectedSiteId, sites]
  )

  const canContinueSite = createSiteMode
    ? Boolean(siteForm.name && siteForm.url && (siteType === 'wordpress'
      ? siteForm.wp_username && siteForm.wp_app_password
      : siteForm.github_repo && siteForm.github_token))
    : Boolean(selectedSiteId)

  const canAnalyze = Boolean(contextForm.business_type && contextForm.business_name && contextForm.communes)

  const updateSiteForm = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSiteForm((prev) => ({ ...prev, [event.target.name]: event.target.value }))
  }

  const updateContextForm = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = event.target
    if (target.name === 'auto_publish') {
      setContextForm((prev) => ({ ...prev, auto_publish: (target as HTMLInputElement).checked }))
      return
    }
    setContextForm((prev) => ({ ...prev, [target.name]: target.value }))
  }

  const ensureSite = async () => {
    if (!createSiteMode && selectedSite) return selectedSite

    const res = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: siteType, ...siteForm }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Creation du site impossible')
    setSites((prev) => [data.site, ...prev])
    setSelectedSiteId(data.site.id)
    setCreateSiteMode(false)
    return data.site as Site
  }

  const runAnalysis = async () => {
    setError('')
    setLoading('analysis')
    try {
      const site = await ensureSite()
      const res = await fetch('/api/analysis-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          siteUrl: site.url,
          businessType: contextForm.business_type,
          businessName: contextForm.business_name,
          targetCities: splitList(contextForm.communes),
          competitorUrls: splitList(contextForm.competitor_urls).slice(0, 5),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analyse impossible')
      setAnalysisRun(data.analysisRun)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur analyse')
    } finally {
      setLoading('')
    }
  }

  const generatePlan = async () => {
    if (!analysisRun) return
    setError('')
    setLoading('plan')
    try {
      const site = selectedSite || await ensureSite()
      const res = await fetch(`/api/analysis-runs/${analysisRun.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: site.id,
          name: contextForm.name || `SEO ${contextForm.business_type} ${splitList(contextForm.communes)[0] || ''}`.trim(),
          business_type: contextForm.business_type,
          business_name: contextForm.business_name,
          keywords: splitList(contextForm.keywords),
          department: contextForm.department,
          communes: splitList(contextForm.communes),
          schedule_frequency: contextForm.schedule_frequency,
          schedule_time: contextForm.schedule_time,
          ai_model: contextForm.ai_model,
          publish_status: contextForm.publish_status,
          auto_publish: contextForm.auto_publish,
          target_length: Number(contextForm.target_length) || 800,
          cycle_duration_days: Number(contextForm.cycle_duration_days) || 14,
          page_types: pageTypes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation du plan impossible')
      setCampaign(data.campaign)
      setPlan(data.plan)
      setItems(data.plan.plan_data || [])
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur plan')
    } finally {
      setLoading('')
    }
  }

  const savePlan = async () => {
    if (!campaign || !plan) return
    const res = await fetch(`/api/campaigns/${campaign.id}/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', plan_id: plan.id, plan_data: items }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Sauvegarde impossible')
  }

  const confirmPlan = async () => {
    if (!campaign || !plan) return
    setError('')
    setLoading('confirm')
    try {
      await savePlan()
      const res = await fetch(`/api/campaigns/${campaign.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', plan_id: plan.id, plan_data: items }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Confirmation impossible')
      router.push('/strategy')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur confirmation')
    } finally {
      setLoading('')
    }
  }

  const updatePlanItem = (id: string, patch: Partial<PlanItemBrief>) => {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        icon={Target}
        badge="Étape 3"
        title="Nouvelle stratégie"
        subtitle="Analyse du site et des concurrents, plan de briefs daté, puis exécution automatique le jour prévu."
        backHref="/strategy"
      />

      <Stepper step={step} />

      {error && (
        <div
          className="glass-card"
          style={{
            borderLeft: '3px solid var(--status-critical)', marginBottom: 'var(--space-4)',
            display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start',
          }}
        >
          <TriangleAlert size={16} color="var(--status-critical)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 'var(--fs-sm)' }}>Étape impossible</strong>
            <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)' }}>{error}</p>
          </div>
        </div>
      )}

      {step === 0 && (
        <div className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={() => setCreateSiteMode(false)} className={createSiteMode ? 'btn-ghost' : 'btn-primary'} disabled={sites.length === 0}>Site existant</button>
            <button onClick={() => setCreateSiteMode(true)} className={createSiteMode ? 'btn-primary' : 'btn-ghost'}>Créer un site</button>
          </div>

          {!createSiteMode ? (
            <FormField label="Site cible">
              <select value={selectedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)} className="input">
                <option value="">Choisir un site</option>
                {sites.map((site) => <option key={site.id} value={site.id}>{site.name} ({site.type})</option>)}
              </select>
            </FormField>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => setSiteType('wordpress')} className={siteType === 'wordpress' ? 'btn-primary' : 'btn-ghost'}><Globe2 size={15} /> WordPress</button>
                <button onClick={() => setSiteType('nextjs')} className={siteType === 'nextjs' ? 'btn-primary' : 'btn-ghost'}>Next.js</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <FormField label="Nom du site"><input name="name" value={siteForm.name} onChange={updateSiteForm} className="input" /></FormField>
                <FormField label="URL"><input name="url" value={siteForm.url} onChange={updateSiteForm} className="input" placeholder="https://example.com" /></FormField>
              </div>
              {siteType === 'wordpress' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <FormField label="Utilisateur WordPress"><input name="wp_username" value={siteForm.wp_username} onChange={updateSiteForm} className="input" /></FormField>
                  <FormField label="Application Password"><input name="wp_app_password" type="password" value={siteForm.wp_app_password} onChange={updateSiteForm} className="input" /></FormField>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <FormField label="Repo GitHub"><input name="github_repo" value={siteForm.github_repo} onChange={updateSiteForm} className="input" placeholder="owner/repo" /></FormField>
                  <FormField label="Token GitHub"><input name="github_token" type="password" value={siteForm.github_token} onChange={updateSiteForm} className="input" /></FormField>
                  <FormField label="Branche cible"><input name="github_branch" value={siteForm.github_branch} onChange={updateSiteForm} className="input" placeholder="seo-engine" /></FormField>
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setStep(1)} disabled={!canContinueSite} className="btn-primary">Continuer <ArrowRight size={15} /></button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <FormField label="Nom de la stratégie"><input name="name" value={contextForm.name} onChange={updateContextForm} className="input" placeholder="SEO Plombier Troyes" /></FormField>
            <FormField label="Nom du business"><input name="business_name" value={contextForm.business_name} onChange={updateContextForm} className="input" /></FormField>
            <FormField label="Type d’activité"><input name="business_type" value={contextForm.business_type} onChange={updateContextForm} className="input" placeholder="plombier, coach, avocat..." /></FormField>
            <FormField label="Département"><input name="department" value={contextForm.department} onChange={updateContextForm} className="input" /></FormField>
          </div>
          <FormField label="Communes ou zones" hint="séparées par une virgule">
            <input name="communes" value={contextForm.communes} onChange={updateContextForm} className="input" placeholder="Troyes, Sainte-Savine, La Chapelle-Saint-Luc" />
          </FormField>
          <FormField label="Mots-clés de base" hint="séparés par une virgule">
            <input name="keywords" value={contextForm.keywords} onChange={updateContextForm} className="input" placeholder="depannage, urgence, devis" />
          </FormField>
          <FormField label="URLs concurrentes" hint="une par ligne, 5 maximum">
            <textarea name="competitor_urls" value={contextForm.competitor_urls} onChange={(event) => setContextForm((prev) => ({ ...prev, competitor_urls: event.target.value }))} className="input" style={{ minHeight: 96, resize: 'vertical' }} />
          </FormField>
          <div>
            <div className="field-label">Types de pages</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {PAGE_TYPES.map((type) => {
                const active = pageTypes.includes(type.value)
                return (
                  <button key={type.value} onClick={() => setPageTypes((prev) => active ? prev.filter((item) => item !== type.value) : [...prev, type.value])} className={active ? 'btn-primary' : 'btn-ghost'}>
                    {type.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <FormField label="Fréquence"><select name="schedule_frequency" value={contextForm.schedule_frequency} onChange={updateContextForm} className="input">{FREQUENCIES.map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}</select></FormField>
            <FormField label="Durée du cycle"><select name="cycle_duration_days" value={contextForm.cycle_duration_days} onChange={updateContextForm} className="input"><option value="7">7 jours</option><option value="14">14 jours</option><option value="21">21 jours</option><option value="30">30 jours</option></select></FormField>
            <FormField label="Modèle IA"><select name="ai_model" value={contextForm.ai_model} onChange={updateContextForm} className="input">{AI_MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></FormField>
            <FormField label="Longueur"><select name="target_length" value={contextForm.target_length} onChange={updateContextForm} className="input"><option value="800">800 mots</option><option value="1200">1200 mots</option><option value="2000">2000 mots</option></select></FormField>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)' }}>
            <input type="checkbox" name="auto_publish" checked={contextForm.auto_publish} onChange={updateContextForm} />
            Publier automatiquement le jour prévu
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(0)} className="btn-ghost">Retour</button>
            <button onClick={runAnalysis} disabled={!canAnalyze || loading === 'analysis'} className="btn-primary">
              {loading === 'analysis' ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />} Analyser site + concurrents
            </button>
          </div>
        </div>
      )}

      {step === 2 && analysisRun && (
        <div className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
            <Stat label="Pages site" value={analysisRun.analysis_data.site.pagesCrawled} />
            <Stat label="Concurrents" value={analysisRun.analysis_data.competitors.length} />
            <Stat label="Mots-clés manquants" value={analysisRun.analysis_data.gapAnalysis.missingKeywords.length} />
            <Stat label="Opportunités locales" value={analysisRun.analysis_data.gapAnalysis.localOpportunities.length} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <SummaryBox title="Mots-clés manquants" items={analysisRun.analysis_data.gapAnalysis.missingKeywords.slice(0, 10)} />
            <SummaryBox title="Angles détectés" items={analysisRun.analysis_data.gapAnalysis.suggestedAngles.slice(0, 10)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(1)} className="btn-ghost">Retour</button>
            <button onClick={generatePlan} disabled={loading === 'plan'} className="btn-primary">
              {loading === 'plan' ? <Loader2 size={15} className="animate-spin" /> : <CalendarCheck size={15} />} Générer le plan de briefs
            </button>
          </div>
        </div>
      )}

      {step === 3 && plan && (
        <div className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div>
              <h2 className="card-title">Plan du cycle</h2>
              <p className="meta" style={{ margin: '0.25rem 0 0' }}>
                {items.length} briefs sur {plan.cycle_duration_days} jours. La rédaction est faite le jour prévu, pas maintenant.
              </p>
            </div>
            <CheckCircle2 size={20} color="var(--status-good)" />
          </div>
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Intention</th>
                  <th>Titre</th>
                  <th>Slug</th>
                  <th>Requête cible</th>
                  <th>Trame</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.scheduled_date}</td>
                    <td><span className="chip">{PAGE_TYPE_LABELS[item.page_type] ?? item.page_type}</span></td>
                    <td>{item.search_intent || '—'}</td>
                    <td><input value={item.proposed_title} onChange={(event) => updatePlanItem(item.id, { proposed_title: event.target.value })} className="input" style={{ minWidth: 220 }} /></td>
                    <td><input value={item.proposed_slug} onChange={(event) => updatePlanItem(item.id, { proposed_slug: event.target.value })} className="input mono" style={{ minWidth: 220 }} /></td>
                    <td><input value={item.target_keyword} onChange={(event) => updatePlanItem(item.id, { target_keyword: event.target.value })} className="input" style={{ minWidth: 180 }} /></td>
                    <td className="meta" style={{ minWidth: 220 }}>{item.outline.slice(0, 3).join(' / ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(2)} className="btn-ghost">Retour analyse</button>
            <button onClick={confirmPlan} disabled={loading === 'confirm'} className="btn-primary">
              {loading === 'confirm' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Confirmer et lancer le cycle
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stepper({ step }: { step: Step }) {
  const labels = ['Site', 'Contexte', 'Analyse', 'Plan']
  return (
    <ol style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', listStyle: 'none', padding: 0 }}>
      {labels.map((label, index) => {
        const reached = index <= step
        return (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            style={{
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${index === step ? 'var(--accent)' : 'var(--line)'}`,
              background: reached ? 'var(--accent-wash)' : 'var(--surface-card)',
              color: reached ? 'var(--accent-text)' : 'var(--ink-muted)',
              fontWeight: 600,
              fontSize: 'var(--fs-xs)',
            }}
          >
            {index + 1}. {label}
          </li>
        )
      })}
    </ol>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function SummaryBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="inset">
      <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', marginBottom: 'var(--space-2)' }}>{title}</div>
      <ul className="meta" style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {(items.length ? items : ['Aucun élément critique détecté']).map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function splitList(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}
