// ─────────────────────────────────────────────────────────────────────────────
// Editorial Identity Tests
// SEO Engine - Domain
// ─────────────────────────────────────────────────────────────────────────────
//
// Le test central de ce fichier est celui qui PROUVE QUE LE CORRECTIF SERT :
// « Taxi Troyes » contre « Taxi Sainte-Savine » est le mode d'echec reel d'un
// generateur une-page-par-ville, et sur des tokens BRUTS ce couple ne franchit
// aucun seuil raisonnable. Les deux assertions vivent dans le meme test : sans
// le couple mesure/contre-mesure, une regression qui supprimerait le retrait des
// villes rendrait simplement le module silencieux, ce qui ressemble en tout
// point a un site sans doublon.

import { describe, it, expect } from 'vitest'
import { contentTokens, cosineSimilarityOfTokens } from '../text/text-utils'
import type { InventoryEntry } from './inventory'
import {
  CANNIBALIZATION_TITLE_FLOOR,
  META_NEAR_DUPLICATE,
  META_NEAR_DUPLICATE_TRUNCATED,
  TITLE_NEAR_DUPLICATE,
  TITLE_NEAR_DUPLICATE_TRUNCATED,
  TRUNCATED_MARGIN,
  compareEditorialIdentity,
  identityThresholds,
  judgeEditorialIdentity,
  type EditorialTarget,
  type IdentityComparison,
} from './identity'

/** Les villes que le proprietaire dessert, sous la forme que l'appelant a. */
const VILLES = ['troyes', 'sainte', 'savine']

function target(overrides: Partial<EditorialTarget> = {}): EditorialTarget {
  return {
    path: '/taxi-troyes',
    title: 'Taxi Troyes',
    metaDescription: 'Taxi a Troyes, reservation immediate.',
    focusKeyword: 'taxi troyes',
    body: '<p>Un corps de page complet, redige et pret a publier.</p>',
    ...overrides,
  }
}

