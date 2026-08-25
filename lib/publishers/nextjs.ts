import type { GeneratedPage } from '@/lib/ai/openai'
import type { RepoProfile } from './nextjs-analyzer'
import { buildScaffold, EMPTY_CHROME, extractChrome, GENERATED_MARKER } from './scaffold'
import { buildContractPayload, emitContractPage, variantForPageType } from './contract'
import { parseGeneratedRoutes, renderGeneratedRoutes, routeForPublication, upsertRoute } from './routes-file'
import { promoteToProduction, type PromotionOutcome } from './promote'
import type { PageType } from '@/lib/types'
import { isRedirectSource } from './redirects'

export interface NextJsPublishOptions {
  githubRepo: string
  githubToken: string
  page: GeneratedPage
  siteUrl: string
  repoProfile?: RepoProfile | null
  /**
   * Branch to read from and commit to. Omitted, GitHub uses the repository's
   * default branch — which for most repositories is production.
   *
   * Pointing this at a dedicated branch is the difference between "a generated
   * page appears in a branch I can review" and "a generated page is live". The
   * engine has no build verification of its own, so on a repo that deploys from
   * its default branch, a bad page ships the moment it is committed.
   */
  branch?: string
  /**
   * Editorial type of the page, when the caller knows it.
   *
   * Only used under the contract, where it selects the layout family the site's
   * adapter renders. Absent, the page falls into the default family and the
   * fallback is logged rather than assumed.
   */
  pageType?: PageType
  /**
   * Carry the branch over to the repository's production branch once committed.
   *
   * Without it a dedicated branch is a dead end: the page is committed, the host
   * deploys another branch, and nothing is ever visible. Ignored when no branch
   * is set, since publication already targets production.
   */
  autoPromote?: boolean
  /**
   * Authorise overwriting ONE named page the engine did not write.
   *
   * The symmetric key to WordPress's `TargetOptions.replaces`, with the same
   * rule: the guard below lifts only when `path` matches the slug about to be
   * committed, exactly. Any other value and `/slug` is refused as 'occupe',
   * unchanged. Absent, nothing here behaves differently.
   *
   * No `remoteId`: a Next.js repository has no remote id, and inventing one to
   * mirror the WordPress shape would be a field nobody could fill.
   */
  replaces?: { path: string }
}

/**
 * Append `?ref=<branch>` to a Contents API read.
 *
 * Reads must target the SAME branch as the write: a file SHA fetched from the
 * default branch is rejected when committing to another one, and the profile
 * detection would otherwise describe a tree that is not the one being written to.
 */
function withRef(url: string, branch?: string): string {
  if (!branch) return url
  return `${url}${url.includes('?') ? '&' : '?'}ref=${encodeURIComponent(branch)}`
}

/**
 * `/taxi-troyes`, `taxi-troyes` and `/Taxi-Troyes/` name the same page.
 *
 * The only comparison in this file that decides whether an existing file may be
 * overwritten, so it is deliberately narrow: slashes and case, nothing else. No
 * prefix match, no "starts with", no route-group awareness — a looser rule here
 * turns a named target back into a blanket permission.
 */
