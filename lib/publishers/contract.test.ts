// ─────────────────────────────────────────────────────────────────────────────
// Publication contract, v1
// SEO Engine - The emitted page is type-checked here, not in the client's CI.
// ─────────────────────────────────────────────────────────────────────────────
//
// Twice, a page that this engine reported as published turned out not to
// compile, and the client's deployment discovered it minutes later. The
// assertions below run the TypeScript compiler over the exact file the engine
// would commit, against a declaration of the contract, so the answer is known
// before the commit rather than after it.

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  buildContractPayload,
  CONTRACT_VERSION,
  emitContractPage,
  parseInternalLinks,
  splitArticle,
  variantForPageType,
  type ContractPayload,
} from './contract'
import type { GeneratedPage } from '@/lib/ai/openai'

// ─── Type-checking harness ───────────────────────────────────────────────────

/** What the site's adapter promises. Mirrors the pasted SeoEnginePage.tsx. */
const ADAPTER_DTS = `
// Declared here because the sandbox has no lib and no node_modules: without it
// every JSX element reports a missing runtime, which would drown the
// diagnostics the assertions are actually about.
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [name: string]: unknown }
}
declare module 'next' {
  export interface Metadata { title?: string; description?: string; [k: string]: unknown }
}
declare module '@/components/seo-engine/SeoEnginePage' {
  import type { Metadata } from 'next'
  export interface SeoEnginePayload {
    contractVersion: number
    variant: 'pilier' | 'local' | 'comparatif'
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
  export function seoEngineMetadata(payload: SeoEnginePayload): Metadata
  export default function SeoEnginePage(props: { payload: SeoEnginePayload }): JSX.Element
}
`

/** Compile one emitted page against the adapter declaration. Returns the errors. */
function typeCheck(pageSource: string): string[] {
  const files: Record<string, string> = {
    '/adapter.d.ts': ADAPTER_DTS,
    '/page.tsx': pageSource,
  }

  const host: ts.CompilerHost = {
    fileExists: (f) => f in files,
    readFile: (f) => files[f],
    getSourceFile: (f, lang) =>
      f in files ? ts.createSourceFile(f, files[f], lang, true) : undefined,
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }

  const program = ts.createProgram(['/adapter.d.ts', '/page.tsx'], {
    jsx: ts.JsxEmit.Preserve,
    strict: true,
    noEmit: true,
    // No lib and no node_modules in this sandbox: only the contract surface is
    // under test, so anything the compiler cannot resolve on its own is noise.
    noLib: true,
    types: [],
    skipLibCheck: true,
  }, host)

  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === '/page.tsx')
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PAGE = {
  title: "Taxi à l'aéroport de Troyes",
  metaDescription: 'Réserver un taxi pour l’aéroport.',
  slug: 'taxi-aeroport-troyes',
  focusKeyword: 'taxi aéroport troyes',
  secondaryKeywords: [],
  ogTitle: 'Taxi aéroport',
  ogDescription: 'Transfert aéroport depuis Troyes.',
  twitterTitle: 'Taxi',
  twitterDescription: 'Transfert.',
  htmlContent:
    '<h1>Taxi aéroport</h1>' +
    '<p class="reponse-directe">Réponse directe en une phrase.</p>' +
    '<p>Un second paragraphe de contexte.</p>' +
    '<h2>Tarifs</h2><p>Le tarif dépend du trajet.</p>' +
    '<h2>Réservation</h2><p>Appelez-nous.</p>',
  schemaLocalBusiness: '{}',
  schemaFaqPage: '{}',
  schemaBreadcrumb: '{}',
  internalLinks: [{ anchor: 'Taxi Aube', suggestion: 'page-fille-taxi-aube' }],
  internalLinksHtml: ['<a href="https://taxidriver10.fr/taxi-aube">Taxi dans l’Aube</a>'],
  faqItems: [{ q: 'Quel tarif ?', a: 'Cela dépend du trajet.' }],
  imageAlts: [],
  ctaText: 'Réserver maintenant',
  targetLength: 1100,
  estimatedWordCount: 1100,
  readingTimeMinutes: 6,
  directAnswer: 'Réponse directe en une phrase.',
} as GeneratedPage

const ADAPTER_IMPORT = '@/components/seo-engine/SeoEnginePage'

function emit(page: GeneratedPage, pageType: Parameters<typeof variantForPageType>[0]): string {
  const { payload } = buildContractPayload({ page, pageType, siteUrl: 'https://taxidriver10.fr' })
  return emitContractPage({ payload, componentName: 'TaxiAeroportTroyesPage', adapterImport: ADAPTER_IMPORT })
}

// ─── Variants ────────────────────────────────────────────────────────────────

