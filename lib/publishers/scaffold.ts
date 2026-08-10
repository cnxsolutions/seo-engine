// ─────────────────────────────────────────────────────────────────────────────
// Deterministic page scaffold
// SEO Engine - Build a page.tsx that fits the site, without asking a model.
// ─────────────────────────────────────────────────────────────────────────────
//
// Publishing used to end in one of two places, both bad. Either an LLM wrote the
// whole page.tsx from a truncated example — which produced, twice in a row, a
// file that did not compile in the client's repository — or a bare `<article>`
// with no navigation, no footer, no theme, looking nothing like the site.
//
// This module is the third option, and it guesses nothing. Everything it emits
// is COPIED from a page that already exists in the repository:
//
//   - import lines, verbatim, never reconstructed from a component name;
//   - only components the real page mounts with NO props, because that is the
//     only way to know a component is safe to mount without reading its
//     signature — and a signature read is a signature guessed;
//   - CSS classes, verbatim, never invented. A class this module has not seen in
//     the repository does not appear in its output. That rules out the failure
//     where Tailwind utilities are emitted into a Bootstrap site.
//
// The rule is deliberately site-agnostic: nothing here knows about any
// particular repository. Give it a Next.js page and it finds that page's chrome.

/** Chrome extracted from an existing page — the parts every page shares. */
export interface PageChrome {
  /** Import lines copied verbatim, in source order. */
  imports: string[]
  /** Zero-prop components mounted before the page content, in source order. */
  before: string[]
  /** Zero-prop components mounted after it, in source order. */
  after: string[]
  /** The `<main>` class of the sample page, or null when it has none. */
  wrapperClass: string | null
  /** A layout class carrying the word "container", reused verbatim. */
  containerClass: string | null
  /**
   * Every default-imported component the sample pages mount, in source order.
   *
   * The scaffold only uses `before`/`after`, but the contract adapter needs the
   * full picture: a hero and a content block carry props, so they are excluded
   * from the chrome, yet they are precisely the components that make a published
   * page look like the site. Listing them here is what lets the adapter
   * generator work on a site whose components are not named like this one's.
   */
  layout: LayoutComponent[]
  /** How many pages the layout was read from. Denominator of `presentIn`. */
  sampleCount: number
}

export interface LayoutComponent {
  name: string
  /** The import line, verbatim. Never rebuilt from the name. */
  importLine: string
  /** Mounted with no props on every sample — safe to mount blind. */
  shared: boolean
  /** Present in every sample, whatever its props. */
  ubiquitous: boolean
  /** How many samples mount it, out of `sampleCount`. */
  presentIn: number
}

/**
 * Does this component belong to the site, or to one page?
 *
 * A strict majority, measured rather than assumed. On the connected site the
 * numbers separate cleanly: the navigation, hero, content block, FAQ and CTA all
 * appear on three pages out of four, while `ChauffeurPriveTouristiqueExtraContent`
 * appears on one. Requiring ALL four would have excluded every content component
 * — the first attempt did exactly that and produced an adapter with nothing but
 * a header and a footer.
 *
 * Applies only to components mounted WITH props, which the adapter fills from
 * read signatures. Bare mounts keep the stricter all-samples rule, because there
 * the engine has no signature to check itself against.
 */
export function isRecurring(component: LayoutComponent, sampleCount: number): boolean {
  return component.presentIn * 2 > sampleCount
}

/**
 * Stamped at the top of every file the engine writes.
 *
 * Load-bearing, not decorative: it is how the publisher tells a page it may
 * overwrite from a page a human wrote. Without it, a generated slug colliding
 * with an existing route silently replaced hand-written work.
 */
export const GENERATED_MARKER = '// Genere par SEO Engine — ne pas modifier a la main.'

/** No usable shell. Exported so callers stop hand-rolling this literal. */
export const EMPTY_CHROME: PageChrome = {
  imports: [],
  before: [],
  after: [],
  wrapperClass: null,
  containerClass: null,
  layout: [],
  sampleCount: 0,
}

/** `import Something from '…'` — default imports only. */
const DEFAULT_IMPORT = /^import\s+([A-Z][A-Za-z0-9_]*)\s+from\s+['"][^'"]+['"]\s*;?\s*$/

/** Any component opening tag, whether it carries props or not. */
const COMPONENT_TAG = /<([A-Z][A-Za-z0-9_]*)(\s[^>]*?)?(\/?)>/g

/** One page's worth of raw observation, before pages are compared. */
interface PageObservation {
  importLine: Map<string, string>
  propless: Set<string>
  carriesProps: Set<string>
  order: string[]
  /** Character offset of each component's first occurrence in the source. */
  offset: Map<string, number>
  /** Offset of the last mount in the file, shared or not. */
  lastMount: number
  wrapperClass: string | null
  containerClass: string | null
}

