import { generateJson } from './provider'
import type { PageType, PlanItemBrief } from '@/lib/types'
import type { GeneratedPage } from './openai'
import { createFullRagContextBuilder, type RagGenerationContext } from './full-rag-context'
import { createRagContextBuilder, type RagEnrichmentContext } from './rag-enricher'

export interface PageTypeGenerateOptions {
  pageType: PageType
  city: string
  department: string
  businessType: string
  businessName: string
  keywords: string[]
  siteUrl: string
  targetLength?: number
  model?: string
  enableExternalLinks?: boolean
  externalLinkCount?: number
  enableImages?: boolean
  imagePerPage?: number
  pillarSlug?: string
  pillarTitle?: string
  competitorNames?: string[]
  alternativeNames?: string[]
  existingSlugs?: string[]
  existingKeywords?: string[]
  planBrief?: PlanItemBrief
  googleContext?: import('@/lib/google/context').GoogleContext | null
  enableRag?: boolean
  // Full RAG integration
  siteId?: string
  campaignId?: string
}

export interface GeneratedSeoPage extends GeneratedPage {
  pageType: PageType
  externalLinks: Array<{ url: string; anchor: string; domain: string; relevance: string }>
  parentSlug?: string
  relatedSlugs: string[]
  // RAG stats
  ragStats?: {
    buildTimeMs: number
    sourcesUsed: string[]
    keywordsIncluded: number
    examplesFound: number
    linksSuggested: number
  }
  // RAG context for reference
  ragContext?: {
    taxonomy?: string
    competitor?: string
    google?: string
    structure?: string
  }
}

const PAGE_TYPE_CONFIG: Record<PageType, {
  systemPromptExtra: string
  targetLengthMultiplier: number
  minFaq: number
  requiredSections: string[]
}> = {
  pillar: {
    systemPromptExtra: `Tu rediges une PAGE PILIER (cornerstone content). C'est la page principale d'un cluster thematique.
Elle doit etre exhaustive, faire autorite sur le sujet, et servir de hub vers les pages filles.
Structure: introduction complete, historique/contexte, sous-sections detaillees, liens vers pages filles, FAQ riche, CTA.
Densite de mots-cles naturelle (1.5-2.5%), au moins 7 sous-titres H2 dont 3 sous forme de QUESTIONS (People Also Ask).
SLUG LONG-TAIL: format [activite]-[service-complet]-[specialite]-[ville]-[departement] (minimum 6 mots).
Entites semantiques variees: quartiers, codes postaux, noms de rues, points de repere.
Inclure des variantes "pres de moi", "a proximite", "dans le quartier" dans le contenu.`,
    targetLengthMultiplier: 2.5,
    minFaq: 6,
    requiredSections: ['hero', 'introduction', 'context', 'detailed_sections', 'child_links', 'faq', 'cta'],
  },
  child: {
    systemPromptExtra: `Tu rediges une PAGE FILLE liee a une page pilier. Elle traite un sous-aspect specifique du sujet pilier.
Elle doit contenir un lien retour vers la page pilier et des liens vers les pages soeurs.
Plus focalisee qu'une page pilier, elle approfondit un angle precis et longue traine.
SLUG LONG-TAIL: format [service-specifique]-[action]-[contexte]-[ville]-[quartier] (minimum 6 mots).
Le title DOIT etre sous forme de question longue traine ou intention specifique.
Inclure un breadcrumb: Accueil > [Page Pilier] > [Cette page].
Entites NLP: noms de quartiers, communes voisines, points de repere locaux.`,
    targetLengthMultiplier: 1.0,
    minFaq: 3,
    requiredSections: ['hero', 'content', 'parent_link', 'faq', 'cta'],
  },
  alternative: {
    systemPromptExtra: `Tu rediges une PAGE ALTERNATIVE ("Alternative a X" ou "X vs Y").
L'objectif est de capter le trafic des personnes cherchant des alternatives a un service/produit concurrent.
Structure: introduction du besoin, presentation des alternatives avec avantages/inconvenients, tableau comparatif, recommandation finale.
SLUG LONG-TAIL: format alternative-a-[concurrent]-[service]-[ville]-[annee] (minimum 6 mots).
Ton objectif et impartial mais oriente vers notre business. Inclure des preuves sociales.
Cibler les intentions: "pas cher", "meilleur rapport qualite prix", "avis clients".`,
    targetLengthMultiplier: 1.5,
    minFaq: 4,
    requiredSections: ['hero', 'why_alternatives', 'comparison_table', 'detailed_alternatives', 'recommendation', 'faq', 'cta'],
  },
  comparative: {
    systemPromptExtra: `Tu rediges une PAGE COMPARATIVE detaillee (type "A vs B" ou "Comparatif des meilleurs X").
Structure avec tableau comparatif, criteres de comparaison clairs, avantages/inconvenients pour chaque option.
SLUG LONG-TAIL: format comparatif-meilleur-[activite]-[ville]-[critere]-[annee] (minimum 6 mots).
Ton neutre et expert avec donnees concretes. Inclure des notes/scores si pertinent.
Finir par une recommandation contextuelle (selon le besoin du lecteur).
Cibler: "meilleur X a Y", "top X", "quel X choisir", "X ou Y lequel choisir".`,
    targetLengthMultiplier: 1.8,
    minFaq: 4,
    requiredSections: ['hero', 'criteria', 'comparison_table', 'detailed_comparison', 'scores', 'verdict', 'faq', 'cta'],
  },
  local_pack: {
    systemPromptExtra: `Tu rediges une PAGE LOCAL PACK optimisee pour le pack local Google (Google Maps / 3-pack).
Maximise les signaux de localisation: adresse precise, zones desservies, horaires, avis clients, schema LocalBusiness complet.
Inclure NAP (Name, Address, Phone) consistent. Mentionner quartiers, rues, points de repere locaux.
SLUG LONG-TAIL: format [activite]-[quartier-ou-rue]-[ville]-proximite-[service] (minimum 6 mots).
Optimiser pour "pres de moi", "a proximite", "ouvert maintenant", "urgence" et intentions locales.
Le schema.org LocalBusiness doit etre extremement detaille (geo, openingHours, areaServed, aggregateRating).
Mentionner au moins 5 quartiers/zones differents de la ville dans le contenu.`,
    targetLengthMultiplier: 1.2,
    minFaq: 3,
    requiredSections: ['hero', 'local_info', 'services', 'areas_served', 'testimonials', 'faq', 'cta'],
  },
}

