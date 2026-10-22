import OpenAI from 'openai'
import { generateJson } from './provider'
import { buildPageSlug } from '@/lib/seo/slug'

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

/**
 * A defect found in a generated page, carried with the page instead of being
 * silently patched over.
 *
 * `blocking` means the page must not be published as it stands (no meta
 * description, no direct answer, empty schemas). `warning` means it is
 * publishable but below target. Nothing here rejects a page on its own — the
 * publication gate decides; see `hasBlockingAnomaly` in page-types.ts.
 */
export interface PageAnomaly {
  field: string
  severity: 'blocking' | 'warning'
  reason: string
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
  /**
   * The 40-60 word self-contained answer that opens the page, right after the
   * H1. Duplicated out of `htmlContent` on purpose: it is the block an engine
   * can lift as an extract or a citation, so downstream code needs it without
   * re-parsing the HTML.
   *
   * Optional on the type — pages rebuilt from the legacy scalar columns have no
   * way to recover it.
   */
  directAnswer?: string
  /** Author entity (the business itself — never an invented person). */
  author?: string
  /** ISO 8601 (YYYY-MM-DD). */
  datePublished?: string
  /** ISO 8601 (YYYY-MM-DD). */
  dateModified?: string
  /** JSON-LD Article carrying author, publisher, datePublished, dateModified. */
  schemaArticle?: string
  /** Qualified search intent the page was written for. */
  searchIntent?: string
  /** Defects detected at normalization time. Empty array when the page is clean. */
  anomalies?: PageAnomaly[]
}

// ─── Shared editorial rules ────────────────────────────────────────────────
//
// These blocks are shared by every generator (this module and page-types.ts).
// They live here because page-types.ts already depends on this module for
// `GeneratedPage`; the reverse edge would be an import cycle.

/**
 * The single rule that outranks all the others.
 *
 * The project already forbids inventing GBP/GSC data; this extends the same
 * discipline to everything a model is tempted to fabricate. A page without a
 * figure is fine. A page with an invented figure, review or citation is a legal
 * exposure in France (publicite trompeuse, faux avis), not only an SEO defect.
 */
export const FACTUAL_INTEGRITY_RULES = `
INTEGRITE FACTUELLE (REGLE ABSOLUE — elle prime sur toutes les autres consignes):
- INTERDICTION d'inventer : une source, une etude, un institut, un organisme, une statistique,
  un pourcentage, un chiffre d'affaires, un prix, un tarif, un delai chiffre, une date historique,
  un avis client, un temoignage, une note, un nombre d'avis, une recompense, une certification,
  un label, un nom de client, une citation ou une declaration attribuee a quelqu'un.
- Tu n'emploies un chiffre, un avis, une note ou une citation QUE s'il figure explicitement dans
  les donnees fournies plus haut dans ce prompt. Aucune autre valeur chiffree n'est autorisee.
- Donnee manquante = tu reformules SANS elle. Une page sans aucun chiffre est CORRECTE et attendue.
  Une page avec un chiffre invente est un DEFAUT GRAVE (risque juridique en France).
- Formulations bannies sans donnee fournie : "selon une etude", "d'apres les statistiques",
  "9 clients sur 10", "des milliers de clients", "note moyenne de X/5", "plus de X interventions",
  "leader", "n°1", "le moins cher", "meilleur prix garanti", "satisfaction 100%".
- aggregateRating / reviewCount / review dans le JSON-LD : UNIQUEMENT si une note et un nombre
  d'avis reels sont fournis. Sinon ces proprietes sont ABSENTES du schema. Ne jamais les inventer.
- Liens externes : uniquement vers des domaines officiels qui existent (service-public.fr,
  legifrance.gouv.fr, ademe.fr, insee.fr, wikipedia.org, federations professionnelles). En cas de
  doute sur une URL profonde, pointer la page d'accueil du domaine. Aucune URL devinee.
- Prix et delais : rester qualitatif ("sur devis", "variable selon l'intervention") sauf donnee fournie.
- Ce que tu peux ecrire librement : l'expertise metier (methode, etapes, cas de figure, contraintes
  reglementaires generales, criteres de choix). L'experience se raconte, elle ne se chiffre pas.
`.trim()

