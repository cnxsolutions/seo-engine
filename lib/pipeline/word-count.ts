// ─────────────────────────────────────────────────────────────────────────────
// Measured Word Count
// SEO Engine - Post-generation pipeline
// The only place where a page's length is a measurement instead of a claim
// ─────────────────────────────────────────────────────────────────────────────
//
// `estimatedWordCount` is written by the model itself and copied verbatim by
// `normalizeResponse` (lib/ai/page-types.ts). Nothing ever compared it to the
// HTML it describes, so a page half the requested length shipped announcing the
// requested length. Everything below counts what is actually in the document.

/** Content of these elements is markup or data, never prose. */
const NON_PROSE_ELEMENTS = ['script', 'style', 'template', 'noscript', 'svg']

/**
 * Entities frequent enough in French copy to change a word count.
 *
 * `&nbsp;` is the one that matters: it glues two words into one token, and the
 * generators emit it before every `:` `!` `?` `»`. The rest are decoded so a
 * token like `d&rsquo;eau` is not counted as a single word.
 */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '’', lsquo: '‘', ldquo: '"', rdquo: '"',
  laquo: '«', raquo: '»', hellip: '…',
  ndash: '–', mdash: '—', deg: '°', euro: '€',
  agrave: 'à', acirc: 'â', ccedil: 'ç', eacute: 'é',
  egrave: 'è', ecirc: 'ê', euml: 'ë', icirc: 'î',
  iuml: 'ï', ocirc: 'ô', ugrave: 'ù', ucirc: 'û',
  uuml: 'ü',
}

// ─── Text Extraction ────────────────────────────────────────────────────────

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase()

    if (key.startsWith('#')) {
      const codePoint = key.startsWith('#x')
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10)
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        return match
      }
    }

    return NAMED_ENTITIES[key] ?? match
  })
}

/**
 * The visible text of an HTML fragment.
 *
 * Tags are replaced by a space rather than removed: `<li>mot</li><li>mot</li>`
 * is two words, and stripping the tags without a separator makes it one.
 */
export function stripHtml(html: string): string {
  let text = html || ''

  for (const element of NON_PROSE_ELEMENTS) {
    text = text.replace(new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?<\\/${element}>`, 'gi'), ' ')
  }

  text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  text = text.replace(/<[^>]+>/g, ' ')
  text = decodeEntities(text)

  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Words in a plain-text string, counted the French way.
 *
 * Apostrophes separate words — `l'entreprise` is two, not one — because that is
 * how the target counts in the brief and in the campaign were written. A token
 * only counts when it carries a letter or a digit, so bullets, dashes and
 * isolated punctuation do not inflate the total.
 */
export function countWords(text: string): number {
  if (!text) return 0

  return text
    .split(/[\s '’]+/)
    .filter(token => /[\p{L}\p{N}]/u.test(token))
    .length
}

export function countHtmlWords(html: string): number {
  return countWords(stripHtml(html))
}

// ─── Length Verdict ─────────────────────────────────────────────────────────

/**
 * A page shorter than this fraction of its target is not the page that was
 * ordered. Below it the model has skipped sections, and publishing it burns the
 * URL on thin content that will not rank.
 */
export const MIN_LENGTH_RATIO = 0.85

/**
 * Above this fraction of its target, a page is padded rather than thorough.
 *
 * Deliberately a WARNING and never a block. Writing long does not damage a page
 * the way writing thin does, so refusing to publish over it would trade a real
 * article for nothing. But it is worth surfacing: when the target came from the
 * SERP, exceeding it by half means the page is markedly longer than everything
 * currently ranking for that query — which on a transactional local search
 * buries the answer under text nobody reads, and pays tokens for the privilege.
 *
 * 1.5 leaves room for a genuinely comprehensive pillar page without letting a
 * 2.4x overshoot pass unmentioned.
 */
export const MAX_LENGTH_RATIO = 1.5

export interface LengthMeasurement {
  /** Words actually present in the HTML. */
  measured: number
  /** What the model claimed, kept only to expose the gap. */
  declared: number
  target: number
  /** measured / target, 0 when no target is known. */
  ratio: number
  meetsTarget: boolean
  /** True past MAX_LENGTH_RATIO. Reported, never blocking. */
  exceedsTarget: boolean
  /** How far the model over-declared, in words. Never negative. */
  overDeclaredBy: number
}

export function measureLength(opts: {
  html: string
  declared?: number
  target: number
  minRatio?: number
}): LengthMeasurement {
  const minRatio = opts.minRatio ?? MIN_LENGTH_RATIO
  const measured = countHtmlWords(opts.html)
  const declared = Math.max(0, Math.round(opts.declared ?? 0))
  const target = Math.max(0, Math.round(opts.target))
  const ratio = target > 0 ? measured / target : 0

  return {
    measured,
    declared,
    target,
    ratio,
    // No target means nothing to fail against — a missing campaign setting must
    // not reject every page of that campaign.
    meetsTarget: target === 0 || ratio >= minRatio,
    exceedsTarget: target > 0 && ratio > MAX_LENGTH_RATIO,
    overDeclaredBy: Math.max(0, declared - measured),
  }
}

/**
 * The number of words this page was actually ordered to contain.
 *
 * The brief wins when the campaign has a plan: it is the figure the editorial
 * calendar was budgeted on. `pageTargetLength` is the per-page-type adjusted
 * length computed by the generator (`targetLength` on the returned page), which
 * already applies the pillar/child multiplier — the raw `campaign.target_length`
 * is the last resort because it ignores that multiplier and would let a pillar
 * page pass at a child page's length.
 */
export function resolveTargetWordCount(opts: {
  briefWordCount?: number
  pageTargetLength?: number
  campaignTargetLength?: number
}): number {
  const candidates = [opts.briefWordCount, opts.pageTargetLength, opts.campaignTargetLength]

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return Math.round(candidate)
    }
  }

  return 0
}