export async function generateSeoPage(opts: PageTypeGenerateOptions): Promise<GeneratedSeoPage> {
  const {
    pageType,
    city,
    department,
    businessType,
    businessName,
    keywords,
    siteUrl,
    targetLength = 800,
    model = 'claude-haiku',
    enableExternalLinks = true,
    externalLinkCount = 3,
    enableImages = true,
    imagePerPage = 2,
    pillarSlug,
    pillarTitle,
    competitorNames = [],
    alternativeNames = [],
    planBrief,
    enableRag = true,
    siteId: explicitSiteId,
  } = opts

  const config = PAGE_TYPE_CONFIG[pageType]
  const adjustedLength = Math.round(targetLength * config.targetLengthMultiplier)

  // Build FULL RAG context if siteId is available and RAG is enabled
  let fullRagContext: RagGenerationContext | undefined = undefined
  if (enableRag && (opts.siteId || explicitSiteId)) {
    try {
      const builder = createFullRagContextBuilder({ enabled: true })
      const resolvedSiteId = explicitSiteId || await getSiteIdFromUrl(opts.siteUrl)
      if (resolvedSiteId) {
        // Get campaign from siteId if not provided
        const campaign = opts.planBrief ? undefined : await getCampaignFromSite(resolvedSiteId)

        fullRagContext = await builder.buildContext({
          siteId: resolvedSiteId,
          campaign: campaign || {
            id: '',
            name: '',
            business_type: businessType,
            business_name: businessName,
            keywords,
            department,
            communes: [city],
            frequency_hours: 24,
            ai_model: model,
            target_length: targetLength,
            is_active: true,
            auto_publish: false,
            publish_status: 'draft' as const,
            site_id: resolvedSiteId,
            created_at: '',
            updated_at: '',
          },
          pageType,
          focusKeyword: planBrief?.target_keyword || `${businessType} ${city}`,
          secondaryKeywords: keywords,
          city,
          department,
          existingSlugs: opts.existingSlugs || [],
          existingKeywords: opts.existingKeywords || [],
          planBrief,
        })
      }
    } catch (error) {
      console.warn('[generateSeoPage] Full RAG context build failed:', error)
    }
  }

  const systemPrompt = buildSystemPrompt(pageType, config.systemPromptExtra)
  const userPrompt = buildUserPrompt({
    pageType,
    city,
    department,
    businessType,
    businessName,
    keywords,
    siteUrl,
    adjustedLength,
    enableExternalLinks,
    externalLinkCount,
    enableImages,
    imagePerPage,
    minFaq: config.minFaq,
    requiredSections: config.requiredSections,
    pillarSlug,
    pillarTitle,
    competitorNames,
    alternativeNames,
    existingSlugs: opts.existingSlugs || [],
    existingKeywords: opts.existingKeywords || [],
    planBrief,
    googleContext: opts.googleContext || undefined,
    fullRagContext,
  })

  const raw = await generateJson({
    systemPrompt,
    userPrompt,
    model,
    maxTokens: adjustedLength > 1500 ? 8000 : 4096,
    temperature: 0.6,
  })

  try {
    const parsed = JSON.parse(raw)
    return normalizeResponse(parsed, opts, adjustedLength, fullRagContext)
  } catch {
    throw new Error(`Reponse IA invalide pour page ${pageType} (JSON malforme). Reessayez.`)
  }
}

