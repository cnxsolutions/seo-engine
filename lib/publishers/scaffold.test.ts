// ─────────────────────────────────────────────────────────────────────────────
// Deterministic page scaffold
// SEO Engine - What the engine commits when nobody wrote a template.
// ─────────────────────────────────────────────────────────────────────────────
//
// The samples below are trimmed from the real connected site
// (cnxsolutions/taxidriver10, src/app/(seo)/…). Keeping the real shape matters:
// every rule here exists because of something those pages do — a propless
// navbar, a prop-carrying JsonLd, a footer 7500 characters in, a theme class on
// <main>, and one propless block per page that belongs to that page alone.

import { describe, expect, it } from 'vitest'
import { buildScaffold, extractChrome } from './scaffold'

const CHAUFFEUR = `import { buildMetadata } from '@/lib/seo/metadata'
import { Metadata } from 'next'
import PremiumNavbar from '@/components/PremiumNavbar'
import PremiumHero from '@/components/PremiumHero'
import PageContent from '@/components/PageContent'
import ChauffeurPriveTouristiqueExtraContent from '@/components/ChauffeurPriveTouristiqueExtraContent'
import PremiumFooter from '@/components/PremiumFooter'
import JsonLd from '@/components/JsonLd'

export default function ChauffeurPriveTouristiqueTroyesPage() {
    return (
        <main className="bg-dark-premium text-white">
            <JsonLd description="…" customFaqs={faq} />
            <PremiumNavbar />
            <PremiumHero title={<>Chauffeur</>} bgImage="/images/x.jpg" />
            <div className="container py-8">
                <PageContent keyword="chauffeur" introText="…" />
                <ChauffeurPriveTouristiqueExtraContent />
            </div>
            <PremiumFooter />
        </main>
    )
}
`

const MAGASINS = `import { buildMetadata } from '@/lib/seo/metadata'
import { Metadata } from 'next'
import PremiumNavbar from '@/components/PremiumNavbar'
import PremiumHero from '@/components/PremiumHero'
import PageContent from '@/components/PageContent'
import MagasinsUsineExtraContent from '@/components/MagasinsUsineExtraContent'
import PremiumFooter from '@/components/PremiumFooter'
import JsonLd from '@/components/JsonLd'

export default function MagasinsUsineTroyesPage() {
    return (
        <main className="bg-dark-premium text-white">
            <JsonLd description="…" />
            <PremiumNavbar />
            <PremiumHero title={<>Magasins</>} bgImage="/images/y.jpg" />
            <div className="container py-8">
                <PageContent keyword="magasins" introText="…" />
                <MagasinsUsineExtraContent />
            </div>
            <PremiumFooter />
        </main>
    )
}
`

const SAMPLES = [CHAUFFEUR, MAGASINS]

const PAGE = {
  title: "Taxi à l'aéroport",
  metaDescription: 'Réserver.',
  ogTitle: 'Taxi',
  ogDescription: 'Réserver.',
  slug: 'taxi-aeroport',
  htmlContent: '<h1>Taxi</h1><p>Prix "tout compris" et 100 €.</p>',
  schemaJson: '{"@type":"FAQPage"}',
  componentName: 'TaxiAeroportPage',
  pageUrl: 'https://taxidriver10.fr/taxi-aeroport',
}

// ─── Chrome extraction ───────────────────────────────────────────────────────

