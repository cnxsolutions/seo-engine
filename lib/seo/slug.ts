// ─────────────────────────────────────────────────────────────────────────────
// Page slugs
// SEO Engine - The URL is the one thing a published page can never take back.
// ─────────────────────────────────────────────────────────────────────────────
//
// This replaces three separate slug builders that had drifted apart: two
// `ensureLongTailSlug` implementations with different word limits and different
// filler lists, plus a fallback that pasted the internal page type in front of
// everything. All three shared the same misconception — that a "long-tail" page
// needs a long URL — and padded the slug until it hit a word count:
//
//   const extras = [businessType, pageType, 'service', 'professionnel', city, 'guide', 'local']
//
// What that shipped, on a real page:
//
//   /taxi-aube-communes-desservies-reservations-child-service-professionnel-troyes-guide
//
// Eighty-two characters, three meaningless words, and `child` — the value of the
// `page_type` enum, leaked out of the database and into a public URL.
//
// Long-tail describes the QUERY, not the address. Google's own guidance asks for
// short, descriptive URLs; stuffing keywords into one buys nothing and costs
// click-through, shareability and trust. And a URL is not a title: a bad title
// is rewritten in place, a bad URL needs a redirect for the rest of the site's
// life.
//
// So: no padding, ever. The slug says what the page is about, in as few words as
// that takes.

/** Above this, a URL wraps in search results and is truncated when shared. */
export const MAX_SLUG_WORDS = 7
export const MAX_SLUG_CHARS = 75

/**
 * Values of the `page_type` enum.
 *
 * These describe how the engine PLANNED the page. They mean nothing to a reader
 * and nothing to a crawler, and one of them reached production.
 */
const INTERNAL_TOKENS = new Set([
  'pillar', 'child', 'alternative', 'comparative', 'local', 'pack', 'localpack', 'local-pack',
])

/**
 * French words that add length without adding meaning to a URL.
 *
 * Removed from the middle of a slug only — never used to lengthen one. Standard
 * practice, and what keeps `taxi-a-la-gare-de-troyes` from spending four of its
 * seven words on grammar.
 */
const STOPWORDS = new Set([
  'a', 'au', 'aux', 'de', 'des', 'du', 'en', 'et', 'la', 'le', 'les', 'un', 'une',
  'pour', 'par', 'sur', 'dans', 'avec', 'ou', 'que', 'qui', 'd', 'l',
])

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface SlugInput {
  /** What the editorial plan proposed, when there is a plan. */
  proposed?: string
  /** The query the page targets. Better than the title: no marketing words. */
  focusKeyword?: string
  /** Last resort before the business type. */
  title?: string
  /** Appended when absent — a local page's URL should carry its town. */
  city?: string
  /** Only used when everything else is empty. */
  businessType?: string
}

/**
 * Build the URL segment for a generated page.
 *
 * Order of preference is deliberate. The planned slug was written by a model
 * that had the brief in front of it; the focus keyword is the query itself; the
 * title comes last because titles carry punctuation and selling words that make
 * poor URLs.
 *
 * The city is appended rather than assumed present: a page about Troyes whose
 * URL does not say Troyes competes with its own siblings.
 */
export function buildPageSlug(input: SlugInput): string {
  const source =
    [input.proposed, input.focusKeyword, input.title]
      .map((candidate) => (candidate ?? '').trim())
      .find((candidate) => candidate.length > 0) ??
    [input.businessType, input.city].filter(Boolean).join(' ')

  let words = slugify(source)
    .split('-')
    .filter(Boolean)
    .filter((word) => !INTERNAL_TOKENS.has(word))

  // Stopwords go only when the slug can afford to lose nothing else. A short
  // slug reads better with them: `taxi-de-nuit` beats `taxi-nuit`.
  if (words.length > MAX_SLUG_WORDS) {
    words = words.filter((word) => !STOPWORDS.has(word))
  }

  words = dedupe(words)

  const city = slugify(input.city ?? '')
    .split('-')
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word))

  if (city.length > 0) {
    // The town always ends the slug, and always survives truncation.
    //
    // Only appending it when absent was not enough: on a long slug the town sat
    // past the word limit and the final `slice` cut it off anyway, so two pages
    // differing only by commune collapsed onto one URL. Moving it to the end
    // unconditionally makes the invariant hold by construction rather than by
    // luck, and `/taxi-aeroport-troyes` is the conventional shape for a local
    // page anyway.
    const withoutCity = words.filter((word) => !city.includes(word))
    words = [...withoutCity.slice(0, Math.max(1, MAX_SLUG_WORDS - city.length)), ...city]
  }

  return capLength(dedupe(words).slice(0, MAX_SLUG_WORDS)).join('-') || 'page'
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolving a slug against the addresses the site already occupies
// ─────────────────────────────────────────────────────────────────────────────
//
// buildPageSlug says what a page SHOULD be called. It knows nothing of what the
// site already publishes, so two sibling briefs produce the same address and the
// second page ends up competing with the first — a page that ranks, that the
// owner did not ask us to touch.
//
// resolveFreeSlug is the other half of that sentence: the same single factory,
// read against the paths already taken. It runs BEFORE the first token is
// generated, so a collision costs a decision instead of a page.

