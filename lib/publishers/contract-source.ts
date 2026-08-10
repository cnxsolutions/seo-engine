// ─────────────────────────────────────────────────────────────────────────────
// The files the site owner pastes into their repository
// SEO Engine - Proposed, never committed by the engine.
// ─────────────────────────────────────────────────────────────────────────────
//
// The engine writes these to the screen, not to GitHub. Committing an adapter
// would put the engine back in the business of writing code it cannot compile —
// the exact thing the contract exists to stop. The site owner pastes them, runs
// their own build, and only then does the engine change how it publishes.
//
// NOTHING here knows any component by name.
//
// The first version did, and it worked beautifully for exactly one repository:
// `PremiumHero`, `PageContent`, `PremiumFAQ` were written into a list, so a
// second site whose components are called `Header` and `Hero` would have got a
// manifest, a build step, and an empty page. Everything below is now derived —
// the shell from the components the site's own pages share, the props from the
// interfaces the site itself declares, the theme class from the site's `<main>`.

import { CONTRACT_VARIANTS, CONTRACT_VERSION, MANIFEST_PATH } from './contract'
import { renderGeneratedRoutes } from './routes-file'
import { bindProps, type PropSignature } from './props'
import { isRecurring, type PageChrome } from './scaffold'

export interface ContractFile {
  path: string
  language: 'tsx' | 'json'
  /** Shown above the code block, in the UI. */
  why: string
  content: string
}

export interface AdapterOptions {
  /** Where the adapter will live, e.g. `src/components/seo-engine`. */
  adapterFolder: string
  /** Where generated pages are committed, e.g. `src/app/(seo)`. */
  pageFolder: string
  /** `src/` when the repo keeps its sources there, empty otherwise. */
  srcPrefix: string
  /** The shell the analysis read out of the site's existing pages. */
  chrome: PageChrome
  /** Prop signatures read from the site's own component sources. */
  componentProps: Record<string, PropSignature[]>
  /**
   * What `layout.tsx` already wraps every page in.
   *
   * An adapter that opens `<main>` under a layout that already has one nests
   * two main landmarks, and one that mounts a header the layout mounts shows it
   * twice.
   */
  layoutShell?: { hasMain: boolean; components: string[]; wraps: boolean }
}

/** One component the generated adapter will mount, and how. */
interface Mount {
  name: string
  importLine: string
  /** Rendered attributes, already formatted. Empty for a bare mount. */
  attributes: string[]
}

/** A component the site clearly uses but that we refuse to fill in blind. */
interface Skipped {
  name: string
  unfilled: string[]
}

export function buildContractFiles(opts: AdapterOptions): ContractFile[] {
  const { mounts, skipped } = planMounts(opts)
  const routesFile = `${opts.srcPrefix}lib/seo/routes.generated.ts`

  return [
    {
      path: `${opts.adapterFolder}/SeoEnginePage.tsx`,
      language: 'tsx',
      why:
        "Le composant qui recoit les pages generees. C'est LUI qui decide du rendu : " +
        'le moteur ne commite plus une seule ligne de mise en page. Modifie-le librement, ' +
        'le moteur ne le reecrira jamais.',
      content: adapterSource(opts, mounts, skipped),
    },
    {
      // Seeded empty, on purpose.
      //
      // The engine rewrites this file at every publication, but the import in
      // `routes.ts` has to resolve BEFORE the first one — otherwise adding that
      // import breaks the site's build and it stays broken until a page is
      // published, which is the wrong order for everything.
      path: routesFile,
      language: 'tsx',
      why:
        'Amorce vide du registre des pages generees. Le moteur le reecrit en entier a chaque ' +
        'publication ; il existe des maintenant pour que l’import dans routes.ts compile avant ' +
        'meme la premiere page.',
      content: renderGeneratedRoutes([], './routes'),
    },
    {
      path: MANIFEST_PATH,
      language: 'json',
      why:
        'Le manifeste, a la racine. Sa presence est ce qui dit au moteur que ce depot ' +
        'implemente le contrat. Sans lui, la publication retombe sur la charpente ' +
        '(navigation et pied de page uniquement).',
      content: `${JSON.stringify(
        {
          contractVersion: CONTRACT_VERSION,
          adapter: `${opts.adapterFolder}/SeoEnginePage`,
          pageFolder: opts.pageFolder,
          variants: CONTRACT_VARIANTS,
          routesFile,
        },
        null,
        2
      )}\n`,
    },
  ]
}

/**
 * Decide what the adapter mounts, from the repository alone.
 *
 * Two kinds of component qualify, and they qualify for different reasons:
 *
 *  - SHARED ones — mounted bare on every sample page — are mounted bare here.
 *    No signature needed: the site itself proves they take nothing.
 *  - UBIQUITOUS ones carrying props are mounted only when every REQUIRED prop
 *    binds to something the payload holds. A hero needing `title` gets it; a
 *    business card needing `distance` does not, so it is skipped and named in
 *    the file rather than fed an empty string.
 */
