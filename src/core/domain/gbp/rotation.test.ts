// ─────────────────────────────────────────────────────────────────────────────
// rotation — l'anti-duplication des posts de fiche, prise pour elle-meme
//
// Chaque test decrit un mode d'echec REEL du produit : republier l'angle de la
// semaine derniere, annoncer deux fois la meme page, parler d'avis qui n'existent
// pas, ou redire ce que le proprietaire vient d'ecrire a la main sur sa fiche.
//
// Aucune horloge, aucun double, aucun reseau : le module est pur, ses tests le
// sont aussi.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  ANGLE_COOLDOWN,
  GBP_POST_ANGLES,
  LINK_COOLDOWN,
  POST_SIMILARITY_BLOCK,
  RECENT_POST_WINDOW,
  describeAngles,
  fingerprintSummary,
  judgePostOriginality,
  linksInCooldown,
  nextAngle,
  type AngleAvailability,
  type GbpPostAngle,
  type RecentPost,
} from './rotation'

/** Un post de la fiche, dont on ne precise que ce que le test regarde. */
function post(overrides: Partial<RecentPost> = {}): RecentPost {
  return {
    angle: 'service',
    summary: 'Un resume sans rapport avec quoi que ce soit d autre.',
    linkedGenerationId: null,
    publishedAt: '2026-08-01T09:00:00.000Z',
    source: 'engine',
    ...overrides,
  }
}

/** Une fiche qui a tout pour parler : aucun angle ferme par la matiere. */
const RICHE: AngleAvailability = { hasRealReviews: true, hasUnlinkedPublishedPage: true }

/** Le motif de fermeture d'un angle, ou null. */
function reasonFor(
  options: readonly { angle: GbpPostAngle; reason: string | null }[],
  angle: GbpPostAngle,
): string | null {
  return options.find(option => option.angle === angle)?.reason ?? null
}

// ─── Barriere amont : le choix de l'angle ───────────────────────────────────

describe('nextAngle', () => {
  it('ne propose aucun angle servi dans les derniers posts', () => {
    const recent = [post({ angle: 'service' }), post({ angle: 'zone' }), post({ angle: 'horaires' })]

    const chosen = nextAngle(recent, RICHE)

    expect(chosen).not.toBeNull()
    expect(['service', 'zone', 'horaires']).not.toContain(chosen)
  })

  it('rouvre un angle des qu il sort de la fenetre de cooldown', () => {
    // 'service' est a l'index 3, donc au-dela des ANGLE_COOLDOWN derniers.
    const recent = [
      post({ angle: 'faq' }),
      post({ angle: 'saison' }),
      post({ angle: 'avis' }),
      post({ angle: 'service' }),
    ]

    expect(reasonFor(describeAngles(recent, RICHE), 'service')).toBeNull()
    expect(reasonFor(describeAngles(recent.slice(1), RICHE), 'faq')).toBeNull()
    expect(reasonFor(describeAngles(recent, RICHE), 'faq')).toBe('angle-en-cooldown')
  })

  it('exclut avis quand la fiche ne porte aucun avis reel', () => {
    const recent = [post({ angle: 'service' }), post({ angle: 'zone' }), post({ angle: 'horaires' })]

    // Controle positif : sur une fiche qui porte de vrais avis, c'est
    // precisement 'avis' que la rotation servirait ici.
    expect(nextAngle(recent, RICHE)).toBe('avis')

    const sansAvis: AngleAvailability = { hasRealReviews: false, hasUnlinkedPublishedPage: true }

    expect(nextAngle(recent, sansAvis)).not.toBe('avis')
    expect(reasonFor(describeAngles(recent, sansAvis), 'avis')).toBe('aucun-avis-reel')
  })

  it('exclut nouvelle-page quand aucune page publiee n attend d etre annoncee', () => {
    const recent = [post({ angle: 'faq' }), post({ angle: 'saison' }), post({ angle: 'service' })]
    const pauvre = {
      hasRealReviews: false,
      hasDeclaredHours: false,
      hasServiceArea: false,
    }

    expect(nextAngle(recent, { ...pauvre, hasUnlinkedPublishedPage: true })).toBe('nouvelle-page')

    const sansPage: AngleAvailability = { ...pauvre, hasUnlinkedPublishedPage: false }

    expect(nextAngle(recent, sansPage)).not.toBe('nouvelle-page')
    expect(reasonFor(describeAngles(recent, sansPage), 'nouvelle-page')).toBe(
      'aucune-page-a-annoncer',
    )
  })

  it('rend null plutot qu un angle interdit quand plus rien n est disponible', () => {
    // Une fiche qui ne declare ni avis, ni horaires, ni zone, ni service, et
    // dont les trois derniers posts ont consomme le peu qui restait. Le creneau
    // est REPORTE : mieux vaut ne rien publier qu'un post redondant.
    const recent = [post({ angle: 'faq' }), post({ angle: 'saison' }), post({ angle: 'service' })]

    const chosen = nextAngle(recent, {
      hasRealReviews: false,
      hasUnlinkedPublishedPage: false,
      hasDeclaredHours: false,
      hasServiceArea: false,
      hasNamedServices: false,
    })

    expect(chosen).toBeNull()
  })

  it('sert l angle le moins recemment employe, jamais le premier venu', () => {
    // Les sept angles ont servi. Les trois derniers sont en cooldown ; parmi les
    // quatre restants, c'est le plus ancien qui revient.
    const recent = [
      post({ angle: 'faq' }),
      post({ angle: 'saison' }),
      post({ angle: 'avis' }),
      post({ angle: 'zone' }),
      post({ angle: 'service' }),
      post({ angle: 'horaires' }),
      post({ angle: 'nouvelle-page' }),
    ]

    expect(nextAngle(recent, RICHE)).toBe('nouvelle-page')
  })

  it('prefere un angle jamais employe a un angle simplement ancien', () => {
    const recent = [
      post({ angle: 'faq' }),
      post({ angle: 'saison' }),
      post({ angle: 'avis' }),
      post({ angle: 'zone' }),
      post({ angle: 'service' }),
    ]

    // 'horaires' et 'nouvelle-page' n'ont jamais servi ; l'ordre de declaration
    // tranche entre eux, et il place le factuel avant le circonstanciel.
    expect(nextAngle(recent, RICHE)).toBe('horaires')
  })

  it('compte les posts ecrits a la main dans la fenetre, sans leur preter d angle', () => {
    const remote = post({ angle: null, source: 'remote' })

    // Deux posts du proprietaire ne suffisent pas a faire sortir le notre du
    // cooldown : il reste a l'index 2.
    expect(reasonFor(describeAngles([remote, remote, post({ angle: 'service' })], RICHE), 'service'))
      .toBe('angle-en-cooldown')

    // Trois, si. Ce que le proprietaire publie fait bel et bien avancer la
    // rotation, il ne la fige pas.
    expect(
      reasonFor(
        describeAngles([remote, remote, remote, post({ angle: 'service' })], RICHE),
        'service',
      ),
    ).toBeNull()
  })
})