describe('variantForPageType', () => {
  it('regroupe cinq types editoriaux en trois mises en page', () => {
    expect(variantForPageType('pillar').variant).toBe('pilier')
    expect(variantForPageType('child').variant).toBe('local')
    expect(variantForPageType('local_pack').variant).toBe('local')
    expect(variantForPageType('alternative').variant).toBe('comparatif')
    expect(variantForPageType('comparative').variant).toBe('comparatif')
  })

  it('signale le repli au lieu de le subir', () => {
    // Legacy rows carry no page_type. Defaulting is fine; defaulting silently is
    // how nobody notices every page renders the same way.
    const fallback = variantForPageType(undefined)
    expect(fallback.variant).toBe('local')
    expect(fallback.fellBack).toBe(true)
    expect(variantForPageType('pillar').fellBack).toBe(false)
  })
})

// ─── Content splitting ───────────────────────────────────────────────────────

describe('splitArticle', () => {
  it('coupe au premier h2 et rend le debut en texte brut', () => {
    const { lead, rest } = splitArticle(PAGE.htmlContent)
    expect(lead).toBe('Réponse directe en une phrase.\n\nUn second paragraphe de contexte.')
    expect(rest.startsWith('<h2>Tarifs</h2>')).toBe(true)
  })

  it('laisse tomber le h1 : le hero du site le rend deja', () => {
    // Two H1s on one page is a defect, and the site's hero component owns that
    // heading.
    const { lead, rest } = splitArticle(PAGE.htmlContent)
    expect(lead).not.toContain('Taxi aéroport')
    expect(rest).not.toContain('<h1')
  })

  it('supporte un article sans aucun h2', () => {
    const { lead, rest } = splitArticle('<h1>T</h1><p>Seul paragraphe.</p>')
    expect(lead).toBe('Seul paragraphe.')
    expect(rest).toBe('')
  })
})

describe('parseInternalLinks', () => {
  it('lit les vraies ancres plutot que les identifiants de planification', () => {
    // `internalLinks[].suggestion` holds things like `page-fille-taxi-aube`,
    // which is a planning id and would 404 if used as an href.
    expect(parseInternalLinks(PAGE.internalLinksHtml)).toEqual([
      { label: 'Taxi dans l’Aube', href: 'https://taxidriver10.fr/taxi-aube' },
    ])
  })

  it('deduplique et ignore ce qui n est pas une ancre', () => {
    const links = parseInternalLinks([
      '<a href="/a">Un</a>',
      '<a href="/a">Un bis</a>',
      'pas une ancre',
    ])
    expect(links).toEqual([{ label: 'Un', href: '/a' }])
  })

  it('ne leve pas sur une entree absente', () => {
    expect(parseInternalLinks(undefined)).toEqual([])
  })
})

// ─── Payload ─────────────────────────────────────────────────────────────────

describe('buildContractPayload', () => {
  it('emet un chemin relatif, jamais une URL absolue', () => {
    // An absolute URL here reaches the site's route registry and its sitemap,
    // where it would be concatenated with the origin a second time.
    const { payload } = buildContractPayload({ page: PAGE, pageType: 'local_pack', siteUrl: 'https://taxidriver10.fr' })
    expect(payload.path).toBe('/taxi-aeroport-troyes')
  })

  it('traduit {q,a} vers {question,answer}, la forme que le site attend', () => {
    const { payload } = buildContractPayload({ page: PAGE, pageType: 'child', siteUrl: 'https://x.fr' })
    expect(payload.faq).toEqual([{ question: 'Quel tarif ?', answer: 'Cela dépend du trajet.' }])
  })

  it('ne duplique pas la reponse directe entre l intro et le corps', () => {
    const { payload } = buildContractPayload({ page: PAGE, pageType: 'child', siteUrl: 'https://x.fr' })
    expect(payload.introText).toBe('Réponse directe en une phrase.')
    expect(payload.mainContent).toContain('Un second paragraphe')
  })

  it('ne repete pas la reponse directe en tete du corps', () => {
    // Observed on the first page really published under the contract: introText
    // and the opening paragraph of mainContent were the same sentence, so the
    // live page said it twice in a row. `directAnswer` is duplicated out of
    // `htmlContent` upstream by design, so the lead necessarily contains it.
    const { payload } = buildContractPayload({ page: PAGE, pageType: 'child', siteUrl: 'https://x.fr' })
    expect(payload.mainContent).not.toContain(payload.introText)
    expect(payload.mainContent).toBe('Un second paragraphe de contexte.')
  })

  it('reconnait la reponse directe malgre les liens retires du HTML', () => {
    // The stored answer is plain text; the same paragraph read back from the
    // article has had its anchors stripped, so spacing and punctuation drift.
    // Exact equality would miss it and the duplicate would survive.
    const avecLien = {
      ...PAGE,
      directAnswer: 'Pour reserver un taxi a Troyes, Taxidriver10 propose une prise en charge sur la ville et ses gares.',
      htmlContent:
        '<h1>T</h1>' +
        '<p class="reponse-directe">Pour reserver un taxi a <a href="/x" title="ville">Troyes</a>, ' +
        'Taxidriver10 propose une prise en charge sur la ville et ses gares.</p>' +
        '<p>Autre chose.</p><h2>S</h2><p>Fin.</p>',
    } as GeneratedPage
    const { payload } = buildContractPayload({ page: avecLien, pageType: 'child', siteUrl: 'https://x.fr' })
    expect(payload.mainContent).toBe('Autre chose.')
  })

  it('se rabat sur le premier paragraphe quand la reponse directe manque', () => {
    // Rows rebuilt from the legacy scalar columns have no directAnswer.
    const legacy = { ...PAGE, directAnswer: undefined } as GeneratedPage
    const { payload } = buildContractPayload({ page: legacy, pageType: 'child', siteUrl: 'https://x.fr' })
    expect(payload.introText).toBe('Réponse directe en une phrase.')
    expect(payload.mainContent).toBe('Un second paragraphe de contexte.')
  })
})

