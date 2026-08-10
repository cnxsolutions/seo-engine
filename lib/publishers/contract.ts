// ─────────────────────────────────────────────────────────────────────────────
// Publication contract, v1
// SEO Engine - Commit data, not code.
// ─────────────────────────────────────────────────────────────────────────────
//
// Every failure this publisher has had came from the same place: the engine
// writing TSX into a repository it does not own and cannot compile. An LLM wrote
// a French sentence where a React identifier belonged; another put a full HTML
// body inside a double-quoted JSX attribute. Both were found days later, in
// someone else's CI.
//
// The contract removes the class of failure instead of catching its instances.
// The engine stops emitting presentation entirely: it commits a page whose only
// import is ONE component living in the site's own repository, and hands it a
// plain object. What the page looks like is decided by code the site owner
// wrote, compiles, and can change without touching the engine.
//
// Two properties of the emitted file are load-bearing, and both are easy to
// break by accident:
//
//   1. `const payload = { … }` carries NO type annotation. An annotated object
//      literal is "fresh" to TypeScript, so excess-property checking applies and
//      a field the engine adds later would fail the site's build — every
//      deployment, at once. Assigning to an inferred const drops that freshness:
//      an unknown extra field is ignored, while a MISSING required field is
//      still an error. Loose in the direction that is safe, strict in the
//      direction that matters.
//   2. `path` is relative. An absolute URL here would end up in the site's route
//      registry and its sitemap, doubled with the origin.

import type { GeneratedPage } from '@/lib/ai/openai'
import type { PageType } from '@/lib/types'
import { GENERATED_MARKER } from './scaffold'

/** Bumped only when the payload gains a REQUIRED field. */
export const CONTRACT_VERSION = 1

/** Where the site declares that it implements the contract. */
export const MANIFEST_PATH = 'seo-engine.json'

/** Default location of the generated route registry, when the site wants one. */
export const DEFAULT_ROUTES_FILE = 'src/lib/seo/routes.generated.ts'

/**
 * Layout families, not page types.
 *
 * Five editorial page types map onto three layouts, because `child` and
 * `local_pack` render the same way and `alternative` and `comparative` differ
 * from each other only in wording. Emitting five variants would ask the site
 * owner to write five layouts to serve three.
 */
export type ContractVariant = 'pilier' | 'local' | 'comparatif'

export const CONTRACT_VARIANTS: ContractVariant[] = ['pilier', 'local', 'comparatif']

const VARIANT_BY_PAGE_TYPE: Record<PageType, ContractVariant> = {
  pillar: 'pilier',
  child: 'local',
  local_pack: 'local',
  alternative: 'comparatif',
  comparative: 'comparatif',
}

/** The layout a page type asks for. Unknown types fall back audibly, not silently. */
export function variantForPageType(pageType: PageType | undefined): {
  variant: ContractVariant
  fellBack: boolean
} {
  const known = pageType && VARIANT_BY_PAGE_TYPE[pageType]
  return known ? { variant: known, fellBack: false } : { variant: 'local', fellBack: true }
}

/**
 * What the engine hands the site. Every field is data; none of it is markup
 * the site did not ask for.
 */
export interface ContractPayload {
  contractVersion: number
  variant: ContractVariant
  /** Relative, always. `/taxi-gare-troyes`, never `https://…/taxi-gare-troyes`. */
  path: string
  title: string
  keyword: string
  description: string
  hero: { badge?: string; subtitle?: string }
  /** The 40–60 word answer that opens the page. */
  introText: string
  /** Plain-text paragraphs, separated by blank lines. */
  mainContent: string
  /** The rest of the article, from its first H2 on, as HTML. */
  bodyHtml: string
  internalLinks: Array<{ label: string; href: string }>
  faq: Array<{ question: string; answer: string }>
  breadcrumbs: Array<{ name: string; url: string }>
  ctaText?: string
}

/**
 * Fields emitted at v1.
 *
 * The emitter walks this list rather than the object, so a field added to the
 * type tomorrow cannot reach a site that only implements v1.
 */
const V1_FIELDS: Array<keyof ContractPayload> = [
  'contractVersion', 'variant', 'path', 'title', 'keyword', 'description',
  'hero', 'introText', 'mainContent', 'bodyHtml', 'internalLinks', 'faq',
  'breadcrumbs', 'ctaText',
]

// ─── Content splitting ───────────────────────────────────────────────────────

/**
 * Split the article at its first H2.
 *
 * What comes before is the lead, and the site's own content component wants it
 * as plain text: it renders `mainContent.split('\n\n')` into paragraphs, so HTML
 * handed to it would be escaped and shown as source. What comes after keeps its
 * markup, headings included.
 *
 * The H1 falls away with the lead, which is intended — the hero renders it, and
 * two H1s on one page is a defect.
 */
export function splitArticle(htmlContent: string): { lead: string; rest: string } {
  const at = htmlContent.search(/<h2[\s>]/i)
  const head = at === -1 ? htmlContent : htmlContent.slice(0, at)
  const rest = at === -1 ? '' : htmlContent.slice(at)
  return { lead: paragraphsToText(head), rest }
}

/** `<p>…</p><p>…</p>` → two blocks of text separated by a blank line. */
function paragraphsToText(html: string): string {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1]).trim())
  return paragraphs.filter(Boolean).join('\n\n')
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/\s+/g, ' ')
}

