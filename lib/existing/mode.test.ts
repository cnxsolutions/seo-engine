// ─────────────────────────────────────────────────────────────────────────────
// Mode d'exploitation du gate anti-duplicat — tests
// SEO Engine - Le defaut ne doit JAMAIS bloquer.
// ─────────────────────────────────────────────────────────────────────────────
//
// Un seul fait est verrouille ici, mais c'est celui qui decide si le moteur
// continue de produire : seule la valeur exacte 'block' ferme la barriere.
// Toute autre — absente, vide, mal orthographiee, booleenne — laisse le gate en
// observation. Le bug empeche est un deploiement qui oublie la variable et se
// met a refuser des pages en silence.
//
// AUCUN TEST NE LIT NI NE MUTE process.env POUR SA VALEUR. L'environnement est
// passe en parametre, ce qui est precisement ce que la signature existe pour
// permettre : un test qui poserait process.env.SEO_DUPLICATE_GATE fuirait dans
// tous les fichiers executes apres lui par le meme worker vitest.

import { describe, expect, it } from 'vitest'
import { duplicateGateMode, type DuplicateGateMode } from './mode'

/**
 * Tout ce qui ne doit pas bloquer. `true`, `1`, `yes` et `on` y figurent
 * expressement : un implementeur qui lirait ce drapeau comme un booleen les
 * ferait tous bloquer, et la variable n'aurait plus de valeur « observe »
 * ecrivable — dire explicitement `SEO_DUPLICATE_GATE=observe` reviendrait alors
 * a bloquer aussi.
 */
const VALEURS_OBSERVE: readonly string[] = [
  '',
  ' ',
  'observe',
  'OBSERVE',
  'blok',
  'blocked',
  'blocking',
  'bloquer',
  'no-block',
  'block,observe',
  'true',
  '1',
  'yes',
  'on',
]

/**
 * Tout ce qui doit bloquer. Une espace de bord ou une majuscule vient d'un
 * fichier .env ou d'un panneau d'hebergeur, pas d'une hesitation : l'operateur
 * a decide de bloquer, et lui repondre 'observe' sans un mot rendrait la
 * bascule du mode bloquant impossible a diagnostiquer.
 */
const VALEURS_BLOCK: readonly string[] = [
  'block',
  'BLOCK',
  'Block',
  ' block',
  'block ',
  '  BLOCK  ',
  '\tblock\n',
]

describe('duplicateGateMode', () => {
  // ─── Le defaut, qui ne bloque rien ─────────────────────────────────────────

  it('rend observe quand la variable est absente', () => {
    expect(duplicateGateMode({})).toBe('observe')
  })

  it('rend observe quand la variable est explicitement undefined', () => {
    // Ce que rend reellement process.env pour une cle jamais posee : la lecture
    // ne doit pas jeter sur l'acces a `.trim()` d'un undefined.
    expect(duplicateGateMode({ SEO_DUPLICATE_GATE: undefined })).toBe('observe')
  })

  it.each(VALEURS_OBSERVE)('rend observe sur la valeur %j', value => {
    expect(duplicateGateMode({ SEO_DUPLICATE_GATE: value })).toBe('observe')
  })

  // ─── La seule valeur qui ferme la barriere ─────────────────────────────────

  it('rend block sur la valeur exacte', () => {
    expect(duplicateGateMode({ SEO_DUPLICATE_GATE: 'block' })).toBe('block')
  })

  it.each(VALEURS_BLOCK)('rend block sur la valeur %j : la casse et les espaces de bord ne changent pas le verdict', value => {
    expect(duplicateGateMode({ SEO_DUPLICATE_GATE: value })).toBe('block')
  })

  // ─── La lecture ambiante, qui reste un defaut de parametre ─────────────────

  it('lit process.env quand aucun environnement n est donne', () => {
    // On compare deux appels plutot que d'affirmer une valeur : affirmer
    // 'observe' ferait echouer la suite chez l'operateur qui a justement pose
    // SEO_DUPLICATE_GATE=block dans son shell pour verifier la bascule. Ce qui
    // est verrouille, c'est que le defaut du parametre EST process.env — le
    // jour ou quelqu'un le remplace par un objet fige, ceci casse.
    expect(duplicateGateMode()).toBe(duplicateGateMode(process.env))
  })

  it('ne rend jamais autre chose que les deux modes', () => {
    // Le typage seul ne suffirait pas : la valeur vient d'une chaine
    // d'environnement, et un `as DuplicateGateMode` pose un jour au retour
    // laisserait passer n'importe quoi jusqu'au jsonb persiste.
    const modes: DuplicateGateMode[] = [...VALEURS_OBSERVE, ...VALEURS_BLOCK].map(value =>
      duplicateGateMode({ SEO_DUPLICATE_GATE: value }),
    )

    for (const mode of modes) {
      expect(['observe', 'block']).toContain(mode)
    }
  })
})
