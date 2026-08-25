import { DEFAULT_GENERATION_MODEL, generateJson } from '@/lib/ai/provider'
import { validateTemplate } from './nextjs'
import { extractChrome, isRecurring, type PageChrome } from './scaffold'
import { CONTRACT_VERSION, MANIFEST_PATH } from './contract'
import { parseComponentProps, type PropSignature } from './props'
import { NO_LAYOUT_SHELL, readLayoutShell, type LayoutShell } from './layout-shell'
import { readRedirectSources } from './redirects'

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
  /**
   * The sample page's shared shell, extracted here rather than at publish time.
   *
   * `samplePageContent` is stored truncated to 3000 characters, and on a real
   * page the footer sits well past that — measured at 7598 on the connected
   * site. Deriving the chrome downstream would therefore drop the footer from
   * every published page, silently. Extracted here, against the whole file.
   */
  chrome?: PageChrome
  /**
   * What `layout.tsx` already wraps every page in.
   *
   * Decides whether a generated page may open its own `<main>`. One connected
   * site's layout does, the other's does not, and emitting the same page for
   * both nests two main landmarks in one document.
   */
  layoutShell?: LayoutShell
  /**
   * Paths the site redirects away from.
   *
   * Publishing onto one produces a page nobody can reach, and on a site that
   * cross-checks its route registry against its redirects, a failed build.
   */
  redirectSources?: string[]
  /**
   * Prop signatures of the components the sample pages mount with props.
   *
   * Read from the site's own source so the contract adapter can be generated for
   * ANY site rather than for the one whose component names happen to be hard-coded
   * somewhere. Bounded: only components the pages actually use are read.
   */
  componentProps?: Record<string, PropSignature[]>
  /** Whether the site implements the publication contract, and on what terms. */
  contract?: ContractStatus
  publishTemplate: string | null
  /**
   * Why no usable template was produced, when that happened.
   *
   * `publishTemplate: null` alone is ambiguous — no sample page, a network
   * failure and a model that wrote uncompilable TSX all look identical, and the
   * publisher silently falls back to a generic page. This says which.
   */
  templateError?: string | null
}

/**
 * How many existing pages the chrome extraction compares.
 *
 * Four is enough for the intersection to be meaningful without turning one
 * analysis into a dozen GitHub reads; the connected site has eight.
 */
const SAMPLE_PAGES_READ = 4

/** Upper bound on the component inventory. Names only — a few kilobytes at most. */
const MAX_COMPONENTS_LISTED = 400

/** How many component sources the analysis opens to read their props. */
const MAX_COMPONENTS_INSPECTED = 12

/**
 * What the repository says about the contract, and whether we believe it.
 *
 * `present` is only true when the manifest declares a version we can serve AND
 * the adapter it points at is really in the tree. A manifest alone is a promise;
 * the file is the proof.
 */
export interface ContractStatus {
  present: boolean
  version: number | null
  adapterPath: string | null
  adapterImport: string | null
  variants: string[]
  /**
   * Generated route registry the site asked us to maintain, if any.
   *
   * Opt-in through the manifest: the engine never creates a file in a
   * repository that did not name it.
   */
  routesFile: string | null
  /** Why the contract is not in use, when it is not. */
  reason: string | null
}

interface GithubTreeItem {
  path: string
  type: string
}

/**
 * Analyzes a Next.js GitHub repo to understand its architecture.
 * Called once when connecting a site — result is cached.
 */
