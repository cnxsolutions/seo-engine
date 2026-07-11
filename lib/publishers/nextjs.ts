import { generateJson } from '@/lib/ai/provider'
import type { GeneratedPage } from '@/lib/ai/openai'
import type { RepoProfile } from './nextjs-analyzer'

export interface NextJsPublishOptions {
  githubRepo: string
  githubToken: string
  page: GeneratedPage
  siteUrl: string
  repoProfile?: RepoProfile | null
}

export interface NextJsPublishResult {
  success: boolean
  fileUrl?: string
  pageUrl?: string
  commitSha?: string
  sitemapUpdated?: boolean
  error?: string
}

/**
 * Publishes a generated page to a Next.js repo.
 * Uses the repo profile (from analyzeNextJsRepo) to match the existing architecture.
 * If no profile, falls back to a generic page.tsx.
 */
export async function publishToNextJs(opts: NextJsPublishOptions): Promise<NextJsPublishResult> {
  const { githubRepo, githubToken, page, siteUrl, repoProfile } = opts
  const repoApi = `https://api.github.com/repos/${githubRepo}`
  const headers = {
    Authorization: `token ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }

  try {
    const profile = repoProfile || await detectProfileLite(repoApi, headers)

    // 1. Generate the page.tsx content
    const pageContent = profile.publishTemplate
      ? fillTemplate(profile.publishTemplate, page, siteUrl)
      : await generatePageWithAI(page, siteUrl, profile)

    // 2. Commit the page file
    const pagePath = `${profile.pageFolder}/${page.slug}/page.tsx`
    const existingSha = await getFileSha(repoApi, headers, pagePath)

    const pagePayload = {
      message: `seo-engine: publish ${page.slug}`,
      content: Buffer.from(pageContent).toString('base64'),
      sha: existingSha,
    }

    const pageRes = await fetch(`${repoApi}/contents/${pagePath}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(pagePayload),
    })

    if (!pageRes.ok) {
      const err = await pageRes.json().catch(() => ({}))
      return { success: false, error: `GitHub ${pageRes.status}: ${(err as { message?: string }).message || 'Erreur'}` }
    }

    const pageData = await pageRes.json()

    // 3. Update sitemap if applicable
    let sitemapUpdated = false
    if (profile.sitemapPath && profile.sitemapFormat === 'ts-object') {
      sitemapUpdated = await addToSitemap(repoApi, headers, profile.sitemapPath, page.slug)
    }

    return {
      success: true,
      fileUrl: pageData.content?.html_url,
      pageUrl: `${siteUrl.replace(/\/$/, '')}/${page.slug}`,
      commitSha: pageData.commit?.sha,
      sitemapUpdated,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erreur réseau GitHub',
    }
  }
}

async function detectProfileLite(repoApi: string, headers: Record<string, string>): Promise<RepoProfile> {
  // Quick detection: check common paths to find where SEO pages live
  const candidates = [
    'src/app/(seo)',
    'src/app/(pages)',
    'app/(seo)',
    'app/(pages)',
    'src/app',
    'app',
  ]

  let pageFolder = 'src/app'
  for (const path of candidates) {
    const res = await fetch(`${repoApi}/contents/${path}`, { headers, cache: 'no-store' })
    if (res.ok) {
      pageFolder = path
      break
    }
  }

  // Check for sitemap
  const sitemapCandidates = ['src/app/sitemap.ts', 'app/sitemap.ts']
  let sitemapPath: string | null = null
  let sitemapFormat: RepoProfile['sitemapFormat'] = null
  for (const path of sitemapCandidates) {
    const res = await fetch(`${repoApi}/contents/${path}`, { headers, cache: 'no-store' })
    if (res.ok) {
      sitemapPath = path
      const data = await res.json()
      const content = Buffer.from(data.content, 'base64').toString('utf-8')
      sitemapFormat = content.includes('PAGE_LAST_MODIFIED') || content.includes('const pages') ? 'ts-object' : 'ts-dynamic'
      break
    }
  }

  // Try to read a sample page
  let samplePageContent: string | null = null
  if (pageFolder) {
    const dirRes = await fetch(`${repoApi}/contents/${pageFolder}`, { headers, cache: 'no-store' })
    if (dirRes.ok) {
      const items = await dirRes.json()
      const subDir = (items as Array<{ name: string; type: string }>).find(
        i => i.type === 'dir' && i.name.includes('-') && !i.name.startsWith('[') && !i.name.startsWith('(')
      )
      if (subDir) {
        const sampleRes = await fetch(`${repoApi}/contents/${pageFolder}/${subDir.name}/page.tsx`, { headers, cache: 'no-store' })
        if (sampleRes.ok) {
          const sampleData = await sampleRes.json()
          samplePageContent = Buffer.from(sampleData.content, 'base64').toString('utf-8')
        }
      }
    }
  }

  return {
    router: 'app',
    srcPrefix: pageFolder.startsWith('src/') ? 'src/' : '',
    pageFolder,
    sitemapPath,
    sitemapFormat,
    layoutPath: null,
    componentsPath: null,
    sharedComponents: [],
    samplePagePath: null,
    samplePageContent: samplePageContent?.slice(0, 3000) || null,
    publishTemplate: null,
  }
}