describe('describeAngles', () => {
  it('decrit les sept angles, dans l ordre, avec un motif sur chaque angle ferme', () => {
    const options = describeAngles([post({ angle: 'service' })], {
      hasRealReviews: false,
      hasUnlinkedPublishedPage: false,
      hasDeclaredHours: false,
      hasServiceArea: false,
      hasNamedServices: false,
    })

    expect(options.map(option => option.angle)).toEqual([...GBP_POST_ANGLES])
    expect(options.every(option => option.available === (option.reason === null))).toBe(true)
    expect(reasonFor(options, 'horaires')).toBe('aucun-horaire-declare')
    expect(reasonFor(options, 'zone')).toBe('aucune-zone-declaree')
    // Ferme par le cooldown ET par la matiere : le motif qui se levera tout seul
    // est annonce en premier.
    expect(reasonFor(options, 'service')).toBe('angle-en-cooldown')
  })

  it('suppose disponible ce que l appelant n a pas renseigne', () => {
    // Un appelant qui ne lit pas les horaires du profil ne doit pas geler la
    // rotation : une information non lue n'est pas une information absente.
    const options = describeAngles([], RICHE)

    expect(options.every(option => option.available)).toBe(true)
  })
})

// ─── Le cooldown de lien ────────────────────────────────────────────────────

describe('linksInCooldown', () => {
  it('retient les pages annoncees dans les derniers posts et relache les autres', () => {
    const recent = [
      post({ linkedGenerationId: 'gen-recente' }),
      post({ linkedGenerationId: null }),
      post({ linkedGenerationId: null }),
      post({ linkedGenerationId: 'gen-limite' }),
      post({ linkedGenerationId: 'gen-ancienne' }),
    ]

    const bloquees = linksInCooldown(recent)

    expect(bloquees.has('gen-recente')).toBe(true)
    // A l'index LINK_COOLDOWN - 1 : encore dans la fenetre.
    expect(bloquees.has('gen-limite')).toBe(true)
    // A l'index LINK_COOLDOWN : elle est de nouveau annoncable.
    expect(bloquees.has('gen-ancienne')).toBe(false)
    expect(recent.length).toBeGreaterThan(LINK_COOLDOWN)
  })
})

// ─── Barriere aval : le jugement du brouillon ───────────────────────────────

const PLOMBERIE =
  'Notre equipe de plomberie intervient chaque jour a Troyes pour vos fuites, vos chauffe-eau et vos installations sanitaires. Appelez-nous pour une intervention rapide.'

const PLOMBERIE_REDITE =
  'Notre equipe de plomberie intervient chaque jour a Troyes pour vos fuites, vos chauffe-eau et vos installations sanitaires. Contactez-nous pour un rendez-vous.'