/**
 * The format that decides whether a page can be quoted as an extract or cited
 * by a generative answer. Nothing else in the prompt guarantees a self-standing
 * answer at the top of the page.
 */
export const DIRECT_ANSWER_RULES = `
BLOC DE REPONSE DIRECTE (OBLIGATOIRE, JUSTE APRES LE H1):
- Le tout premier element apres le <h1> est : <p class="reponse-directe">...</p>
- Longueur imperative : 40 a 60 mots. Compte-les avant de repondre.
- Il repond COMPLETEMENT a la requete cible : un lecteur qui ne lit que ce paragraphe a sa reponse.
- AUTOSUFFISANT : aucun renvoi a la suite de la page. Interdits : "voir ci-dessous", "dans cet
  article", "nous verrons", "decouvrez plus bas", "comme explique plus loin", "ci-apres".
- Aucun pronom sans antecedent : le sujet est nomme. Le mot-cle focus et la ville y figurent, ecrits
  en francais correct (accents, articles, majuscules) : ce sont ses mots qui comptent, pas sa forme brute.
- Phrases affirmatives et factuelles. Pas de question, pas d'accroche marketing, pas de CTA,
  pas de "Vous cherchez ... ?", pas de liste a puces, pas de lien.
- Ce paragraphe est repris MOT POUR MOT dans le champ JSON "directAnswer".
`.trim()

/**
 * How the page must READ, as opposed to what it must contain.
 *
 * Every other block of the prompt speaks about search engines — keyword,
 * headings, entities, schema — and a model that obeys them literally writes to
 * Google in front of the visitor. A published page did exactly that: it quoted
 * the site's own Search Console queries as "signaux", pasted them unaccented
 * ("la creation site internet", "l'automatisation ia"), called itself "cette
 * page pilier", opened five sections with "Réponse courte :" and listed streets
 * to look local. A reader leaves; Google's spam policies (keyword stuffing,
 * scaled content) and answer engines read the same tells as mass production.
 *
 * This block is the counterweight. It outranks the SEO instructions when they
 * conflict, and the audit (READER_FIRST rules, lib/pipeline/seo-audit.ts)
 * refuses the tells it can measure.
 */
export const READER_FIRST_RULES = `
ECRITURE — POUR LE LECTEUR, PAS POUR GOOGLE (prime sur les consignes SEO en cas de conflit):
- Tu ecris pour la personne qui lit : un client potentiel avec un besoin concret. Chaque phrase
  doit lui servir. Le referencement structure la page ; il ne se voit jamais dans le texte.
- La page ne parle jamais d'elle-meme ni de sa strategie : pas de "cette page", "page pilier",
  "pages filles", "cluster", "maillage", "ancres", "contenu optimise", ni de son intention de
  recherche. Si le SUJET de la page est le referencement, ce vocabulaire sert a conseiller le
  lecteur sur SON site, jamais a decrire celui-ci.
- Les donnees internes sont invisibles : requetes Search Console, positions, impressions,
  mots-cles et statistiques du site servent a comprendre ce que cherchent les visiteurs. Ne les
  cite jamais, ne les enumere jamais, ne dis jamais d'ou elles viennent.
- Un mot-cle est un sujet, pas une chaine a recopier. Ecris-le en francais correct, avec accents,
  articles et majuscules — "création de site internet", "référencement", "SEO", "IA", "PME" —
  et seulement la ou une personne le dirait. Jamais une suite de mots-cles separes par des virgules.
- Lieux : un quartier, une rue, une commune ou un repere n'apparait que si tu as quelque chose de
  precis a en dire (un trajet, une contrainte, une habitude locale). Jamais d'enumeration de lieux
  pour paraitre local, jamais "pres de moi", jamais un code postal plaque dans une phrase.
- Aucune formule mecanique : pas d'etiquette en tete de paragraphe ("Réponse courte :",
  "En bref :", "À retenir :"), pas de phrase qui annonce la suite, pas de conclusion qui resume.
- Tournures interdites : "il ne s'agit pas de X, mais de Y", "dans un monde ou", "a l'ere du
  numerique", "en somme", "n'hesitez pas a", "veritable levier", "incontournable", "que vous soyez
  X ou Y", "plus que jamais", "un enjeu majeur", et les series systematiques de trois elements.
- Concret avant general : chaque section apporte un element utilisable — une situation type, une
  etape, un critere de choix, une erreur a eviter. Une phrase qui irait telle quelle sur le site
  d'un concurrent d'une autre ville est a reecrire ou a supprimer.
- Voix : vouvoiement, phrases de longueurs variees, verbes actifs. L'entreprise dit "nous" quand
  elle decrit sa facon de travailler, sans se vanter et sans rien inventer.
- Un titre en question est une vraie question ("Comment choisir… ?", "Faut-il… ?"). Jamais un "?"
  ajoute a un groupe nominal : "Stratégie de référencement pour PME ?" est interdit.
- Un lien externe se place dans la phrase qu'il appuie, sur les mots qui le justifient. Pas de
  section "Sources utiles" ni de liste de liens generiques ajoutee pour la forme.
`.trim()

