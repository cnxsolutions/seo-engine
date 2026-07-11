import type { GeneratedPage } from '@/lib/ai/openai'

export interface WordPressPublishOptions {
  siteUrl: string
  appUsername: string
  appPassword: string
  page: GeneratedPage
  publishStatus?: 'publish' | 'draft' | 'pending'
  pageTemplate?: string
}

export interface WordPressPublishResult {
  success: boolean
  pageId?: number
  pageUrl?: string
  error?: string
}

/**
 * Publishes a generated page to WordPress with full RankMath SEO Pro metadata.
 * Sets every RM post_meta key for maximum SEO score.
 */
export async function publishToWordPress(opts: WordPressPublishOptions): Promise<WordPressPublishResult> {
  const { siteUrl, appUsername, appPassword, page, publishStatus = 'draft', pageTemplate } = opts
  const base = siteUrl.replace(/\/$/, '')
  const auth = Buffer.from(`${appUsername}:${appPassword}`).toString('base64')
  const headers = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }

  // 1. Build the full page content with embedded JSON-LD schemas
  const contentWithSchema = buildContentWithSchema(page)

  try {
    // 2. Create the page
    const body: Record<string, unknown> = {
      title:   { raw: page.title },
      content: { raw: contentWithSchema },
      slug:    page.slug,
      status:  publishStatus,
    }
    if (pageTemplate) body.template = pageTemplate

    const createRes = await fetch(`${base}/wp-json/wp/v2/pages`, {
      method: 'POST', headers, body: JSON.stringify(body),
    })

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      return { success: false, error: `WP API ${createRes.status}: ${(err as { message?: string }).message || 'Erreur inconnue'}` }
    }

    const created = await createRes.json()
    const { id: pageId, link: pageUrl } = created

    // 3. Set ALL RankMath SEO Pro post meta fields
    const rankMathMeta = buildRankMathMeta(page, siteUrl)
    await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ meta: rankMathMeta }),
    })

    return { success: true, pageId, pageUrl }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erreur réseau' }
  }
}

/**
 * Builds all RankMath SEO Pro post meta keys.
 * Reference: RankMath post_meta keys (v1.0+)
 */
function buildRankMathMeta(page: GeneratedPage, siteUrl: string): Record<string, string | string[] | number> {
  return {
    // Core SEO
    'rank_math_title':          page.title,
    'rank_math_description':    page.metaDescription,
    'rank_math_focus_keyword':  page.focusKeyword,
    'rank_math_pillar_content': '0',

    // Secondary keywords (comma-separated for RM)
    'rank_math_additional_keywords': page.secondaryKeywords.join(','),

    // Robots
    'rank_math_robots': JSON.stringify(['index', 'follow']),
    'rank_math_advanced_robots': JSON.stringify({
      'max-snippet': '-1',
      'max-video-preview': '-1',
      'max-image-preview': 'large',
    }),

    // Canonical (let RM generate it, but set explicitly)
    'rank_math_canonical_url': `${siteUrl}/${page.slug}/`,

    // OpenGraph
    'rank_math_facebook_title':       page.ogTitle,
    'rank_math_facebook_description': page.ogDescription,
    'rank_math_facebook_enable_image_overlay': '0',

    // Twitter Card
    'rank_math_twitter_use_facebook': '0',
    'rank_math_twitter_card_type':    'summary_large_image',
    'rank_math_twitter_title':        page.twitterTitle,
    'rank_math_twitter_description':  page.twitterDescription,

    // JSON-LD Schemas (RM Pro schema override)
    'rank_math_schema_LocalBusiness': page.schemaLocalBusiness,
    'rank_math_schema_FAQPage':       page.schemaFaqPage,
    'rank_math_schema_BreadcrumbList': page.schemaBreadcrumb,

    // Content stats (informational, used by RM content analysis)
    'rank_math_estimated_reading_time': page.readingTimeMinutes,
  }
}

/**
 * Appends JSON-LD scripts to the HTML content for reliable Schema delivery.
 * WordPress will render these in the page body where RM may not override them.
 */
function buildContentWithSchema(page: GeneratedPage): string {
  const schemas = [page.schemaLocalBusiness, page.schemaFaqPage, page.schemaBreadcrumb]
    .filter(Boolean)
    .map(s => `<script type="application/ld+json">${s}</script>`)
    .join('\n')

  return `${page.htmlContent}\n\n<!-- SEO Schema.org Structured Data -->\n${schemas}`
}

/**
 * Tests WP REST API connectivity and auth.
 */
export async function testWordPressConnection(
  siteUrl: string, username: string, appPassword: string
): Promise<{ success: boolean; siteName?: string; error?: string }> {
  const base = siteUrl.replace(/\/$/, '')
  const auth = Buffer.from(`${username}:${appPassword}`).toString('base64')

  try {
    const [meRes, siteRes] = await Promise.all([
      fetch(`${base}/wp-json/wp/v2/users/me`, { headers: { Authorization: `Basic ${auth}` } }),
      fetch(`${base}/wp-json`),
    ])
    if (!meRes.ok) return { success: false, error: `Auth échouée (HTTP ${meRes.status})` }
    const site = await siteRes.json()
    return { success: true, siteName: site.name || siteUrl }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Site injoignable' }
  }
}
