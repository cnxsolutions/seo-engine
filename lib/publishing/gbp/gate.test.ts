// ─────────────────────────────────────────────────────────────────────────────
// Le gate d'un post de fiche, verifie
// SEO Engine - Publication GBP
// ─────────────────────────────────────────────────────────────────────────────
//
// CE FICHIER NE RETESTE NI LE FORMAT NI L'ORIGINALITE. Les deux sont couverts
// chez eux — format.test.ts et src/core/domain/gbp/rotation.test.ts — et les
// rejouer ici ferait de ce fichier un miroir condamne a diverger.
//
// Il teste les trois choses que seul l'AGREGAT peut faire mal :
//   1. l'integrite factuelle, qui n'existe qu'ici et qui est la seule barriere
//      entre le modele et une affirmation fausse publiee sous l'identite du
//      client ;
//   2. le TRI — qu'un code emis par une famille atterrisse du bon cote de
//      `publishable`, ce qu'aucune des deux familles deleguees ne decide ;
//   3. le passage : un post correct ne doit produire AUCUN constat bloquant,
//      sinon le gate ne protege plus rien, il arrete tout.
//
// Aucun reseau, aucune base, aucun modele : `runGbpPostGate` est pure et le
// reste. C'est ce qui permet de la faire tourner alors que l'acces en ecriture
// a l'API GBP n'est toujours pas accorde (docs/gbp-acces-api.md).

import { describe, expect, it } from 'vitest'
import type { Site } from '@/lib/types'
import type { GbpPostAngle, RecentPost } from '@/src/core/domain/gbp/rotation'
import { GBP_TOPIC_TYPE, type LocalPostDraft } from './format'
import {
  BLOCKING_GBP_CODES,
  gbpRefusalMessage,
  runGbpPostGate,
  type GbpProfileFacts,
} from './gate'

// ─── Doubles ─────────────────────────────────────────────────────────────────

