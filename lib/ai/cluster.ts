import { generateSeoPage, type GeneratedSeoPage } from './page-types'
import { buildBreadcrumb } from '@/lib/seo/breadcrumb'
import { injectInternalLinks } from '@/lib/seo/internal-linking'
import type { GeneratedPage } from './openai'
import type { InventoryEntry, InventoryFreshness } from '@/src/core/domain/existing/inventory'

export interface GenerateClusterOptions {
  mainKeyword: string
  satelliteKeywords: string[]
  businessType: string
  businessName: string
  city: string
  department: string
  siteUrl: string
  model?: string
  targetLength?: number
  enableAlternatives?: boolean
  enableComparatives?: boolean
  enableLocalPack?: boolean
  competitorNames?: string[]
  alternativeNames?: string[]
  /**
   * Une adresse par page prevue, deja prouvee libre par l'appelant.
   *
   * Ce module ne resout plus rien : il consomme des slugs. La route
   * (app/api/cluster/route.ts) les resout AVANT l'appel, contre un Set qu'elle
   * fait grandir page apres page, parce que c'est le seul endroit ou une
   * collision peut encore etre traitee sans jeter une page deja payee.
   *
   * `satellites`, `alternatives` et `comparatives` sont lues par index, dans
   * l'ordre ou les pages sont produites.
   */
  reservedSlugs: {
    pillar: string
    satellites: string[]
    alternatives: string[]
    comparatives: string[]
    localPack?: string
  }
  /**
   * Les pages du site les plus proches du sujet du cluster, classees.
   *
   * Les memes pour toutes les pages produites ici : elles traitent le meme
   * sujet, donc elles ont les memes voisines. Les relire par page aurait paye
   * huit fois le meme embedding pour la meme reponse.
   */
  inventoryNeighbours: readonly InventoryEntry[]
  /** Ce que vaut la liste ci-dessus, et depuis quand. */
  inventoryFreshness: InventoryFreshness
}

export interface ClusterResult {
  pillarPage: GeneratedPage
  satellitePages: GeneratedPage[]
  alternativePages: GeneratedPage[]
  comparativePages: GeneratedPage[]
  localPackPage: GeneratedPage | null
  stats: {
    totalPages: number
    totalEstimatedWords: number
    pageTypes: Record<string, number>
  }
}