// ─── The emitted file, compiled ──────────────────────────────────────────────

describe('emitContractPage — compilation', () => {
  it('compile pour les trois variantes', () => {
    for (const pageType of ['pillar', 'local_pack', 'comparative'] as const) {
      expect(typeCheck(emit(PAGE, pageType))).toEqual([])
    }
  })

  it('compile sur une page hostile : apostrophes, backticks, guillemets, accents', () => {
    const hostile = {
      ...PAGE,
      title: 'Prix « tout compris » d\u2019un taxi — 100 €',
      htmlContent:
        '<h1>T</h1><p>Un `backtick`, un ${dollar}, un "guillemet" et un \\antislash.</p>' +
        '<h2>Suite</h2><p>Fin.</p>',
      ctaText: 'Appeler « maintenant »',
    } as GeneratedPage
    expect(typeCheck(emit(hostile, 'child'))).toEqual([])
  })

  it('n emet AUCUN JSX en dehors de l element unique', () => {
    // The property that removes the failure class: there is no markup for a
    // model to get wrong, because no model writes this file.
    const out = emit(PAGE, 'child')
    const body = out.slice(out.indexOf('export default function'))
    const tags = [...body.matchAll(/<[A-Za-z]/g)].length
    expect(tags).toBe(1)
    expect(out).toContain('<SeoEnginePage payload={payload} />')
    expect(out).not.toContain('className')
  })

  it('n annote PAS le payload — un champ en trop ne doit pas bloquer le build du site', () => {
    // THE guard on contract drift. `const payload: SeoEnginePayload = {…}` makes
    // the literal fresh, so excess-property checking fires and a field added
    // engine-side would break EVERY deployment of the site at once. Assigning to
    // an inferred const drops that freshness.
    const out = emit(PAGE, 'child')
    expect(out).toContain('const payload = {')
    expect(out).not.toMatch(/const payload\s*:/)

    const withExtra = out.replace('"variant"', '"champInconnuDuFutur": true,\n  "variant"')
    expect(typeCheck(withExtra)).toEqual([])
  })

  it('mais un champ REQUIS manquant reste une erreur', () => {
    // Loose in the safe direction, strict in the one that matters.
    const out = emit(PAGE, 'child')
    const withoutVariant = out.replace(/\n\s*"variant": .*,/, '')
    // Assert the mutation landed. The first version of this regex did not match
    // the `as const` suffix, so it removed nothing and the test passed against
    // an unmodified file — green for entirely the wrong reason.
    expect(withoutVariant).not.toContain('"variant"')
    expect(typeCheck(withoutVariant).join(' ')).toMatch(/variant/)
  })

  it('exporte metadata, que Next.js lit sur la page et nulle part ailleurs', () => {
    expect(emit(PAGE, 'child')).toContain('export const metadata = seoEngineMetadata(payload)')
  })

  it('declare la version du contrat dans le fichier commite', () => {
    const { payload } = buildContractPayload({ page: PAGE, pageType: 'child', siteUrl: 'https://x.fr' })
    expect(payload.contractVersion).toBe(CONTRACT_VERSION)
    expect(emit(PAGE, 'child')).toContain(`"contractVersion": ${CONTRACT_VERSION}`)
  })

  it('n emet pas les champs vides plutot que des undefined', () => {
    const sansCta = { ...PAGE, ctaText: '' } as GeneratedPage
    const out = emit(sansCta, 'child')
    expect(out).not.toContain('undefined')
  })
})

// ─── Harness self-check ──────────────────────────────────────────────────────

describe('le harnais de compilation detecte vraiment une erreur', () => {
  it('refuse un fichier qui ne compile pas', () => {
    // Without this, an always-empty diagnostics list would make every test above
    // pass for the wrong reason.
    const casse = `import SeoEnginePage from '${ADAPTER_IMPORT}'
const payload = { variant: 'local' }
export default function P() { return <SeoEnginePage payload={payload} /> }
`
    expect(typeCheck(casse).length).toBeGreaterThan(0)
  })
})

// Keeps the type import honest.
export type { ContractPayload }