// Volontairement du meme metier et de la meme ville : deux posts d'une meme
// entreprise partagent TOUJOURS du vocabulaire, et un test dont les deux textes
// n'ont pas un mot commun ne prouverait rien du seuil.
const HORAIRES =
  'Nos horaires changent en aout : le bureau de Troyes ferme le lundi matin. Les urgences de plomberie restent prises en charge sept jours sur sept.'

describe('judgePostOriginality', () => {
  it('refuse un brouillon qui redit un post ecrit a la main sur la fiche', () => {
    // Le proprietaire vient d'ecrire ce post lui-meme : c'est exactement celui
    // que le moteur ne doit pas repeter.
    const recent = [post({ angle: null, source: 'remote', summary: PLOMBERIE })]

    const verdict = judgePostOriginality(
      { summary: PLOMBERIE_REDITE, angle: 'zone', linkedGenerationId: 'gen-1' },
      recent,
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reasons).toContain('GBP_DUPLICATE_SUMMARY')
    expect(verdict.worstSimilarity).toBeGreaterThanOrEqual(POST_SIMILARITY_BLOCK)
    expect(verdict.againstSummary).toBe(PLOMBERIE)
  })

  it('accepte un brouillon qui parle d autre chose, et mesure quand meme', () => {
    const recent = [post({ angle: null, source: 'remote', summary: PLOMBERIE })]

    const verdict = judgePostOriginality(
      { summary: HORAIRES, angle: 'horaires', linkedGenerationId: 'gen-1' },
      recent,
    )

    expect(verdict.ok).toBe(true)
    expect(verdict.reasons).toEqual([])
    // Le score est rendu meme sur un brouillon accepte : c'est lui que l'ecran
    // affiche a cote du seuil.
    expect(verdict.worstSimilarity).toBeLessThan(POST_SIMILARITY_BLOCK)
  })

  it('refuse un brouillon sans page liee, et mesure malgre le refus', () => {
    const recent = [post({ summary: PLOMBERIE })]

    const verdict = judgePostOriginality(
      { summary: HORAIRES, angle: 'horaires', linkedGenerationId: null },
      recent,
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reasons).toEqual(['GBP_NO_LINK'])
    expect(verdict.worstSimilarity).toBeGreaterThan(0)
    expect(verdict.againstSummary).toBe(PLOMBERIE)
  })

  it('cumule le cooldown d angle et celui de lien plutot que de s arreter au premier', () => {
    const recent = [
      post({ angle: 'service', linkedGenerationId: 'gen-1', summary: HORAIRES }),
      post({ angle: 'zone' }),
      post({ angle: 'faq' }),
    ]

    const verdict = judgePostOriginality(
      { summary: 'Un texte neuf, qui ne ressemble a rien de ce qui precede.', angle: 'service', linkedGenerationId: 'gen-1' },
      recent,
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reasons).toContain('GBP_ANGLE_COOLDOWN')
    expect(verdict.reasons).toContain('GBP_LINK_COOLDOWN')
    expect(ANGLE_COOLDOWN).toBeLessThanOrEqual(recent.length)
  })

  it('ne compare qu a la fenetre recente, pas a tout l historique', () => {
    const filler = post({ angle: null, source: 'remote', summary: HORAIRES })
    const recent = [
      ...Array.from({ length: RECENT_POST_WINDOW }, () => filler),
      post({ angle: null, source: 'remote', summary: PLOMBERIE }),
    ]

    const verdict = judgePostOriginality(
      { summary: PLOMBERIE_REDITE, angle: 'service', linkedGenerationId: 'gen-1' },
      recent,
    )

    // Le jumeau est a l'index RECENT_POST_WINDOW : hors fenetre, donc invisible.
    // Un doublon vieux d'un trimestre n'est plus percu comme un doublon.
    expect(verdict.ok).toBe(true)
    expect(verdict.worstSimilarity).toBeLessThan(POST_SIMILARITY_BLOCK)
  })
})

// ─── Empreinte ──────────────────────────────────────────────────────────────

describe('fingerprintSummary', () => {
  it('ignore l ordre des mots, la casse, les accents et les mots outils', () => {
    const empreinte = fingerprintSummary('Dépannage rapide à Troyes')

    expect(fingerprintSummary('troyes rapide depannage')).toBe(empreinte)
    expect(fingerprintSummary('Un depannage rapide, pour tout Troyes !')).toBe(empreinte)
  })

  it('separe deux sujets differents', () => {
    expect(fingerprintSummary(PLOMBERIE)).not.toBe(fingerprintSummary(HORAIRES))
  })

  it('rend toujours huit caracteres hexadecimaux, meme sur un resume vide', () => {
    expect(fingerprintSummary(PLOMBERIE)).toMatch(/^[0-9a-f]{8}$/)
    expect(fingerprintSummary('')).toMatch(/^[0-9a-f]{8}$/)
  })
})