function samePagePath(a: string, b: string): boolean {
  const normalise = (value: string) =>
    value.split(/[?#]/)[0].replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase()

  return normalise(a) === normalise(b)
}

/**
 * Which of the three page builders produced the committed file.
 *
 * - `contrat`   — the site implements the publication contract: the page is one
 *                 import and one data object, and the site renders it. Best case
 *                 by a distance, because nothing we emit can fail to compile.
 * - `charpente` — built from the repository's own chrome. Good.
 * - `gabarit`   — an LLM-written template stored by the analyzer. Legacy: it is
 *                 by construction copied from ONE example page, so it drags that
 *                 page's specific components into every other page.
 * - `secours`   — a bare `<article>`. Compiles, but looks like nothing.
 */
export type PageBuildMode = 'contrat' | 'charpente' | 'gabarit' | 'secours'

export interface NextJsPublishResult {
  success: boolean
  fileUrl?: string
  pageUrl?: string
  commitSha?: string
  sitemapUpdated?: boolean
  error?: string
  /**
   * What happened between the publication branch and production.
   *
   * Absent when no promotion was asked for. Present and `promoted: false` means
   * the page is committed but not live — a state the engine used to be in
   * permanently without ever saying so.
   */
  promotion?: PromotionOutcome
  /**
   * Publishing in the site's shell and publishing a naked article both returned
   * `success: true` and were indistinguishable afterwards. Only one of them is
   * worth keeping, so the engine now says which one it did.
   */
  mode?: PageBuildMode
  /**
   * Set when the publisher DECLINED on purpose rather than failed.
   *
   * The distinction decides what the scheduler does next: a broken push is worth
   * another tick, an occupied slug will be just as occupied in fifteen minutes
   * and needs a human. Read as a plain error, the two guards below put the row
   * back in the queue and refused it again, for ever.
   */
  refusal?: 'occupe' | 'redirection'
}

/**
 * Publishes a generated page to a Next.js repo.
 * Uses the repo profile (from analyzeNextJsRepo) to match the existing architecture.
 * If no profile, falls back to a generic page.tsx.
 */
export async function publishToNextJs(opts: NextJsPublishOptions): Promise<NextJsPublishResult> {
  const { githubRepo, githubToken, page, siteUrl, repoProfile, branch, pageType, autoPromote } = opts
  const repoApi = `https://api.github.com/repos/${githubRepo}`
  const headers = {
    Authorization: `token ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }

  try {
    const profile = repoProfile || await detectProfileLite(repoApi, headers, branch)

    // 1. Generate the page.tsx content
    const { content: pageContent, mode } = selectPageContent(profile, page, siteUrl, pageType)

    // 2. Refuse a slug the site sends visitors away from
    //
    // Checked before the file, because a route group means the two do not line
    // up: `src/app/(seo)/taxi-troyes/page.tsx` serves `/taxi-troyes`, and the
    // redirect that intercepts it lives in middleware, not in the tree. This
    // happened — the page was published, unreachable, and it broke the site's
    // own route-registry check.
    if (isRedirectSource(page.slug, profile.redirectSources)) {
      return {
        success: false,
        refusal: 'redirection',
        error:
          `/${page.slug} est une source de redirection dans ${githubRepo} : la page serait inatteignable. ` +
          `Publication annulee — changer le slug.`,
      }
    }

    // 3. Commit the page file
    const pagePath = `${profile.pageFolder}/${page.slug}/page.tsx`
    const existing = await readExistingPage(repoApi, headers, pagePath, branch)

    // Never overwrite a page a human wrote — unless a human named that page.
    //
    // The commit is an upsert on a path derived from a generated slug, so a slug
    // that happens to match an existing route replaces that route's source. It
    // nearly happened: a pillar page's cleaned-up slug came out as
    // `/taxi-troyes`, which the site already served as a hand-written page. The
    // engine would have destroyed it and reported a successful publication.
    //
    // `replaces` is the one way past this, and it is a KEY, not a switch: it has
    // to name the very path being written. A mismatch is refused exactly as
    // before, because a target that could point elsewhere would authorise
    // exactly the overwrite this guard exists to prevent.
    const authorised = opts.replaces !== undefined && samePagePath(opts.replaces.path, page.slug)
    if (existing && !authorised && !existing.content.includes(GENERATED_MARKER)) {
      return {
        success: false,
        refusal: 'occupe',
        error:
          `/${page.slug} existe deja dans ${githubRepo} et n'a pas ete ecrite par le moteur. ` +
          `Publication annulee pour ne pas ecraser une page redigee a la main — changer le slug.`,
      }
    }

    const pagePayload = {
      message: `seo-engine: publish ${page.slug}`,
      content: Buffer.from(pageContent).toString('base64'),
      sha: existing?.sha,
      ...(branch ? { branch } : {}),
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

    // 4. Make the page discoverable
    //
    // Committing the page is not publishing it. On the connected site the
    // sitemap derives from a hand-maintained registry, so every page published
    // so far renders on request and appears in no sitemap, no IndexNow ping and
    // no internal link — the article exists and nothing is ever told about it.
    let sitemapUpdated = false
    if (profile.contract?.routesFile) {
      sitemapUpdated = await updateGeneratedRoutes({
        repoApi,
        headers,
        routesFile: profile.contract.routesFile,
        slug: page.slug,
        pageType,
        branch,
      })
    } else if (profile.sitemapPath && profile.sitemapFormat === 'ts-object') {
      sitemapUpdated = await addToSitemap(repoApi, headers, profile.sitemapPath, page.slug, branch)
    }

    // 5. Carry it to the branch the host actually deploys
    //
    // Last, deliberately: the page file and the route registry must both be on
    // the branch before it is merged, or production gets a page that is in no
    // sitemap until the next publication.
    const promotion = autoPromote && branch
      ? await promoteToProduction({ repoApi, headers, head: branch, slug: page.slug })
      : undefined

    if (promotion && !promotion.promoted) {
      console.warn(`[publish] /${page.slug} commite sur « ${branch} » mais PAS en ligne : ${promotion.reason}`)
    }

    return {
      success: true,
      fileUrl: pageData.content?.html_url,
      pageUrl: `${siteUrl.replace(/\/$/, '')}/${page.slug}`,
      commitSha: pageData.commit?.sha,
      sitemapUpdated,
      mode,
      promotion,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erreur réseau GitHub',
    }
  }
}

export interface NextJsProbeOptions {
  githubRepo: string
  githubToken: string
  /** Read from this branch, so the answer describes the tree we would write to. */
  branch?: string
  /**
   * The profile the analyzer stored, when there is one. Absent, the probe pays
   * for a `detectProfileLite` — it cannot know where pages live otherwise, and
   * guessing `src/app` would report every slug free on a repo using `app/(seo)`.
   */
  repoProfile?: RepoProfile | null
  slug: string
}

export interface NextJsProbe {
  /** The site sends this path somewhere else: a page committed here is unreachable. */
  redirected: boolean
  /** A `page.tsx` already exists at this path. */
  occupied: boolean
  /**
   * The occupying file carries the generation marker.
   *
   * Reported, never acted on here: whether being ours makes an address writable
   * is the caller's question, and `publishToNextJs` and `probeSlugFree` answer
   * it differently on purpose.
   */
  ours: boolean
}

/**
 * Is `/slug` free in this repository — asked WITHOUT writing anything.
 *
 * The same two guards `publishToNextJs` applies before it commits (steps 2 and
 * 3), lifted out so they can be asked before a single token is spent. They were
 * previously reachable only by attempting a publication, which meant a page had
 * to be generated and paid for to discover that its address was taken.
 *
 * The guards are not re-implemented: `isRedirectSource` and `GENERATED_MARKER`
 * are the very same ones the publisher uses. A second definition of "occupied"
 * would let the probe say free and the publisher refuse minutes later.
 *
 * Throws whatever the network or GitHub throws. The caller decides what an
 * unanswerable question means — `probeSlugFree` treats it as "learned nothing",
 * which is not the same as "free".
 */
export async function probeNextJsPath(opts: NextJsProbeOptions): Promise<NextJsProbe> {
  const { githubRepo, githubToken, branch, slug } = opts
  const repoApi = `https://api.github.com/repos/${githubRepo}`
  const headers = {
    Authorization: `token ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }

  const profile = opts.repoProfile || (await detectProfileLite(repoApi, headers, branch))

  // Checked first, and separately from the file, because a route group makes the
  // two disagree: `src/app/(seo)/taxi-troyes/page.tsx` serves `/taxi-troyes`,
  // and the rule intercepting that URL lives in middleware, not in the tree.
  if (isRedirectSource(slug, profile.redirectSources)) {
    return { redirected: true, occupied: false, ours: false }
  }

  const existing = await readExistingPage(repoApi, headers, `${profile.pageFolder}/${slug}/page.tsx`, branch)
  if (!existing) return { redirected: false, occupied: false, ours: false }

  return {
    redirected: false,
    occupied: true,
    ours: existing.content.includes(GENERATED_MARKER),
  }
}

async function detectProfileLite(repoApi: string, headers: Record<string, string>, branch?: string): Promise<RepoProfile> {
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
    const res = await fetch(withRef(`${repoApi}/contents/${path}`, branch), { headers, cache: 'no-store' })
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
    const res = await fetch(withRef(`${repoApi}/contents/${path}`, branch), { headers, cache: 'no-store' })
    if (res.ok) {
      sitemapPath = path
      const data = await res.json()
      const content = Buffer.from(data.content, 'base64').toString('utf-8')
      sitemapFormat = content.includes('PAGE_LAST_MODIFIED') || content.includes('const pages') ? 'ts-object' : 'ts-dynamic'
      break
    }
  }

  // Read SEVERAL existing pages, not one.
  //
  // The chrome extraction needs to compare pages to separate the site's shell
  // from one page's own content; given a single page it deliberately returns
  // nothing rather than guess.
  const sampleContents: string[] = []
  if (pageFolder) {
    const dirRes = await fetch(withRef(`${repoApi}/contents/${pageFolder}`, branch), { headers, cache: 'no-store' })
    if (dirRes.ok) {
      const items = await dirRes.json()
      const subDirs = (items as Array<{ name: string; type: string }>)
        .filter(i => i.type === 'dir' && i.name.includes('-') && !i.name.startsWith('[') && !i.name.startsWith('('))
        .slice(0, 4)

      const fetched = await Promise.all(subDirs.map(async (subDir) => {
        const res = await fetch(withRef(`${repoApi}/contents/${pageFolder}/${subDir.name}/page.tsx`, branch), { headers, cache: 'no-store' })
        if (!res.ok) return null
        const data = await res.json()
        return Buffer.from(data.content, 'base64').toString('utf-8')
      }))
      sampleContents.push(...fetched.filter((c): c is string => Boolean(c)))
    }
  }
  const samplePageContent: string | null = sampleContents[0] ?? null

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
    // Extracted from the whole file, before the slice above throws away the
    // part of the page the footer lives in.
    chrome: extractChrome(sampleContents),
    publishTemplate: null,
  }
}

/**
 * A React component identifier derived from the slug.
 *
 * The template needs a name for its default export, and the only thing it knows
 * about the page is its slug. `taxi-troyes-gare` becomes `TaxiTroyesGarePage`.
 *
 * Accents are folded and every non-alphanumeric character dropped: a JavaScript
 * identifier may not contain a hyphen, and `export default function Taxi-Troyes()`
 * is a syntax error the publisher would only discover in someone else's CI.
 */
export function componentNameFromSlug(slug: string): string {
  const pascal = slug
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  // An identifier cannot start with a digit. Stripping leading digits alone
  // would leave `24h-taxi` as `hTaxi`, valid but lowercase — so recapitalise
  // whatever character now leads. An empty result still has to yield something
  // valid, hence the neutral fallback.
  const stripped = pascal.replace(/^[0-9]+/, '')
  const safe = stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : ''
  return safe ? `${safe}Page` : 'SeoPage'
}

/**
 * Placeholders `fillTemplate` knows how to substitute.
 *
 * Kept next to the substitution itself so the analyzer prompt, this list and the
 * unresolved-placeholder guard below cannot drift apart.
 */
export const TEMPLATE_PLACEHOLDERS = [
  'TITLE', 'META_DESCRIPTION', 'SLUG', 'COMPONENT_NAME',
  'OG_TITLE', 'OG_DESCRIPTION', 'HTML_CONTENT',
  'FAQ_ITEMS_JSON', 'SCHEMA_JSON', 'PAGE_URL', 'SITE_URL',
] as const

export class TemplateSubstitutionError extends Error {
  constructor(readonly leftovers: string[]) {
    super(
      `Template non substituable : ${leftovers.join(', ')}. ` +
        `Placeholders reconnus : ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}. ` +
        `Re-analyser le depot pour regenerer le gabarit.`
    )
    this.name = 'TemplateSubstitutionError'
  }
}

/**
 * Positions where substituting a value produces code that cannot compile.
 *
 * These are checked on the TEMPLATE, before substitution, because afterwards the
 * damage is indistinguishable from ordinary text. Each entry is a mistake an
 * LLM-written template actually made against this repository.
 */
const TEMPLATE_MISUSES: Array<{ pattern: RegExp; why: string }> = [
  {
    // `export default function {{TITLE}}Page()` — the title is a French sentence
    // with spaces and accents, so the identifier is a syntax error. The guard
    // below cannot see it: {{TITLE}} IS a supported placeholder, so nothing is
    // left over to detect. Only {{COMPONENT_NAME}} yields a legal identifier.
    pattern: /export\s+default\s+function\s+\{\{(?!COMPONENT_NAME\}\})/,
    why: "l'export par defaut doit etre nomme avec {{COMPONENT_NAME}} — tout autre placeholder produit un identifiant invalide",
  },
  {
    // `subtitle="{{HTML_CONTENT}}"` — a full HTML body inside a double-quoted
    // JSX attribute. The first quote in the content closes the attribute.
    pattern: /=\s*"[^"]*\{\{(HTML_CONTENT|SCHEMA_JSON|FAQ_ITEMS_JSON)\}\}/,
    why: 'un contenu HTML ou JSON ne peut pas etre place dans un attribut entre guillemets : il le referme',
  },
]

export function fillTemplate(template: string, page: GeneratedPage, siteUrl: string): string {
  const pageUrl = `${siteUrl.replace(/\/$/, '')}/${page.slug}`
  const faqJson = JSON.stringify(page.faqItems || [], null, 2)
  const schemaJson = buildSchemaJson(page, pageUrl)

  const misuse = TEMPLATE_MISUSES.find((m) => m.pattern.test(template))
  if (misuse) throw new TemplateSubstitutionError([`gabarit invalide : ${misuse.why}`])

  const filled = template
    .replace(/\{\{TITLE\}\}/g, escapeJs(page.title))
    .replace(/\{\{META_DESCRIPTION\}\}/g, escapeJs(page.metaDescription))
    .replace(/\{\{SLUG\}\}/g, page.slug)
    .replace(/\{\{COMPONENT_NAME\}\}/g, componentNameFromSlug(page.slug))
    .replace(/\{\{OG_TITLE\}\}/g, escapeJs(page.ogTitle || page.title))
    .replace(/\{\{OG_DESCRIPTION\}\}/g, escapeJs(page.ogDescription || page.metaDescription))
    .replace(/\{\{HTML_CONTENT\}\}/g, escapeTemplate(page.htmlContent))
    .replace(/\{\{FAQ_ITEMS_JSON\}\}/g, faqJson)
    .replace(/\{\{SCHEMA_JSON\}\}/g, schemaJson)
    .replace(/\{\{PAGE_URL\}\}/g, pageUrl)
    .replace(/\{\{SITE_URL\}\}/g, siteUrl)

  // Refuse to ship a template that still carries a placeholder.
  //
  // The template is written by an LLM from a sample page in the repository, so
  // it can invent a placeholder nobody supports. That is what happened: the
  // model wrote `{{TITLE.replace(/ /g, '')}}` to name the component, the exact
  // `{{TITLE}}` regex did not match it, and the expression was committed
  // verbatim — `export default function {{TITLE.replace(…)}}Page()`. The build
  // failed in the client's own CI, several minutes after our side reported a
  // successful publication.
  //
  // Failing here costs one slot. Committing costs a broken repository, and the
  // engine has no way to know it happened.
  const leftovers = [...new Set(filled.match(/\{\{[^}]{0,80}\}\}/g) ?? [])]
  if (leftovers.length > 0) throw new TemplateSubstitutionError(leftovers)

  // Last line of defence, on the OUTPUT this time: whatever the template did,
  // the file we are about to commit must declare a default export whose name is
  // a legal JavaScript identifier. The checks above cover the mistakes we have
  // seen; this one covers the ones we have not.
  const defaultExport = filled.match(/export\s+default\s+function\s+([^\s(]*)/)
  if (defaultExport && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(defaultExport[1])) {
    throw new TemplateSubstitutionError([
      `identifiant d'export invalide apres substitution : "${defaultExport[1].slice(0, 60)}"`,
    ])
  }

  return filled
}

