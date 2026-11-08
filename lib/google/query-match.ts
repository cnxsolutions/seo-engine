// ─────────────────────────────────────────────────────────────────────────────
// Query matching — is this the query the page was written for?
// SEO Engine - Brand, target, related, or unexpected.
// ─────────────────────────────────────────────────────────────────────────────
//
// Search Console says which queries show a page; it does not say whether they
// are the ones the page was written for. On 2026-11-08 the CNX page written for
// « alternative à un consultant SEO à Troyes » was shown first on « agence seo
// troyes » (31st), and on its own keyword only once (57th): the second fact is
// the interesting one, and nothing surfaced it.
//
// The matching is deliberately literal — tokens, accents folded, a crude
// plural strip. A stemmer or embeddings would call more queries « related »,
// and a query wrongly called related is one the owner never gets to see.

const STOPWORDS = new Set([
  'a', 'au', 'aux', 'avec', 'ce', 'ces', 'chez', 'd', 'dans', 'de', 'des', 'du', 'en', 'et', 'l', 'la', 'le',
  'les', 'leur', 'ou', 'par', 'pour', 'pres', 'qu', 'que', 'quel', 'quelle', 'sa', 'se', 'son', 'sur', 'un',
  'une', 'vos', 'votre', 'mon', 'ma', 'mes',
])

/** Lowercase, accents folded, apostrophes and punctuation turned into spaces. */
export function foldQuery(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Meaningful tokens: stopwords dropped, a trailing plural s/x stripped. */
export function queryTokens(text: string): string[] {
  return foldQuery(text)
    .split(' ')
    .filter((token) => token && !STOPWORDS.has(token))
    .map((token) => (token.length > 3 ? token.replace(/[sx]$/, '') : token))
}

/**
 * The ways a site's name shows up in a query, compacted (no spaces): its
 * declared name and its host label — « cnx-solutions.fr » gives « cnxsolutions ».
 * Below four characters a brand would match half the dictionary, so it is dropped.
 */
export function brandForms(site: { name?: string | null; url?: string | null }): string[] {
  const forms = new Set<string>()
  const add = (value: string) => {
    const compact = foldQuery(value).replace(/ /g, '')
    if (compact.length >= 4) forms.add(compact)
  }

  if (site.name) add(site.name)
  if (site.url) {
    try {
      const host = new URL(/^https?:\/\//i.test(site.url) ? site.url : `https://${site.url}`).hostname
      add(host.replace(/^www\./, '').split('.')[0])
    } catch {
      // Not a URL: the name alone will have to do.
    }
  }

  return [...forms]
}

export function isBrandQuery(query: string, brands: readonly string[]): boolean {
  const compact = foldQuery(query).replace(/ /g, '')
  return compact.length > 0 && brands.some((brand) => compact.includes(brand))
}

/** The tokens a page claims: its focus keyword, its title and its address. */
export function pageTokens(page: { focusKeyword?: string | null; title?: string | null; url?: string | null }): Set<string> {
  const tokens = new Set<string>()
  for (const token of queryTokens(page.focusKeyword ?? '')) tokens.add(token)
  for (const token of queryTokens(page.title ?? '')) tokens.add(token)
  if (page.url) {
    let path = page.url
    try {
      path = new URL(page.url).pathname
    } catch {
      // Already a path.
    }
    // « -2 » is the address suffix of a republished page, not a word.
    for (const token of queryTokens(path.replace(/-\d+\/?$/, ''))) tokens.add(token)
  }
  return tokens
}

export type QueryKind = 'brand' | 'target' | 'related' | 'unexpected'

/**
 * Where a query sits relative to the page that Google showed for it.
 *
 *   brand       someone typed the site's name — says nothing about the subject
 *   target      the focus keyword itself, word for word once folded
 *   related     every meaningful word of the query is one the page claims
 *               (one may be missing in a query of four words or more)
 *   unexpected  Google associates the page with words it never chose
 */
export function classifyQuery(
  query: string,
  page: { focusKeyword?: string | null; title?: string | null; url?: string | null },
  brands: readonly string[]
): QueryKind {
  if (isBrandQuery(query, brands)) return 'brand'

  return claimOf(queryTokens(query), pageClaim(page))
}

/** What a page claims, tokenised once — for callers that test many queries against many pages. */
export interface PageClaim {
  focus: string
  tokens: Set<string>
}

export function pageClaim(page: { focusKeyword?: string | null; title?: string | null; url?: string | null }): PageClaim {
  return { focus: queryTokens(page.focusKeyword ?? '').join(' '), tokens: pageTokens(page) }
}

/** `classifyQuery` without the brand test, on tokens already computed. */
export function claimOf(tokens: readonly string[], claim: PageClaim): Exclude<QueryKind, 'brand'> {
  if (tokens.length === 0) return 'related'
  if (claim.focus && tokens.join(' ') === claim.focus) return 'target'

  const missing = tokens.filter((token) => !claim.tokens.has(token)).length
  const tolerated = tokens.length >= 4 ? 1 : 0
  return missing <= tolerated ? 'related' : 'unexpected'
}

/** Same query once folded: « Couvreur Châlons » and « couvreur chalons ». */
export function sameQuery(a: string, b: string): boolean {
  const left = queryTokens(a).join(' ')
  return left.length > 0 && left === queryTokens(b).join(' ')
}