export async function analyzeNextJsRepo(
  githubRepo: string,
  githubToken: string,
  branch?: string
): Promise<RepoProfile> {
  const repoApi = `https://api.github.com/repos/${githubRepo}`
  const headers = {
    Authorization: `token ${githubToken}`,
    Accept: 'application/vnd.github+json',
  }

  // 1. Get the full file tree (shallow — just paths)
  //
  // On the branch the publisher WRITES to. This used to read `main` and fall
  // back to `master` regardless: on the connected site, which publishes to
  // `seo-engine`, the engine was describing an architecture that was not the one
  // it was about to commit into. The `master` fallback survives only when no
  // branch is configured, which is the one case where guessing is all we have.
  let tree: GithubTreeItem[] = []

  const treeRes = await fetch(`${repoApi}/git/trees/${encodeURIComponent(branch || 'main')}?recursive=1`, { headers })
  if (!treeRes.ok) {
    if (branch) {
      throw new Error(`Branche « ${branch} » introuvable sur ${githubRepo} (GitHub ${treeRes.status})`)
    }
    const fallbackRes = await fetch(`${repoApi}/git/trees/master?recursive=1`, { headers })
    if (!fallbackRes.ok) throw new Error('Impossible de lire le repo GitHub')
    tree = (await fallbackRes.json()).tree || []
  } else {
    const payload = await treeRes.json()
    // GitHub caps a recursive tree and says so. Reading an amputated tree as if
    // it were complete is how a site silently gets "no sitemap detected".
    if (payload.truncated) {
      throw new Error(`Arborescence tronquee par GitHub sur ${githubRepo} : depot trop volumineux pour une analyse fiable`)
    }
    tree = payload.tree || []
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
    sitemapContent = await fetchFileContent(repoApi, headers, sitemapPath, branch)
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
  // Several pages, not one.
  //
  // The chrome extraction compares them to find what they SHARE — that is the
  // only way to tell the site's shell from one page's own content. Reading a
  // single page and calling its blocks "the template" is exactly how
  // ChauffeurPriveTouristiqueExtraContent ended up in the stored template.
  const candidates = seoPages.length > 0
    ? seoPages
    : pageFolders.map(f => `${appPath}${f}/page.tsx`).filter(f => files.includes(f))

  const samplePagePaths = candidates.slice(0, SAMPLE_PAGES_READ)
  const sampleContents = (
    await Promise.all(samplePagePaths.map(path => fetchFileContent(repoApi, headers, path, branch)))
  ).filter((c): c is string => Boolean(c))

  const samplePagePath = samplePagePaths[0] || null
  const samplePageContent = sampleContents[0] ?? null

  // 6. Find layout
  const layoutPath = files.find(f => f === `${pageFolder}/layout.tsx`) ||
    files.find(f => f === `${appPath}layout.tsx`) || null

  // 7. Find components
  const componentsPath = files.some(f => f.startsWith(`${srcPrefix}components/`)) ? `${srcPrefix}components` : null
  const sharedComponents = files
    .filter(f => f.startsWith(`${srcPrefix}components/`) && f.endsWith('.tsx'))
    .map(f => f.replace(`${srcPrefix}components/`, '').replace('.tsx', ''))
    // Was 30, which silently cut 23 of the 53 components on the connected site
    // — `premium/PremiumFAQ` among them, so the contract adapter was generated
    // without a FAQ section and nothing said why. These are short strings in a
    // JSONB column; the cap only exists to bound a pathological repository.
    .slice(0, MAX_COMPONENTS_LISTED)

  const chrome = extractChrome(sampleContents)

  // 8. Use AI to generate a publish template based on the sample page
  let publishTemplate: string | null = null
  let templateError: string | null = null
  if (samplePageContent) {
    const attempt = await generatePublishTemplate(samplePageContent, sharedComponents, sitemapContent)
    publishTemplate = attempt.template
    templateError = attempt.error
  }

  const [contract, componentProps, layoutSource, redirectSources] = await Promise.all([
    detectContract(repoApi, headers, files, branch),
    readComponentProps(repoApi, headers, files, chrome, branch),
    layoutPath ? fetchFileContent(repoApi, headers, layoutPath, branch) : Promise.resolve(null),
    readRedirects(repoApi, headers, files, branch),
  ])

  return {
    contract,
    componentProps,
    layoutShell: layoutPath ? readLayoutShell(layoutSource) : NO_LAYOUT_SHELL,
    redirectSources,
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
    chrome,
    publishTemplate,
    templateError,
  }
}

/**
 * Read the props of the components the pages mount WITH props.
 *
 * Bounded on purpose: only components present on every sample page are read, so
 * a repository with fifty components costs a handful of requests, not fifty. The
 * ones that matter are exactly those — a hero and a content block used
 * everywhere are the site's language; a block used once is that page's content.
 */
async function readComponentProps(
  repoApi: string,
  headers: Record<string, string>,
  files: string[],
  chrome: PageChrome,
  branch?: string
): Promise<Record<string, PropSignature[]>> {
  const candidates = chrome.layout
    .filter((component) => !component.shared && isRecurring(component, chrome.sampleCount))
    .slice(0, MAX_COMPONENTS_INSPECTED)

  const entries = await Promise.all(
    candidates.map(async (component) => {
      const path = resolveImportPath(component.importLine, files)
      if (!path) return null
      const source = await fetchFileContent(repoApi, headers, path, branch)
      const props = parseComponentProps(source, component.name)
      return [component.name, props] as const
    })
  )

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, PropSignature[]] => entry !== null))
}

