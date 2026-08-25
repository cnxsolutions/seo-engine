'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarCheck, CheckCircle2, CircleCheck, Globe2, Loader2, ScanSearch, Target } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FieldError, FormField, Notice, PageHeader, StatusBadge } from '@/components/ui'
import { PAGE_TYPE_LABELS, pageTypeLabel } from '@/lib/types'
import type { AnalysisRun, Campaign, CyclePlan, PageType, PlanItemBrief, Site, SiteType } from '@/lib/types'
import type { InventoryResponse } from '@/app/api/sites/[id]/inventory/types'
// LA normalisation qui a ÉCRIT les chemins de `takenPaths` (voir
// app/api/sites/[id]/inventory/project.ts). Comparer avec une autre — celle de
// lib/pipeline/internal-links, par exemple — ferait répondre « adresse libre »
// à propos d'une adresse parfaitement prise. Le module est pur, sans un seul
// import : il traverse le bundle client sans rien emporter.
import { normalizeInventoryPath } from '@/src/core/domain/existing/inventory'
import { AI_MODEL_OPTIONS, DEFAULT_GENERATION_MODEL } from '@/lib/ai/provider'

// The select and the plan table used to read a local label table that said
// 'Fille' and 'Local Pack' where the calendar and the strategy list said
// 'Enfant' and 'Local pack'. Both now read PAGE_TYPE_LABELS from lib/types, so
// the wording of a page type is decided in exactly one place. The ORDER of the
// select stays here — it is an editorial sequence (pillar first), not a naming.
const PAGE_TYPE_ORDER: PageType[] = ['pillar', 'child', 'local_pack', 'alternative', 'comparative']

const PAGE_TYPES: Array<{ value: PageType; label: string }> = PAGE_TYPE_ORDER.map((value) => ({
  value,
  label: PAGE_TYPE_LABELS[value],
}))

const FREQUENCIES = [
  { value: 'daily', label: 'Tous les jours' },
  { value: 'every_2_days', label: 'Tous les 2 jours' },
  { value: 'every_3_days', label: 'Tous les 3 jours' },
  { value: 'weekly', label: 'Hebdomadaire' },
]

type Step = 0 | 1 | 2 | 3

// ─── Validation des adresses saisies ─────────────────────────────────────────
//
// L'ÉTAPE DU PLAN EST LE SEUL ENDROIT DU PARCOURS où un humain retape une URL à
// la main. Tout le travail de réservation d'adresse fait en amont s'y annule
// silencieusement : jusqu'ici le champ était confronté à rien, et une adresse
// déjà prise partait en production pour être refusée à la publication — après
// avoir été payée.
//
// ZÉRO APPEL RÉSEAU PAR FRAPPE. L'inventaire est chargé UNE fois, à l'ouverture
// de l'étape, par le mode `?fields=paths` qui ne rend que l'ensemble des chemins
// pris. La comparaison se fait ensuite en mémoire. Un GET par caractère sur une
// route paginée serait un flood, et un debounce à régler serait une seconde
// mécanique à maintenir pour le même résultat.

type SlugVerdict = 'empty' | 'checking' | 'unverified' | 'free' | 'taken' | 'duplicate-in-plan'

/**
 * L'inventaire tel que cette étape en a besoin, et ses trois états.
 *
 * 'unavailable' n'est PAS une erreur bloquante : réseau coupé, 500, site
 * inconnu — on le dit et on laisse passer. Un bouton mort devant un opérateur
 * qui a un plan à lancer est pire qu'une vérification manquante, et le moteur
 * vérifiera de toute façon chaque adresse directement sur le site avant
 * d'écrire.
 */
type InventoryCheck =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; taken: Set<string>; blind: boolean }

/**
 * Ce qu'on peut PROUVER d'une adresse saisie, jamais plus.
 *
 * `verified` est faux en régime aveugle : `takenPaths` n'y contient alors que
 * ce que le moteur a lui-même publié, et rendre « adresse libre » certifierait
 * une vérification qui n'a pas eu lieu. La collision ENTRE DEUX BRIEFS du même
 * plan, elle, reste vraie dans tous les régimes — elle ne dépend d'aucun
 * inventaire, et c'est une collision qui n'existe encore dans aucune base.
 */
function slugState(slug: string, taken: Set<string>, otherSlugs: string[], verified: boolean): SlugVerdict {
  const path = normalizeInventoryPath(slug)
  if (path === '' || path === '/') return 'empty'
  if (verified && taken.has(path)) return 'taken'
  if (otherSlugs.some((other) => normalizeInventoryPath(other) === path)) return 'duplicate-in-plan'
  return verified ? 'free' : 'unverified'
}

