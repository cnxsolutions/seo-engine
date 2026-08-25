// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Verdict Tests
// SEO Engine - Domain
// ─────────────────────────────────────────────────────────────────────────────
//
// Le verdict traverse un jsonb : il est ecrit par une version du code et relu
// par une autre, parfois edite a la main pendant un incident. La suite verrouille
// donc trois choses : que l'ordre de gravite est bien l'ordre du tableau, que
// CANNIBALIZATION ne bloque pas, et qu'aucune forme de jsonb malforme ne fait
// jeter la relecture — un feed qui plante sur une ligne abimee cache les vingt
// autres.

import { describe, it, expect } from 'vitest'
import {
  BLOCKING_DUPLICATE_CODES,
  DUPLICATE_CODES,
  type DuplicateMatchEvidence,
  buildDuplicateVerdict,
  isBlocking,
  isDuplicateCode,
  parseDuplicateVerdict,
  summarizeVerdict,
} from './verdict'

const QUAND = new Date('2026-08-21T12:00:00.000Z')

function preuve(overrides: Partial<DuplicateMatchEvidence> = {}): DuplicateMatchEvidence {
  return {
    entryKey: 'page:/taxi-troyes',
    entryPath: '/taxi-troyes',
    code: 'CANNIBALIZATION',
    similarity: 0.5,
    partial: false,
    ...overrides,
  }
}

describe('le vocabulaire', () => {
  it('n a aucun doublon et porte six codes', () => {
    expect(new Set(DUPLICATE_CODES).size).toBe(DUPLICATE_CODES.length)
    expect(DUPLICATE_CODES.length).toBe(6)
  })

  it('exclut CANNIBALIZATION des codes bloquants', () => {
    // Deux pages qui se disputent une requete est un fait a corriger
    // editorialement, jamais une raison de retenir une publication.
    expect(BLOCKING_DUPLICATE_CODES).not.toContain('CANNIBALIZATION')
    expect(BLOCKING_DUPLICATE_CODES.length).toBe(DUPLICATE_CODES.length - 1)
  })

  it('reconnait un code et rejette tout le reste', () => {
    expect(isDuplicateCode('SLUG_COLLISION')).toBe(true)
    expect(isDuplicateCode('slug_collision')).toBe(false)
    expect(isDuplicateCode('INVENTE')).toBe(false)
    expect(isDuplicateCode(null)).toBe(false)
    expect(isDuplicateCode(3)).toBe(false)
  })
})

describe('isBlocking', () => {
  it('bloque des qu une seule ligne porte un code bloquant', () => {
    const verdict = buildDuplicateVerdict(
      {
        decidedBy: 'policy',
        mode: 'block',
        reasons: [],
        matches: [preuve(), preuve({ code: 'META_NEAR_DUPLICATE' })],
      },
      QUAND,
    )

    expect(isBlocking(verdict)).toBe(true)
  })

  it('ne bloque pas un verdict qui ne porte que des avertissements', () => {
    const verdict = buildDuplicateVerdict(
      { decidedBy: 'policy', mode: 'block', reasons: [], matches: [preuve()] },
      QUAND,
    )

    expect(isBlocking(verdict)).toBe(false)
  })

  it('ne bloque pas un verdict sans preuve', () => {
    const verdict = buildDuplicateVerdict(
      { decidedBy: 'policy', mode: 'observe', reasons: ['aucun candidat'], matches: [] },
      QUAND,
    )

    expect(isBlocking(verdict)).toBe(false)
  })

  it('ignore le mode : les preuves ne changent pas selon ce qu on en fait', () => {
    const matches = [preuve({ code: 'DUPLICATE_EXACT', similarity: 1 })]
    const observe = buildDuplicateVerdict(
      { decidedBy: 'policy', mode: 'observe', reasons: [], matches },
      QUAND,
    )
    const bloque = buildDuplicateVerdict(
      { decidedBy: 'policy', mode: 'block', reasons: [], matches },
      QUAND,
    )

    expect(isBlocking(observe)).toBe(isBlocking(bloque))
  })
})

describe('summarizeVerdict', () => {
  it('designe la ligne la plus grave selon l ordre du tableau', () => {
    const verdict = buildDuplicateVerdict(
      {
        decidedBy: 'policy',
        mode: 'block',
        reasons: [],
        matches: [
          preuve({ code: 'SLUG_COLLISION', entryPath: '/a' }),
          preuve({ code: 'DUPLICATE_NEAR', entryPath: '/b', entryUrl: 'https://x.fr/b' }),
          preuve({ code: 'CANNIBALIZATION', entryPath: '/c' }),
        ],
      },
      QUAND,
    )

    expect(summarizeVerdict(verdict)).toEqual({
      code: 'DUPLICATE_NEAR',
      targetUrl: 'https://x.fr/b',
    })
  })

  it('omet targetUrl quand la preuve n a pas d URL', () => {
    const verdict = buildDuplicateVerdict(
      { decidedBy: 'policy', mode: 'block', reasons: [], matches: [preuve()] },
      QUAND,
    )

    expect(summarizeVerdict(verdict)).toEqual({ code: 'CANNIBALIZATION' })
  })

  it('rend null quand il n y a rien a montrer', () => {
    const verdict = buildDuplicateVerdict(
      { decidedBy: 'policy', mode: 'observe', reasons: ['rien'], matches: [] },
      QUAND,
    )

    expect(summarizeVerdict(verdict)).toBeNull()
  })
})

