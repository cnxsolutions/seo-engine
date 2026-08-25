// ─────────────────────────────────────────────────────────────────────────────
// Component prop signatures, read from the site's own source
// SEO Engine - Mount a component only when its props can actually be filled.
// ─────────────────────────────────────────────────────────────────────────────
//
// The first version of the contract adapter carried a hard-coded list of
// component names taken from one site — `PremiumHero`, `PageContent`,
// `PremiumFAQ`. It produced an excellent adapter for that site and an empty one
// for every other. A second site whose components are called `Header` and `Hero`
// would have got a manifest, a build step, and nothing to show for it.
//
// This module removes the list. It reads what a component really accepts, and
// the generator mounts it only when every REQUIRED prop maps to something the
// payload carries. A component that needs a value the engine does not have —
// `distance`, `population` — is left out rather than fed an empty string.

/** One prop, as the site declares it. */
export interface PropSignature {
  name: string
  /** Optional in the interface, OR given a default in the destructuring. */
  optional: boolean
  /** The declared type, verbatim. Used to tell a list from a string. */
  type: string
}

/**
 * Read the props of a component from its source file.
 *
 * Handles the two shapes a Next.js component uses in practice —
 * `interface XProps { … }` and `type XProps = { … }` — and treats a prop with a
 * default value in the destructuring as optional even when the interface marks
 * it required, because that is what the compiler does.
 *
 * Returns an empty list when nothing can be read. The caller reads that as "no
 * required props", which is correct for `const X = () => …` and safely
 * conservative otherwise: a component with unreadable props is only ever mounted
 * bare, exactly as the sample page mounts it.
 */
export function parseComponentProps(source: string | null, componentName: string): PropSignature[] {
  if (!source) return []

  const block = findPropsBlock(source, componentName)
  if (!block) return []

  const withDefaults = findDestructuredDefaults(source)
  const props: PropSignature[] = []

  // Depth tracked line by line: only the top level is a prop.
  //
  // `externalLink?: { label: string; href: string }` spans three lines, and
  // reading them flat promoted `label` and `href` to required props of the
  // component. That both blocks a legitimate mount and risks binding `href` to
  // the page path — a value that belongs to something else entirely.
  let depth = 0

  for (const line of block.split('\n')) {
    const clean = line.trim()
    const opens = (clean.match(/\{/g) ?? []).length
    const closes = (clean.match(/\}/g) ?? []).length

    const atTopLevel = depth === 0
    depth += opens - closes

    if (!atTopLevel) continue
    if (!clean || clean.startsWith('//') || clean.startsWith('*') || clean.startsWith('/*')) continue

    const match = clean.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+?)[;,]?$/)
    if (!match) continue

    const [, name, question, type] = match
    props.push({
      name,
      optional: Boolean(question) || withDefaults.has(name),
      type: type.trim(),
    })
  }

  return props
}

/** The body of `interface XProps { … }` or `type XProps = { … }`, braces matched. */
function findPropsBlock(source: string, componentName: string): string | null {
  const pattern = new RegExp(
    `(?:interface|type)\\s+${componentName}Props\\s*=?\\s*\\{`,
    ''
  )
  const match = source.match(pattern)
  if (!match || match.index === undefined) return null

  // Brace counting, not a lazy `[^}]*`: a prop typed
  // `externalLink?: { label: string; href: string }` closes a brace of its own,
  // and stopping there would drop every prop declared after it.
  const start = match.index + match[0].length
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i)
    }
  }
  return null
}

/**
 * Props given a default value where the component destructures them.
 *
 * `const Hero = ({ title = <>…</>, subtitle = '…' }: HeroProps)` makes both
 * optional at the call site whatever the interface says. Missing this would
 * leave a mountable component unmounted.
 */
