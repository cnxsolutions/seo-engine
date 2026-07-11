import { generateJson } from '@/lib/ai/provider'
import { getSiteContext } from '@/lib/db'
import { generateEditorialCalendar } from '@/lib/scheduler/editorial'
import type { AnalysisRun, Campaign, PageType, PlanItemBrief } from '@/lib/types'

export interface GenerateBriefPlanOptions {
  campaign: Campaign
  cycleDays: number
  analysisRun?: AnalysisRun | null
  existingSlugs?: string[]
  existingKeywords?: string[]
}

export async function generateBriefPlan(opts: GenerateBriefPlanOptions): Promise<PlanItemBrief[]> {
  const { campaign, cycleDays, analysisRun } = opts
  let existingSlugs = opts.existingSlugs || []
  let existingKeywords = opts.existingKeywords || []

  if ((!opts.existingSlugs || !opts.existingKeywords) && campaign.site_id) {
    const context = await getSiteContext(campaign.site_id).catch(() => null)
    if (context) {
      existingSlugs = opts.existingSlugs || context.usedSlugs
      existingKeywords = opts.existingKeywords || context.usedKeywords
    }
  }

  const frequency = campaign.schedule_frequency || 'daily'
  const frequencyDays: Record<string, number> = {
    manual: 1,
    daily: 1,
    every_2_days: 2,
    every_3_days: 3,
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    custom: 1,
  }
  const intervalDays = frequencyDays[frequency] || 1
  const slotCount = Math.min(Math.floor(cycleDays / intervalDays), 60)

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)

  const calendarSlots = generateEditorialCalendar({
    campaign,
    startDate: tomorrow,
    slotCount,
  })

  if (calendarSlots.length === 0) return []

  const raw = await generateJson({
    systemPrompt: `Tu es un stratege SEO senior. Tu crees uniquement des briefs editoriaux exploitables par une IA de redaction plus tard.
Tu ne rediges jamais la page, tu ne fournis jamais de HTML, et tu reponds uniquement en JSON valide.`,
    userPrompt: buildPrompt({ campaign, analysisRun, existingSlugs, existingKeywords, calendarSlots }),
    model: 'gpt-4o-mini',
    maxTokens: 7000,
    temperature: 0.45,
  })

  try {
    const parsed = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed : parsed.items || parsed.plan || []
    return normalizeBriefs(items, calendarSlots, campaign)
  } catch {
    return fallbackBriefs(calendarSlots, campaign)
  }
}

