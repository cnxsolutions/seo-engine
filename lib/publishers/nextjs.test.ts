// ─────────────────────────────────────────────────────────────────────────────
// Next.js publisher — template substitution
// SEO Engine - The engine commits TSX to someone else's repository.
// ─────────────────────────────────────────────────────────────────────────────
//
// A page that does not compile is the worst failure this publisher has: our side
// reports "published", and the defect surfaces minutes later in the client's CI
// with no link back to us. These tests lock the guard that prevents it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentNameFromSlug, fillTemplate, pageFilePath, publishToNextJs, TemplateSubstitutionError, validateTemplate } from './nextjs'
import { GENERATED_MARKER } from './scaffold'
import type { GeneratedPage } from '@/lib/ai/openai'

const page = {
  title: 'Taxi à Troyes',
  metaDescription: 'Réserver un taxi à Troyes.',
  slug: 'reserver-taxi-troyes-gare',
  focusKeyword: 'taxi troyes',
  secondaryKeywords: [],
  ogTitle: 'Taxi Troyes',
  ogDescription: 'Réserver.',
  twitterTitle: 'Taxi Troyes',
  twitterDescription: 'Réserver.',
  htmlContent: '<h1>Taxi à Troyes</h1>',
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

// ─── Component identifier ────────────────────────────────────────────────────

describe('componentNameFromSlug', () => {
  it('builds a PascalCase identifier from a hyphenated slug', () => {
    expect(componentNameFromSlug('reserver-taxi-troyes-gare')).toBe('ReserverTaxiTroyesGarePage')
  })

  it('folds accents — an identifier cannot carry them', () => {
    expect(componentNameFromSlug('taxi-conventionné-troyes')).toBe('TaxiConventionneTroyesPage')
  })

  it('never starts with a digit', () => {
    // `export default function 24hTaxiPage()` is a syntax error.
    expect(componentNameFromSlug('24h-taxi')).toBe('HTaxiPage')
  })

  it('falls back to a neutral name on an unusable slug', () => {
    expect(componentNameFromSlug('---')).toBe('SeoPage')
    expect(componentNameFromSlug('')).toBe('SeoPage')
  })
})

// ─── Substitution ────────────────────────────────────────────────────────────

describe('fillTemplate', () => {
  it('substitutes every supported placeholder', () => {
    const out = fillTemplate(
      'export default function {{COMPONENT_NAME}}() { return "{{SLUG}} — {{TITLE}}" }',
      page,
      'https://taxidriver10.fr'
    )

    expect(out).toContain('function ReserverTaxiTroyesGarePage()')
    expect(out).toContain('reserver-taxi-troyes-gare')
    expect(out).not.toContain('{{')
  })

  it('REFUSES a template carrying an expression placeholder', () => {
    // The exact regression: an LLM-written template named its component
    // `{{TITLE.replace(/ /g, '')}}Page`. The `{{TITLE}}` regex does not match it,
    // so it was committed verbatim and the client's build died on
    // `export default function {{TITLE.replace(…)}}Page()`.
    expect(() =>
      fillTemplate(
        "export default function {{TITLE.replace(/ /g, '')}}Page() { return null }",
        page,
        'https://taxidriver10.fr'
      )
    ).toThrow(TemplateSubstitutionError)
  })

  it('names the offending placeholder so the operator can act', () => {
    try {
      fillTemplate('const x = {{UNKNOWN_THING}}', page, 'https://taxidriver10.fr')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateSubstitutionError)
      expect((error as TemplateSubstitutionError).message).toContain('{{UNKNOWN_THING}}')
      // The message must also say what IS supported, or the reader has to go
      // read the publisher to find out.
      expect((error as TemplateSubstitutionError).message).toContain('{{COMPONENT_NAME}}')
    }
  })

  it('reports every distinct leftover, not just the first', () => {
    try {
      fillTemplate('{{A}} {{B}} {{A}}', page, 'https://taxidriver10.fr')
      expect.unreachable('should have thrown')
    } catch (error) {
      const { leftovers } = error as TemplateSubstitutionError
      expect(leftovers).toEqual(['{{A}}', '{{B}}'])
    }
  })

  // ── Le HTML genere n'est pas du JSX ────────────────────────────────────────
  //
  // Colle tel quel dans le gabarit, le corps de page est lu comme du JSX :
  // `class` n'est pas `className`, `datetime` n'est pas `dateTime`. Six pages
  // ont casse le build du site client ainsi, pendant que le moteur affichait
  // « en ligne ».

  it('emet le corps de page via dangerouslySetInnerHTML quand il est un enfant JSX', () => {
    const html = '<p class="intro">Réservation "immédiate" {à Troyes}</p><time datetime="2026-01-01">x</time>'
    const out = fillTemplate('<div className="prose">{{HTML_CONTENT}}</div>', { ...page, htmlContent: html }, 'https://t.fr')

    expect(out).toBe(`<div className="prose"><div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(html)} }} /></div>`)
  })

  it('garde la forme chaine quand le gabarit entoure le placeholder de backticks', () => {
    const out = fillTemplate(
      'const content = `{{HTML_CONTENT}}`',
      { ...page, htmlContent: '<p class="a">`x` ${y}</p>' },
      'https://t.fr'
    )
    expect(out).toBe('const content = `<p class="a">\\`x\\` \\${y}</p>`')
  })

  it('emet la FAQ dans la forme que le gabarit declare', () => {
    const faq = { ...page, faqItems: [{ q: 'Q ?', a: 'R.' }] }
    const declared = fillTemplate('const faqItems: Array<{ question: string; answer: string }> = {{FAQ_ITEMS_JSON}};', faq, 'https://t.fr')
    expect(JSON.parse(declared.slice(declared.indexOf('['), -1))).toEqual([{ question: 'Q ?', answer: 'R.' }])

    const engine = fillTemplate('const faqItems = {{FAQ_ITEMS_JSON}};', faq, 'https://t.fr')
    expect(JSON.parse(engine.slice(engine.indexOf('['), -1))).toEqual([{ q: 'Q ?', a: 'R.' }])
  })

  it('laisse passer un objet JSX a double accolade, qui n est pas un placeholder', () => {
    const out = fillTemplate(
      'export default function {{COMPONENT_NAME}}() { return <script dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} /> }',
      page,
      'https://taxidriver10.fr'
    )
    expect(out).toContain('{{ __html: JSON.stringify(schema) }}')
  })

  it('leaves ordinary JSX braces alone', () => {
    // Single braces are JSX, not placeholders — the guard must not fire on them.
    const out = fillTemplate(
      'export default function {{COMPONENT_NAME}}() { return <div>{value}</div> }',
      page,
      'https://taxidriver10.fr'
    )
    expect(out).toContain('{value}')
  })
})

