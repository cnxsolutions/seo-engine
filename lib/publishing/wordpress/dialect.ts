// ─────────────────────────────────────────────────────────────────────────────
// SEO plugin dialects
// SEO Engine - Six keys we are sure of, instead of nineteen we hoped for.
// ─────────────────────────────────────────────────────────────────────────────
//
// The publisher this replaces posted nineteen `rank_math_*` keys to every
// WordPress site, unconditionally. On a site running Yoast, SEOPress, or no SEO
// plugin at all, those become orphan rows in `postmeta`: the page ships with the
// theme's default title, and nothing anywhere says so.
//
// Thirteen of the nineteen are dropped rather than translated, because they were
// wrong even on RankMath:
//
//   rank_math_schema_LocalBusiness   was handed raw JSON-LD. RankMath stores its
//   rank_math_schema_FAQPage         schema in its own internal format with
//   rank_math_schema_BreadcrumbList  %variable% placeholders, not as a JSON blob.
//   rank_math_advanced_robots        was handed a JSON string; an array is expected.
//   rank_math_additional_keywords    is a Pro-only field, absent from most installs.
//   …and the rest were cosmetic flags nothing reads back.
//
// What remains is the set whose key name and value format are documented and
// identical in meaning across the three plugins. A field we cannot map honestly
// is not sent, and the connector says which ones it dropped.

export type SeoDialect = 'rankmath' | 'yoast' | 'seopress' | 'aucun'

/** The only fields the engine claims to set. */
export interface SeoFields {
  title: string
  description: string
  canonical: string
  focusKeyword: string
  ogTitle: string
  ogDescription: string
}

type KeyMap = Record<keyof SeoFields, string>

const DIALECTS: Record<Exclude<SeoDialect, 'aucun'>, KeyMap> = {
  rankmath: {
    title: 'rank_math_title',
    description: 'rank_math_description',
    canonical: 'rank_math_canonical_url',
    focusKeyword: 'rank_math_focus_keyword',
    ogTitle: 'rank_math_facebook_title',
    ogDescription: 'rank_math_facebook_description',
  },
  yoast: {
    title: '_yoast_wpseo_title',
    description: '_yoast_wpseo_metadesc',
    canonical: '_yoast_wpseo_canonical',
    focusKeyword: '_yoast_wpseo_focuskw',
    ogTitle: '_yoast_wpseo_opengraph-title',
    ogDescription: '_yoast_wpseo_opengraph-description',
  },
  seopress: {
    title: '_seopress_titles_title',
    description: '_seopress_titles_desc',
    canonical: '_seopress_robots_canonical',
    focusKeyword: '_seopress_analysis_target_kw',
    ogTitle: '_seopress_social_fb_title',
    ogDescription: '_seopress_social_fb_desc',
  },
}

/**
 * Which SEO plugin is installed, from the REST discovery document.
 *
 * Detected by namespace rather than guessed: `GET /wp-json` lists every
 * namespace a plugin registered, and each of the three registers one. A site
 * with none gets `aucun`, which is a real answer and not a fallback to RankMath.
 */
export function detectDialect(namespaces: string[] | undefined): SeoDialect {
  const all = (namespaces ?? []).map((namespace) => namespace.toLowerCase())
  if (all.some((n) => n.startsWith('rankmath'))) return 'rankmath'
  if (all.some((n) => n.startsWith('yoast'))) return 'yoast'
  if (all.some((n) => n.startsWith('seopress'))) return 'seopress'
  return 'aucun'
}

/**
 * The post meta to send, in the site's own dialect.
 *
 * Empty for `aucun`: writing SEO meta nobody reads leaves rows in the database
 * and creates the impression the page has a title it does not have.
 */
export function metaFor(dialect: SeoDialect, fields: SeoFields): Record<string, string> {
  if (dialect === 'aucun') return {}

  const keys = DIALECTS[dialect]
  const meta: Record<string, string> = {}
  for (const field of Object.keys(keys) as Array<keyof SeoFields>) {
    const value = fields[field]
    if (value) meta[keys[field]] = value
  }
  return meta
}

/** What the operator should be told when no plugin will read our metadata. */
export function dialectNote(dialect: SeoDialect): string | null {
  if (dialect !== 'aucun') return null
  return (
    "Aucune extension SEO detectee (RankMath, Yoast, SEOPress) : le titre et la meta description " +
    'ne seront pas poses. La page sortira avec le titre par defaut du theme.'
  )
}