function buildSystemPrompt(pageType: PageType, extra: string): string {
  return `Tu es un expert SEO francophone de niveau Google Certified Partner, specialise en strategie de contenu, E-E-A-T, local pack, et schema.org.
Tu maitrises parfaitement les strategies de maillage interne (pilier/fille/satellite) et de maillage externe.
Tu connais RankMath SEO Pro et toutes ses exigences pour le score 100/100.

TYPE DE PAGE: ${pageType.toUpperCase()}
${extra}

REGLES ABSOLUES:
- Reponds UNIQUEMENT en JSON valide, sans markdown, sans backticks.
- Le contenu doit etre unique, naturel, et ne jamais ressembler a du contenu genere par IA.
- Utilise des donnees concretes, des chiffres, des exemples locaux.
- Varie les formulations et la structure des phrases.
- Integre des preuves sociales (avis, temoignages, chiffres).
`.trim()
}

function buildUserPrompt(opts: {
  pageType: PageType
  city: string
  department: string
  businessType: string
  businessName: string
  keywords: string[]
  siteUrl: string
  adjustedLength: number
  enableExternalLinks: boolean
  externalLinkCount: number
  enableImages: boolean
  imagePerPage: number
  minFaq: number
  requiredSections: string[]
  pillarSlug?: string
  pillarTitle?: string
  competitorNames: string[]
  alternativeNames: string[]
  existingSlugs: string[]
  existingKeywords: string[]
  planBrief?: PlanItemBrief
  googleContext?: import('@/lib/google/context').GoogleContext
  fullRagContext?: RagGenerationContext
}): string {
  const mainKeyword = opts.planBrief?.target_keyword || `${opts.businessType} ${opts.city}`
  const year = new Date().getFullYear()

  let contextBlock = ''
  if (opts.pageType === 'child' && opts.pillarSlug && opts.pillarTitle) {
    contextBlock = `
- Page pilier parente : "${opts.pillarTitle}" (slug: /${opts.pillarSlug})
- Inclure un lien retour vers la page pilier dans le contenu.`
  }
  if (opts.pageType === 'alternative' && opts.alternativeNames.length > 0) {
    contextBlock = `
- Alternatives a comparer : ${opts.alternativeNames.join(', ')}
- Notre solution : ${opts.businessName}`
  }
  if (opts.pageType === 'comparative' && opts.competitorNames.length > 0) {
    contextBlock = `
- Elements a comparer : ${opts.competitorNames.join(', ')}
- Inclure notre solution : ${opts.businessName}`
  }

  const externalLinksBlock = opts.enableExternalLinks
    ? `
- Inclure ${opts.externalLinkCount} liens externes vers des sources d'autorite (sites gouvernementaux, Wikipedia, etudes, organismes officiels).
- Format: {"url": "https://...", "anchor": "texte d'ancrage", "domain": "example.com", "relevance": "pourquoi ce lien est pertinent"}`
    : '- Pas de liens externes.'

  const imagesBlock = opts.enableImages
    ? `
- Proposer ${opts.imagePerPage} suggestions d'images avec alt text optimise SEO.
- Format imageAlts: ["alt text descriptif avec mot-cle"]`
    : '- Pas d\'images requises.'

  const briefBlock = opts.planBrief
    ? `
BRIEF DU PLAN A RESPECTER STRICTEMENT:
- Titre cible: ${opts.planBrief.proposed_title}
- Slug cible: ${opts.planBrief.proposed_slug}
- Mot-cle focus cible: ${opts.planBrief.target_keyword}
- Intention: ${opts.planBrief.search_intent}
- Objectif: ${opts.planBrief.page_goal}
- Trame obligatoire: ${opts.planBrief.outline.join(' | ')}
- Regles SEO: ${opts.planBrief.seo_rules.join(' | ')}
- Entites requises: ${opts.planBrief.required_entities.join(', ')}
- Maillage interne suggere: ${opts.planBrief.internal_link_targets.join(', ')}
- Insights concurrents a exploiter sans copier: ${opts.planBrief.competitor_insights.join(' | ') || 'aucun'}

Tu dois conserver le slug cible et le mot-cle focus cible dans la reponse JSON.`
    : ''

  let googleBlock = ''
  if (opts.googleContext?.gbp) {
    const g = opts.googleContext.gbp
    googleBlock += `
DONNEES GOOGLE BUSINESS PROFILE (REELLES — utiliser comme preuve sociale et coherence NAP):
- Nom officiel: ${g.businessName}
- Adresse: ${g.address}
- Telephone: ${g.phone}
- Horaires: ${g.hours}
- Note Google: ${g.averageRating}/5 (${g.reviewCount} avis)
- Avis clients recents: ${g.topReviews.slice(0, 5).map((r) => `"${r}"`).join(' | ') || 'aucun'}
- Services/categories: ${g.services.join(', ') || 'non renseigne'}
IMPORTANT: Utiliser les VRAIES informations ci-dessus (tel, adresse, horaires) dans le contenu. Ne pas inventer.
`
  }
  if (opts.googleContext?.gsc) {
    const s = opts.googleContext.gsc
    googleBlock += `
DONNEES SEARCH CONSOLE (mots-cles qui rankent reellement):
- Top requetes: ${s.topQueries.slice(0, 8).map((q) => `"${q.query}" (pos ${q.position})`).join(', ')}
- Position moyenne: ${s.averagePosition}
IMPORTANT: Integrer naturellement ces requetes performantes dans le contenu pour renforcer le positionnement.
`
  }

  // Full RAG Context Block (using ALL sources: Taxonomy, Competitor, Google, RAG examples)
  let ragBlock = ''
  if (opts.fullRagContext) {
    const builder = createFullRagContextBuilder({ enabled: true })
    ragBlock = '\n\n' + builder.formatAsPrompt(opts.fullRagContext)
  }

  return `
Genere une page SEO de type "${opts.pageType}" complete et optimisee pour :

- Type d'activite : ${opts.businessType}
- Business : ${opts.businessName}
- Ville cible : ${opts.city} (${opts.department})
- Site web : ${opts.siteUrl}
- Mots-cles : ${opts.keywords.join(', ')}
- Mot-cle focus : "${mainKeyword}"
- Longueur cible : ~${opts.adjustedLength} mots
- Annee : ${year}
- Minimum FAQ : ${opts.minFaq} questions
- Sections requises : ${opts.requiredSections.join(', ')}
${contextBlock}
${briefBlock}
${googleBlock}${ragBlock}

MAILLAGE EXTERNE:
${externalLinksBlock}

IMAGES:
${imagesBlock}

REPONDS EN JSON avec cette structure :
{
  "title": "string (max 65 chars, format QUESTION longue traine ou intention specifique, mot-cle focus inclus)",
  "metaDescription": "string (max 155 chars, mot-cle focus + benefice + CTA + localisation)",
  "slug": "string LONG-TAIL OBLIGATOIRE (6-10 mots separes par tirets, ex: depannage-plomberie-urgence-fuite-eau-troyes-centre-ville). JAMAIS de slug court a 2-3 mots.",
  "focusKeyword": "${mainKeyword}",
  "secondaryKeywords": ["MINIMUM 8 mots-cles: 2 variations geo (quartiers/communes voisines), 2 questions longue-traine, 2 'pres de moi/a proximite', 2 variantes service specifique"],
  "ogTitle": "string",
  "ogDescription": "string",
  "twitterTitle": "string",
  "twitterDescription": "string",
  "htmlContent": "HTML complet avec toutes les sections requises",
  "schemaLocalBusiness": "JSON-LD string",
  "schemaFaqPage": "JSON-LD string",
  "schemaBreadcrumb": "JSON-LD string",
  "internalLinks": [{"anchor": "string", "suggestion": "slug de la page cible"}],
  "internalLinksHtml": ["<a href='/url'>ancre</a>"],
  "faqItems": [{"q": "string", "a": "string"}],
  "imageAlts": ["string"],
  "externalLinks": [{"url": "string", "anchor": "string", "domain": "string", "relevance": "string"}],
  "relatedSlugs": ["slugs de pages liees suggerees"],
  "ctaText": "Nous contacter",
  "targetLength": ${opts.adjustedLength},
  "estimatedWordCount": number,
  "readingTimeMinutes": number
}

ANTI-DOUBLON (CRITIQUE):
${opts.existingSlugs.length > 0 ? `- Slugs DEJA UTILISES (NE PAS reutiliser): ${opts.existingSlugs.slice(0, 30).join(', ')}` : '- Pas de slugs existants connus.'}
${opts.existingKeywords.length > 0 ? `- Mots-cles DEJA CIBLES (choisir un angle DIFFERENT): ${opts.existingKeywords.slice(0, 30).join(', ')}` : '- Pas de mots-cles existants connus.'}

STRATEGIE LONG-TAIL (OBLIGATOIRE):
- Le slug DOIT faire entre 6 et 10 mots, separes par des tirets. JAMAIS moins de 5 mots.
- Format slug: [service]-[specificite]-[intention]-[localisation-precise]
- Exemples de slugs CORRECTS:
  * "depannage-plomberie-urgence-fuite-eau-troyes-centre-ville"
  * "installation-chauffe-eau-thermodynamique-prix-troyes-saint-andre"
  * "meilleur-electricien-renovation-appartement-ancien-troyes-aube"
- Le TITLE doit cibler une question ou intention longue-traine (ex: "Comment trouver un plombier pas cher a Troyes pour une fuite urgente?")
- OBLIGATOIRE dans le contenu:
  * Au moins 3 variantes semantiques LSI du mot-cle focus
  * Au moins 2 formulations "pres de moi" / "a proximite" / "dans le quartier de"
  * Au moins 3 sous-titres H2 en forme de QUESTIONS (style People Also Ask)
  * Entites NLP: noms de quartiers, codes postaux (10000, 10100...), rues connues, points de repere
  * Intentions de recherche variees: transactionnelle ("devis gratuit", "prix", "tarif horaire"), informationnelle ("comment", "pourquoi", "quand"), navigationnelle ("trouver", "localiser", "contacter")
- secondaryKeywords DOIT contenir au minimum 8 mots-cles diversifies

Contraintes critiques :
1. Le mot-cle focus "${mainKeyword}" apparait dans title, metaDescription, H1, premier paragraphe, un H2, et le slug.
2. Minimum ${opts.minFaq} questions FAQ.
3. Le contenu atteint au moins ${opts.adjustedLength} mots.
4. Les liens externes pointent vers des sources REELLES et fiables (pas de liens inventes).
5. Le maillage interne suggere des pages coherentes avec la strategie pilier/fille.
6. Schema.org complet et valide.
7. Le slug DOIT etre UNIQUE — ne pas reprendre un slug de la liste existante ci-dessus.
8. Si le mot-cle focus est deja cible par une page existante, VARIER l'angle (longue traine, geo-specifique, intention differente).
`.trim()
}