/**
 * Are these two blocks the same prose?
 *
 * Compared on normalised text, not on identity: the direct answer is stored as
 * plain text while the lead paragraph comes back from HTML with its links
 * stripped, so punctuation and spacing drift slightly. The prefix comparison
 * catches the case where one of the two carries a trailing clause the other
 * does not.
 */
function sameText(a: string, b: string): boolean {
  const normalise = (value: string) =>
    value.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[.,;:!?'’"()-]/g, '').trim()

  const left = normalise(a)
  const right = normalise(b)
  if (!left || !right) return false
  if (left === right) return true

  const shortest = Math.min(left.length, right.length)
  return shortest >= 60 && left.slice(0, shortest) === right.slice(0, shortest)
}

/**
 * Real links, read out of the rendered anchors.
 *
 * `internalLinks[].suggestion` looks like a target but is not one — it holds
 * planning identifiers such as `page-fille-taxi-aube-troyes`, which would
 * produce 404s. `internalLinksHtml` holds the anchors that were actually
 * written, so that is what gets parsed.
 */
export function parseInternalLinks(internalLinksHtml: string[] | undefined): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = []
  const seen = new Set<string>()

  for (const html of internalLinksHtml ?? []) {
    const match = html.match(/<a[^>]*\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!match) continue
    const href = match[1]
    const label = stripTags(match[2]).trim()
    if (!label || seen.has(href)) continue
    seen.add(href)
    links.push({ label, href })
  }

  return links
}

// ─── Payload ─────────────────────────────────────────────────────────────────

export function buildContractPayload(opts: {
  page: GeneratedPage
  pageType: PageType | undefined
  siteUrl: string
}): { payload: ContractPayload; fellBack: boolean } {
  const { page, pageType, siteUrl } = opts
  const { variant, fellBack } = variantForPageType(pageType)
  const { lead, rest } = splitArticle(page.htmlContent)
  const origin = siteUrl.replace(/\/$/, '')

  // The lead paragraph and the direct answer are the SAME text.
  //
  // `directAnswer` is deliberately duplicated out of `htmlContent` upstream — it
  // is the block an answer engine can lift as a citation — so the lead's first
  // paragraph is that same sentence. Sending both produced a live page that
  // opened with one paragraph and then repeated it verbatim.
  //
  // Filtered by comparison rather than by position: the answer is not always the
  // first paragraph, and dropping index 0 blindly would delete real content.
  const leadParagraphs = lead ? lead.split('\n\n') : []
  const introText = page.directAnswer?.trim() || leadParagraphs[0] || ''
  const mainContent = leadParagraphs.filter((paragraph) => !sameText(paragraph, introText)).join('\n\n')

  const payload: ContractPayload = {
    contractVersion: CONTRACT_VERSION,
    variant,
    path: `/${page.slug}`,
    title: page.title,
    keyword: page.focusKeyword,
    description: page.metaDescription,
    hero: { subtitle: page.ogDescription || page.metaDescription },
    introText,
    mainContent,
    bodyHtml: rest,
    internalLinks: parseInternalLinks(page.internalLinksHtml),
    faq: (page.faqItems ?? []).map((item) => ({ question: item.q, answer: item.a })),
    breadcrumbs: [{ name: page.title, url: `${origin}/${page.slug}` }],
    ctaText: page.ctaText || undefined,
  }

  return { payload, fellBack }
}

// ─── Emission ────────────────────────────────────────────────────────────────

/**
 * Emit the page.tsx the engine commits under the contract.
 *
 * The whole file is one import, one object and one element. There is no JSX to
 * get wrong, no CSS class, and no component name the engine had to invent.
 */
export function emitContractPage(opts: {
  payload: ContractPayload
  componentName: string
  adapterImport: string
}): string {
  const { payload, componentName, adapterImport } = opts

  const trimmed: Record<string, unknown> = {}
  for (const field of V1_FIELDS) {
    const value = payload[field]
    if (value !== undefined) trimmed[field] = value
  }

  // `variant` needs `as const`, and only `variant`.
  //
  // Dropping the type annotation is what stops a field added engine-side from
  // breaking the site's build — but it also widens every string literal to
  // `string`, and `string` is not assignable to the union the adapter declares.
  // Annotating the whole object would bring excess-property checking back;
  // `as const` on the whole object would make the arrays readonly and fail
  // against the mutable `Array<…>` in the interface. Narrowing this one field
  // is the only version that satisfies both ends. The compilation test in
  // contract.test.ts is what found this.
  const literal = JSON.stringify(trimmed, null, 2).replace(
    `"variant": ${JSON.stringify(payload.variant)}`,
    `"variant": ${JSON.stringify(payload.variant)} as const`
  )

  // `metadata` has to be exported from the page file — Next.js reads it there,
  // not from a component. Rather than emit a metadata literal, the engine calls
  // a helper that ships with the adapter, so canonical URLs, OG images and
  // locale stay under the site's control alongside everything else.
  return `${GENERATED_MARKER}
import SeoEnginePage, { seoEngineMetadata } from '${adapterImport}'

// Une republication ecrase ce fichier. Le rendu est decide par SeoEnginePage,
// qui vit dans ce depot.
//
// Volontairement sans annotation de type : un litteral annote serait soumis au
// controle des proprietes excedentaires, et un champ ajoute cote moteur
// bloquerait tous les deploiements de ce site d'un coup.
const payload = ${literal}

export const metadata = seoEngineMetadata(payload)

export default function ${componentName}() {
  return <SeoEnginePage payload={payload} />
}
`
}