/**
 * E-E-A-T signals. The author is the business as an Organization: inventing a
 * named human expert with a diploma and twenty years of practice would violate
 * FACTUAL_INTEGRITY_RULES on the very first line of the byline.
 */
export function buildAuthorityRules(businessName: string, isoDate: string): string {
  return `
E-E-A-T / PATERNITE ET FRAICHEUR (OBLIGATOIRE):
- Auteur = "${businessName}", entite de type Organization. N'INVENTE JAMAIS de nom de personne,
  de titre, de diplome, d'annee d'obtention, ni de nombre d'annees d'experience.
- Bloc auteur visible, place a la fin de l'article, avant le CTA final, recopie tel quel :
  <p class="page-auteur">Publié par ${businessName} — mis à jour le
  <time datetime="${isoDate}">${frenchLongDate(isoDate)}</time></p>
- datePublished = "${isoDate}" et dateModified = "${isoDate}" (format ISO 8601 AAAA-MM-JJ).
- "schemaArticle" : JSON-LD Article valide contenant headline, description, author
  {"@type":"Organization","name":"${businessName}"}, publisher identique, datePublished,
  dateModified, inLanguage "fr-FR", mainEntityOfPage.
- Chaque affirmation engageante (obligation legale, norme, delai reglementaire) est soit
  attribuee a une source officielle reellement existante et liee, soit reformulee en conseil
  general non chiffre. Jamais d'affirmation reglementaire precise sans source.
`.trim()
}

// ─── Shared output handling ────────────────────────────────────────────────

export type AiOutputErrorKind = 'empty' | 'truncated' | 'malformed' | 'not_object' | 'missing_field'

/**
 * A model response that cannot be turned into a page.
 *
 * Typed rather than a bare `Error` so the caller can tell "retry now" (a
 * malformed answer) from "the request itself is too big" (truncation) without
 * matching on message text.
 */
export class AiOutputError extends Error {
  readonly kind: AiOutputErrorKind
  readonly context: string
  readonly rawPreview: string

  constructor(kind: AiOutputErrorKind, context: string, message: string, raw = '') {
    super(message)
    this.name = 'AiOutputError'
    this.kind = kind
    this.context = context
    this.rawPreview = raw.slice(0, 280)
  }
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
}

/**
 * Narrow the payload to the outermost JSON object when the model wrapped it in
 * prose. Truncated answers keep their unbalanced tail so `looksTruncated` can
 * still recognise them.
 */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) return text
  const end = text.lastIndexOf('}')
  return end > start ? text.slice(start, end + 1) : text.slice(start)
}

/** True when the JSON ends inside a string or with unclosed brackets. */
export function looksTruncated(text: string): boolean {
  let depth = 0
  let inString = false
  let escaped = false

  for (const char of text) {
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      if (inString) escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth--
  }

  return inString || depth > 0
}

