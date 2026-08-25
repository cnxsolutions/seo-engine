// ─────────────────────────────────────────────────────────────────────────────
// Link Injection
// SEO Engine - Turns an anchor phrase already present in the copy into a link
// ─────────────────────────────────────────────────────────────────────────────

export interface InternalLinkTarget {
  anchor: string
  href: string
}

export interface InjectInternalLinksResult {
  htmlContent: string
  /** Anchor HTML actually inserted, in insertion order. */
  injectedLinks: string[]
}

/**
 * Regions no link may be injected into.
 *
 * The previous implementation matched `>[^<]*ANCHOR[^<]*<` anywhere, which put
 * an `<a>` inside another `<a>` as soon as two targets shared a word — invalid
 * HTML that browsers un-nest and crawlers read as one broken link — and happily
 * linked a whole H2, which then reads as a navigation item rather than a
 * heading. Both cases only surfaced now that this function has a real caller.
 */
function forbiddenRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []

  const patterns = [
    /<a\b[^>]*>[\s\S]*?<\/a>/gi,
    /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi,
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    /<style\b[^>]*>[\s\S]*?<\/style>/gi,
    /<!--[\s\S]*?-->/g,
    // Every remaining tag: an anchor phrase can appear inside an alt or title
    // attribute, and rewriting there produces markup inside an attribute value.
    /<[^>]+>/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(html)) !== null) {
      ranges.push([match.index, match.index + match[0].length])
      if (match[0].length === 0) pattern.lastIndex++
    }
  }

  return ranges
}

function overlapsForbiddenRange(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([from, to]) => start < to && end > from)
}

/**
 * First occurrence of `anchor` in visible text, on word boundaries.
 *
 * Word boundaries matter in French: without them "eau" links the middle of
 * "beaucoup" and the reader gets a link on half a word.
 */
function findInjectableMatch(html: string, anchor: string): { start: number; end: number; text: string } | null {
  const ranges = forbiddenRanges(html)
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(anchor)})(?=[^\\p{L}\\p{N}]|$)`, 'giu')

  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const start = match.index + match[1].length
    const end = start + match[2].length
    if (!overlapsForbiddenRange(ranges, start, end)) {
      return { start, end, text: match[2] }
    }
  }

  return null
}

export function escapeAttribute(value: string): string {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ─── Generic Injection ──────────────────────────────────────────────────────

export interface AnchorInjection {
  /** Phrase to look for in the copy. */
  anchor: string
  /** Destination identity — one injection per key, whatever the phrase. */
  key: string
  /** Builds the anchor HTML around the text as it was actually written. */
  render: (text: string) => string
}

/**
 * Link the first safe occurrence of each injection's phrase.
 *
 * A phrase that is not in the copy is skipped rather than appended: an inline
 * link is worth something precisely because it sits inside a sentence the reader
 * is already reading. The caller decides what to do with the leftovers.
 */
export function injectAnchors(htmlContent: string, injections: AnchorInjection[]): InjectInternalLinksResult {
  let nextHtml = htmlContent || ''
  const injectedLinks: string[] = []
  const usedKeys = new Set<string>()

  for (const injection of injections) {
    const anchor = (injection.anchor || '').trim()
    if (!anchor || !injection.key) continue
    // One link per destination: three anchors to the same page is not internal
    // linking, it is keyword stuffing with hrefs.
    if (usedKeys.has(injection.key)) continue

    const match = findInjectableMatch(nextHtml, anchor)
    if (!match) continue

    const anchorHtml = injection.render(match.text)
    nextHtml = nextHtml.slice(0, match.start) + anchorHtml + nextHtml.slice(match.end)
    injectedLinks.push(anchorHtml)
    usedKeys.add(injection.key)
  }

  return { htmlContent: nextHtml, injectedLinks }
}

export function injectInternalLinks(
  htmlContent: string,
  linkMap: InternalLinkTarget[]
): InjectInternalLinksResult {
  return injectAnchors(
    htmlContent,
    linkMap
      .filter(link => (link.href || '').trim().length > 0)
      .map(link => ({
        anchor: link.anchor,
        key: link.href.trim(),
        render: (text: string) => `<a href="${escapeAttribute(link.href.trim())}">${text}</a>`,
      }))
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
