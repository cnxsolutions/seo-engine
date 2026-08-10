// ─────────────────────────────────────────────────────────────────────────────
// Internal Link Resolution
// SEO Engine - Post-generation pipeline
// Every internal href must point at a page that exists, or it leaves the page
// ─────────────────────────────────────────────────────────────────────────────
//
// The generator invents anchors, the smart linker adds more, and until now
// nothing checked that either resolved. A page shipping five links to /404 is
// worse than a page shipping none: it spends crawl budget, dilutes the internal
// PageRank it was meant to concentrate, and tells a visitor the site is broken.
//
// Everything here is pure. The set of existing paths is read from the database
// by the caller (see repository.ts) and handed in.

export type HrefKind = 'internal' | 'external' | 'ignored'

export interface ClassifiedHref {
  kind: HrefKind
  /** Normalised path, present only for `internal`. */
  path?: string
}

export interface LinkAudit {
  html: string
  /** Internal hrefs pointing at a page that exists. */
  kept: string[]
  /** Internal hrefs removed because nothing resolved them. */
  removed: string[]
  external: string[]
  /** Anchors, `mailto:`, `tel:`… — nothing to resolve. */
  ignored: string[]
  /** Anchor HTML for the links that survived, in document order. */
  keptHtml: string[]
}

// ─── Path Normalisation ─────────────────────────────────────────────────────

/**
 * Canonical form of a site path: leading slash, no query, no fragment, no
 * trailing slash, lower case.
 *
 * Case folding is deliberate. Slugs produced by this engine are always lower
 * case and hosts are case-insensitive, so folding costs nothing and absorbs the
 * one real-world difference between a crawled `site_pages.path` and a generated
 * `generations.slug`.
 */
export function normalizePath(value: string): string {
  let path = (value || '').trim()
  if (!path) return ''

  path = path.split('#')[0].split('?')[0]

  try {
    path = decodeURIComponent(path)
  } catch {
    // A malformed escape sequence is not a reason to drop the link; compare the
    // raw form instead.
  }

  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/+$/, '')

  return path.toLowerCase()
}

function hostOf(value: string): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return url.host.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * What kind of destination an href points at, from this site's point of view.
 *
 * An absolute URL on the site's own host is INTERNAL: the smart linker writes
 * its navigation blocks that way (`${siteUrl}${href}`), and treating those as
 * external is how a whole nav block of dead links would sail through unchecked.
 */
export function classifyHref(href: string, siteUrl?: string): ClassifiedHref {
  const value = (href || '').trim()
  if (!value) return { kind: 'ignored' }

  if (value.startsWith('#')) return { kind: 'ignored' }
  if (/^(mailto|tel|sms|javascript|data|file):/i.test(value)) return { kind: 'ignored' }

  const siteHost = hostOf(siteUrl || '')

  // Protocol-relative and absolute URLs.
  if (value.startsWith('//') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value)
      const host = url.host.toLowerCase().replace(/^www\./, '')
      if (siteHost && host === siteHost) {
        return { kind: 'internal', path: normalizePath(url.pathname) }
      }
      return { kind: 'external' }
    } catch {
      return { kind: 'external' }
    }
  }

  return { kind: 'internal', path: normalizePath(value) }
}

/** Turn crawled paths and published slugs into the set the audit compares against. */
export function buildKnownPathSet(values: Iterable<string | null | undefined>): Set<string> {
  const known = new Set<string>()

  // The home page always exists; no crawl is needed to know that, and a link
  // back to it is the single most common internal link in a generated page.
  known.add('/')

  for (const value of values) {
    if (!value) continue
    const path = normalizePath(value)
    if (path) known.add(path)
  }

  return known
}

// ─── Anchor Rewriting ───────────────────────────────────────────────────────

function readHref(attributes: string): string | null {
  const match = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? null
}

/** Inner text of an anchor, so unwrapping a dead link keeps the sentence intact. */
function anchorText(inner: string): string {
  return inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Blocks the smart linker builds itself. Emptied of their links they are pure
 * noise — an "À lire également" heading above nothing — so they go with them.
 */
const GENERATED_BLOCK_CLASSES = ['related-pages', 'pillar-hub']

function dropEmptyGeneratedBlocks(html: string): string {
  let result = html

  for (const tag of ['nav', 'section']) {
    const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi')
    result = result.replace(pattern, (match, attributes: string, inner: string) => {
      const isGenerated = GENERATED_BLOCK_CLASSES.some(className => attributes.includes(className))
      if (!isGenerated) return match
      return /<a\b/i.test(inner) ? match : ''
    })
  }

  return result
}

/**
 * Remove every internal link whose destination does not exist.
 *
 * A dead link inside a list item takes the whole item with it, because a bullet
 * whose only content was the link becomes an orphan fragment. Anywhere else the
 * anchor is unwrapped and its text is kept: the sentence was written around it.
 */
export function pruneUnresolvedInternalLinks(opts: {
  html: string
  knownPaths: Iterable<string | null | undefined>
  siteUrl?: string
}): LinkAudit {
  const known = opts.knownPaths instanceof Set
    ? (opts.knownPaths as Set<string>)
    : buildKnownPathSet(opts.knownPaths)

  const kept: string[] = []
  const removed: string[] = []
  const external: string[] = []
  const ignored: string[] = []
  const keptHtml: string[] = []

  /** Decides, records nothing — the two passes below would double-count. */
  const resolves = (href: string): boolean => {
    const classified = classifyHref(href, opts.siteUrl)
    if (classified.kind !== 'internal') return true
    return !!classified.path && known.has(classified.path)
  }

  let html = opts.html || ''

  // 1. List items whose only content is a dead link. Only removals are recorded
  //    here; the survivors are counted by the pass below, which sees them again.
  html = html.replace(
    /<li\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/li>/gi,
    (match, attributes: string) => {
      const href = readHref(attributes)
      if (href === null || resolves(href)) return match
      removed.push(href)
      return ''
    }
  )

  // 2. Every remaining anchor, and the full accounting.
  html = html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (match, attributes: string, inner: string) => {
      const href = readHref(attributes)
      if (href === null) return match

      const classified = classifyHref(href, opts.siteUrl)
      if (classified.kind === 'external') {
        external.push(href)
        return match
      }
      if (classified.kind === 'ignored') {
        ignored.push(href)
        return match
      }

      if (classified.path && known.has(classified.path)) {
        kept.push(href)
        keptHtml.push(match)
        return match
      }

      removed.push(href)
      return anchorText(inner)
    }
  )

  // 3. Navigation blocks emptied by the two passes above.
  html = dropEmptyGeneratedBlocks(html)

  return { html, kept, removed, external, ignored, keptHtml }
}

/** Read-only view of the same analysis, for logging and tests. */
export function extractInternalHrefs(html: string, siteUrl?: string): string[] {
  const hrefs: string[] = []
  const pattern = /<a\b([^>]*)>/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html || '')) !== null) {
    const href = readHref(match[1])
    if (href === null) continue
    if (classifyHref(href, siteUrl).kind === 'internal') hrefs.push(href)
  }

  return hrefs
}