/**
 * A page built to break a fragile template.
 *
 * Deliberately hostile: the title is a French sentence with spaces, accents and
 * an apostrophe, so a template that names its component from it produces a
 * visibly illegal identifier; the HTML carries the double quote that closes a
 * JSX attribute. A template that survives this probe survives real content.
 */
const TEMPLATE_PROBE_PAGE = {
  title: "Comment réserver un taxi à l'aéroport",
  metaDescription: 'Réserver un taxi.',
  slug: 'comment-reserver-un-taxi-aeroport',
  focusKeyword: 'taxi aéroport',
  secondaryKeywords: [],
  ogTitle: "Taxi à l'aéroport",
  ogDescription: 'Réserver.',
  twitterTitle: 'Taxi',
  twitterDescription: 'Réserver.',
  htmlContent: '<h1 class="titre">Taxi</h1><p>Réservation "immédiate".</p>',
  schemaLocalBusiness: '{}',
  schemaFaqPage: '{}',
  schemaBreadcrumb: '{}',
  internalLinks: [],
  internalLinksHtml: [],
  faqItems: [],
  imageAlts: [],
  ctaText: '',
  targetLength: 1100,
  estimatedWordCount: 1100,
  readingTimeMinutes: 6,
} as GeneratedPage

/**
 * Dry-runs a template and returns why it is unusable, or `null` if it is fine.
 *
 * Called when the template is WRITTEN, not only when it is used. Storing a
 * broken template and discovering it at publication time costs a calendar slot
 * and — before the guard existed — a broken build in the client's repository.
 * The failure belongs at the moment someone clicks "analyser", where there is a
 * human watching and a retry costs nothing.
 */
