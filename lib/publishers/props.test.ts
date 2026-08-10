// ─────────────────────────────────────────────────────────────────────────────
// Component prop signatures
// SEO Engine - What makes the adapter work on a site nobody hard-coded.
// ─────────────────────────────────────────────────────────────────────────────
//
// Sources below are trimmed from the real connected site. Each rule here exists
// because one of its components does something the naive parser got wrong.

import { describe, expect, it } from 'vitest'
import { bindProps, parseComponentProps } from './props'

const HERO = `
interface PremiumHeroProps {
  title?: React.ReactNode
  subtitle?: string
  badgeText?: string
  bgImage?: string
}

const PremiumHero = ({
  title = (<>Taxi</>),
  subtitle = 'Votre chauffeur prive.',
  badgeText,
  bgImage = '/images/hero.jpg',
}: PremiumHeroProps) => null
`

const CONTENT = `
interface PageContentProps {
    keyword: string
    cityName?: string
    introText: string
    mainContent: string
    advantages?: string[]
    internalLinks: InternalLink[]
    externalLink?: {
        label: string
        href: string
    }
    conclusionText?: string
}
const PageContent = ({ keyword, introText, mainContent, internalLinks }: PageContentProps) => null
`

const LOCAL = `
interface LocalBusinessInfoProps {
    cityName: string
    distance: string
    duration?: string
}
`

const TOC = `
interface TableOfContentsProps {
    items: TOCItem[]
    title?: string
}
`

const FAQ = `
interface PremiumFAQProps {
    items?: { question: string; answer: string }[]
    heading?: React.ReactNode
}
`

// ─── Reading a signature ─────────────────────────────────────────────────────

describe('parseComponentProps', () => {
  it('lit les props declarees', () => {
    expect(parseComponentProps(HERO, 'PremiumHero').map((p) => p.name)).toEqual([
      'title', 'subtitle', 'badgeText', 'bgImage',
    ])
  })

  it('distingue obligatoire et optionnel', () => {
    const props = parseComponentProps(CONTENT, 'PageContent')
    const required = props.filter((p) => !p.optional).map((p) => p.name)
    expect(required).toEqual(['keyword', 'introText', 'mainContent', 'internalLinks'])
  })

  it('ignore les props imbriquees dans un objet', () => {
    // `externalLink?: { label; href }` spans three lines. Read flat, `label` and
    // `href` became required props of the component — blocking a legitimate
    // mount, and risking `href` being bound to the page path.
    const names = parseComponentProps(CONTENT, 'PageContent').map((p) => p.name)
    expect(names).not.toContain('label')
    expect(names).not.toContain('href')
    // …and the props declared AFTER the nested object are still read.
    expect(names).toContain('conclusionText')
  })

  it('traite une valeur par defaut comme un optionnel', () => {
    // Whatever the interface says, a destructured default makes the prop
    // omittable at the call site — which is what the compiler enforces.
    const bgImage = parseComponentProps(HERO, 'PremiumHero').find((p) => p.name === 'bgImage')
    expect(bgImage?.optional).toBe(true)
  })

  it('ne rend rien plutot que de deviner', () => {
    expect(parseComponentProps(null, 'X')).toEqual([])
    expect(parseComponentProps('const X = () => null', 'X')).toEqual([])
  })
})

// ─── Deciding what to mount ──────────────────────────────────────────────────

describe('bindProps', () => {
  it('monte un composant dont toutes les props obligatoires se remplissent', () => {
    const decision = bindProps(parseComponentProps(CONTENT, 'PageContent'))
    expect(decision.mountable).toBe(true)
    expect(decision.bound.map((b) => b.name)).toContain('mainContent')
  })

  it('refuse de monter ce qui exige une donnee que le moteur n a pas', () => {
    // `distance` between two towns is not something a page generator knows.
    // Passing '' would compile and render an empty field on a live page.
    const decision = bindProps(parseComponentProps(LOCAL, 'LocalBusinessInfo'))
    expect(decision.mountable).toBe(false)
    expect(decision.unfilled).toEqual(['cityName', 'distance'])
  })

  it('ne confond pas deux props qui portent le meme nom', () => {
    // `items` on a table of contents and `items` on a FAQ are the same name and
    // must not receive the same value. The declared type is the tiebreaker.
    expect(bindProps(parseComponentProps(TOC, 'TableOfContents')).mountable).toBe(false)

    const faq = bindProps(parseComponentProps(FAQ, 'PremiumFAQ'))
    expect(faq.bound).toContainEqual({ name: 'items', expression: 'payload.faq' })
  })

  it('n affiche pas deux fois le meme texte sur une page', () => {
    // The first derived adapter gave the page title to the hero AND to the FAQ
    // heading, so the rendered page repeated the same sentence twice.
    const used = new Set<string>()
    const hero = bindProps(parseComponentProps(HERO, 'PremiumHero'), used)
    const faq = bindProps(parseComponentProps(FAQ, 'PremiumFAQ'), used)

    expect(hero.bound.map((b) => b.name)).toContain('title')
    expect(faq.bound.map((b) => b.name)).not.toContain('heading')
    // The FAQ list itself is not display text and is legitimately reused.
    expect(faq.bound.map((b) => b.name)).toContain('items')
  })

  it('remplit quand meme une prop OBLIGATOIRE deja utilisee ailleurs', () => {
    // Skipping it would block the mount entirely, which is worse than showing a
    // value twice.
    const used = new Set(['payload.mainContent', 'payload.introText'])
    const decision = bindProps(parseComponentProps(CONTENT, 'PageContent'), used)
    expect(decision.mountable).toBe(true)
    expect(decision.bound.map((b) => b.name)).toContain('mainContent')
  })
})