/**
 * Collect every path the site redirects away from.
 *
 * Reads whichever of the usual files exist. Next 16 renamed `middleware.ts` to
 * `proxy.ts`, and a repository mid-migration can carry both, so all candidates
 * are read and merged rather than stopping at the first hit.
 */
async function readRedirects(
  repoApi: string,
  headers: Record<string, string>,
  files: string[],
  branch?: string
): Promise<string[]> {
  const candidates = [
    'middleware.ts', 'src/middleware.ts', 'proxy.ts', 'src/proxy.ts', 'next.config.ts', 'next.config.js',
  ].filter((path) => files.includes(path))

  const sources = await Promise.all(
    candidates.map((path) => fetchFileContent(repoApi, headers, path, branch))
  )
  return [...new Set(sources.flatMap((source) => readRedirectSources(source)))]
}

/**
 * Turn `import X from '@/components/premium/PremiumFAQ'` into a real repo path.
 *
 * The alias is resolved against the tree rather than assumed: `@/` maps to `src/`
 * on most repositories and to the root on others, and only the tree knows which.
 */
function resolveImportPath(importLine: string, files: string[]): string | null {
  const match = importLine.match(/from\s+['"]([^'"]+)['"]/)
  if (!match) return null

  const specifier = match[1].replace(/^@\//, '')
  const candidates = ['src/', ''].flatMap((prefix) =>
    ['.tsx', '.ts', '/index.tsx'].map((ext) => `${prefix}${specifier}${ext}`)
  )
  return candidates.find((candidate) => files.includes(candidate)) ?? null
}

/**
 * Look for the manifest, then verify what it claims.
 *
 * Deliberately unforgiving: a manifest pointing at a missing adapter, or
 * declaring a version this engine does not emit, means the contract is NOT in
 * use. Publishing under a contract the site does not really implement produces a
 * page importing a component that does not exist — a build failure, in someone
 * else's repository, which is the whole thing we are avoiding.
 */
async function detectContract(
  repoApi: string,
  headers: Record<string, string>,
  files: string[],
  branch?: string
): Promise<ContractStatus> {
  const absent = (reason: string | null): ContractStatus => ({
    present: false, version: null, adapterPath: null, adapterImport: null, variants: [], routesFile: null, reason,
  })

  if (!files.includes(MANIFEST_PATH)) return absent(null)

  const raw = await fetchFileContent(repoApi, headers, MANIFEST_PATH, branch)
  if (!raw) return absent(`${MANIFEST_PATH} illisible`)

  let manifest: { contractVersion?: number; adapter?: string; variants?: string[]; routesFile?: string }
  try {
    manifest = JSON.parse(raw)
  } catch {
    return absent(`${MANIFEST_PATH} n'est pas un JSON valide`)
  }

  const version = typeof manifest.contractVersion === 'number' ? manifest.contractVersion : null
  if (version !== CONTRACT_VERSION) {
    return absent(`contrat v${version ?? '?'} declare, ce moteur emet du v${CONTRACT_VERSION}`)
  }

  const adapterImport = manifest.adapter
  if (!adapterImport) return absent(`${MANIFEST_PATH} ne declare aucun adaptateur`)

  // `@/components/seo-engine/SeoEnginePage` → `src/components/seo-engine/SeoEnginePage.tsx`
  const relative = adapterImport.replace(/^@\//, 'src/').replace(/^\//, '')
  const adapterPath = ['.tsx', '.ts', '/index.tsx']
    .map((ext) => `${relative}${ext}`)
    .find((candidate) => files.includes(candidate))

  if (!adapterPath) {
    return absent(`adaptateur ${adapterImport} introuvable dans le depot`)
  }

  return {
    present: true,
    version,
    adapterPath,
    adapterImport: adapterImport.startsWith('src/') ? `@/${adapterImport.slice(4)}` : adapterImport,
    variants: Array.isArray(manifest.variants) ? manifest.variants : [],
    routesFile: typeof manifest.routesFile === 'string' ? manifest.routesFile : null,
    reason: null,
  }
}

async function fetchFileContent(
  repoApi: string,
  headers: Record<string, string>,
  path: string,
  branch?: string
): Promise<string | null> {
  try {
    const ref = branch ? `?ref=${encodeURIComponent(branch)}` : ''
    const res = await fetch(`${repoApi}/contents/${path}${ref}`, { headers, cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return Buffer.from(data.content, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

/**
 * Output budget for one template.
 *
 * Sized for reasoning + a full page.tsx, not for the text alone.
 */
const TEMPLATE_MAX_TOKENS = 16000

/** Set by `requestTemplate` so the real API error reaches the caller. */
let lastFailure: string | null = null

interface TemplateAttempt {
  template: string | null
  error: string | null
}

/**
 * Writes the publish template, then proves it compiles before returning it.
 *
 * Two consecutive templates written here broke the client's build — an
 * expression placeholder, then a French sentence used as a React identifier —
 * and both were discovered days later in someone else's CI. The generation is
 * therefore a loop: generate, dry-run through `fillTemplate`, and on failure
 * hand the model its own error back once. A template that still fails is
 * discarded rather than stored; the publisher's heuristic fallback writes a
 * plain page, which is worse-looking but always compiles.
 */
async function generatePublishTemplate(
  samplePage: string,
  components: string[],
  sitemapContent: string | null
): Promise<TemplateAttempt> {
  let lastError: string | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    lastFailure = null
    const raw = await requestTemplate(samplePage, components, sitemapContent, lastError)
    if (!raw) {
      lastError = lastFailure ?? 'le modele n a renvoye aucun gabarit'
      continue
    }

    const problem = validateTemplate(raw)
    if (!problem) return { template: raw, error: null }
    lastError = problem
  }

  return { template: null, error: lastError }
}

async function requestTemplate(
  samplePage: string,
  components: string[],
  sitemapContent: string | null,
  previousError: string | null
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
3. N'utiliser QUE ces placeholders, a l'identique et sans jamais rien ajouter apres le nom :
   {{TITLE}}, {{META_DESCRIPTION}}, {{SLUG}}, {{COMPONENT_NAME}}, {{OG_TITLE}}, {{OG_DESCRIPTION}},
   {{HTML_CONTENT}}, {{FAQ_ITEMS_JSON}}, {{SCHEMA_JSON}}, {{PAGE_URL}}, {{SITE_URL}}
   INTERDIT ABSOLU : toute EXPRESSION dans un placeholder. {{TITLE.replace(/ /g, '')}},
   {{SLUG.toUpperCase()}} ou {{TITLE + 'Page'}} ne sont PAS substitues : ils sont commites tels
   quels et le build du client echoue sur une erreur de syntaxe.
4. Nommer l'export par defaut avec {{COMPONENT_NAME}} — c'est le SEUL moyen d'obtenir un
   identifiant React valide. Ecris exactement : export default function {{COMPONENT_NAME}}() {
   N'essaie jamais de deriver le nom du titre ou du slug toi-meme : un identifiant JavaScript ne
   peut contenir ni espace, ni tiret, ni accent.
5. Etre un fichier page.tsx complet et valide
${previousError ? `
## ECHEC PRECEDENT — CORRIGE-LE
Ton gabarit precedent a ete refuse par la validation :
${previousError}
Ne reproduis pas cette erreur.` : ''}

Reponds en JSON: { "template": "le code TSX complet avec placeholders", "sitemapEntry": "le format d'entree sitemap a ajouter" }`

  try {
    const raw = await generateJson({
      systemPrompt: 'Tu es un expert Next.js. Tu generes des templates de pages en respectant exactement l\'architecture existante. Reponds uniquement en JSON valide.',
      userPrompt: prompt,
      // Writing TSX that must COMPILE in someone else's repository is a code
      // task, not a summarisation one, and it runs once per site — the cheap
      // tier is a false economy here. gpt-4o-mini produced two unusable
      // templates in a row: an expression placeholder
      // (`{{TITLE.replace(…)}}`) and a French sentence used as a React
      // identifier (`{{TITLE}}Page`). Both broke the client's build.
      model: DEFAULT_GENERATION_MODEL,
      // A reasoning model spends output tokens THINKING before it writes a
      // character. Measured on this exact prompt: 3000 requested, 3000 spent on
      // reasoning, 0 characters returned — the budget inherited from
      // gpt-4o-mini, which does not reason, was consumed entirely.
      maxTokens: TEMPLATE_MAX_TOKENS,
      temperature: 0.3,
    })
    const parsed = JSON.parse(raw)
    return parsed.template || null
  } catch (error) {
    // Never swallow this. "aucun gabarit" hid a truncated response for two
    // rounds; the reason has to survive all the way to the UI.
    lastFailure = error instanceof Error ? error.message : String(error)
    return null
  }
}