export function validateTemplate(template: string): string | null {
  try {
    fillTemplate(template, TEMPLATE_PROBE_PAGE, 'https://exemple.fr')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'gabarit invalide'
  }
}

/**
 * Choose how to build the page, best available first.
 *
 * Synchronous and offline on purpose. The path this replaced asked gpt-4o-mini
 * to write the whole page.tsx at EVERY publication — a paid, non-deterministic
 * code-generation call standing between a finished article and its commit, whose
 * failure mode was a file that did not compile in someone else's repository.
 *
 * The scaffold is tried BEFORE a stored template because a stored template is,
 * by construction, what a model copied from a single example page: it carries
 * that page's own components into every other page. The scaffold copies only
 * what every page shares.
 */
function selectPageContent(
  profile: RepoProfile,
  page: GeneratedPage,
  siteUrl: string,
  pageType?: PageType
): { content: string; mode: PageBuildMode } {
  const pageUrl = `${siteUrl.replace(/\/$/, '')}/${page.slug}`

  // ─── The contract, when the site implements it ─────────────────────────────
  //
  // Tried first because it is the only path where the engine emits no
  // presentation at all: one import, one object, one element. There is no JSX to
  // get wrong, so the failure mode the other paths guard against cannot occur.
  const contract = profile.contract
  if (contract?.present && contract.adapterImport) {
    const { payload, fellBack } = buildContractPayload({ page, pageType, siteUrl })
    if (fellBack) {
      console.warn(
        `[publish] type de page « ${pageType ?? 'inconnu'} » non reconnu pour ${page.slug} : ` +
          `variante « ${payload.variant} » par defaut`
      )
    }
    return {
      content: emitContractPage({
        payload,
        componentName: componentNameFromSlug(page.slug),
        adapterImport: contract.adapterImport,
      }),
      mode: 'contrat',
    }
  }
  // Prefer the chrome captured at analysis time: it saw the whole file, while
  // `samplePageContent` is a 3000-character prefix that usually stops before the
  // footer. Falling back to it keeps profiles stored before this existed working.
  const chrome = profile.chrome ?? extractChrome([profile.samplePageContent])

  if (chrome.before.length > 0 || chrome.after.length > 0) {
    const scaffold = buildScaffold(
      {
        title: page.title,
        metaDescription: page.metaDescription,
        ogTitle: page.ogTitle || page.title,
        ogDescription: page.ogDescription || page.metaDescription,
        slug: page.slug,
        htmlContent: page.htmlContent,
        schemaJson: buildSchemaJson(page, pageUrl) || null,
        componentName: componentNameFromSlug(page.slug),
        pageUrl,
      },
      chrome,
      profile.layoutShell
    )
    return { content: scaffold.content, mode: 'charpente' }
  }

  if (profile.publishTemplate) {
    return { content: fillTemplate(profile.publishTemplate, page, siteUrl), mode: 'gabarit' }
  }

  return { content: buildFallbackPage(page, siteUrl, profile), mode: 'secours' }
}