/**
 * Parse a model answer into a JSON object, naming the failure.
 *
 * Tolerates markdown fences and surrounding prose because models produce both;
 * refuses to tolerate an empty or truncated payload, because both used to travel
 * downstream as a page with empty fields.
 */
export function parseAiJsonObject<T = Record<string, unknown>>(raw: string, context: string): T {
  const text = stripCodeFences(raw ?? '')

  if (!text || text === '{}') {
    throw new AiOutputError(
      'empty',
      context,
      `Reponse IA vide pour ${context} : le modele n'a renvoye aucun contenu exploitable.`,
      text
    )
  }

  const candidate = extractJsonObject(text)

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    if (looksTruncated(candidate)) {
      throw new AiOutputError(
        'truncated',
        context,
        `Reponse IA tronquee pour ${context} : le JSON s'arrete avant sa fin. ` +
          `Augmenter maxTokens ou reduire la longueur cible.`,
        candidate
      )
    }
    throw new AiOutputError(
      'malformed',
      context,
      `Reponse IA invalide pour ${context} (JSON malforme). Reessayez.`,
      candidate
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AiOutputError(
      'not_object',
      context,
      `Reponse IA invalide pour ${context} : objet JSON attendu, ${Array.isArray(parsed) ? 'tableau' : typeof parsed} recu.`,
      candidate
    )
  }

  const value: unknown = parsed
  return value as T
}

/**
 * Output budget for a page of `targetWords` words.
 *
 * Two costs, and separating them matters:
 *
 *  - PER WORD (~3.2 tokens): French prose runs about 1.6 tokens per word, and
 *    HTML tags plus JSON string escaping roughly double it.
 *
 *  - FIXED (~3 500 tokens): the four JSON-LD blocks — LocalBusiness, FAQPage
 *    repeating every question and answer, BreadcrumbList, Article — plus the FAQ
 *    array itself, the meta/OG/Twitter fields, the direct answer, the internal
 *    and external link lists and the image alts. A measured page carried ~4 200
 *    characters of schema alone. None of it shrinks when the article does.
 *
 * That fixed part was budgeted at 1 500, which held only because the per-word
 * term was large enough to hide it. The moment brief-driven lengths lowered the
 * target from 2 000 to 1 100 words, the whole budget fell to 5 020 tokens and the
 * response was truncated mid-JSON — a page ordered SHORTER failed for lack of
 * room, which is the wrong shape of failure.
 *
 * The 6 000 floor covers the fixed cost plus a short page. The 16k ceiling keeps
 * non-streaming requests under the SDK HTTP timeout: past it the truncation would
 * come from the transport rather than the model, which is far harder to read.
 */
export function estimateMaxOutputTokens(targetWords: number): number {
  const estimated = Math.round(targetWords * 3.5) + 3500
  return Math.min(16000, Math.max(6000, estimated))
}

/** Word count of rendered text, tags and entities excluded. */
export function countHtmlWords(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean).length
}

/** Word count of plain text. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** First non-blank string of the list, or '' — `??` keeps `''`, which is the bug. */
export function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return ''
}

export function todayIso(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

const FRENCH_LONG_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})

/**
 * `2026-10-21` → `21 octobre 2026`, the date a visitor reads.
 *
 * The ISO form stays in `datetime`, where machines read it; printed as the
 * visible text, it read like a log line under every article. UTC on both sides,
 * so the day never shifts with the server's zone. The first of the month is
 * « 1er », which Intl does not write. Unparseable input comes back unchanged
 * rather than as "Invalid Date".
 */
export function frenchLongDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  return FRENCH_LONG_DATE.formatToParts(date)
    .map((part) => (part.type === 'day' && part.value === '1' ? '1er' : part.value))
    .join('')
}