function getDefaultProfile(): RepoProfile {
  return {
    router: 'app',
    srcPrefix: 'src/',
    pageFolder: 'src/app',
    sitemapPath: null,
    sitemapFormat: null,
    layoutPath: null,
    componentsPath: null,
    sharedComponents: [],
    samplePagePath: null,
    samplePageContent: null,
    publishTemplate: null,
  }
}

function fillTemplate(template: string, page: GeneratedPage, siteUrl: string): string {
  const pageUrl = `${siteUrl.replace(/\/$/, '')}/${page.slug}`
  const faqJson = JSON.stringify(page.faqItems || [], null, 2)
  const schemaJson = buildSchemaJson(page, pageUrl)

  return template
    .replace(/\{\{TITLE\}\}/g, escapeJs(page.title))
    .replace(/\{\{META_DESCRIPTION\}\}/g, escapeJs(page.metaDescription))
    .replace(/\{\{SLUG\}\}/g, page.slug)
    .replace(/\{\{OG_TITLE\}\}/g, escapeJs(page.ogTitle || page.title))
    .replace(/\{\{OG_DESCRIPTION\}\}/g, escapeJs(page.ogDescription || page.metaDescription))
    .replace(/\{\{HTML_CONTENT\}\}/g, escapeTemplate(page.htmlContent))
    .replace(/\{\{FAQ_ITEMS_JSON\}\}/g, faqJson)
    .replace(/\{\{SCHEMA_JSON\}\}/g, schemaJson)
    .replace(/\{\{PAGE_URL\}\}/g, pageUrl)
    .replace(/\{\{SITE_URL\}\}/g, siteUrl)
}