describe('extractChrome', () => {
  it('retient les composants montes sans prop sur TOUTES les pages', () => {
    const chrome = extractChrome(SAMPLES)
    expect(chrome.before).toEqual(['PremiumNavbar'])
    expect(chrome.after).toEqual(['PremiumFooter'])
  })

  it('ecarte un composant qui porte des props', () => {
    // JsonLd, PremiumHero and PageContent all take props. Mounting them would
    // mean inventing values for props we have never read.
    const { before, after } = extractChrome(SAMPLES)
    for (const name of ['JsonLd', 'PremiumHero', 'PageContent']) {
      expect([...before, ...after]).not.toContain(name)
    }
  })

  it('ecarte un bloc propre a une page, meme sans prop', () => {
    // THE regression this module exists for. Both ExtraContent blocks are
    // propless, so the "no props" rule alone lets them through — it did, and my
    // own test caught it. Only presence on EVERY page separates shell from
    // content.
    const emitted = buildScaffold(PAGE, extractChrome(SAMPLES)).content
    expect(emitted).not.toContain('ExtraContent')
  })

  it('refuse de conclure sur une seule page', () => {
    // With one sample, ChauffeurPriveTouristiqueExtraContent is indistinguishable
    // from the footer. Emitting nothing beats emitting someone else's page.
    expect(extractChrome([CHAUFFEUR]).before).toEqual([])
    expect(extractChrome([CHAUFFEUR]).after).toEqual([])
  })

  it('recopie les classes du site, sans jamais en inventer', () => {
    const chrome = extractChrome(SAMPLES)
    expect(chrome.wrapperClass).toBe('bg-dark-premium text-white')
    expect(chrome.containerClass).toBe('container py-8')
  })

  it('recopie les lignes d import telles quelles', () => {
    // Never reconstructed from the component name: an import path cannot be
    // guessed, and '@/components/premium/PremiumFAQ' proves it on this site.
    expect(extractChrome(SAMPLES).imports).toEqual([
      "import PremiumNavbar from '@/components/PremiumNavbar'",
      "import PremiumFooter from '@/components/PremiumFooter'",
    ])
  })

  it('ne rend rien sur une entree vide plutot que de lever', () => {
    for (const input of [[], [null], [undefined, null], ['']]) {
      expect(extractChrome(input).before).toEqual([])
    }
  })

  it('ecarte un composant absent de l une des pages', () => {
    const sansFooter = MAGASINS.replace('<PremiumFooter />', '')
    expect(extractChrome([CHAUFFEUR, sansFooter]).after).toEqual([])
  })
})

// ─── Emitted file ────────────────────────────────────────────────────────────

describe('buildScaffold', () => {
  it('monte la charpente dans l ordre du site', () => {
    const out = buildScaffold(PAGE, extractChrome(SAMPLES)).content
    const navbar = out.indexOf('<PremiumNavbar />')
    const article = out.indexOf('<article')
    const footer = out.indexOf('<PremiumFooter />')
    expect(navbar).toBeGreaterThan(-1)
    expect(navbar).toBeLessThan(article)
    expect(article).toBeLessThan(footer)
  })

  it('nomme l export par defaut avec un identifiant legal', () => {
    const out = buildScaffold(PAGE, extractChrome(SAMPLES)).content
    const match = out.match(/export default function ([^\s(]*)/)
    expect(match?.[1]).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
  })

  it('echappe le contenu : ni backtick ni interpolation ne s echappent', () => {
    const out = buildScaffold(
      { ...PAGE, htmlContent: '<p>Prix `special` et ${injection}</p>' },
      extractChrome(SAMPLES)
    ).content
    expect(out).toContain('\\`special\\`')
    expect(out).toContain('\\${injection}')
  })

  it("echappe l apostrophe du titre, qui vit dans une chaine a quotes simples", () => {
    const out = buildScaffold(PAGE, extractChrome(SAMPLES)).content
    expect(out).toContain("title: 'Taxi à l\\'aéroport'")
  })

  it('signale une page nue quand le depot n a rien donne', () => {
    const nu = buildScaffold(PAGE, extractChrome([]))
    expect(nu.fidelity).toBe('bare')
    expect(nu.mounted).toEqual([])
    // It still has to compile and still has to carry the content.
    expect(nu.content).toContain('export default function TaxiAeroportPage()')
    expect(nu.content).toContain('<article')
  })

  it('signale une page habillee quand il a donne quelque chose', () => {
    const habille = buildScaffold(PAGE, extractChrome(SAMPLES))
    expect(habille.fidelity).toBe('chrome')
    expect(habille.mounted).toEqual(['PremiumNavbar', 'PremiumFooter'])
  })

  it('omet le bloc JSON-LD plutot que d emettre un script vide', () => {
    const out = buildScaffold({ ...PAGE, schemaJson: null }, extractChrome(SAMPLES)).content
    expect(out).not.toContain('application/ld+json')
  })

  it('est deterministe : deux appels donnent le meme octet', () => {
    // The property that makes this usable as the floor. The path it replaced
    // asked a model to write the file at every single publication.
    const a = buildScaffold(PAGE, extractChrome(SAMPLES)).content
    const b = buildScaffold(PAGE, extractChrome(SAMPLES)).content
    expect(a).toBe(b)
  })
})