const SITE: Site = {
  id: 'site-1',
  name: 'Taxi Troyes',
  type: 'nextjs',
  url: 'https://taxi-troyes.fr',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

/**
 * Du remplissage sans un chiffre, sans un guillemet et sans un euro.
 *
 * Tout fixture doit atteindre la fourchette editoriale (200 caracteres) sans
 * declencher au passage un constat qui n'est pas celui qu'on teste — un « 0,50 €
 * » glisse dans le remplissage ferait passer un test d'integrite pour une raison
 * qui n'a rien a voir avec ce qu'il verifie.
 */
const FILLER =
  'Nous intervenons dans toute agglomeration troyenne, du centre-ville aux communes voisines, '
  + 'avec des vehicules entretenus et des chauffeurs qui connaissent les acces. '

/** Un resume qui commence par ce qu'on teste, puis rentre dans la fourchette. */
function summaryOf(head: string): string {
  let text = head.endsWith(' ') ? head : `${head} `
  while (text.length < 240) text += FILLER
  return text.slice(0, 600)
}

const PLAIN_SUMMARY = summaryOf('Reservez votre trajet vers la gare de Troyes en quelques minutes.')

function draftOf(overrides: Partial<LocalPostDraft> = {}): LocalPostDraft {
  return {
    languageCode: 'fr',
    topicType: GBP_TOPIC_TYPE,
    summary: PLAIN_SUMMARY,
    ...overrides,
  }
}

function remotePost(summary: string): RecentPost {
  return {
    // Un post ecrit a la main par le proprietaire n'a pas d'angle : la colonne
    // est nulle, ce que gbp_posts_engine_needs_angle autorise expressement.
    angle: null,
    summary,
    linkedGenerationId: null,
    publishedAt: '2026-08-10T09:00:00.000Z',
    source: 'remote',
  }
}

function profileWith(reviews: unknown): GbpProfileFacts {
  return { reviews_summary: reviews }
}

/** Une fiche reellement notee, dans la forme que `summarizeReviews` produit. */
const REAL_REVIEWS = profileWith({
  average_rating: 4.8,
  total_count: 37,
  recent_positive: [
    'Chauffeur ponctuel et vehicule impeccable, je recommande sans hesiter',
    'Prise en charge rapide a la gare, trajet agreable',
  ],
})

/** Une fiche sans le moindre avis — ce que `summarizeReviews` rend sur zero avis. */
const NO_REVIEWS = profileWith({ average_rating: 0, total_count: 0, recent_positive: [] })

function runGate(overrides: {
  draft?: LocalPostDraft
  angle?: GbpPostAngle
  linkedGenerationId?: string | null
  recentPosts?: readonly RecentPost[]
  gbpProfile?: GbpProfileFacts | null
} = {}) {
  return runGbpPostGate({
    draft: overrides.draft ?? draftOf(),
    angle: overrides.angle ?? 'service',
    linkedGenerationId:
      overrides.linkedGenerationId === undefined ? 'gen-1' : overrides.linkedGenerationId,
    site: SITE,
    recentPosts: overrides.recentPosts ?? [],
    gbpProfile: overrides.gbpProfile === undefined ? REAL_REVIEWS : overrides.gbpProfile,
  })
}

function codes(findings: ReadonlyArray<{ code: string }>): string[] {
  return findings.map(finding => finding.code)
}

// ─── 3. Le passage ───────────────────────────────────────────────────────────

describe('runGbpPostGate — un post correct', () => {
  it('ne produit AUCUN constat bloquant', async () => {
    const verdict = await runGate()

    expect(verdict.blocking).toEqual([])
    expect(verdict.publishable).toBe(true)
  })

  it('ne fabrique ni score ni note : un 100 invente afficherait une pastille verte', async () => {
    const verdict = await runGate()

    // ValidationPipelineOrchestrator mesure une PAGE. Il ne tourne pas ici, et
    // l'absence est la seule reponse honnete.
    expect(verdict.score).toBeUndefined()
    expect(verdict.grade).toBeUndefined()
    expect(verdict.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('laisse passer un resume hors fourchette editoriale, en avertissant', async () => {
    // GBP_SUMMARY_TARGET n'engage que nous : elle ne vient d'aucune documentation
    // Google, et lui donner le pouvoir de bloquer lui donnerait une autorite
    // qu'elle n'a pas. Elle est le SEUL code de format absent des bloquants.
    const verdict = await runGate({ draft: draftOf({ summary: 'Trajet gare, reservation en ligne.' }) })

    expect(codes(verdict.warnings)).toContain('GBP_SUMMARY_OFF_TARGET')
    expect(codes(verdict.blocking)).not.toContain('GBP_SUMMARY_OFF_TARGET')
    expect(verdict.publishable).toBe(true)
  })
})

// ─── 1. Integrite factuelle : la note ────────────────────────────────────────

describe('runGbpPostGate — une note citee', () => {
  it('refuse une note absente du profil', async () => {
    const verdict = await runGate({
      draft: draftOf({ summary: summaryOf('Nos clients nous notent 4,8/5 sur notre fiche.') }),
      gbpProfile: NO_REVIEWS,
    })

    expect(codes(verdict.blocking)).toContain('GBP_UNSUPPORTED_CLAIM')
    expect(verdict.publishable).toBe(false)
    // Le constat doit NOMMER la note inventee : « affirmation non etayee » ne dit
    // pas a l'operateur quel chiffre retirer.
    expect(verdict.blocking[0].message).toContain('4,8/5')
    expect(verdict.blocking[0].source).toBe('gbp')
  })

  it('laisse passer la note REELLE de la fiche', async () => {
    const verdict = await runGate({
      draft: draftOf({ summary: summaryOf('Nos clients nous notent 4,8/5 sur notre fiche.') }),
      gbpProfile: REAL_REVIEWS,
    })

    expect(verdict.blocking).toEqual([])
    expect(verdict.publishable).toBe(true)
  })

  it('refuse une note qui differe de celle de la fiche', async () => {
    // Le cas le plus insidieux : la fiche EST notee, donc rien n'alerte, et le
    // modele arrondit vers le haut. C'est une fausse mesure publiee, pas une
    // approximation de style.
    const verdict = await runGate({
      draft: draftOf({ summary: summaryOf('Une note de 5/5 sur notre fiche etablissement.') }),
      gbpProfile: REAL_REVIEWS,
    })

    expect(codes(verdict.blocking)).toContain('GBP_UNSUPPORTED_CLAIM')
    expect(verdict.blocking[0].message).toContain('4.8')
  })

  it('refuse une note quand la fiche n a jamais ete synchronisee', async () => {
    // Un profil absent n'arrete pas le moteur — voir le test suivant — mais il
    // ne peut etayer aucun chiffre. Publier une note sans source revient au meme
    // que la publier contre une source qui la contredit.
    const verdict = await runGate({
      draft: draftOf({ summary: summaryOf('Nos clients nous notent 4,8/5 sur notre fiche.') }),
      gbpProfile: null,
    })

    expect(codes(verdict.blocking)).toContain('GBP_UNSUPPORTED_CLAIM')
  })

  it('ne bloque PAS un post sans chiffre quand le profil est absent', async () => {
    // « Ne jamais arreter le moteur parce qu'une source manque » : l'absence de
    // profil ne ferme que les posts qui affirment un fait, pas la publication.
    const verdict = await runGate({ gbpProfile: null })

    expect(verdict.blocking).toEqual([])
    expect(verdict.publishable).toBe(true)
  })

  it('refuse une note quand reviews_summary est illisible', async () => {
    // La colonne est un jsonb : rien ne garantit sa forme. Une lecture ratee ne
    // doit surtout pas valoir autorisation — ni faire jeter le gate.
    const verdict = await runGate({
      draft: draftOf({ summary: summaryOf('Nos clients nous notent 4,8/5 sur notre fiche.') }),
      gbpProfile: profileWith({ moyenne: '4,8' }),
    })

    expect(codes(verdict.blocking)).toContain('GBP_UNSUPPORTED_CLAIM')
  })
})

// ─── 1. Integrite factuelle : le prix et la citation ─────────────────────────

describe('runGbpPostGate — un tarif ou un temoignage', () => {
  it('refuse tout montant en euros, faute de toute source de prix', async () => {
    // gbp_profiles ne porte aucune colonne de tarif (db/000_baseline.sql:425-443)
    // et fetchProfile n'en demande aucune : un montant est donc par construction
    // invente. La regle est severe dans le sens ou l'erreur coute le moins cher.
    const verdict = await runGate({
      draft: draftOf({ summary: summaryOf('Course vers la gare a partir de 25 euros.') }),
    })

    expect(codes(verdict.blocking)).toContain('GBP_UNSUPPORTED_CLAIM')
    expect(verdict.blocking[0].message).toContain('25 euros')
  })

  it('refuse un temoignage qu aucun avis de la fiche ne contient', async () => {
    const verdict = await runGate({
      draft: draftOf({
        summary: summaryOf('Un client nous ecrit : « le meilleur taxi de tout le departement ».'),
      }),
    })

    expect(codes(verdict.blocking)).toContain('GBP_UNSUPPORTED_CLAIM')
  })

  it('laisse passer une citation qui vient d un avis reel', async () => {
    // recent_positive est tronque a cent caracteres par summarizeReviews : la
    // comparaison accepte les deux sens d'inclusion, sinon aucun avis long ne
    // serait jamais reconnu.
    const verdict = await runGate({
      draft: draftOf({
        summary: summaryOf('Un client nous ecrit : « Chauffeur ponctuel et vehicule impeccable ».'),
      }),
    })

    expect(verdict.blocking).toEqual([])
  })

  it('ne prend pas un mot mis en relief pour un temoignage', async () => {
    // Le plancher de quinze caracteres est ce qui separe une citation d'une mise
    // en valeur typographique. Sans lui, ce controle deviendrait une regle de
    // ponctuation et refuserait des posts parfaitement exacts.
    const verdict = await runGate({
      draft: draftOf({ summary: summaryOf('Nous sommes un taxi « conventionne » a Troyes.') }),
    })

    expect(verdict.blocking).toEqual([])
  })
})

// ─── 2. Le tri ───────────────────────────────────────────────────────────────

describe('runGbpPostGate — ce que l agregat classe', () => {
  it('refuse un post trop proche d un post ecrit a la main par le proprietaire', async () => {
    // Les posts 'remote' entrent dans le MEME corpus que les notres. Les ignorer
    // ferait proposer de redire ce que le proprietaire vient d'ecrire : le plus
    // mauvais post possible, redondant ET visiblement automatique.
    const verdict = await runGate({
      draft: draftOf({ summary: PLAIN_SUMMARY }),
      recentPosts: [remotePost(PLAIN_SUMMARY)],
    })

    expect(codes(verdict.blocking)).toContain('GBP_DUPLICATE_SUMMARY')
    expect(verdict.publishable).toBe(false)
    // La mesure part vers l'ecran : « accepte » n'informe pas, « 1.00 » informe.
    expect(verdict.blocking[0].message).toContain('1.00')
  })

  it('refuse un post qui n annonce aucune page', async () => {
    const verdict = await runGate({ linkedGenerationId: null })

    expect(codes(verdict.blocking)).toContain('GBP_NO_LINK')
  })

  it('fait bloquer un defaut de format, sans le reformuler', async () => {
    // Le gate ne rejuge pas le format : il reprend le constat de
    // validateLocalPost tel quel et se contente de le classer.
    const verdict = await runGate({
      draft: draftOf({ callToAction: { actionType: 'BOOK', url: 'https://reservation-tiers.fr/x' } }),
    })

    expect(codes(verdict.blocking)).toContain('GBP_CTA_FOREIGN_DOMAIN')
    expect(verdict.publishable).toBe(false)
  })

  it('cumule les trois familles au lieu de s arreter a la premiere', async () => {
    // L'operateur doit voir tout d'un coup. Decouvrir le deuxieme defaut apres
    // avoir corrige le premier, c'est deux allers-retours pour un seul post.
    const verdict = await runGate({
      draft: draftOf({
        summary: summaryOf('Nos clients nous notent 4,8/5, course a partir de 25 €.'),
        callToAction: { actionType: 'CALL', url: 'https://taxi-troyes.fr/reserver' },
      }),
      linkedGenerationId: null,
      gbpProfile: NO_REVIEWS,
    })

    const found = codes(verdict.blocking)
    expect(found).toContain('GBP_CALL_HAS_URL')
    expect(found).toContain('GBP_NO_LINK')
    expect(found).toContain('GBP_UNSUPPORTED_CLAIM')
  })

  it('n emet aucun code que BLOCKING_GBP_CODES ne connaisse pas', async () => {
    // Un code inconnu de la liste serait un defaut silencieusement degrade en
    // avertissement au moment du tri : le post partirait. La verification porte
    // sur un brouillon volontairement mauvais de bout en bout.
    const verdict = await runGate({
      draft: draftOf({
        summary: summaryOf('Nos clients nous notent 4,8/5, course a partir de 25 €.'),
        callToAction: { actionType: 'CALL', url: 'https://taxi-troyes.fr/reserver' },
      }),
      linkedGenerationId: null,
      gbpProfile: NO_REVIEWS,
    })

    const known = new Set<string>([...BLOCKING_GBP_CODES, 'GBP_SUMMARY_OFF_TARGET'])
    for (const finding of [...verdict.blocking, ...verdict.warnings]) {
      expect(known.has(finding.code)).toBe(true)
      expect(finding.source).toBe('gbp')
    }
  })
})

// ─── La redaction du refus ───────────────────────────────────────────────────

describe('gbpRefusalMessage', () => {
  it('reprend la forme CODE: phrase de lib/pipeline/gate.ts', async () => {
    // Une seule mise en forme dans tout le produit : l'operateur lit la meme
    // chose qu'il s'agisse d'une page refusee ou d'un post refuse.
    const verdict = await runGate({ linkedGenerationId: null })

    expect(gbpRefusalMessage(verdict)).toContain('GBP_NO_LINK: ')
  })

  it('rend une chaine vide quand rien ne bloque', async () => {
    expect(gbpRefusalMessage(await runGate())).toBe('')
  })
})
