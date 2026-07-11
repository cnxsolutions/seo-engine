import OpenAI from 'openai'
import { generateJson } from './provider'

let client: OpenAI | null = null

export function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY manquante dans .env.local')
  }

  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  return client
}

export interface GeneratePageOptions {
  city: string
  department: string
  businessType: string
  businessName: string
  keywords: string[]
  siteUrl: string
  targetLength?: number
  model?: string
  includeEntities?: boolean
  ctaText?: string
}

export interface FaqItem {
  q: string
  a: string
}

export interface GeneratedPage {
  title: string
  metaDescription: string
  slug: string
  focusKeyword: string
  secondaryKeywords: string[]
  ogTitle: string
  ogDescription: string
  twitterTitle: string
  twitterDescription: string
  htmlContent: string
  schemaLocalBusiness: string
  schemaFaqPage: string
  schemaBreadcrumb: string
  internalLinks: Array<{ anchor: string; suggestion: string }>
  internalLinksHtml: string[]
  faqItems: FaqItem[]
  imageAlts: string[]
  ctaText: string
  targetLength: number
  estimatedWordCount: number
  readingTimeMinutes: number
}

export async function generateLocalSeoPage(opts: GeneratePageOptions): Promise<GeneratedPage> {
  const {
    city,
    department,
    businessType,
    businessName,
    keywords,
    siteUrl,
    targetLength = 700,
    model = 'gpt-4o',
    includeEntities = true,
    ctaText = 'Nous contacter',
  } = opts

  const raw = await generateJson({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt({
      city,
      department,
      businessType,
      businessName,
      keywords,
      siteUrl,
      targetLength,
      includeEntities,
      ctaText,
    }),
    model,
    maxTokens: 4000,
    temperature: 0.65,
  })

  try {
    const parsed = JSON.parse(raw) as Partial<GeneratedPage>
    return {
      title: parsed.title ?? `${businessType} ${city} | ${businessName}`,
      metaDescription: parsed.metaDescription ?? `${businessType} ${city} avec ${businessName}.`,
      slug: parsed.slug ?? slugify(`${businessType}-${city}`),
      focusKeyword: parsed.focusKeyword ?? `${businessType} ${city}`,
      secondaryKeywords: parsed.secondaryKeywords ?? [],
      ogTitle: parsed.ogTitle ?? parsed.title ?? `${businessType} ${city}`,
      ogDescription: parsed.ogDescription ?? parsed.metaDescription ?? '',
      twitterTitle: parsed.twitterTitle ?? parsed.ogTitle ?? parsed.title ?? '',
      twitterDescription: parsed.twitterDescription ?? parsed.ogDescription ?? parsed.metaDescription ?? '',
      htmlContent: parsed.htmlContent ?? '',
      schemaLocalBusiness: parsed.schemaLocalBusiness ?? '{}',
      schemaFaqPage: parsed.schemaFaqPage ?? '{}',
      schemaBreadcrumb: parsed.schemaBreadcrumb ?? '{}',
      internalLinks: parsed.internalLinks ?? [],
      internalLinksHtml: parsed.internalLinksHtml ?? [],
      faqItems: parsed.faqItems ?? [],
      imageAlts: parsed.imageAlts ?? [],
      ctaText: parsed.ctaText ?? ctaText,
      targetLength: parsed.targetLength ?? targetLength,
      estimatedWordCount: parsed.estimatedWordCount ?? estimateWordCount(parsed.htmlContent ?? ''),
      readingTimeMinutes: parsed.readingTimeMinutes ?? 3,
    }
  } catch {
    throw new Error('Reponse IA invalide (JSON malforme). Reessayez.')
  }
}

const SYSTEM_PROMPT = `
Tu es un expert SEO local francophone de niveau Google Certified Partner, specialise en local pack, E-E-A-T, et schema.org.
Tu connais parfaitement RankMath SEO Pro et toutes ses exigences pour le score 100/100.
Tu rediges uniquement du contenu unique, naturel, et a haute valeur ajoutee qui ne ressemble jamais a du contenu genere.
Reponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans commentaire.
Chaque valeur de chaine doit etre une chaine JSON valide.
`.trim()

function buildPrompt(opts: Omit<GeneratePageOptions, 'model'>): string {
  const { city, department, businessType, businessName, keywords, siteUrl, targetLength, includeEntities, ctaText } = opts
  const mainKeyword = `${businessType} ${city}`
  const year = new Date().getFullYear()

  return `
Genere une page SEO locale complete et optimisee RankMath SEO Pro 100/100 pour :

- Type d'activite : ${businessType}
- Business : ${businessName}
- Ville cible : ${city} (${department})
- Site web : ${siteUrl}
- Mots-cles : ${keywords.join(', ')}
- Mot-cle focus : "${mainKeyword}"
- Longueur cible du contenu : ~${targetLength} mots
- Annee : ${year}
- CTA principal : "${ctaText}"
- Inclure les entites metier detaillees : ${includeEntities ? 'oui' : 'non'}

REPONDS EN JSON avec EXACTEMENT cette structure :
{
  "title": "string",
  "metaDescription": "string",
  "slug": "string",
  "focusKeyword": "string",
  "secondaryKeywords": ["string"],
  "ogTitle": "string",
  "ogDescription": "string",
  "twitterTitle": "string",
  "twitterDescription": "string",
  "htmlContent": "HTML complet avec hero, contenu, FAQ et CTA",
  "schemaLocalBusiness": "JSON-LD string",
  "schemaFaqPage": "JSON-LD string",
  "schemaBreadcrumb": "JSON-LD string",
  "internalLinks": [{"anchor": "string", "suggestion": "string"}],
  "internalLinksHtml": ["<a href='/url'>ancre</a>"],
  "faqItems": [{"q": "string", "a": "string"}],
  "imageAlts": ["string"],
  "ctaText": "${ctaText}",
  "targetLength": ${targetLength},
  "estimatedWordCount": 1200,
  "readingTimeMinutes": 6
}

Contraintes critiques :
1. Le mot-cle focus "${mainKeyword}" apparait dans title, metaDescription, H1, premier paragraphe, au moins un H2 et le slug.
2. Minimum 3 sous-titres H2/H3.
3. Minimum 3 questions FAQ coherentes avec faqItems et schemaFaqPage.
4. Le contenu atteint au moins ${targetLength} mots.
5. Le CTA final utilise "${ctaText}".
6. Le fil d'Ariane est coherant avec la page cible.
7. Fournir 3 suggestions d'alt d'image.
8. ${includeEntities ? 'Inclure adresse, horaires, zones desservies, preuves sociales et entites metier concretes.' : 'Les entites metier peuvent rester legeres si inconnues.'}
`.trim()
}

function slugify(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function estimateWordCount(html: string) {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
}