function normalizeResponse(
  parsed: Record<string, unknown>,
  opts: PageTypeGenerateOptions,
  adjustedLength: number,
  fullRagContext?: RagGenerationContext
): GeneratedSeoPage {
  const p = parsed as Partial<GeneratedSeoPage>
  const rawSlug = opts.planBrief?.proposed_slug ?? (p.slug as string) ?? slugify(`${opts.pageType}-${opts.businessType}-${opts.city}`)
  const slug = ensureLongTailSlug(rawSlug, opts)

  return {
    title: (p.title as string) ?? opts.planBrief?.proposed_title ?? `${opts.businessType} ${opts.city}`,
    metaDescription: (p.metaDescription as string) ?? '',
    slug,
    focusKeyword: opts.planBrief?.target_keyword ?? (p.focusKeyword as string) ?? `${opts.businessType} ${opts.city}`,
    secondaryKeywords: (p.secondaryKeywords as string[]) ?? opts.planBrief?.secondary_keywords ?? [],
    ogTitle: (p.ogTitle as string) ?? (p.title as string) ?? '',
    ogDescription: (p.ogDescription as string) ?? (p.metaDescription as string) ?? '',
    twitterTitle: (p.twitterTitle as string) ?? (p.ogTitle as string) ?? '',
    twitterDescription: (p.twitterDescription as string) ?? (p.ogDescription as string) ?? '',
    htmlContent: (p.htmlContent as string) ?? '',
    schemaLocalBusiness: (p.schemaLocalBusiness as string) ?? '{}',
    schemaFaqPage: (p.schemaFaqPage as string) ?? '{}',
    schemaBreadcrumb: (p.schemaBreadcrumb as string) ?? '{}',
    internalLinks: (p.internalLinks as GeneratedSeoPage['internalLinks']) ?? [],
    internalLinksHtml: (p.internalLinksHtml as string[]) ?? [],
    faqItems: (p.faqItems as GeneratedSeoPage['faqItems']) ?? [],
    imageAlts: (p.imageAlts as string[]) ?? [],
    ctaText: (p.ctaText as string) ?? 'Nous contacter',
    targetLength: adjustedLength,
    estimatedWordCount: (p.estimatedWordCount as number) ?? adjustedLength,
    readingTimeMinutes: (p.readingTimeMinutes as number) ?? Math.ceil(adjustedLength / 200),
    pageType: opts.pageType,
    externalLinks: (p.externalLinks as GeneratedSeoPage['externalLinks']) ?? [],
    parentSlug: opts.pillarSlug,
    relatedSlugs: (p.relatedSlugs as string[]) ?? [],
    // RAG stats
    ragStats: fullRagContext?.stats,
    // RAG context blocks for reference
    ragContext: fullRagContext ? {
      taxonomy: fullRagContext.promptBlocks.taxonomy || undefined,
      competitor: fullRagContext.promptBlocks.competitor || undefined,
      google: fullRagContext.promptBlocks.google || undefined,
      structure: fullRagContext.promptBlocks.structure || undefined,
    } : undefined,
  }
}

function ensureLongTailSlug(slug: string, opts: PageTypeGenerateOptions): string {
  const parts = slug.split('-').filter(Boolean)
  if (parts.length >= 5) return slug

  const city = slugify(opts.city)
  const dept = slugify(opts.department)
  const biz = slugify(opts.businessType)
  const pageType = slugify(opts.pageType)

  const extras = [biz, pageType, city, dept, 'service', 'professionnel']
    .filter(s => s && !slug.includes(s))

  return [...parts, ...extras].slice(0, 9).join('-')
}

function slugify(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Get site ID from URL by querying Supabase
 */
async function getSiteIdFromUrl(siteUrl: string): Promise<string | null> {
  try {
    const { createServiceClient } = await import('@/lib/supabase')
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('sites')
      .select('id')
      .eq('url', siteUrl)
      .maybeSingle()
    return data?.id || null
  } catch {
    return null
  }
}

/**
 * Get campaign from siteId
 */
async function getCampaignFromSite(siteId: string): Promise<import('@/lib/types').Campaign | null> {
  try {
    const { createServiceClient } = await import('@/lib/supabase')
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('campaigns')
      .select('*')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .limit(1)
      .single()
    return data as import('@/lib/types').Campaign | null
  } catch {
    return null
  }
}