function findDestructuredDefaults(source: string): Set<string> {
  const defaults = new Set<string>()
  const destructuring = source.match(/\(\s*\{([\s\S]*?)\}\s*:\s*[A-Za-z_$][\w$]*Props/)
  if (!destructuring) return defaults

  for (const part of destructuring[1].split(/,(?![^{[(]*[}\])])/)) {
    const named = part.trim().match(/^([A-Za-z_$][\w$]*)\s*=/)
    if (named) defaults.add(named[1])
  }
  return defaults
}

// ─── Binding props to the payload ────────────────────────────────────────────

/**
 * How a prop name maps onto the contract payload.
 *
 * Matched on NAME, then checked against the declared TYPE. Names are matched
 * loosely because conventions differ between sites — `introText`, `intro` and
 * `lead` all mean the same thing — while the type check is what stops a
 * plausible name from binding to the wrong shape. `items: TOCItem[]` on a table
 * of contents and `items: {question, answer}[]` on a FAQ have the same name and
 * must not receive the same value.
 */
interface Binding {
  matches: RegExp
  expression: string
  /** `list` binds only to an array type, `text` only to a non-array one. */
  shape: 'list' | 'text' | 'any'
  /**
   * May the same value legitimately appear on several components?
   *
   * True for lists — a FAQ belongs both in the visible accordion and in the
   * JSON-LD — and for identifiers like the focus keyword. False for display
   * text: the first derived adapter passed the page title to the hero AND to
   * the FAQ heading, and the subtitle twice over, so the rendered page repeated
   * the same sentence in three places.
   */
  reusable?: boolean
  /** Extra evidence required in the declared type, when the name is ambiguous. */
  typeHint?: RegExp
}

const BINDINGS: Binding[] = [
  { matches: /^(title|heading|pageTitle)$/i, expression: 'payload.title', shape: 'text' },
  { matches: /^(subtitle|subheading|baseline)$/i, expression: 'payload.hero.subtitle', shape: 'text' },
  { matches: /^(badge|badgeText|eyebrow|tag)$/i, expression: 'payload.hero.badge', shape: 'text' },
  { matches: /^(description|metaDescription|excerpt|summary)$/i, expression: 'payload.description', shape: 'text' },
  { matches: /^(keyword|focusKeyword|query)$/i, expression: 'payload.keyword', shape: 'text', reusable: true },
  { matches: /^(introText|intro|lead|chapo)$/i, expression: 'payload.introText', shape: 'text' },
  { matches: /^(mainContent|content|body|text|corps)$/i, expression: 'payload.mainContent', shape: 'text' },
  { matches: /^(conclusionText|conclusion|cta|ctaText|callToAction)$/i, expression: 'payload.ctaText', shape: 'text' },
  { matches: /^(path|slug|href|url|canonical)$/i, expression: 'payload.path', shape: 'text', reusable: true },
  { reusable: true, matches: /^(internalLinks|links|relatedLinks)$/i, expression: 'payload.internalLinks', shape: 'list' },
  { reusable: true, matches: /^(breadcrumbs|crumbs|ariane)$/i, expression: 'payload.breadcrumbs', shape: 'list' },
  {
    matches: /^(faq|faqs|faqItems|customFaqs|items|questions)$/i,
    expression: 'payload.faq',
    shape: 'list',
    reusable: true,
    // `items` alone is meaningless — a table of contents declares it too. The
    // type has to actually mention a question for this to be a FAQ.
    typeHint: /question|faq/i,
  },
]

export interface BoundProp {
  name: string
  expression: string
}

export interface MountDecision {
  /** Props to pass, in declaration order. */
  bound: BoundProp[]
  /** True when every required prop could be filled. */
  mountable: boolean
  /** Required props with nothing to fill them, for the report. */
  unfilled: string[]
}

/**
 * Decide whether a component can be mounted, and with what.
 *
 * Strict on requirement, generous on option: an optional prop we can fill is
 * filled, and a required prop we cannot fill blocks the mount entirely. Passing
 * `''` to satisfy a required string would compile and then render an empty
 * heading on a live page — worse than not mounting it, because it looks like it
 * worked.
 *
 * `alreadyUsed` carries the display values placed by earlier components on the
 * same page, so the same sentence is not shown twice. Pass the same Set across
 * a whole adapter.
 */
export function bindProps(props: PropSignature[], alreadyUsed?: Set<string>): MountDecision {
  const bound: BoundProp[] = []
  const unfilled: string[] = []
  const used = alreadyUsed ?? new Set<string>()

  for (const prop of props) {
    const isList = /\[\]|Array</.test(prop.type)
    const binding = BINDINGS.find(
      (candidate) =>
        candidate.matches.test(prop.name) &&
        (candidate.shape === 'any' || (candidate.shape === 'list') === isList) &&
        (!candidate.typeHint || candidate.typeHint.test(prop.type))
    )

    if (binding) {
      // A required prop takes its value even if something else already shows it:
      // leaving it unbound would block the mount entirely. An OPTIONAL one gives
      // way, which is what stops the page repeating itself.
      const duplicate = !binding.reusable && used.has(binding.expression)
      if (duplicate && prop.optional) continue

      used.add(binding.expression)
      bound.push({ name: prop.name, expression: binding.expression })
    } else if (!prop.optional) {
      unfilled.push(prop.name)
    }
  }

  return { bound, mountable: unfilled.length === 0, unfilled }
}