function planMounts(opts: AdapterOptions): { mounts: Mount[]; skipped: Skipped[] } {
  const mounts: Mount[] = []
  const skipped: Skipped[] = []
  // Shared across the whole adapter: a value already displayed by one component
  // does not get shown again by the next.
  const used = new Set<string>()

  const providedByLayout = new Set(opts.layoutShell?.components ?? [])

  for (const component of opts.chrome.layout) {
    if (providedByLayout.has(component.name)) continue

    if (component.shared) {
      mounts.push({ name: component.name, importLine: component.importLine, attributes: [] })
      continue
    }

    if (!isRecurring(component, opts.chrome.sampleCount)) continue

    const props = opts.componentProps[component.name]
    if (!props || props.length === 0) continue

    const decision = bindProps(props, used)
    if (!decision.mountable) {
      skipped.push({ name: component.name, unfilled: decision.unfilled })
      continue
    }
    if (decision.bound.length === 0) continue

    mounts.push({
      name: component.name,
      importLine: component.importLine,
      attributes: decision.bound.map((prop) => `${prop.name}={${prop.expression}}`),
    })
  }

  return { mounts, skipped }
}

function adapterSource(opts: AdapterOptions, mounts: Mount[], skipped: Skipped[]): string {
  const imports = mounts.map((mount) => mount.importLine).join('\n')

  // The article goes where the site's own pages put their content: after the
  // last component that appears above the body, before the footer. `after`
  // holds exactly the chrome that sits below it.
  const belowNames = new Set(opts.chrome.after)
  const above = mounts.filter((mount) => !belowNames.has(mount.name))
  const below = mounts.filter((mount) => belowNames.has(mount.name))

  const wrapInMain = !opts.layoutShell?.hasMain
  const wrapperClass = opts.chrome.wrapperClass
  const openMain = !wrapInMain
    ? '<>'
    : wrapperClass
      ? `<main className="${wrapperClass}">`
      : '<main>'
  const closeMain = wrapInMain ? '</main>' : '</>'
  const bodyWrapper = opts.chrome.containerClass
    ? [
        `      <section className="${opts.chrome.containerClass}">`,
        `        <div dangerouslySetInnerHTML={{ __html: payload.bodyHtml }} />`,
        `      </section>`,
      ]
    : [`      <div dangerouslySetInnerHTML={{ __html: payload.bodyHtml }} />`]

  const body = [
    ...above.map(renderMount),
    '      {payload.bodyHtml ? (',
    '        <>',
    ...bodyWrapper.map((line) => `  ${line}`),
    '        </>',
    '      ) : null}',
    ...below.map(renderMount),
  ].join('\n')

  const todo = skipped.length
    ? `\n *\n * Composants de ce site NON montes, faute de pouvoir remplir leurs props\n * obligatoires depuis le payload — a brancher toi-meme si tu veux les voir :\n${skipped
        .map((entry) => ` *   - ${entry.name} (manque : ${entry.unfilled.join(', ')})`)
        .join('\n')}`
    : ''

  return `import type { Metadata } from 'next'
${imports}

/**
 * Recepteur des pages generees par SEO Engine.
 *
 * Le moteur ne commite plus de JSX : il commite un objet \`payload\` et laisse ce
 * fichier decider du rendu. Trois consequences :
 *
 *   - la mise en page des pages generees se change ICI, en un seul endroit,
 *     sans toucher au moteur ni republier quoi que ce soit ;
 *   - une page generee ne peut plus casser le build avec du JSX invalide, parce
 *     qu'elle n'en contient plus ;
 *   - \`npm run build\` de ce depot redevient la seule autorite sur le rendu.
 *
 * Ce fichier a ete genere a partir de TES pages : composants, ordre, classes et
 * props ont ete lus dans ce depot, jamais supposes.${todo}
 *
 * Le champ \`variant\` porte la famille de mise en page demandee. Le rendu est
 * identique pour les trois aujourd'hui : c'est le point de depart a specialiser.
 */
export interface SeoEnginePayload {
  contractVersion: number
  variant: ${CONTRACT_VARIANTS.map((v) => `'${v}'`).join(' | ')}
  /** Chemin relatif, jamais une URL absolue. */
  path: string
  title: string
  keyword: string
  description: string
  hero: { badge?: string; subtitle?: string }
  introText: string
  mainContent: string
  bodyHtml: string
  internalLinks: Array<{ label: string; href: string }>
  faq: Array<{ question: string; answer: string }>
  breadcrumbs: Array<{ name: string; url: string }>
  ctaText?: string
}

/**
 * Metadonnees de la page.
 *
 * Next.js exige que \`metadata\` soit exporte depuis le fichier page.tsx, donc la
 * page generee appelle cette fonction. Branche-la sur ton generateur de
 * metadonnees si tu veux que les pages generees heritent des memes reglages que
 * les autres.
 */
export function seoEngineMetadata(payload: SeoEnginePayload): Metadata {
  return {
    title: payload.title,
    description: payload.description,
    alternates: { canonical: payload.path },
    openGraph: {
      title: payload.title,
      description: payload.description,
      url: payload.path,
      type: 'article',
    },
  }
}

export default function SeoEnginePage({ payload }: { payload: SeoEnginePayload }) {
  return (
    ${openMain}
${body}
    ${closeMain}
  )
}
`
}

function renderMount(mount: Mount): string {
  if (mount.attributes.length === 0) return `      <${mount.name} />`
  if (mount.attributes.length <= 2) return `      <${mount.name} ${mount.attributes.join(' ')} />`
  return [
    `      <${mount.name}`,
    ...mount.attributes.map((attribute) => `        ${attribute}`),
    `      />`,
  ].join('\n')
}