/**
 * Two samples is the minimum that can tell a shell from a page.
 *
 * With one page there is no way to know whether a propless component is the
 * site's footer or that page's own content block. The first version of this
 * module tried anyway and mounted
 * `ChauffeurPriveTouristiqueExtraContent` — a component about one specific
 * page — onto every page the engine would ever publish. Below this threshold
 * the honest answer is to emit nothing.
 */
const MIN_SAMPLES = 2

/**
 * Read the chrome shared by several existing pages.
 *
 * A component qualifies only if it clears two bars at once:
 *
 *  1. It is mounted `<Name />`, self-closing and propless, in EVERY sample. A
 *     single occurrence carrying a prop disqualifies it everywhere — a
 *     component that needs a prop somewhere probably needs it here too, and a
 *     missing required prop is a build failure in someone else's CI.
 *  2. It is present in EVERY sample. This is what separates the shell from the
 *     content, and it is the only reliable separator: page-specific blocks are
 *     propless too, so rule 1 alone lets them through. Appearing on every page
 *     examined is what "shared" means.
 *
 * Conservative by design. Missing a genuine chrome component costs a slightly
 * plainer page; mounting a page-specific one costs a page about taxis to the
 * airport that opens with a block about wine tours.
 */
export function extractChrome(samplePages: Array<string | null | undefined>): PageChrome {
  const observations = samplePages.filter((s): s is string => Boolean(s)).map(observe)
  if (observations.length < MIN_SAMPLES) return EMPTY_CHROME

  const [first] = observations

  const shared = first.order.filter((name) =>
    observations.every((o) => o.propless.has(name) && !o.carriesProps.has(name))
  )

  // ─── Where the page body goes ──────────────────────────────────────────────
  //
  // Split on the LAST non-shared component, not the first. The first attempt
  // flipped on the first one and put the navbar below the article, because this
  // site opens with `<JsonLd …>` — a prop-carrying, non-shared component that
  // sits ABOVE the navigation. The last content block, by contrast, is by
  // definition the bottom of the body: whatever chrome follows it is the footer.
  //
  // Positions come from the first sample's source, not from a list of component
  // names, so the rule holds on a site laid out differently.
  const contentEnd = lastContentOffset(first, shared)
  const before: string[] = []
  const after: string[] = []
  for (const name of shared) {
    const at = first.offset.get(name) ?? 0
    ;(at > contentEnd ? after : before).push(name)
  }

  const used = [...before, ...after]
  return {
    imports: used.map((name) => first.importLine.get(name)!),
    before,
    after,
    wrapperClass: mostCommon(observations.map((o) => o.wrapperClass)),
    containerClass: mostCommon(observations.map((o) => o.containerClass)),
    layout: first.order.map((name) => ({
      name,
      importLine: first.importLine.get(name)!,
      shared: shared.includes(name),
      // Present everywhere, props or not. A hero on every page is part of the
      // site's language even though it cannot be mounted blind.
      ubiquitous: observations.every((o) => o.order.includes(name)),
      presentIn: observations.filter((o) => o.order.includes(name)).length,
    })),
    sampleCount: observations.length,
  }
}

function observe(samplePage: string): PageObservation {
  const importLine = new Map<string, string>()
  for (const line of samplePage.split(/\r?\n/)) {
    const match = line.trim().match(DEFAULT_IMPORT)
    if (match) importLine.set(match[1], line.trim())
  }

  const propless = new Set<string>()
  const carriesProps = new Set<string>()
  const order: string[] = []
  const offset = new Map<string, number>()
  let lastMount = 0

  for (const match of samplePage.matchAll(COMPONENT_TAG)) {
    const [, name, attrs, selfClosing] = match
    if (!importLine.has(name)) continue

    const bare = selfClosing === '/' && (attrs ?? '').trim() === ''
    if (bare) propless.add(name)
    else carriesProps.add(name)

    if (!order.includes(name)) order.push(name)
    if (!offset.has(name)) offset.set(name, match.index)
    lastMount = match.index
  }

  return { importLine, propless, carriesProps, order, offset, lastMount, ...readClasses(samplePage) }
}

/**
 * Where the page body ends in the sample.
 *
 * The last non-shared component is the bottom of the content, so any chrome
 * below it is the footer. When a page has no content components at all, there
 * is nothing to anchor to: fall back to the midpoint of the mounted region,
 * which keeps a top bar on top and a footer at the bottom.
 */
function lastContentOffset(first: PageObservation, shared: string[]): number {
  const content = first.order
    .filter((name) => !shared.includes(name))
    .map((name) => first.offset.get(name) ?? 0)

  if (content.length > 0) return Math.max(...content)

  const mounts = shared.map((name) => first.offset.get(name) ?? 0)
  const earliest = mounts.length > 0 ? Math.min(...mounts) : 0
  return (earliest + first.lastMount) / 2
}

/**
 * The class value seen most often across the samples.
 *
 * Still a copy, never a composition: whichever value wins came verbatim out of
 * the repository. A page whose wrapper differs from the rest of the site does
 * not get to redefine the site's theme for everyone.
 */