// ─── Known placeholders in illegal positions ─────────────────────────────────
//
// The leftover-scan above only catches placeholders nobody supports. These are
// SUPPORTED placeholders used where their value cannot legally go — the output
// carries no `{{`, so nothing was left to detect, and the build died anyway.

describe('fillTemplate — gabarits invalides', () => {
  it('refuse un export par defaut nomme avec {{TITLE}}', () => {
    // The second regression, from the regenerated template: the title is a
    // French sentence, so this produced
    // `export default function Comment réserver un taxi à Troyes…Page()`.
    expect(() =>
      fillTemplate('export default function {{TITLE}}Page() { return null }', page, 'https://x.fr')
    ).toThrow(/COMPONENT_NAME/)
  })

  it('accepte {{COMPONENT_NAME}} au meme endroit', () => {
    const out = fillTemplate(
      'export default function {{COMPONENT_NAME}}() { return null }',
      page,
      'https://x.fr'
    )
    expect(out).toContain('function ReserverTaxiTroyesGarePage()')
  })

  it('refuse du HTML dans un attribut entre guillemets', () => {
    // `subtitle="{{HTML_CONTENT}}"` — the first quote inside the body closes
    // the attribute and everything after it becomes stray JSX.
    expect(() =>
      fillTemplate(
        'export default function {{COMPONENT_NAME}}() { return <Hero subtitle="{{HTML_CONTENT}}" /> }',
        page,
        'https://x.fr'
      )
    ).toThrow(/attribut/)
  })

  it('laisse passer le JSON en accolades, qui est la forme correcte', () => {
    // `customFaqs={{{FAQ_ITEMS_JSON}}}` is `{` + placeholder + `}` — valid JSX.
    const out = fillTemplate(
      'export default function {{COMPONENT_NAME}}() { return <Faq items={{{FAQ_ITEMS_JSON}}} /> }',
      page,
      'https://x.fr'
    )
    expect(out).toContain('items={[]}')
  })

  it('rejette tout identifiant d export illegal, meme inattendu', () => {
    // The catch-all: no known misuse pattern matches, but the result is still
    // not a legal identifier.
    expect(() =>
      fillTemplate('export default function Taxi-Troyes() { return null }', page, 'https://x.fr')
    ).toThrow(/identifiant d'export invalide/)
  })
})

// ─── Validation à l'écriture ─────────────────────────────────────────────────
//
// The guard above fires at publication time, which costs a calendar slot. This
// one fires when the template is stored, where a human is watching.

describe('validateTemplate', () => {
  it('accepte un gabarit correct', () => {
    expect(
      validateTemplate('export default function {{COMPONENT_NAME}}() { return <div>{{TITLE}}</div> }')
    ).toBeNull()
  })

  it('rejette les deux gabarits qui ont casse le build en production', () => {
    expect(validateTemplate("export default function {{TITLE.replace(/ /g, '')}}Page() {}")).toContain(
      'gabarit'
    )
    expect(validateTemplate('export default function {{TITLE}}Page() {}')).toContain('COMPONENT_NAME')
  })

  it('rend la raison, pas seulement un booleen', () => {
    // The operator reads this string in the UI; "false" would tell them nothing.
    const why = validateTemplate('export default function {{COMPONENT_NAME}}() { return {{NOPE}} }')
    expect(why).toContain('{{NOPE}}')
  })
})

// ─── Ne jamais ecraser une page ecrite a la main ─────────────────────────────
//
// The commit is an upsert on a path built from a generated slug. A slug that
// collides with an existing route replaces that route's source file, and the
// engine reports success. It nearly happened for real: a cleaned-up pillar slug
// came out as `/taxi-troyes`, a page the site already served.

describe('publishToNextJs — collision de slug', () => {
  const PROFILE = {
    router: 'app' as const,
    srcPrefix: 'src/',
    pageFolder: 'src/app/(seo)',
    sitemapPath: null,
    sitemapFormat: null,
    layoutPath: null,
    componentsPath: null,
    sharedComponents: [],
    samplePagePath: null,
    samplePageContent: null,
    publishTemplate: null,
  }

  const options = {
    githubRepo: 'cnxsolutions/taxidriver10',
    githubToken: 'x',
    page,
    siteUrl: 'https://taxidriver10.fr',
    repoProfile: PROFILE,
  }

  /** Answer the existence check with a file we did or did not write. */
  function repoServing(pageSource: string | null) {
    const commits: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        commits.push(String(url))
        return new Response(JSON.stringify({ content: { html_url: 'x' }, commit: { sha: 'y' } }), { status: 200 })
      }
      if (pageSource === null) return new Response('{}', { status: 404 })
      return new Response(
        JSON.stringify({ sha: 'abc', content: Buffer.from(pageSource).toString('base64') }),
        { status: 200 }
      )
    }))
    return { commits }
  }

  afterEach(() => vi.unstubAllGlobals())

  it('refuse d ecraser une page que le moteur n a pas ecrite', async () => {
    const { commits } = repoServing('export default function TaxiTroyes() { return <div>ecrit a la main</div> }')
    const result = await publishToNextJs(options)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/n'a pas ete ecrite par le moteur/)
    expect(commits).toHaveLength(0)
  })

  it('accepte de remplacer une page qu il a ecrite', async () => {
    const { commits } = repoServing(`${GENERATED_MARKER}\nexport default function X() { return null }`)
    const result = await publishToNextJs(options)

    expect(result.success).toBe(true)
    expect(commits).toHaveLength(1)
  })

  it('publie normalement quand le chemin est libre', async () => {
    const { commits } = repoServing(null)
    expect((await publishToNextJs(options)).success).toBe(true)
    expect(commits).toHaveLength(1)
  })

  // ── `replaces` : une CLE, jamais un interrupteur ───────────────────────────
  //
  // Le pendant Next.js de `TargetOptions.replaces`. Le garde ci-dessus protege
  // les pages ecrites a la main ; celui-ci decide QUAND il se leve. La seule
  // propriete qui compte est que la levee soit NOMINATIVE : une cle qui ouvre
  // n'importe quelle porte est `force` sous un autre nom, et ce depot contient
  // les pages que le proprietaire a ecrites lui-meme.

  it('deverrouille la page du proprietaire que `replaces` NOMME', async () => {
    const { commits } = repoServing('export default function Fait() { return <div>a la main</div> }')

    const result = await publishToNextJs({ ...options, replaces: { path: '/reserver-taxi-troyes-gare' } })

    expect(result.success).toBe(true)
    expect(commits).toHaveLength(1)
  })

  it('refuse quand `replaces` nomme une AUTRE page que celle qu on commite', async () => {
    // La moitie qui porte la surete. Le premier test ne prouve que l'ouverture ;
    // sans celui-ci, un `replaces` renseigne au hasard vaudrait permission
    // generale sur tout le depot.
    const { commits } = repoServing('export default function Fait() { return <div>a la main</div> }')

    const result = await publishToNextJs({ ...options, replaces: { path: '/contact' } })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/n'a pas ete ecrite par le moteur/)
    expect(commits).toHaveLength(0)
  })

  it('tolere le slash et la casse, et rien d autre', async () => {
    // `/Reserver-Taxi-Troyes-Gare/` et `reserver-taxi-troyes-gare` viennent de
    // deux ecrans et designent la meme page. Refuser sur l'orthographe pousserait
    // l'operateur vers `force`, seul resultat que ce dispositif evite.
    const { commits } = repoServing('export default function Fait() { return <div>a la main</div> }')

    const result = await publishToNextJs({ ...options, replaces: { path: '/Reserver-Taxi-Troyes-Gare/' } })

    expect(result.success).toBe(true)
    expect(commits).toHaveLength(1)
  })

  it('ne deverrouille rien par PREFIXE', async () => {
    // `/reserver` est un prefixe du slug. Une comparaison laxiste transformerait
    // un chemin court en passe-partout sur toute une branche du site.
    const { commits } = repoServing('export default function Fait() { return <div>a la main</div> }')

    const result = await publishToNextJs({ ...options, replaces: { path: '/reserver' } })

    expect(result.success).toBe(false)
    expect(commits).toHaveLength(0)
  })

  // ── Site sans groupe de routes : `pageFolder` stocke avec un slash final ────
  //
  // L'analyseur enregistrait `src/app/` pour un site sans `(seo)`. Le chemin
  // devenait `src/app//slug/page.tsx`, GitHub repondait 422 « malformed path
  // component », et la meme publication echouait tous les quarts d'heure.

  const SANS_GROUPE = { ...options, repoProfile: { ...PROFILE, pageFolder: 'src/app/' } }

  it('commite sur un chemin sans double slash quand le dossier finit par /', async () => {
    const { commits } = repoServing(null)

    expect((await publishToNextJs(SANS_GROUPE)).success).toBe(true)
    expect(commits).toEqual([
      'https://api.github.com/repos/cnxsolutions/taxidriver10/contents/src/app/reserver-taxi-troyes-gare/page.tsx',
    ])
  })

  it('voit la page ecrite a la main au meme chemin, et refuse de l ecraser', async () => {
    // Le controle d'existence lisait le meme chemin casse, et GitHub repond 404
    // a une lecture sur `//` (verifie sur l'API) : il ne trouvait jamais rien,
    // et le garde contre l'ecrasement etait aveugle.
    const commits: string[] = []
    const source = 'export default function Fait() { return <div>a la main</div> }'
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        commits.push(String(url))
        return new Response('{}', { status: 200 })
      }
      if (String(url).split('/contents/')[1]?.includes('//')) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify({ sha: 'abc', content: Buffer.from(source).toString('base64') }), { status: 200 })
    }))

    const result = await publishToNextJs(SANS_GROUPE)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/n'a pas ete ecrite par le moteur/)
    expect(commits).toHaveLength(0)
  })
})

