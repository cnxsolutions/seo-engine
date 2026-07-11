import { generateSeoPage, type GeneratedSeoPage } from './page-types'
import { buildBreadcrumb } from '@/lib/seo/breadcrumb'
import { injectInternalLinks } from '@/lib/seo/internal-linking'
import type { GeneratedPage } from './openai'

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
  existingSlugs?: string[]
  existingKeywords?: string[]
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
    existingSlugs = [],
    existingKeywords = [],
  } = opts

  const generatedSlugs = [...existingSlugs]
  const generatedKeywords = [...existingKeywords]

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
    existingSlugs: generatedSlugs,
    existingKeywords: generatedKeywords,
  })
  generatedSlugs.push(pillarPage.slug)
  generatedKeywords.push(pillarPage.focusKeyword.toLowerCase())

  // 2. Pages filles — un sous-sujet par mot-clé satellite
  const satellitePages: GeneratedSeoPage[] = []
  for (const keyword of satelliteKeywords) {
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
      existingSlugs: generatedSlugs,
      existingKeywords: generatedKeywords,
    })
    generatedSlugs.push(page.slug)
    generatedKeywords.push(page.focusKeyword.toLowerCase())
    satellitePages.push(page)
  }

  // 3. Pages alternatives — capter le trafic "alternative à X"
  const alternativePages: GeneratedSeoPage[] = []
  if (enableAlternatives) {
    const altNames = alternativeNames.length > 0
      ? alternativeNames
      : generateAlternativeTargets(businessType, city)

    if (altNames.length > 0) {
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
        existingSlugs: generatedSlugs,
        existingKeywords: generatedKeywords,
      })
      generatedSlugs.push(altPage.slug)
      generatedKeywords.push(altPage.focusKeyword.toLowerCase())
      alternativePages.push(altPage)
    }
  }

  // 4. Pages comparatives — "meilleur X à Y", "X vs Y"
  const comparativePages: GeneratedSeoPage[] = []
  if (enableComparatives) {
    const compNames = competitorNames.length > 0
      ? competitorNames
      : generateCompetitorTargets(businessType, city)

    if (compNames.length > 0) {
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
        existingSlugs: generatedSlugs,
        existingKeywords: generatedKeywords,
      })
      generatedSlugs.push(compPage.slug)
      generatedKeywords.push(compPage.focusKeyword.toLowerCase())
      comparativePages.push(compPage)
    }
  }

  // 5. Page Local Pack — optimisée Google Maps / 3-pack
  let localPackPage: GeneratedSeoPage | null = null
  if (enableLocalPack) {
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
      existingSlugs: generatedSlugs,
      existingKeywords: generatedKeywords,
    })
    generatedSlugs.push(localPackPage.slug)
    generatedKeywords.push(localPackPage.focusKeyword.toLowerCase())
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