function buildPrompt(opts: {
  campaign: Campaign
  analysisRun?: AnalysisRun | null
  existingSlugs: string[]
  existingKeywords: string[]
  calendarSlots: ReturnType<typeof generateEditorialCalendar>
}) {
  const analysis = opts.analysisRun?.analysis_data
  const competitorSummary = analysis?.competitors.map((competitor) => ({
    url: competitor.url,
    topKeywords: competitor.topKeywords.slice(0, 12),
    strengths: competitor.strengths,
    pages: competitor.pages.slice(0, 8).map((page) => ({
      title: page.title,
      h1: page.h1,
      wordCount: page.wordCount,
      keywords: page.keywords,
      hasFaq: page.hasFaq,
      hasSchema: page.hasSchema,
    })),
  })) || []

  const slots = opts.calendarSlots.map((slot) => ({
    scheduled_date: slot.scheduled_date,
    page_type: slot.page_type,
    target_keyword_seed: slot.target_keyword,
    target_city: slot.target_city,
  }))

  return `
Campagne:
- Activite: ${opts.campaign.business_type}
- Business: ${opts.campaign.business_name}
- Site: ${opts.campaign.site?.url || ''}
- Departement: ${opts.campaign.department || 'Aube'}
- Communes: ${opts.campaign.communes.join(', ')}
- Mots-cles de base: ${opts.campaign.keywords.join(', ')}

Analyse du site:
${analysis ? JSON.stringify({
  topKeywords: analysis.site.topKeywords,
  pages: analysis.site.pages.slice(0, 12),
  gaps: analysis.gapAnalysis,
}, null, 1) : 'Aucune analyse disponible'}

Analyse concurrents:
${JSON.stringify(competitorSummary, null, 1)}

Anti-doublon:
- Slugs deja utilises: ${opts.existingSlugs.slice(0, 50).join(', ') || 'aucun'}
- Mots-cles deja cibles: ${opts.existingKeywords.slice(0, 50).join(', ') || 'aucun'}

Slots a transformer en briefs:
${JSON.stringify(slots, null, 1)}

Objectif:
Pour chaque slot, produire un brief SEO complet. Ce brief servira le jour J a rediger la page avec une autre IA.
Ne redige pas la page. Ne donne pas de HTML.

Regles:
1. proposed_slug doit etre longue traine, 6 a 10 mots, unique, jamais dans les slugs deja utilises.
2. target_keyword doit etre une intention longue traine, differente des mots-cles deja cibles.
3. page_type "pillar": brief autorite topique, trame hub, liens vers pages filles.
4. page_type "child": angle specifique, lien retour pilier et pages soeurs.
5. page_type "alternative": capter "alternative a X", "moins cher que X", "remplacer X".
6. page_type "comparative": capter "meilleur X", "X vs Y", "comparatif".
7. page_type "local_pack": maximiser signaux locaux, quartiers, proximite, ouvert maintenant, avis.
8. outline contient uniquement les H2/H3 attendus, pas les paragraphes.
9. seo_rules contient les contraintes de redaction a respecter plus tard.
10. competitor_insights reprend des observations utiles des concurrents, sans copier leur contenu.

Reponds avec ce JSON:
{
  "items": [
    {
      "id": "laisser vide ou string",
      "scheduled_date": "YYYY-MM-DD",
      "page_type": "pillar|child|alternative|comparative|local_pack",
      "priority": "high|medium|low",
      "target_city": "ville",
      "target_keyword": "mot-cle focus longue traine",
      "secondary_keywords": ["8 variations minimum"],
      "search_intent": "transactionnelle|informationnelle|locale|comparative|alternative",
      "proposed_title": "titre SEO 50-65 caracteres",
      "proposed_slug": "slug-longue-traine-unique",
      "page_goal": "objectif de la page en une phrase",
      "outline": ["H2: ...", "H2: ...", "H3: ..."],
      "seo_rules": ["regle concrete", "regle concrete"],
      "required_entities": ["quartier", "code postal", "entite locale"],
      "internal_link_targets": ["slug ou role de page cible"],
      "competitor_insights": ["observation concurrentielle utile"],
      "estimated_word_count": 800,
      "rationale": "pourquoi cette page est prioritaire"
    }
  ]
}`.trim()
}

function normalizeBriefs(
  rawItems: Array<Partial<PlanItemBrief>>,
  slots: ReturnType<typeof generateEditorialCalendar>,
  campaign: Campaign
): PlanItemBrief[] {
  return slots.map((slot, index) => {
    const item = rawItems[index] || {}
    const pageType = (item.page_type || slot.page_type || 'child') as PageType
    const city = item.target_city || slot.target_city || campaign.communes[0] || campaign.department || ''
    const targetKeyword = item.target_keyword || slot.target_keyword || `${campaign.business_type} ${city}`.trim()

    return {
      id: item.id || createPlanItemId(),
      scheduled_date: item.scheduled_date || slot.scheduled_date,
      page_type: pageType,
      priority: item.priority || priorityFor(pageType, index),
      target_city: city,
      target_keyword: targetKeyword,
      secondary_keywords: asStringArray(item.secondary_keywords, [
        `${targetKeyword} pres de moi`,
        `${targetKeyword} avis`,
        `${targetKeyword} prix`,
      ]),
      search_intent: item.search_intent || intentFor(pageType),
      proposed_title: item.proposed_title || titleFor(pageType, campaign.business_type, city),
      proposed_slug: ensureLongTailSlug(item.proposed_slug || '', campaign.business_type, city, pageType),
      page_goal: item.page_goal || `Capter une intention ${intentFor(pageType)} sur ${targetKeyword}.`,
      outline: asStringArray(item.outline, defaultOutline(pageType, campaign.business_type, city)),
      seo_rules: asStringArray(item.seo_rules, defaultRules(pageType, targetKeyword)),
      required_entities: asStringArray(item.required_entities, [city, campaign.department || 'Aube']),
      internal_link_targets: asStringArray(item.internal_link_targets, pageType === 'pillar' ? ['pages filles du cluster'] : ['page pilier parente']),
      competitor_insights: asStringArray(item.competitor_insights, []),
      estimated_word_count: item.estimated_word_count || estimatedWords(pageType, campaign.target_length),
      rationale: item.rationale || `Page ${pageType} planifiee pour renforcer la couverture longue traine.`,
    }
  })
}