/** Les deux verdicts qui interdisent de lancer le cycle. */
function blocks(verdict: SlugVerdict | undefined): boolean {
  return verdict === 'taken' || verdict === 'duplicate-in-plan'
}

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
  const [inventory, setInventory] = useState<InventoryCheck>({ state: 'loading' })

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

  // UN SEUL aller-retour, à l'ouverture de l'étape du plan. Pas à chaque frappe,
  // pas à chaque rendu : l'ensemble des chemins pris tient en quelques
  // kilo-octets de chaînes et la comparaison se fait ensuite en mémoire.
  useEffect(() => {
    if (step !== 3 || !selectedSiteId) return

    let cancelled = false
    setInventory({ state: 'loading' })

    fetch(`/api/sites/${selectedSiteId}/inventory?fields=paths`)
      .then((res) => (res.ok ? (res.json() as Promise<InventoryResponse>) : null))
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setInventory({ state: 'unavailable' })
          return
        }
        setInventory({
          state: 'ready',
          taken: new Set(data.takenPaths ?? []),
          blind: data.summary.freshness === 'blind',
        })
      })
      .catch(() => {
        if (!cancelled) setInventory({ state: 'unavailable' })
      })

    return () => {
      cancelled = true
    }
  }, [step, selectedSiteId])

  /**
   * Le verdict de chaque adresse, recalculé À LA FRAPPE mais SANS RÉSEAU.
   *
   * Le coût est quadratique en nombre de briefs — une quinzaine par cycle : la
   * comparaison croisée reste largement sous la milliseconde, et l'écrire ainsi
   * évite un index à maintenir en parallèle des lignes éditées.
   */
  const slugVerdicts = useMemo(() => {
    const verdicts = new Map<string, SlugVerdict>()

    for (const item of items) {
      if (inventory.state === 'loading') {
        verdicts.set(item.id, 'checking')
        continue
      }
      const others = items.filter((other) => other.id !== item.id).map((other) => other.proposed_slug)
      const taken = inventory.state === 'ready' ? inventory.taken : new Set<string>()
      const verified = inventory.state === 'ready' && !inventory.blind
      verdicts.set(item.id, slugState(item.proposed_slug, taken, others, verified))
    }

    return verdicts
  }, [items, inventory])

  const collisions = useMemo(
    () => [...slugVerdicts.values()].filter(blocks).length,
    [slugVerdicts]
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

      {/* La quatrième bannière écrite à la main du dépôt, remplacée par
          l'exemplaire partagé : même ton, même glyphe, une seule définition. */}
      {error && <Notice tone="critical" title="Étape impossible" body={error} />}

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
            {/* « 0 pages » sur un site que l'analyse n'a pas su lire annoncerait
                au propriétaire que son site est vide — au moment précis où le
                moteur s'apprête à écrire par-dessus ses pages. */}
            <Stat
              label="Pages site"
              value={analysisRun.analysis_data.site.pagesCrawled || 'Aucune page lue'}
              hint={
                analysisRun.analysis_data.site.pagesCrawled === 0
                  ? 'L’analyse n’a extrait aucune page : plan du site introuvable ou accès bloqué. Le moteur produira sans connaître l’existant.'
                  : undefined
              }
            />
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

          {/* Inventaire illisible : on le DIT, on ne bloque RIEN. Le moteur
              vérifiera chaque adresse directement sur le site avant d'écrire. */}
          {inventory.state === 'unavailable' && (
            <Notice
              inline
              tone="warning"
              title="Vérification des URL impossible"
              body="L’inventaire du site n’a pas pu être lu : les collisions d’URL ne sont pas vérifiées ici. Le moteur les vérifiera avant d’écrire."
            />
          )}

          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Type</th>
                  <th>Intention</th>
                  <th>Titre</th>
                  <th>Slug</th>
                  <th>Requête cible</th>
                  <th>Trame</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const action = item.action
                  const verdict = slugVerdicts.get(item.id)

                  return (
                    <tr key={item.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{item.scheduled_date}</td>
                      <td><ActionBadge kind={action?.kind ?? 'create'} /></td>
                      <td><span className="chip">{pageTypeLabel(item.page_type)}</span></td>
                      <td>{item.search_intent || '—'}</td>
                      <td><input value={item.proposed_title} onChange={(event) => updatePlanItem(item.id, { proposed_title: event.target.value })} className="input" style={{ minWidth: 220 }} /></td>
                      <td style={{ minWidth: 240 }}>
                        {/* On ne choisit PAS l'adresse d'une page qui existe
                            déjà : une ligne de mise à jour rend son chemin
                            cible en lecture seule. */}
                        {action?.kind === 'refresh' ? (
                          <>
                            <div className="mono meta">{action.targetPath}</div>
                            <div className="meta">Adresse existante — elle n’est pas modifiable ici.</div>
                          </>
                        ) : (
                          <>
                            <input
                              value={item.proposed_slug}
                              onChange={(event) => updatePlanItem(item.id, { proposed_slug: event.target.value })}
                              className="input mono"
                              style={{ minWidth: 220 }}
                              aria-invalid={blocks(verdict) || undefined}
                              aria-describedby={`slug-hint-${item.id}`}
                            />
                            <div id={`slug-hint-${item.id}`}>
                              <SlugHint verdict={verdict} />
                            </div>
                          </>
                        )}
                      </td>
                      <td><input value={item.target_keyword} onChange={(event) => updatePlanItem(item.id, { target_keyword: event.target.value })} className="input" style={{ minWidth: 180 }} /></td>
                      <td className="meta" style={{ minWidth: 220 }}>{item.outline.slice(0, 3).join(' / ')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* La garde est posée à l'endroit exact où l'humain peut la
              contourner. Laisser passer ici annulerait toute la réservation
              d'adresse faite en amont : la page serait écrite, payée, puis
              refusée à la publication. */}
          {collisions > 0 && (
            <p className="meta" style={{ margin: 0, color: 'var(--status-critical-text)' }}>
              {collisions} adresse{collisions > 1 ? 's' : ''} déjà prise{collisions > 1 ? 's' : ''}. Corrigez-les
              avant de lancer le cycle — sinon la page sera écrite puis refusée à la publication, après avoir
              été payée.
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(2)} className="btn-ghost">Retour analyse</button>
            <button
              onClick={confirmPlan}
              disabled={loading === 'confirm' || collisions > 0}
              className="btn-primary"
              title={
                collisions > 0
                  ? `${collisions} adresse${collisions > 1 ? 's' : ''} en collision : corrigez-les avant de lancer le cycle.`
                  : undefined
              }
            >
              {loading === 'confirm' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Confirmer et lancer le cycle
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Ce que ce brief fait au site qui existe déjà.
 *
 * `StatusBadge` porte déjà 'create' et 'refresh' dans le vocabulaire partagé —
 * on le lit, on n'écrit pas un second dictionnaire de deux entrées ici. Un plan
 * antérieur à ce lot ne porte aucun verdict : il s'affiche en « Nouvelle page »,
 * ce qu'il était, sans qu'on lui invente une décision rétroactive.
 */
function ActionBadge({ kind }: { kind: 'create' | 'refresh' | 'skip' }) {
  if (kind === 'skip') return <span className="badge badge-muted">Écartée</span>
  return <StatusBadge status={kind} />
}

/**
 * Trois états de champ, jamais deux — et le vert n'apparaît que sur une
 * vérification qui a réellement eu lieu.
 *
 * Le message de collision dit ce que la donnée PROUVE : `takenPaths` mélange les
 * pages en ligne et les adresses réservées par des générations qui n'ont rien
 * publié. Écrire « cette page existe déjà sur le site » serait faux une fois sur
 * deux.
 */
function SlugHint({ verdict }: { verdict: SlugVerdict | undefined }) {
  switch (verdict) {
    case 'taken':
      return (
        <FieldError>
          Cette URL est déjà prise sur ce site (page en ligne ou adresse réservée par une génération).
          Changez-la, ou laissez le moteur mettre cette page à jour plutôt que d’en créer une nouvelle.
        </FieldError>
      )
    case 'duplicate-in-plan':
      return <FieldError>Deux briefs de ce plan visent la même URL.</FieldError>
    case 'empty':
      return <FieldError>Une adresse est nécessaire : le moteur ne sait pas où écrire cette page.</FieldError>
    case 'free':
      // Un glyphe ET un mot : la couleur n'est jamais le seul porteur du verdict.
      return (
        <p className="meta" style={{ margin: 'var(--space-1) 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
          <CircleCheck size={11} color="var(--status-good)" aria-hidden="true" /> Adresse libre.
        </p>
      )
    case 'checking':
      return <p className="meta" style={{ margin: 'var(--space-1) 0 0' }}>Vérification…</p>
    default:
      // Régime aveugle, ou inventaire illisible. Surtout PAS le badge vert : une
      // ignorance affichée comme une garantie est le seul mensonge que cet
      // écran puisse encore dire.
      return (
        <p className="meta" style={{ margin: 'var(--space-1) 0 0' }}>
          Le moteur ne sait pas quelles adresses sont prises sur ce site. Celle-ci sera vérifiée directement
          sur le site avant l’écriture.
        </p>
      )
  }
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

/** `value` accepte une chaîne pour qu'un compteur puisse dire l'inconnu au lieu
 *  de rendre un 0 qui se lirait comme une mesure. Composant local à ce fichier :
 *  aucun autre appelant n'est concerné par l'élargissement. */
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="meta" style={{ marginTop: 'var(--space-1)' }}>{hint}</div>}
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