export async function generateCluster(opts: GenerateClusterOptions): Promise<ClusterResult> {
  const {
    mainKeyword,
    satelliteKeywords,
    businessType,
    businessName,
    city,
    department,
    siteUrl,
    model = 'gpt-4o',
    targetLength = 800,
    enableAlternatives = true,
    enableComparatives = true,
    enableLocalPack = true,
    competitorNames = [],
    alternativeNames = [],
    reservedSlugs,
  } = opts

  // Les listes vivantes `generatedSlugs` / `generatedKeywords` ont disparu.
  //
  // Elles servaient a dire au modele « n'utilise pas ceux-la », ce qui est une
  // consigne et non une garantie : le slug etait ensuite refabrique par
  // buildPageSlug sans jamais les consulter. Une adresse se reserve, elle ne se
  // recommande pas.

  // `action` est fixe a 'create' et n'est PAS un parametre : un cluster cree un
  // ensemble de pages neuves d'un seul tenant. Rafraichir une page existante est
  // une decision page par page, qui passe par le chemin planifie.
  const awareness = {
    inventoryNeighbours: opts.inventoryNeighbours,
    inventoryFreshness: opts.inventoryFreshness,
    action: { kind: 'create' } as const,
  }

  // 1. Page pilier — cornerstone exhaustive
  const pillarPage = await generateSeoPage({
    pageType: 'pillar',
    city,
    department,
    businessType,
    businessName,
    keywords: [mainKeyword, ...satelliteKeywords],
    siteUrl,
    targetLength,
    model,
    enableExternalLinks: true,
    externalLinkCount: 5,
    enableImages: true,
    imagePerPage: 3,
    reservedSlug: reservedSlugs.pillar,
    ...awareness,
  })

  // 2. Pages filles — un sous-sujet par mot-clé satellite
  const satellitePages: GeneratedSeoPage[] = []
  for (const [index, keyword] of satelliteKeywords.entries()) {
    // Un satellite sans adresse reservee est un sujet que l'appelant a ecarte
    // sur une collision. Il est saute ICI, avant l'appel au modele : c'est tout
    // l'interet d'avoir resolu les adresses en amont.
    const reservedSlug = reservedSlugs.satellites[index]
    if (!reservedSlug) continue

    const page = await generateSeoPage({
      pageType: 'child',
      city,
      department,
      businessType,
      businessName,
      keywords: [keyword, mainKeyword],
      siteUrl,
      targetLength,
      model: model === 'gpt-4o' ? 'gpt-4o-mini' : model,
      enableExternalLinks: true,
      externalLinkCount: 3,
      enableImages: true,
      imagePerPage: 2,
      pillarSlug: pillarPage.slug,
      pillarTitle: pillarPage.title,
      reservedSlug,
      ...awareness,
    })
    satellitePages.push(page)
  }

  // 3. Pages alternatives — capter le trafic "alternative à X"
  const alternativePages: GeneratedSeoPage[] = []
  if (enableAlternatives) {
    const altNames = alternativeNames.length > 0
      ? alternativeNames
      : generateAlternativeTargets(businessType, city)

    const altSlug = reservedSlugs.alternatives[0]

    if (altNames.length > 0 && altSlug) {
      const altPage = await generateSeoPage({
        pageType: 'alternative',
        city,
        department,
        businessType,
        businessName,
        keywords: [mainKeyword, ...altNames.map(n => `alternative ${n}`)],
        siteUrl,
        targetLength,
        model: model === 'gpt-4o' ? 'gpt-4o-mini' : model,
        enableExternalLinks: true,
        externalLinkCount: 3,
        enableImages: true,
        imagePerPage: 2,
        pillarSlug: pillarPage.slug,
        pillarTitle: pillarPage.title,
        alternativeNames: altNames,
        reservedSlug: altSlug,
        ...awareness,
      })
      alternativePages.push(altPage)
    }
  }

  // 4. Pages comparatives — "meilleur X à Y", "X vs Y"
  const comparativePages: GeneratedSeoPage[] = []
  if (enableComparatives) {
    const compNames = competitorNames.length > 0
      ? competitorNames
      : generateCompetitorTargets(businessType, city)

    const compSlug = reservedSlugs.comparatives[0]

    if (compNames.length > 0 && compSlug) {
      const compPage = await generateSeoPage({
        pageType: 'comparative',
        city,
        department,
        businessType,
        businessName,
        keywords: [mainKeyword, `meilleur ${businessType} ${city}`, `comparatif ${businessType} ${city}`],
        siteUrl,
        targetLength,
        model: model === 'gpt-4o' ? 'gpt-4o-mini' : model,
        enableExternalLinks: true,
        externalLinkCount: 3,
        enableImages: true,
        imagePerPage: 2,
        pillarSlug: pillarPage.slug,
        pillarTitle: pillarPage.title,
        competitorNames: compNames,
        reservedSlug: compSlug,
        ...awareness,
      })
      comparativePages.push(compPage)
    }
  }

  // 5. Page Local Pack — optimisée Google Maps / 3-pack
  let localPackPage: GeneratedSeoPage | null = null
  if (enableLocalPack && reservedSlugs.localPack) {
    localPackPage = await generateSeoPage({
      pageType: 'local_pack',
      city,
      department,
      businessType,
      businessName,
      keywords: [mainKeyword, `${businessType} près de moi`, `${businessType} ${city} avis`],
      siteUrl,
      targetLength,
      model: model === 'gpt-4o' ? 'gpt-4o-mini' : model,
      enableExternalLinks: true,
      externalLinkCount: 2,
      enableImages: true,
      imagePerPage: 2,
      pillarSlug: pillarPage.slug,
      pillarTitle: pillarPage.title,
      reservedSlug: reservedSlugs.localPack,
      ...awareness,
    })
  }

  // 6. Maillage interne complet entre toutes les pages du cluster
  const allPages = [
    pillarPage,
    ...satellitePages,
    ...alternativePages,
    ...comparativePages,
    ...(localPackPage ? [localPackPage] : []),
  ]

  const pillarBreadcrumb = buildBreadcrumb([
    { name: 'Accueil', url: siteUrl },
    { name: businessType, url: `${siteUrl.replace(/\/$/, '')}/${pillarPage.slug}` },
    { name: pillarPage.title, url: `${siteUrl.replace(/\/$/, '')}/${pillarPage.slug}` },
  ])

  // Pilier → liens vers toutes les pages filles + spécialisées
  const pillarLinks = allPages
    .filter(p => p !== pillarPage)
    .map(p => ({ anchor: p.focusKeyword, href: `/${p.slug}` }))

  const linkedPillar = injectInternalLinks(`${pillarBreadcrumb.html}${pillarPage.htmlContent}`, pillarLinks)
  pillarPage.htmlContent = linkedPillar.htmlContent
  pillarPage.internalLinksHtml = linkedPillar.injectedLinks
  pillarPage.schemaBreadcrumb = pillarBreadcrumb.schema

  // Pages filles/spécialisées → lien retour vers pilier + liens entre sœurs
  const childPages = [...satellitePages, ...alternativePages, ...comparativePages, ...(localPackPage ? [localPackPage] : [])]
  for (const page of childPages) {
    const pageBreadcrumb = buildBreadcrumb([
      { name: 'Accueil', url: siteUrl },
      { name: pillarPage.title, url: `${siteUrl.replace(/\/$/, '')}/${pillarPage.slug}` },
      { name: page.title, url: `${siteUrl.replace(/\/$/, '')}/${page.slug}` },
    ])

    const siblingLinks = [
      { anchor: pillarPage.focusKeyword, href: `/${pillarPage.slug}` },
      ...childPages
        .filter(s => s !== page)
        .slice(0, 3)
        .map(s => ({ anchor: s.focusKeyword, href: `/${s.slug}` })),
    ]

    const linkedPage = injectInternalLinks(`${pageBreadcrumb.html}${page.htmlContent}`, siblingLinks)
    page.htmlContent = linkedPage.htmlContent
    page.internalLinksHtml = linkedPage.injectedLinks
    page.schemaBreadcrumb = pageBreadcrumb.schema
  }

  // Stats
  const pageTypes: Record<string, number> = {}
  for (const p of allPages) {
    const type = (p as GeneratedSeoPage).pageType || 'child'
    pageTypes[type] = (pageTypes[type] || 0) + 1
  }

  return {
    pillarPage: toGeneratedPage(pillarPage),
    satellitePages: satellitePages.map(toGeneratedPage),
    alternativePages: alternativePages.map(toGeneratedPage),
    comparativePages: comparativePages.map(toGeneratedPage),
    localPackPage: localPackPage ? toGeneratedPage(localPackPage) : null,
    stats: {
      totalPages: allPages.length,
      totalEstimatedWords: allPages.reduce((sum, p) => sum + (p.estimatedWordCount || 0), 0),
      pageTypes,
    },
  }
}

