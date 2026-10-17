import { describe, expect, it } from 'vitest'
import { isRegenerable } from './regeneration'

describe('isRegenerable', () => {
  it('reecrit une page refusee pour ce que le modele a ecrit', () => {
    expect(isRegenerable(['H1_KEYWORD: le H1 ne contient pas le mot-cle', 'SCANNABLE: aucune liste'])).toBe(true)
  })

  it('ne paie pas une reecriture qui garderait la meme adresse ou la meme requete', () => {
    // L'adresse est reservee et le mot-cle vient du plan : deux regenerations
    // de plus seraient refusees a l'identique.
    expect(isRegenerable(['SLUG_COLLISION: Adresse deja occupee par /taxi-troyes'])).toBe(false)
    expect(isRegenerable(['CANNIBALIZATION: Meme requete visee que /taxi-troyes (82 %)'])).toBe(false)
  })

  it('ne reecrit pas quand un defaut corrigeable cotoie une cannibalisation', () => {
    expect(isRegenerable(['TITLE_LENGTH: 74 caracteres', 'CANNIBALIZATION: Meme requete visee que /x'])).toBe(false)
  })

  it('une liste vide n est pas un refus', () => {
    expect(isRegenerable([])).toBe(false)
  })
})