function mostCommon(values: Array<string | null>): string | null {
  const tally = new Map<string, number>()
  for (const value of values) {
    if (value) tally.set(value, (tally.get(value) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/**
 * Layout classes, copied rather than composed.
 *
 * Only two are taken: the `<main>` wrapper, which carries the site theme, and
 * one class list containing "container", which carries its horizontal rhythm.
 * Anything else is page-specific decoration.
 */
function readClasses(samplePage: string): Pick<PageChrome, 'wrapperClass' | 'containerClass'> {
  const wrapper = samplePage.match(/<main[^>]*\sclassName="([^"]*)"/)
  const container = samplePage.match(/className="([^"]*\bcontainer\b[^"]*)"/)
  return {
    wrapperClass: wrapper?.[1] ?? null,
    containerClass: container?.[1] ?? null,
  }
}

/**
 * How much of the site's own presentation a scaffolded page carries.
 *
 * - `chrome` — the page mounts the site's navigation and footer itself.
 * - `layout` — it does not need to: `layout.tsx` already wraps every page. The
 *   published page is content only, and renders complete. Distinguished from
 *   `bare` because they produce the same file and mean opposite things.
 * - `bare`   — nothing wraps it. The page renders alone on a white background.
 */
export type ScaffoldFidelity = 'chrome' | 'layout' | 'bare'

export interface Scaffold {
  content: string
  fidelity: ScaffoldFidelity
  /** Components mounted, for the log line. */
  mounted: string[]
}

/** What `layout.tsx` already provides, so the page does not repeat it. */
export interface ScaffoldShell {
  hasMain: boolean
  components: string[]
  wraps: boolean
}

export interface ScaffoldInput {
  title: string
  metaDescription: string
  ogTitle: string
  ogDescription: string
  slug: string
  htmlContent: string
  /** Pre-serialised JSON-LD, or null to emit none. */
  schemaJson: string | null
  componentName: string
  pageUrl: string
}

/**
 * Emit a complete, compilable page.tsx.
 *
 * No network call, no model call, no randomness: the same inputs always produce
 * the same file. That is the property that makes it usable as the floor under
 * everything else — when the clever path fails, this one cannot.
 */
export function buildScaffold(input: ScaffoldInput, chrome: PageChrome, shell?: ScaffoldShell): Scaffold {
  // Never mount what the layout already mounts. Two navigation bars on one page
  // is not a smaller mistake than none.
  const provided = new Set(shell?.components ?? [])
  const before = chrome.before.filter((name) => !provided.has(name))
  const after = chrome.after.filter((name) => !provided.has(name))
  const mounted = [...before, ...after]

  const keptImports = chrome.imports.filter((line) =>
    mounted.some((name) => new RegExp(`\\bimport\\s+${name}\\b`).test(line))
  )
  const importBlock = ["import { Metadata } from 'next'", ...keptImports].join('\n')

  // The layout's `<main>` is the page's main landmark. Opening a second one
  // nests two, which is invalid HTML and announces the page twice to a screen
  // reader. A fragment carries no semantics and cannot collide.
  const wrapInMain = !shell?.hasMain
  const openMain = !wrapInMain
    ? '<>'
    : chrome.wrapperClass
      ? `<main className="${chrome.wrapperClass}">`
      : '<main>'
  const closeMain = wrapInMain ? '</main>' : '</>'

  // No container class found means the site has none to copy — on the connected
  // repository the layout lives inside the components themselves. Wrapping the
  // article in a classless `<div>` would add a node that does nothing, so the
  // article stands on its own instead.
  const article = chrome.containerClass
    ? [
        `      <div className="${chrome.containerClass}">`,
        `        <article dangerouslySetInnerHTML={{ __html: content }} />`,
        `      </div>`,
      ]
    : [`      <article dangerouslySetInnerHTML={{ __html: content }} />`]

  const body = [
    ...before.map((name) => `      <${name} />`),
    input.schemaJson
      ? `      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />`
      : null,
    ...article,
    ...after.map((name) => `      <${name} />`),
  ]
    .filter(Boolean)
    .join('\n')

  const content = `${GENERATED_MARKER}
${importBlock}

export const metadata: Metadata = {
  title: '${escapeSingleQuoted(input.title)}',
  description: '${escapeSingleQuoted(input.metaDescription)}',
  alternates: { canonical: '${input.pageUrl}' },
  openGraph: {
    title: '${escapeSingleQuoted(input.ogTitle)}',
    description: '${escapeSingleQuoted(input.ogDescription)}',
    url: '${input.pageUrl}',
  },
}

export default function ${input.componentName}() {
  return (
    ${openMain}
${body}
    ${closeMain}
  )
}

const content = \`${escapeBackticked(input.htmlContent)}\`
${input.schemaJson ? `\nconst schema = \`${escapeBackticked(input.schemaJson)}\`\n` : ''}`

  return {
    content,
    fidelity: mounted.length > 0 ? 'chrome' : shell?.wraps ? 'layout' : 'bare',
    mounted,
  }
}

function escapeSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')
}

function escapeBackticked(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}