async function generatePageWithAI(page: GeneratedPage, siteUrl: string, profile: RepoProfile): Promise<string> {
  const pageUrl = `${siteUrl.replace(/\/$/, '')}/${page.slug}`

  const prompt = `Genere un fichier page.tsx Next.js App Router complet pour cette page SEO.

## INFOS PAGE:
- Title: ${page.title}
- Meta description: ${page.metaDescription}
- Slug: ${page.slug}
- URL: ${pageUrl}
- OG Title: ${page.ogTitle}
- Focus keyword: ${page.focusKeyword}

## CONTENU HTML:
${page.htmlContent.slice(0, 2000)}

## FAQ:
${JSON.stringify(page.faqItems || [])}

## ARCHITECTURE DU REPO:
- Router: ${profile.router}
- Composants dispos: ${profile.sharedComponents.slice(0, 15).join(', ') || 'aucun'}
${profile.samplePageContent ? `\n## EXEMPLE PAGE EXISTANTE (a imiter):\n${profile.samplePageContent.slice(0, 1500)}` : ''}

## CONSIGNES:
1. Exporter metadata (Metadata type) avec title, description, canonical, openGraph, twitter
2. Le contenu HTML doit etre inline dans une variable string, rendu avec dangerouslySetInnerHTML
3. Inclure le schema.org JSON-LD (LocalBusiness + FAQPage) en script tag
4. Si des composants existants sont pertinents (Navbar, Footer, FAQ, CTA), les utiliser
5. Le fichier doit etre autonome et complet

Reponds UNIQUEMENT avec le code TSX complet, sans markdown, sans backticks, juste le code.`

  try {
    const raw = await generateJson({
      systemPrompt: 'Tu es un expert Next.js 14+ App Router. Tu generes des fichiers page.tsx complets. Reponds avec un JSON: {"code": "le fichier TSX complet"}',
      userPrompt: prompt,
      model: 'gpt-4o-mini',
      maxTokens: 4000,
      temperature: 0.3,
    })
    const parsed = JSON.parse(raw)
    return parsed.code || buildFallbackPage(page, siteUrl)
  } catch {
    return buildFallbackPage(page, siteUrl)
  }
}

function buildFallbackPage(page: GeneratedPage, siteUrl: string): string {
  const pageUrl = `${siteUrl.replace(/\/$/, '')}/${page.slug}`
  const schemaJson = buildSchemaJson(page, pageUrl)

  return `import { Metadata } from 'next'

export const metadata: Metadata = {
  title: '${escapeJs(page.title)}',
  description: '${escapeJs(page.metaDescription)}',
  alternates: { canonical: '${pageUrl}' },
  openGraph: {
    title: '${escapeJs(page.ogTitle || page.title)}',
    description: '${escapeJs(page.ogDescription || page.metaDescription)}',
    url: '${pageUrl}',
  },
}

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: \`${escapeTemplate(schemaJson)}\` }} />
      <article dangerouslySetInnerHTML={{ __html: content }} />
    </>
  )
}

const content = \`${escapeTemplate(page.htmlContent)}\`
`
}

function buildSchemaJson(page: GeneratedPage, pageUrl: string): string {
  const schemas: object[] = []

  try { if (page.schemaLocalBusiness && page.schemaLocalBusiness !== '{}') schemas.push(JSON.parse(page.schemaLocalBusiness)) } catch {}
  try { if (page.schemaBreadcrumb && page.schemaBreadcrumb !== '{}') schemas.push(JSON.parse(page.schemaBreadcrumb)) } catch {}

  if (page.faqItems?.length) {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faqItems.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
  }

  return JSON.stringify(schemas.length === 1 ? schemas[0] : schemas)
}

async function getFileSha(repoApi: string, headers: Record<string, string>, path: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${repoApi}/contents/${path}`, { headers, cache: 'no-store' })
    if (!res.ok) return undefined
    const data = await res.json()
    return data.sha
  } catch {
    return undefined
  }
}

async function addToSitemap(repoApi: string, headers: Record<string, string>, sitemapPath: string, slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${repoApi}/contents/${sitemapPath}`, { headers, cache: 'no-store' })
    if (!res.ok) return false

    const data = await res.json()
    const content = Buffer.from(data.content, 'base64').toString('utf-8')

    if (content.includes(`'/${slug}'`) || content.includes(`"/${slug}"`)) return true

    const today = new Date().toISOString().split('T')[0]
    const newEntry = `    '/${slug}': '${today}',`

    // Find the closing brace of the PAGE_LAST_MODIFIED (or similar) object
    const objectStart = content.indexOf('{', content.indexOf('='))
    if (objectStart === -1) return false

    let braceCount = 0
    let insertPos = -1
    for (let i = objectStart; i < content.length; i++) {
      if (content[i] === '{') braceCount++
      if (content[i] === '}') {
        braceCount--
        if (braceCount === 0) { insertPos = i; break }
      }
    }
    if (insertPos === -1) return false

    const updated = content.slice(0, insertPos) + newEntry + '\n' + content.slice(insertPos)

    const payload = {
      message: `seo-engine: add /${slug} to sitemap`,
      content: Buffer.from(updated).toString('base64'),
      sha: data.sha,
    }

    const updateRes = await fetch(`${repoApi}/contents/${sitemapPath}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    })

    return updateRes.ok
  } catch {
    return false
  }
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ')
}

function escapeTemplate(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}