/**
 * The floor: a page with nothing but its content.
 *
 * Reached when the repository's pages share no chrome to copy — which is a
 * failure on a site whose pages carry their own shell, and completely normal on
 * one whose `layout.tsx` wraps everything. The layout shell is passed in for
 * exactly that reason: on the second kind of site this page renders complete.
 */
function buildFallbackPage(page: GeneratedPage, siteUrl: string, profile: RepoProfile): string {
  const pageUrl = `${siteUrl.replace(/\/$/, '')}/${page.slug}`
  const scaffold = buildScaffold(
    {
      title: page.title,
      metaDescription: page.metaDescription,
      ogTitle: page.ogTitle || page.title,
      ogDescription: page.ogDescription || page.metaDescription,
      slug: page.slug,
      htmlContent: page.htmlContent,
      schemaJson: buildSchemaJson(page, pageUrl) || null,
      componentName: componentNameFromSlug(page.slug),
      pageUrl,
    },
    EMPTY_CHROME,
    profile.layoutShell
  )
  return scaffold.content
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

/**
 * Rewrite the generated route registry with this page in it.
 *
 * Read, upsert, render, commit — the whole file each time, rather than a string
 * insertion. The sitemap updater below finds its insertion point by counting
 * braces, which is correct right up until a comment contains one.
 *
 * A failure here does NOT fail the publication: the page is committed and
 * correct, it is merely not yet listed. Returning false says so.
 */
async function updateGeneratedRoutes(opts: {
  repoApi: string
  headers: Record<string, string>
  routesFile: string
  slug: string
  pageType?: PageType
  branch?: string
}): Promise<boolean> {
  const { repoApi, headers, routesFile, slug, pageType, branch } = opts

  try {
    const url = withRef(`${repoApi}/contents/${routesFile}`, branch)
    const existing = await fetch(url, { headers, cache: 'no-store' })

    let current: string | null = null
    let sha: string | undefined
    if (existing.ok) {
      const data = await existing.json()
      current = Buffer.from(data.content, 'base64').toString('utf-8')
      sha = data.sha
    }

    const { variant } = variantForPageType(pageType)
    const updated = upsertRoute(
      parseGeneratedRoutes(current),
      routeForPublication({
        path: `/${slug}`,
        variant,
        today: new Date().toISOString().slice(0, 10),
      })
    )

    // `./routes` relative to the generated file, which sits beside it.
    const rendered = renderGeneratedRoutes(updated, './routes')
    if (current === rendered) return true

    const res = await fetch(`${repoApi}/contents/${routesFile}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `seo-engine: index /${slug}`,
        content: Buffer.from(rendered).toString('base64'),
        sha,
        ...(branch ? { branch } : {}),
      }),
    })

    if (!res.ok) {
      console.warn(`[publish] registre de routes non mis a jour (GitHub ${res.status}) : /${slug} restera hors du sitemap`)
      return false
    }
    return true
  } catch (error) {
    console.warn(`[publish] registre de routes illisible :`, error instanceof Error ? error.message : error)
    return false
  }
}

/**
 * The page already at this path, if any.
 *
 * Returns the content as well as the SHA: the SHA is needed to overwrite, and
 * the content is needed to decide whether we are allowed to.
 */
async function readExistingPage(
  repoApi: string,
  headers: Record<string, string>,
  path: string,
  branch?: string
): Promise<{ sha: string; content: string } | null> {
  try {
    const res = await fetch(withRef(`${repoApi}/contents/${path}`, branch), { headers, cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf-8') }
  } catch {
    return null
  }
}

async function addToSitemap(repoApi: string, headers: Record<string, string>, sitemapPath: string, slug: string, branch?: string): Promise<boolean> {
  try {
    const res = await fetch(withRef(`${repoApi}/contents/${sitemapPath}`, branch), { headers, cache: 'no-store' })
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
      ...(branch ? { branch } : {}),
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
