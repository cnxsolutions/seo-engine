// ─────────────────────────────────────────────────────────────────────────────
// Page slugs
// SEO Engine - What a published URL is allowed to contain.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { buildPageSlug, MAX_SLUG_CHARS, MAX_SLUG_WORDS, slugify } from './slug'

describe('buildPageSlug', () => {
  it('ne laisse JAMAIS passer un type de page interne', () => {
    // The regression. `child` is a value of the page_type enum; it reached a
    // public URL through a padding list that included `pageType`.
    const slug = buildPageSlug({
      proposed: 'taxi-aube-communes-desservies-child-reservations',
      city: 'Troyes',
    })
    for (const internal of ['child', 'pillar', 'local_pack', 'comparative']) {
      expect(slug).not.toContain(internal)
    }
  })

  it('ne rembourre plus avec des mots vides de sens', () => {
    // The old builders appended 'service', 'professionnel', 'guide' and 'local'
    // until the slug reached a word count. None of them says anything about the
    // page.
    const slug = buildPageSlug({ proposed: 'taxi-gare', city: 'Troyes' })
    expect(slug).toBe('taxi-gare-troyes')
    for (const filler of ['service', 'professionnel', 'guide']) {
      expect(slug).not.toContain(filler)
    }
  })

  it('reste sous les limites de longueur', () => {
    const slug = buildPageSlug({
      proposed:
        'reservation-taxi-conventionne-cpam-transport-assis-professionnalise-longue-distance-aeroport',
      city: 'Sainte-Savine',
    })
    expect(slug.split('-').length).toBeLessThanOrEqual(MAX_SLUG_WORDS)
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_CHARS)
  })

  it('garde la ville meme quand il faut couper', () => {
    // Truncation must not be what removes the town: two pages differing only by
    // city would then collide on one URL.
    const slug = buildPageSlug({
      proposed: 'reservation-taxi-conventionne-cpam-transport-assis-professionnalise-longue-distance',
      city: 'Sainte-Savine',
    })
    expect(slug).toContain('sainte-savine')
  })

  it('termine toujours par la ville, ou qu elle soit dans la source', () => {
    // A fixed position is what makes "the town is never truncated" true by
    // construction instead of by luck — and city-last is the conventional shape
    // for a local page.
    expect(buildPageSlug({ proposed: 'taxi-aeroport', city: 'Troyes' })).toBe('taxi-aeroport-troyes')
    expect(buildPageSlug({ proposed: 'taxi-troyes-aeroport', city: 'Troyes' })).toBe('taxi-aeroport-troyes')
  })

  it('garde la ville meme quand elle est deja la mais trop loin', () => {
    // Found while cleaning up a real published slug. The town was present at
    // word eight, the cap kept seven, and the final slice removed it — two
    // communes would have produced the same URL.
    const slug = buildPageSlug({
      proposed: 'taxi-aube-communes-desservies-reservations-service-professionnel-troyes-guide',
      city: 'Troyes',
    })
    expect(slug).toContain('troyes')
    expect(slug.split('-').length).toBeLessThanOrEqual(MAX_SLUG_WORDS)
  })

  it('ne repete pas un mot', () => {
    expect(buildPageSlug({ proposed: 'taxi-troyes-taxi-gare', city: 'Troyes' })).toBe('taxi-gare-troyes')
  })

  it('garde les petits mots tant que le slug est court', () => {
    // `taxi-de-nuit` reads better than `taxi-nuit`; stopwords only go when the
    // slug has no room left.
    expect(buildPageSlug({ proposed: 'taxi-de-nuit', city: 'Troyes' })).toBe('taxi-de-nuit-troyes')
  })

  it('sacrifie les petits mots avant les mots porteurs', () => {
    const slug = buildPageSlug({
      proposed: 'reserver-un-taxi-a-la-gare-de-troyes-pour-un-depart-matinal',
    })
    expect(slug).not.toContain('-un-')
    expect(slug).toContain('taxi')
    expect(slug).toContain('gare')
  })

  it('prend la requete cible quand le plan ne propose rien', () => {
    expect(buildPageSlug({ focusKeyword: 'taxi conventionné CPAM', city: 'Troyes' }))
      .toBe('taxi-conventionne-cpam-troyes')
  })

  it('prend le titre en dernier recours, jamais avant la requete', () => {
    const slug = buildPageSlug({
      focusKeyword: 'taxi gare',
      title: 'Comment réserver un taxi à Troyes ? Le guide complet',
      city: 'Troyes',
    })
    expect(slug).toBe('taxi-gare-troyes')
  })

  it('rend quelque chose de publiable meme sans rien', () => {
    // A slug is a path segment: empty is not an option, and `undefined` in a URL
    // is worse than a generic word.
    expect(buildPageSlug({})).toBe('page')
    expect(buildPageSlug({ businessType: 'taxi', city: 'Troyes' })).toBe('taxi-troyes')
  })

  it('plie les accents et la ponctuation', () => {
    expect(buildPageSlug({ proposed: "Réservation d'un taxi — l'Aube !" }))
      .toBe('reservation-d-un-taxi-l-aube')
  })
})

describe('slugify', () => {
  it('ne laisse ni accent, ni majuscule, ni tiret en bordure', () => {
    expect(slugify('  Épicerie Fine — Troyes  ')).toBe('epicerie-fine-troyes')
  })
})