function entry(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    path: '/taxi-sainte-savine',
    url: 'https://exemple.fr/taxi-sainte-savine',
    title: 'Taxi Sainte-Savine',
    metaDescription: 'Taxi a Sainte-Savine, reservation immediate.',
    focusKeyword: 'taxi sainte savine',
    canonicalPath: null,
    noindex: false,
    body: 'Un corps de page deja en ligne.',
    bodyIsExcerpt: false,
    origin: 'crawl',
    coversTopic: true,
    observedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Une mesure litterale, pour juger le juge sans passer par le comparateur. */
function comparison(overrides: Partial<IdentityComparison> = {}): IdentityComparison {
  return {
    entryPath: '/taxi-sainte-savine',
    entryUrl: 'https://exemple.fr/taxi-sainte-savine',
    pathCollision: false,
    titleSimilarity: 0,
    metaSimilarity: 0,
    sameFocusKeyword: false,
    sharedIntents: [],
    comparisonIsPartial: false,
    ...overrides,
  }
}

describe('compareEditorialIdentity — titres', () => {
  it('detecte « Taxi Troyes » contre « Taxi Sainte-Savine », et ne le detecterait PAS sans le retrait des villes', () => {
    const mesure = compareEditorialIdentity(
      target({ title: 'Taxi Troyes' }),
      entry({ title: 'Taxi Sainte-Savine' }),
      VILLES,
    )

    // Villes retirees : « Taxi » contre « Taxi ».
    expect(mesure.titleSimilarity).toBeGreaterThanOrEqual(TITLE_NEAR_DUPLICATE)

    // Le meme couple, sur les tokens bruts, c'est-a-dire le calcul que fait
    // aujourd'hui le DuplicateDetector avec son seuil de 0.9. Il tombe si bas
    // que la regle de cannibalisation est litteralement inatteignable.
    const brut = cosineSimilarityOfTokens(
      contentTokens('Taxi Troyes'),
      contentTokens('Taxi Sainte-Savine'),
    )
    expect(brut).toBeLessThan(0.6)
  })

  it('juge ce couple comme TITLE_NEAR_DUPLICATE', () => {
    const mesure = compareEditorialIdentity(
      target({ title: 'Taxi Troyes' }),
      entry({ title: 'Taxi Sainte-Savine' }),
      VILLES,
    )

    const verdict = judgeEditorialIdentity([mesure], { intent: 'create', truncated: false })

    expect(verdict.blocking.map(b => b.code)).toContain('TITLE_NEAR_DUPLICATE')
  })

  it('ne rapproche pas deux titres de services differents dans la meme ville', () => {
    // Le retrait des villes ne doit pas rendre tout identique : ce qui reste est
    // le noyau editorial, et « taxi » n'est pas « transport medical assis ».
    const mesure = compareEditorialIdentity(
      target({ title: 'Taxi Troyes' }),
      entry({ title: 'Transport medical assis Troyes' }),
      VILLES,
    )

    expect(mesure.titleSimilarity).toBeLessThan(TITLE_NEAR_DUPLICATE)
  })

  it('ne conclut pas a la difference quand le retrait vide les deux titres', () => {
    // Deux titres entierement faits de noms de villes se videraient tous les
    // deux, et le cosinus de deux vecteurs vides vaut 0 : deux titres IDENTIQUES
    // passeraient pour differents.
    const mesure = compareEditorialIdentity(
      target({ title: 'Troyes' }),
      entry({ title: 'Troyes' }),
      VILLES,
    )

    expect(mesure.titleSimilarity).toBe(1)
  })
})

describe('compareEditorialIdentity — meta descriptions', () => {
  // Deux metas REDIGEES PAR LE MODELE pour deux pages soeurs d'un site
  // mono-service multi-villes. Ce n'est pas un repli automatique : quand la meta
  // manque, le gate refuse deja la page sur une anomalie bloquante du champ.
  const METxA =
    'Taxi conventionne CPAM a Troyes : transport medical assis, reservation 24h/24 et prise en charge a domicile. Devis immediat par telephone.'
  const METxB =
    'Reservation 24h/24 de votre taxi conventionne CPAM a Sainte-Savine : prise en charge a domicile, transport medical assis. Devis immediat par telephone.'

  it('detecte deux metas de pages soeurs, et bloque en META_NEAR_DUPLICATE', () => {
    const mesure = compareEditorialIdentity(
      target({ title: 'Taxi conventionne Troyes', metaDescription: METxA }),
      entry({ title: 'Taxi conventionne Sainte-Savine', metaDescription: METxB }),
      VILLES,
    )

    expect(mesure.metaSimilarity).toBeGreaterThanOrEqual(META_NEAR_DUPLICATE)

    const verdict = judgeEditorialIdentity([mesure], { intent: 'create', truncated: false })
    expect(verdict.blocking.map(b => b.code)).toContain('META_NEAR_DUPLICATE')
  })

  it('laisse passer deux metas qui promettent des choses differentes', () => {
    const mesure = compareEditorialIdentity(
      target({ metaDescription: METxA }),
      entry({
        metaDescription:
          'Location de utilitaire avec chauffeur a Troyes : demenagement, livraison de meubles et transport de palettes, sept jours sur sept.',
      }),
      VILLES,
    )

    expect(mesure.metaSimilarity).toBeLessThan(META_NEAR_DUPLICATE)
  })

  it('ne derive JAMAIS la meta du titre', () => {
    // Un titre identique des deux cotes ne doit rien apporter a la meta : c'est
    // le seul endroit du produit ou deux metas sont confrontees, et melanger les
    // deux champs rendrait le score de meta indechiffrable.
    const mesure = compareEditorialIdentity(
      target({ title: 'Taxi Troyes', metaDescription: 'Reservation en ligne.' }),
      entry({ title: 'Taxi Troyes', metaDescription: 'Devis pour un demenagement de bureau.' }),
      VILLES,
    )

    expect(mesure.metaSimilarity).toBe(0)
  })
})

describe('compareEditorialIdentity — aveux et signaux', () => {
  it('avoue la comparaison partielle des que l entree n est qu un extrait', () => {
    const complet = compareEditorialIdentity(target(), entry({ bodyIsExcerpt: false }), VILLES)
    expect(complet.comparisonIsPartial).toBe(false)

    const extrait = compareEditorialIdentity(target(), entry({ bodyIsExcerpt: true }), VILLES)
    expect(extrait.comparisonIsPartial).toBe(true)
  })

  it('avoue aussi la comparaison partielle quand la page a ecrire n a pas encore de corps', () => {
    // Au moment de DECIDER d'ecrire, le corps n'existe pas. Un score bas ne
    // prouve alors rien : on n'a pas compare les memes quantites de texte.
    const sansCorps = compareEditorialIdentity(
      target({ body: undefined }),
      entry({ bodyIsExcerpt: false }),
      VILLES,
    )
    expect(sansCorps.comparisonIsPartial).toBe(true)

    const corpsVide = compareEditorialIdentity(
      target({ body: '' }),
      entry({ bodyIsExcerpt: false }),
      VILLES,
    )
    expect(corpsVide.comparisonIsPartial).toBe(true)
  })

  it('normalise les deux chemins avant de conclure a la collision', () => {
    const collision = compareEditorialIdentity(
      target({ path: '/Taxi-Troyes/' }),
      entry({ path: '/taxi-troyes' }),
      VILLES,
    )
    expect(collision.pathCollision).toBe(true)

    const libre = compareEditorialIdentity(target({ path: '/taxi-troyes' }), entry(), VILLES)
    expect(libre.pathCollision).toBe(false)
  })

  it('compare les mots-cles apres normalisation, et refuse d apparier deux vides', () => {
    const identique = compareEditorialIdentity(
      target({ focusKeyword: 'Taxi Troyes' }),
      entry({ focusKeyword: 'taxi  troyes' }),
      VILLES,
    )
    expect(identique.sameFocusKeyword).toBe(true)

    // Une entree sans focus_keyword aurait sinon partage son sujet avec tout ce
    // qui passe.
    const sansMotCle = compareEditorialIdentity(
      target({ focusKeyword: '' }),
      entry({ focusKeyword: null }),
      VILLES,
    )
    expect(sansMotCle.sameFocusKeyword).toBe(false)
  })

  it('intersecte les intentions de recherche, triees, sur le vocabulaire du domaine', () => {
    const mesure = compareEditorialIdentity(
      target({
        title: 'Prix taxi Troyes',
        metaDescription: 'Tarif et devis pour un taxi a Troyes.',
        body: 'Nos tarifs sont affiches.',
      }),
      entry({
        title: 'Combien coute un taxi a Sainte-Savine',
        metaDescription: 'Le prix d une course, explique.',
        body: 'Le tarif depend de la distance.',
      }),
      VILLES,
    )

    expect(mesure.sharedIntents).toEqual(['transactional'])
  })

  it('accepte des villes ecrites en toutes lettres autant que pre-decoupees', () => {
    const preDecoupe = compareEditorialIdentity(target(), entry(), ['troyes', 'sainte', 'savine'])
    const enClair = compareEditorialIdentity(target(), entry(), ['Troyes', 'Sainte-Savine'])

    expect(enClair.titleSimilarity).toBe(preDecoupe.titleSimilarity)
  })
})

describe('identityThresholds', () => {
  it('durcit les deux seuils bloquants de la marge annoncee', () => {
    // Un echantillon rend le moteur plus prudent, jamais plus confiant : la page
    // la plus ressemblante du site n'est peut-etre pas dans ce qu'on regarde.
    expect(identityThresholds(false)).toEqual({
      title: TITLE_NEAR_DUPLICATE,
      meta: META_NEAR_DUPLICATE,
    })
    expect(identityThresholds(true)).toEqual({
      title: TITLE_NEAR_DUPLICATE_TRUNCATED,
      meta: META_NEAR_DUPLICATE_TRUNCATED,
    })

    expect(TITLE_NEAR_DUPLICATE - TITLE_NEAR_DUPLICATE_TRUNCATED).toBeCloseTo(TRUNCATED_MARGIN, 10)
    expect(META_NEAR_DUPLICATE - META_NEAR_DUPLICATE_TRUNCATED).toBeCloseTo(TRUNCATED_MARGIN, 10)
  })
})

describe('judgeEditorialIdentity', () => {
  it('bloque a 0.72 sur un inventaire tronque, et laisse passer 0.75 sur un inventaire complet', () => {
    const mesure = comparison({ titleSimilarity: 0.75 })

    const complet = judgeEditorialIdentity([mesure], { intent: 'create', truncated: false })
    expect(complet.blocking).toHaveLength(0)

    const tronque = judgeEditorialIdentity([comparison({ titleSimilarity: TITLE_NEAR_DUPLICATE_TRUNCATED })], {
      intent: 'create',
      truncated: true,
    })
    expect(tronque.blocking.map(b => b.code)).toEqual(['TITLE_NEAR_DUPLICATE'])
  })

  it('durcit aussi le seuil de meta sur un inventaire tronque', () => {
    const mesure = comparison({ metaSimilarity: META_NEAR_DUPLICATE_TRUNCATED })

    expect(judgeEditorialIdentity([mesure], { intent: 'create', truncated: false }).blocking).toHaveLength(0)
    expect(
      judgeEditorialIdentity([mesure], { intent: 'create', truncated: true }).blocking.map(b => b.code),
    ).toEqual(['META_NEAR_DUPLICATE'])
  })

  it('bloque une collision de slug a la creation', () => {
    const verdict = judgeEditorialIdentity([comparison({ pathCollision: true })], {
      intent: 'create',
      truncated: false,
    })

    expect(verdict.blocking.map(b => b.code)).toEqual(['SLUG_COLLISION'])
  })

  it('ne produit AUCUN constat sur la page qu un rafraichissement remplace', () => {
    // Une mise a jour reussie ressemble par construction a ce qu'elle remplace :
    // bloquer sur cette ressemblance interdirait tout rafraichissement.
    const memeAdresse = comparison({
      pathCollision: true,
      titleSimilarity: 1,
      metaSimilarity: 1,
      sameFocusKeyword: true,
    })

    const verdict = judgeEditorialIdentity([memeAdresse], { intent: 'refresh', truncated: false })

    expect(verdict.blocking).toHaveLength(0)
    expect(verdict.warnings).toHaveLength(0)
  })

  it('continue de juger les AUTRES pages pendant un rafraichissement', () => {
    const cible = comparison({ entryPath: '/taxi-troyes', pathCollision: true, titleSimilarity: 1 })
    const voisine = comparison({ entryPath: '/taxi-sainte-savine', titleSimilarity: 0.95 })

    const verdict = judgeEditorialIdentity([cible, voisine], { intent: 'refresh', truncated: false })

    expect(verdict.blocking).toHaveLength(1)
    expect(verdict.blocking[0].comparison.entryPath).toBe('/taxi-sainte-savine')
  })

  it('classe les codes d une meme page par gravite', () => {
    const tout = comparison({ pathCollision: true, titleSimilarity: 1, metaSimilarity: 1 })

    const verdict = judgeEditorialIdentity([tout], { intent: 'create', truncated: false })

    expect(verdict.blocking.map(b => b.code)).toEqual([
      'TITLE_NEAR_DUPLICATE',
      'META_NEAR_DUPLICATE',
      'SLUG_COLLISION',
    ])
  })

  it('n AVERTIT de cannibalisation que sur un couple qui ne bloque pas', () => {
    const memeMotCle = comparison({ sameFocusKeyword: true, titleSimilarity: 0.5 })
    const avertissement = judgeEditorialIdentity([memeMotCle], { intent: 'create', truncated: false })
    expect(avertissement.warnings.map(w => w.code)).toEqual(['CANNIBALIZATION'])
    expect(avertissement.blocking).toHaveLength(0)

    // Dire « cannibalisation » sous un « meme titre » ne renseigne personne.
    const dejaBloquee = comparison({ sameFocusKeyword: true, titleSimilarity: 1 })
    const verdict = judgeEditorialIdentity([dejaBloquee], { intent: 'create', truncated: false })
    expect(verdict.warnings).toHaveLength(0)
  })

  it('avertit sur une intention partagee et des titres deja proches', () => {
    const mesure = comparison({
      sharedIntents: ['transactional'],
      titleSimilarity: CANNIBALIZATION_TITLE_FLOOR,
    })

    expect(
      judgeEditorialIdentity([mesure], { intent: 'create', truncated: false }).warnings,
    ).toHaveLength(1)

    // Une intention partagee SEULE ne dit rien : toutes les pages d'un site de
    // service sont transactionnelles.
    const seuleIntention = comparison({ sharedIntents: ['transactional'], titleSimilarity: 0.1 })
    expect(
      judgeEditorialIdentity([seuleIntention], { intent: 'create', truncated: false }).warnings,
    ).toHaveLength(0)
  })

  it('ne rend rien sur une liste vide', () => {
    // Un inventaire aveugle n'est pas un motif de refus : zero comparaison doit
    // rendre zero constat, jamais un doute.
    expect(judgeEditorialIdentity([], { intent: 'create', truncated: true })).toEqual({
      blocking: [],
      warnings: [],
    })
  })
})