describe('buildDuplicateVerdict', () => {
  it('date le verdict avec l horloge recue, pas avec celle du processus', () => {
    const verdict = buildDuplicateVerdict(
      { decidedBy: 'operator', mode: 'observe', reasons: [], matches: [] },
      QUAND,
    )

    expect(verdict.decidedAt).toBe('2026-08-21T12:00:00.000Z')
    expect(verdict.decidedBy).toBe('operator')
    expect(verdict.mode).toBe('observe')
  })

  it('recopie les tableaux recus', () => {
    // Le verdict part vers un UPDATE et vers un ecran. Une mutation ulterieure
    // du tableau de l'appelant reecrirait apres coup une preuve deja affichee.
    const reasons = ['une raison']
    const matches = [preuve()]
    const verdict = buildDuplicateVerdict(
      { decidedBy: 'policy', mode: 'block', reasons, matches },
      QUAND,
    )

    reasons.push('ajoutee apres coup')
    matches[0].code = 'DUPLICATE_EXACT'

    expect(verdict.reasons).toEqual(['une raison'])
    expect(verdict.matches[0].code).toBe('CANNIBALIZATION')
  })
})

describe('parseDuplicateVerdict', () => {
  const MALFORMES: unknown[] = [
    null,
    undefined,
    0,
    'DUPLICATE_EXACT',
    true,
    [],
    [{ code: 'DUPLICATE_EXACT' }],
    {},
    { decidedAt: 42 },
    { decidedAt: '' },
    { decidedAt: '2026-08-21T12:00:00.000Z', matches: 'oui', reasons: 3 },
    { decidedAt: '2026-08-21T12:00:00.000Z', matches: [null, 7, 'x'] },
  ]

  it('ne jette sur aucune forme de jsonb malforme', () => {
    for (const raw of MALFORMES) {
      expect(() => parseDuplicateVerdict(raw)).not.toThrow()
    }
  })

  it('rend null tant qu il n y a pas de trace de decision', () => {
    // La colonne existe pour dire par qui et QUAND. Un objet sans date n'est
    // pas un verdict ; l'afficher ferait croire a un refus qu'on ne saurait
    // pas situer.
    for (const raw of MALFORMES.slice(0, 10)) {
      expect(parseDuplicateVerdict(raw)).toBeNull()
    }
  })

  it('accepte un verdict date mais vide de preuves', () => {
    // C'est la forme d'un passage en mode observation qui n'a rien trouve : la
    // preuve que le controle a bien tourne. La perdre effacerait ce fait.
    const verdict = parseDuplicateVerdict({
      decidedAt: '2026-08-21T12:00:00.000Z',
      matches: 'oui',
      reasons: 3,
    })

    expect(verdict).toEqual({
      decidedBy: 'policy',
      decidedAt: '2026-08-21T12:00:00.000Z',
      mode: 'observe',
      reasons: [],
      matches: [],
    })
  })

  it('ecarte les lignes de preuve qui ne designent rien', () => {
    const verdict = parseDuplicateVerdict({
      decidedBy: 'robot',
      decidedAt: '2026-08-21T12:00:00.000Z',
      mode: 'blok',
      reasons: ['deux titres trop proches', 7, null],
      matches: [
        {
          entryKey: 'page:/taxi-troyes',
          entryPath: '/taxi-troyes',
          entryUrl: 'https://x.fr/taxi-troyes',
          code: 'TITLE_NEAR_DUPLICATE',
          similarity: 0.91,
          partial: true,
        },
        { entryKey: 'generation:1', entryPath: '/a', code: 'INVENTE', similarity: 1 },
        { entryPath: '/sans-clef', code: 'SLUG_COLLISION', similarity: 1 },
        { entryKey: 'page:/b', code: 'SLUG_COLLISION', similarity: 1 },
        'pas un objet',
        {
          entryKey: 'page:/c',
          entryPath: '/c',
          code: 'DUPLICATE_NEAR',
          similarity: 12,
          partial: 'oui',
        },
      ],
    })

    expect(verdict).not.toBeNull()
    expect(verdict?.matches).toHaveLength(2)
    expect(verdict?.matches[0].partial).toBe(true)
    expect(verdict?.reasons).toEqual(['deux titres trop proches'])

    const dernier = verdict?.matches[1]
    expect(dernier?.code).toBe('DUPLICATE_NEAR')
    // Un score hors bornes est une mesure fausse, pas une certitude.
    expect(dernier?.similarity).toBe(1)
    // 'oui' n'est pas vrai : seule la valeur booleenne compte, sinon toute
    // comparaison relue passerait pour partielle.
    expect(dernier?.partial).toBe(false)
  })

  it('ne durcit jamais sur une valeur approximative', () => {
    // Meme regle que le drapeau d'exploitation : une faute de frappe relue
    // depuis la base ne doit pas faire compter une observation comme un
    // blocage, ni attribuer a un humain une decision de la politique.
    const verdict = parseDuplicateVerdict({
      decidedAt: '2026-08-21T12:00:00.000Z',
      decidedBy: 'Operator',
      mode: 'BLOCK',
    })

    expect(verdict?.mode).toBe('observe')
    expect(verdict?.decidedBy).toBe('policy')
  })

  it('relit a l identique ce que buildDuplicateVerdict a ecrit', () => {
    const verdict = buildDuplicateVerdict(
      {
        decidedBy: 'operator',
        mode: 'block',
        reasons: ['collision de slug'],
        matches: [preuve({ code: 'SLUG_COLLISION', similarity: 1, entryUrl: 'https://x.fr/t' })],
      },
      QUAND,
    )

    // Le passage par JSON est ce que la colonne jsonb fait reellement subir au
    // verdict : ce qui n'y survit pas n'existe pas en base.
    expect(parseDuplicateVerdict(JSON.parse(JSON.stringify(verdict)))).toEqual(verdict)
  })
})