// ─── Local SEO page ────────────────────────────────────────────────────────

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

  const isoDate = todayIso()

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
    maxTokens: estimateMaxOutputTokens(targetLength),
    temperature: 0.65,
  })

  const parsed = parseAiJsonObject<Partial<GeneratedPage>>(raw, `page locale ${businessType} ${city}`)
  const anomalies: PageAnomaly[] = []

  const htmlContent = firstNonEmpty(parsed.htmlContent)
  if (!htmlContent) {
    throw new AiOutputError(
      'missing_field',
      `page locale ${businessType} ${city}`,
      "Reponse IA inexploitable : le champ htmlContent est absent ou vide (aucun contenu d'article)."
    )
  }

  const title = firstNonEmpty(parsed.title)
  if (!title) {
    anomalies.push({ field: 'title', severity: 'blocking', reason: 'Titre absent, repli generique applique.' })
  }
  const metaDescription = firstNonEmpty(parsed.metaDescription)
  if (!metaDescription) {
    anomalies.push({
      field: 'metaDescription',
      severity: 'blocking',
      reason: 'Meta description absente, repli generique applique.',
    })
  }
  const directAnswer = firstNonEmpty(parsed.directAnswer)
  const directAnswerWords = countWords(directAnswer)
  if (!directAnswer) {
    anomalies.push({ field: 'directAnswer', severity: 'blocking', reason: 'Bloc de reponse directe absent.' })
  } else if (directAnswerWords < 35 || directAnswerWords > 70) {
    anomalies.push({
      field: 'directAnswer',
      severity: 'warning',
      reason: `Reponse directe de ${directAnswerWords} mots, hors cible 40-60.`,
    })
  }

  const wordCount = countHtmlWords(htmlContent)

  return {
    title: title || `${businessType} ${city} | ${businessName}`,
    metaDescription: metaDescription || `${businessType} ${city} avec ${businessName}.`,
    // Through the factory, never verbatim. `parsed.slug` used to be taken as
    // written whenever it was non-empty, so /api/optimize was a way round every
    // rule the other paths obey — the seven-word cap, the 75-character cap, the
    // town at the end, the page_type tokens stripped out. A rule one caller can
    // skip is not a rule, it is a habit.
    slug: buildPageSlug({
      proposed: firstNonEmpty(parsed.slug),
      focusKeyword: firstNonEmpty(parsed.focusKeyword),
      title: firstNonEmpty(parsed.title),
      city,
      businessType,
    }),
    focusKeyword: firstNonEmpty(parsed.focusKeyword) || `${businessType} ${city}`,
    secondaryKeywords: parsed.secondaryKeywords ?? [],
    ogTitle: firstNonEmpty(parsed.ogTitle, parsed.title) || `${businessType} ${city}`,
    ogDescription: firstNonEmpty(parsed.ogDescription, parsed.metaDescription),
    twitterTitle: firstNonEmpty(parsed.twitterTitle, parsed.ogTitle, parsed.title),
    twitterDescription: firstNonEmpty(parsed.twitterDescription, parsed.ogDescription, parsed.metaDescription),
    htmlContent,
    schemaLocalBusiness: firstNonEmpty(parsed.schemaLocalBusiness) || '{}',
    schemaFaqPage: firstNonEmpty(parsed.schemaFaqPage) || '{}',
    schemaBreadcrumb: firstNonEmpty(parsed.schemaBreadcrumb) || '{}',
    schemaArticle: firstNonEmpty(parsed.schemaArticle) || '{}',
    internalLinks: parsed.internalLinks ?? [],
    internalLinksHtml: parsed.internalLinksHtml ?? [],
    faqItems: parsed.faqItems ?? [],
    imageAlts: parsed.imageAlts ?? [],
    ctaText: firstNonEmpty(parsed.ctaText) || ctaText,
    targetLength,
    // Measured, not self-reported: models are unreliable narrators of their own
    // word count and the publication gate reads this field.
    estimatedWordCount: wordCount,
    readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 200)),
    directAnswer: directAnswer || undefined,
    author: businessName,
    datePublished: firstNonEmpty(parsed.datePublished) || isoDate,
    dateModified: firstNonEmpty(parsed.dateModified) || isoDate,
    anomalies,
  }
}

