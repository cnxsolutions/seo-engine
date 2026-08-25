// ─────────────────────────────────────────────────────────────────────────────
// Next.js publisher — template substitution
// SEO Engine - The engine commits TSX to someone else's repository.
// ─────────────────────────────────────────────────────────────────────────────
//
// A page that does not compile is the worst failure this publisher has: our side
// reports "published", and the defect surfaces minutes later in the client's CI
// with no link back to us. These tests lock the guard that prevents it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentNameFromSlug, fillTemplate, publishToNextJs, TemplateSubstitutionError, validateTemplate } from './nextjs'
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
})
