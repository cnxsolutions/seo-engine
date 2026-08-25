// ─────────────────────────────────────────────────────────────────────────────
// Structural Checks
// SEO Engine - Post-generation pipeline
// The handful of defects that make a page unpublishable on sight
// ─────────────────────────────────────────────────────────────────────────────
//
// These are the checks no existing validator performs: `SeoValidator` never
// looks for an H1, and it only reads the single `schemaMarkup` string it is
// given, while a generated page carries three JSON-LD blocks plus whatever the
// model inlined in the HTML. All of it is pure string work.

export interface HeadingCensus {
  h1: number
  h2: number
  h3: number
  total: number
  /** Text of the H1 elements, in document order. */
  h1Texts: string[]
}

export function censusHeadings(html: string): HeadingCensus {
  const census: HeadingCensus = { h1: 0, h2: 0, h3: 0, total: 0, h1Texts: [] }
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html || '')) !== null) {
    const level = Number(match[1])
    census.total++
    if (level === 1) {
      census.h1++
      census.h1Texts.push(match[2].replace(/<[^>]+>/g, '').trim())
    }
    if (level === 2) census.h2++
    if (level === 3) census.h3++
  }

  return census
}

// ─── JSON-LD ────────────────────────────────────────────────────────────────

export interface JsonLdCheck {
  label: string
  /** Nothing was emitted for this slot — absent, not broken. */
  empty: boolean
  valid: boolean
  error?: string
  types: string[]
}

/** `'{}'` is what the generator writes when it produced no schema at all. */
function isEmptySchema(raw: string): boolean {
  const trimmed = (raw || '').trim()
  return trimmed === '' || trimmed === '{}' || trimmed === '[]' || trimmed === 'null'
}

function collectTypes(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectTypes(entry, into)
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const type = record['@type']
  if (typeof type === 'string') into.add(type)
  else if (Array.isArray(type)) for (const t of type) if (typeof t === 'string') into.add(t)

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') collectTypes(nested, into)
  }
}

export function checkJsonLd(label: string, raw: string): JsonLdCheck {
  if (isEmptySchema(raw)) {
    return { label, empty: true, valid: true, types: [] }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    const types = new Set<string>()
    collectTypes(parsed, types)

    if (types.size === 0) {
      return {
        label,
        empty: false,
        valid: false,
        error: 'aucun @type — le bloc ne sera lu par aucun moteur',
        types: [],
      }
    }

    return { label, empty: false, valid: true, types: [...types] }
  } catch (error) {
    return {
      label,
      empty: false,
      valid: false,
      error: error instanceof Error ? error.message : 'JSON invalide',
      types: [],
    }
  }
}

/** JSON-LD the model wrote straight into the HTML, outside the schema fields. */
export function extractInlineJsonLd(html: string): string[] {
  const blocks: string[] = []
  const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html || '')) !== null) {
    blocks.push(match[1])
  }

  return blocks
}

export function checkAllJsonLd(opts: {
  schemaLocalBusiness?: string
  schemaFaqPage?: string
  schemaBreadcrumb?: string
  html?: string
}): JsonLdCheck[] {
  const checks: JsonLdCheck[] = [
    checkJsonLd('schemaLocalBusiness', opts.schemaLocalBusiness ?? ''),
    checkJsonLd('schemaFaqPage', opts.schemaFaqPage ?? ''),
    checkJsonLd('schemaBreadcrumb', opts.schemaBreadcrumb ?? ''),
  ]

  extractInlineJsonLd(opts.html ?? '').forEach((block, index) => {
    checks.push(checkJsonLd(`ld+json[${index}]`, block))
  })

  return checks
}