const SYSTEM_PROMPT = `
Tu es un expert SEO local francophone de niveau Google Certified Partner, specialise en local pack, E-E-A-T, et schema.org.
Tu connais parfaitement RankMath SEO Pro et toutes ses exigences pour le score 100/100.
Tu rediges uniquement du contenu unique, naturel, et a haute valeur ajoutee qui ne ressemble jamais a du contenu genere.
Reponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans commentaire.
Chaque valeur de chaine doit etre une chaine JSON valide.

${FACTUAL_INTEGRITY_RULES}
`.trim()

function buildPrompt(opts: Omit<GeneratePageOptions, 'model'>): string {
  const { city, department, businessType, businessName, keywords, siteUrl, targetLength, includeEntities, ctaText } = opts
  const mainKeyword = `${businessType} ${city}`
  const year = new Date().getFullYear()
  const isoDate = todayIso()
  const words = targetLength ?? 700

  return `
Genere une page SEO locale complete et optimisee RankMath SEO Pro 100/100 pour :

- Type d'activite : ${businessType}
- Business : ${businessName}
- Ville cible : ${city} (${department})
- Site web : ${siteUrl}
- Mots-cles : ${keywords.join(', ')}
- Mot-cle focus : "${mainKeyword}"
- Longueur cible du contenu : ~${words} mots
- Annee : ${year}
- CTA principal : "${ctaText}"
- Inclure les entites metier detaillees : ${includeEntities ? 'oui' : 'non'}

${DIRECT_ANSWER_RULES}

${buildAuthorityRules(businessName, isoDate)}

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
  "directAnswer": "40 a 60 mots, copie exacte du <p class='reponse-directe'>",
  "htmlContent": "HTML complet avec H1, reponse directe, contenu, FAQ, bloc auteur et CTA",
  "schemaLocalBusiness": "JSON-LD string",
  "schemaFaqPage": "JSON-LD string",
  "schemaBreadcrumb": "JSON-LD string",
  "schemaArticle": "JSON-LD string (author, publisher, datePublished, dateModified)",
  "internalLinks": [{"anchor": "string", "suggestion": "string"}],
  "internalLinksHtml": ["<a href='/url'>ancre</a>"],
  "faqItems": [{"q": "string", "a": "string"}],
  "imageAlts": ["string"],
  "ctaText": "${ctaText}",
  "datePublished": "${isoDate}",
  "dateModified": "${isoDate}",
  "targetLength": ${words},
  "estimatedWordCount": number,
  "readingTimeMinutes": number
}

Contraintes critiques :
1. Le mot-cle focus "${mainKeyword}" apparait dans title, metaDescription, H1, reponse directe, au moins un H2 et le slug.
2. Minimum 3 sous-titres H2/H3.
3. Minimum 3 questions FAQ coherentes avec faqItems et schemaFaqPage.
4. Le CTA final utilise "${ctaText}".
5. Le fil d'Ariane est coherent avec la page cible.
6. Fournir 3 suggestions d'alt d'image.
7. ${includeEntities ? 'Inclure adresse, horaires, zones desservies et entites metier concretes UNIQUEMENT si elles sont fournies ci-dessus ; sinon rester generique.' : 'Les entites metier peuvent rester legeres si inconnues.'}

RAPPEL FINAL — LONGUEUR : le texte reel de htmlContent (hors balises) doit atteindre AU MOINS
${words} mots. En dessous de ${Math.round(words * 0.85)} mots, la page est rejetee. Developpe les
sections trop courtes avec du contenu utile ; ne rallonge jamais par de la repetition ou du remplissage.
`.trim()
}

// The private `slugify` that used to live here is gone.
//
// It was the second slug factory in the repository, and a second factory is a
// second policy: this one knew nothing of the word cap, the character cap, the
// town at the end or the `page_type` tokens that must never reach a URL. As
// long as it existed, any rule added to lib/seo/slug.ts was one caller away
// from being optional. One address, one factory.
