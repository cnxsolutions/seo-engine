// ─────────────────────────────────────────────────────────────────────────────
// Mode d'exploitation du gate anti-duplicat — tests
// SEO Engine - Le defaut BLOQUE, depuis le 2026-10-17.
// ─────────────────────────────────────────────────────────────────────────────
//
// Un seul fait est verrouille ici : seule la valeur exacte 'observe' rouvre
// l'observation. Toute autre — absente, vide, mal orthographiee, booleenne —
// laisse la barriere fermee. Le bug empeche est l'inverse de celui de la
// premiere livraison : un deploiement qui oublie la variable, ou l'ecrit mal,
// ne doit jamais se remettre a publier des doublons sans que personne ne l'ait
// decide. Une page retenue est regeneree (lib/scheduler/cron.ts) ; un doublon
// publie, lui, reste en ligne.
//
// AUCUN TEST NE LIT NI NE MUTE process.env POUR SA VALEUR. L'environnement est
// passe en parametre, ce qui est precisement ce que la signature existe pour
// permettre : un test qui poserait process.env.SEO_DUPLICATE_GATE fuirait dans
// tous les fichiers executes apres lui par le meme worker vitest.

import { describe, expect, it } from 'vitest'
import { duplicateGateMode, type DuplicateGateMode } from './mode'

/**
 * Tout ce qui doit bloquer. `false`, `0`, `no` et `off` y figurent expressement :
 * un implementeur qui lirait ce drapeau comme un booleen les ferait tous
 * observer, et 'observ' — une faute de frappe — rouvrirait la porte aux doublons.
 */
const VALEURS_BLOCK: readonly string[] = [
  '',
  ' ',
  'block',
  'BLOCK',
  ' block ',
  'blok',
  'observ',
  'observed',
  'observer',
  'observation',
  'no-observe',
  'observe,block',
  'false',
  '0',
  'no',
  'off',
]

/**
 * Tout ce qui doit observer. Une espace de bord ou une majuscule vient d'un
 * fichier .env ou d'un panneau d'hebergeur, pas d'une hesitation : l'operateur
 * a decide d'observer, et lui repondre 'block' sans un mot rendrait le retour a
 * l'observation impossible a diagnostiquer.
 */
const VALEURS_OBSERVE: readonly string[] = [
  'observe',
  'OBSERVE',
  'Observe',
  ' observe',
  'observe ',
  '  OBSERVE  ',
  '\tobserve\n',
]

describe('duplicateGateMode', () => {
  // ─── Le defaut, qui bloque ─────────────────────────────────────────────────

  it('rend block quand la variable est absente', () => {
    expect(duplicateGateMode({})).toBe('block')
  })

  it('rend block quand la variable est explicitement undefined', () => {
    // Ce que rend reellement process.env pour une cle jamais posee : la lecture
    // ne doit pas jeter sur l'acces a `.trim()` d'un undefined.
    expect(duplicateGateMode({ SEO_DUPLICATE_GATE: undefined })).toBe('block')
  })

  it.each(VALEURS_BLOCK)('rend block sur la valeur %j', value => {
    expect(duplicateGateMode({ SEO_DUPLICATE_GATE: value })).toBe('block')
  })

  // ─── La seule valeur qui rouvre l'observation ──────────────────────────────

  it('rend observe sur la valeur exacte', () => {
    expect(duplicateGateMode({ SEO_DUPLICATE_GATE: 'observe' })).toBe('observe')
  })

  it.each(VALEURS_OBSERVE)('rend observe sur la valeur %j : la casse et les espaces de bord ne changent pas le verdict', value => {
    expect(duplicateGateMode({ SEO_DUPLICATE_GATE: value })).toBe('observe')
  })

  // ─── La lecture ambiante, qui reste un defaut de parametre ─────────────────

  it('lit process.env quand aucun environnement n est donne', () => {
    // On compare deux appels plutot que d'affirmer une valeur : affirmer
    // 'block' ferait echouer la suite chez l'operateur qui a justement pose
    // SEO_DUPLICATE_GATE=observe dans son shell pour verifier la bascule. Ce qui
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