function toGeneratedPage(page: GeneratedSeoPage): GeneratedPage {
  return page as unknown as GeneratedPage
}

function generateAlternativeTargets(businessType: string, city: string): string[] {
  const genericAlternatives: Record<string, string[]> = {
    plombier: ['SOS Plomberie', 'plombier pas cher', 'dépannage plomberie urgence'],
    taxi: ['VTC', 'Uber', 'covoiturage'],
    electricien: ['dépannage électrique DIY', 'électricien pas cher', 'SOS Électricité'],
    serrurier: ['serrurier pas cher', 'ouverture de porte DIY', 'SOS Serrurerie'],
    coach: ['coaching en ligne', 'formation autodidacte', 'mentorat gratuit'],
    avocat: ['aide juridictionnelle', 'conseiller juridique en ligne', 'médiateur'],
    dentiste: ['soins dentaires à l\'étranger', 'centres dentaires low-cost', 'dentiste de garde'],
  }

  const key = Object.keys(genericAlternatives).find(k => businessType.toLowerCase().includes(k))
  return key ? genericAlternatives[key].slice(0, 3) : [`autre ${businessType} ${city}`]
}

function generateCompetitorTargets(businessType: string, city: string): string[] {
  return [
    `${businessType} indépendant ${city}`,
    `grande enseigne ${businessType}`,
    `${businessType} en ligne`,
  ]
}