function fallbackBriefs(slots: ReturnType<typeof generateEditorialCalendar>, campaign: Campaign) {
  return normalizeBriefs([], slots, campaign)
}

function asStringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.length > 0
    ? value.map(String).filter(Boolean)
    : fallback
}

function priorityFor(pageType: PageType, index: number): PlanItemBrief['priority'] {
  if (pageType === 'pillar' || pageType === 'local_pack' || index < 2) return 'high'
  if (pageType === 'alternative' || pageType === 'comparative') return 'medium'
  return 'low'
}

function intentFor(pageType: PageType) {
  const map: Record<PageType, string> = {
    pillar: 'informationnelle et transactionnelle',
    child: 'longue traine specifique',
    alternative: 'alternative',
    comparative: 'comparative',
    local_pack: 'locale',
  }
  return map[pageType]
}

function titleFor(pageType: PageType, businessType: string, city: string) {
  if (pageType === 'local_pack') return `${businessType} pres de moi a ${city}`
  if (pageType === 'comparative') return `Quel ${businessType} choisir a ${city} ?`
  if (pageType === 'alternative') return `Alternative de ${businessType} a ${city}`
  return `${businessType} a ${city} : guide complet`
}

function defaultOutline(pageType: PageType, businessType: string, city: string) {
  if (pageType === 'local_pack') {
    return [
      `H2: Pourquoi choisir un ${businessType} proche de ${city} ?`,
      'H2: Zones desservies et delais',
      'H2: Avis, preuves et garanties',
      'H2: FAQ locale',
    ]
  }
  if (pageType === 'comparative') {
    return ['H2: Criteres de comparaison', 'H2: Tableau comparatif', 'H2: Avantages et limites', 'H2: Recommandation finale']
  }
  if (pageType === 'alternative') {
    return ['H2: Pourquoi chercher une alternative ?', 'H2: Options possibles', 'H2: Comparaison des solutions', 'H2: FAQ']
  }
  return ['H2: Besoin et intention de recherche', 'H2: Methode et criteres', 'H2: Conseils pratiques', 'H2: FAQ']
}

function defaultRules(pageType: PageType, keyword: string) {
  return [
    `Inclure le mot-cle "${keyword}" dans title, H1, introduction et un H2.`,
    'Inclure au moins 3 formulations longue traine naturelles.',
    'Ajouter une FAQ structuree.',
    pageType === 'local_pack' ? 'Renforcer les signaux de proximite, quartiers et avis.' : 'Prevoir un maillage interne coherent.',
  ]
}

function estimatedWords(pageType: PageType, baseLength: number) {
  const map: Record<PageType, number> = {
    pillar: Math.max(baseLength * 2, 1800),
    child: baseLength,
    alternative: Math.max(baseLength + 300, 1100),
    comparative: Math.max(baseLength + 500, 1300),
    local_pack: Math.max(baseLength + 200, 1000),
  }
  return map[pageType]
}

function ensureLongTailSlug(slug: string, businessType: string, city: string, pageType: PageType) {
  const clean = slugify(slug)
  const parts = clean.split('-').filter(Boolean)
  if (parts.length >= 6) return parts.slice(0, 10).join('-')

  const extras = [businessType, pageType, 'service', 'professionnel', city, 'guide', 'local']
    .map(slugify)
    .filter((part) => part && !parts.includes(part))

  return [...parts, ...extras].slice(0, 10).join('-')
}

function createPlanItemId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function slugify(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