describe('pageFilePath', () => {
  it('joint dossier et slug avec un seul slash', () => {
    expect(pageFilePath('src/app/(seo)', 'taxi-troyes')).toBe('src/app/(seo)/taxi-troyes/page.tsx')
    expect(pageFilePath('src/app/', 'taxi-troyes')).toBe('src/app/taxi-troyes/page.tsx')
    expect(pageFilePath('app//', 'taxi-troyes')).toBe('app/taxi-troyes/page.tsx')
  })
})

describe('publishToNextJs — image d en-tete', () => {
  const PROFILE = {
    router: 'app' as const,
    appRoot: 'nextjs/',
    srcPrefix: 'nextjs/src/',
    pageFolder: 'nextjs/src/app/(public)',
    sitemapPath: null,
    sitemapFormat: null,
    layoutPath: null,
    componentsPath: null,
    sharedComponents: [],
    samplePagePath: null,
    samplePageContent: null,
    publishTemplate: null,
  }
  const options = {
    githubRepo: 'cnxsolutions/foodflow',
    githubToken: 'x',
    page,
    siteUrl: 'https://www.flowyne.com',
    repoProfile: PROFILE,
  }
  const IMAGE_PATH = `nextjs/public/images/seo/${page.slug}.webp`

  /** A repository with or without the photo already in it; every PUT is recorded. */
  function repo(imageExists: boolean) {
    const puts: Array<{ url: string; body: { content: string } }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push({ url: String(url), body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify({ content: { html_url: 'x' }, commit: { sha: 'y' } }), { status: 200 })
      }
      if (String(url).includes('/images/seo/') && imageExists) return new Response(JSON.stringify({ sha: 'img' }), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
    return puts
  }

  const photo = vi.fn(async () => ({
    data: Buffer.from('webp-bytes'), format: 'webp' as const, mimeType: 'image/webp' as const,
    width: 1536, height: 1024, alt: 'Un taxi devant la gare',
  }))

  afterEach(() => {
    vi.unstubAllGlobals()
    photo.mockClear()
  })

  it('commite la photo AVANT la page, sous public/ de l application, et la page la montre', async () => {
    const puts = repo(false)

    const result = await publishToNextJs({ ...options, heroImage: photo })

    expect(result.success).toBe(true)
    expect(photo).toHaveBeenCalledWith('webp')
    expect(puts[0].url).toContain(`/contents/${IMAGE_PATH}`)
    expect(Buffer.from(puts[0].body.content, 'base64').toString()).toBe('webp-bytes')
    expect(Buffer.from(puts[1].body.content, 'base64').toString()).toContain(`/images/seo/${page.slug}.webp`)
    expect(result.heroImage).toBe(`/images/seo/${page.slug}.webp`)
  })

  it('reprend une photo deja presente sans en generer une autre', async () => {
    const puts = repo(true)

    const result = await publishToNextJs({ ...options, heroImage: photo })

    expect(photo).not.toHaveBeenCalled()
    expect(puts).toHaveLength(1)
    expect(result.heroImage).toBe(`/images/seo/${page.slug}.webp`)
  })

  it('publie la page sans image quand la generation echoue', async () => {
    const puts = repo(false)

    const result = await publishToNextJs({ ...options, heroImage: async () => null })

    expect(result.success).toBe(true)
    expect(puts).toHaveLength(1)
    expect(Buffer.from(puts[0].body.content, 'base64').toString()).not.toContain('/images/seo/')
    expect(result.heroImage).toBeUndefined()
  })
})
