import { generateJson } from '@/lib/ai/provider'

export interface RepoProfile {
  router: 'app' | 'pages'
  srcPrefix: string
  pageFolder: string
  sitemapPath: string | null
  sitemapFormat: 'ts-object' | 'ts-dynamic' | 'xml-static' | null
  layoutPath: string | null
  componentsPath: string | null
  sharedComponents: string[]
  samplePagePath: string | null
  samplePageContent: string | null
  publishTemplate: string | null
}

interface GithubTreeItem {
  path: string
  type: string
}

/**
 * Analyzes a Next.js GitHub repo to understand its architecture.
 * Called once when connecting a site — result is cached.
 */
export async function analyzeNextJsRepo(githubRepo: string, githubToken: string): Promise<RepoProfile> {
  const repoApi = `https://api.github.com/repos/${githubRepo}`
  const headers = {
    Authorization: `token ${githubToken}`,
    Accept: 'application/vnd.github+json',
  }

  // 1. Get the full file tree (shallow — just paths)
  const treeRes = await fetch(`${repoApi}/git/trees/main?recursive=1`, { headers })
  if (!treeRes.ok) {
    const fallbackRes = await fetch(`${repoApi}/git/trees/master?recursive=1`, { headers })
    if (!fallbackRes.ok) throw new Error('Impossible de lire le repo GitHub')
    var tree: GithubTreeItem[] = (await fallbackRes.json()).tree || []
  } else {
    var tree: GithubTreeItem[] = (await treeRes.json()).tree || []
  }

  const files = tree.filter(f => f.type === 'blob').map(f => f.path)

  // 2. Detect basic structure
  const hasSrc = files.some(f => f.startsWith('src/'))
  const srcPrefix = hasSrc ? 'src/' : ''
  const router = files.some(f => f.includes(`${srcPrefix}app/`)) ? 'app' : 'pages'

  // 3. Find sitemap
  const sitemapCandidates = files.filter(f => f.includes('sitemap'))
  const sitemapPath = sitemapCandidates.find(f => f.endsWith('sitemap.ts') || f.endsWith('sitemap.tsx')) || null
  let sitemapFormat: RepoProfile['sitemapFormat'] = null
  let sitemapContent: string | null = null
  if (sitemapPath) {
    sitemapContent = await fetchFileContent(repoApi, headers, sitemapPath)
    if (sitemapContent?.includes('PAGE_LAST_MODIFIED') || sitemapContent?.includes('const pages')) {
      sitemapFormat = 'ts-object'
    } else {
      sitemapFormat = 'ts-dynamic'
    }
  }

  // 4. Find where SEO pages live
  const appPath = `${srcPrefix}app/`
  const pageFolders = files
    .filter(f => f.startsWith(appPath) && f.endsWith('page.tsx'))
    .map(f => f.replace(appPath, '').replace('/page.tsx', ''))
    .filter(f => !f.includes('[') && !f.includes('api/') && f.includes('-'))

  // Detect route groups (seo), (pages), etc
  const routeGroups = [...new Set(
    pageFolders.filter(f => f.startsWith('(')).map(f => f.split('/')[0])
  )]
  const seoGroup = routeGroups.find(g => g.includes('seo') || g.includes('page')) || routeGroups[0]
  const pageFolder = seoGroup ? `${appPath}${seoGroup}` : appPath

  // 5. Find a sample SEO page to use as template
  const seoPages = files.filter(f =>
    f.startsWith(pageFolder) && f.endsWith('page.tsx') && !f.includes('[')
  )
  const samplePagePath = seoPages[0] || pageFolders.map(f => `${appPath}${f}/page.tsx`).find(f => files.includes(f)) || null
  let samplePageContent: string | null = null
  if (samplePagePath) {
    samplePageContent = await fetchFileContent(repoApi, headers, samplePagePath)
  }

  // 6. Find layout
  const layoutPath = files.find(f => f === `${pageFolder}/layout.tsx`) ||
    files.find(f => f === `${appPath}layout.tsx`) || null

  // 7. Find components
  const componentsPath = files.some(f => f.startsWith(`${srcPrefix}components/`)) ? `${srcPrefix}components` : null
  const sharedComponents = files
    .filter(f => f.startsWith(`${srcPrefix}components/`) && f.endsWith('.tsx'))
    .map(f => f.replace(`${srcPrefix}components/`, '').replace('.tsx', ''))
    .slice(0, 30)

  // 8. Use AI to generate a publish template based on the sample page
  let publishTemplate: string | null = null
  if (samplePageContent) {
    publishTemplate = await generatePublishTemplate(samplePageContent, sharedComponents, sitemapContent)
  }

  return {
    router,
    srcPrefix,
    pageFolder,
    sitemapPath,
    sitemapFormat,
    layoutPath,
    componentsPath,
    sharedComponents,
    samplePagePath,
    samplePageContent: samplePageContent?.slice(0, 3000) || null,
    publishTemplate,
  }
}

async function fetchFileContent(repoApi: string, headers: Record<string, string>, path: string): Promise<string | null> {
  try {
    const res = await fetch(`${repoApi}/contents/${path}`, { headers, cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return Buffer.from(data.content, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

async function generatePublishTemplate(
  samplePage: string,
  components: string[],
  sitemapContent: string | null
): Promise<string | null> {
  const prompt = `Analyse cette page Next.js existante et genere un TEMPLATE reutilisable pour publier de nouvelles pages SEO dans le meme style.

## PAGE EXISTANTE:
\`\`\`tsx
${samplePage.slice(0, 2500)}
\`\`\`

## COMPOSANTS DISPONIBLES:
${components.slice(0, 20).join(', ')}

${sitemapContent ? `## SITEMAP FORMAT:\n\`\`\`ts\n${sitemapContent.slice(0, 800)}\n\`\`\`` : ''}

## CONSIGNES:
Genere un template TSX avec des placeholders. Le template doit:
1. Respecter EXACTEMENT le meme pattern d'imports, metadata export, et structure JSX que la page existante
2. Utiliser les memes composants si disponibles
3. Avoir ces placeholders: {{TITLE}}, {{META_DESCRIPTION}}, {{SLUG}}, {{OG_TITLE}}, {{OG_DESCRIPTION}}, {{HTML_CONTENT}}, {{FAQ_ITEMS_JSON}}, {{SCHEMA_JSON}}
4. Etre un fichier page.tsx complet et valide

Reponds en JSON: { "template": "le code TSX complet avec placeholders", "sitemapEntry": "le format d'entree sitemap a ajouter" }`

  try {
    const raw = await generateJson({
      systemPrompt: 'Tu es un expert Next.js. Tu generes des templates de pages en respectant exactement l\'architecture existante. Reponds uniquement en JSON valide.',
      userPrompt: prompt,
      model: 'gpt-4o-mini',
      maxTokens: 3000,
      temperature: 0.3,
    })
    const parsed = JSON.parse(raw)
    return parsed.template || null
  } catch {
    return null
  }
}