/**
 * The outcome of confronting a proposed slug with what is already online.
 *
 * `slug` is a slug — no leading slash, this is what goes into `generations.slug`.
 * `from` and `occupiedBy` are paths, because both name an ADDRESS that is
 * already taken: one gets struck through in the plan, the other gets linked.
 */
export type SlugResolution =
  | { status: 'free'; slug: string }
  | { status: 'disambiguated'; slug: string; from: string; token: string }
  | { status: 'collision'; occupiedBy: string }

/**
 * Compare on paths: `taken` carries normalized paths, not bare slugs.
 *
 * Local on purpose. This module imports nothing, which is what makes its tests
 * runnable without a database, without a network and without a pipeline — and
 * a slug decision is not a reason to give that up.
 */
function asPath(slug: string): string {
  return `/${slug}`.toLowerCase()
}

/** The phrase buildPageSlug would build from, in the same order of preference. */
function subjectOf(input: SlugInput): string {
  return (
    [input.proposed, input.focusKeyword, input.title]
      .map((candidate) => (candidate ?? '').trim())
      .find((candidate) => candidate.length > 0) ?? ''
  )
}

/**
 * Find an address for this page that no existing one already holds.
 *
 * NO NUMERIC SUFFIX, EVER. `-2` is not a disambiguation, it is a confession:
 * it states in the URL itself that the two pages are the same page. It would
 * also always succeed, which is exactly the failure — a page with nothing new
 * to say must be refused before it is written, not renamed until it fits.
 *
 * So the only way out of a collision is a word that carries meaning: a
 * district, a service angle, a trade precision. They are tried in the order
 * they were given, because that order is editorial and not technical, and the
 * first one that frees the address wins.
 */
export function resolveFreeSlug(
  input: SlugInput,
  taken: ReadonlySet<string>,
  disambiguators: readonly string[],
): SlugResolution {
  const base = buildPageSlug(input)
  if (!taken.has(asPath(base))) return { status: 'free', slug: base }

  const subject = subjectOf(input)

  for (const token of disambiguators) {
    // Same factory, never a second one: the candidate goes back through
    // buildPageSlug and comes out with the same word cap, the same character
    // cap and the same town at the end.
    const candidate = buildPageSlug({ ...input, proposed: `${token} ${subject}` })

    // A candidate identical to the base is not a candidate. dedupe() absorbs a
    // token the slug already carries — a disambiguator equal to the town is the
    // ordinary case — and it would report the occupied address as free.
    if (candidate === base) continue

    // Freedom is checked on the TRUNCATED result, never on the phrase we asked
    // for. Adding a word at the front pushes the last one past the seven-word
    // cap, and the word that fell may be the only one that told this page apart
    // from a sibling: `taxi-…-assis-professionnalise-troyes` and
    // `…-assis-troyes` are two different addresses right up to the cap.
    if (!taken.has(asPath(candidate))) {
      return { status: 'disambiguated', slug: candidate, from: asPath(base), token }
    }
  }

  return { status: 'collision', occupiedBy: asPath(base) }
}

function dedupe(words: string[]): string[] {
  const seen = new Set<string>()
  return words.filter((word) => {
    if (seen.has(word)) return false
    seen.add(word)
    return true
  })
}

/** Drop trailing words until the joined slug fits, never cutting mid-word. */
function capLength(words: string[]): string[] {
  const kept = [...words]
  while (kept.length > 1 && kept.join('-').length > MAX_SLUG_CHARS) kept.pop()
  return kept
}
