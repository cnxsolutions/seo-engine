import { describe, expect, it } from 'vitest'
import { normalizeSiteUrl } from './site-url'

describe('normalizeSiteUrl', () => {
  it('reconnait la meme adresse sous ses variantes', () => {
    // Le doublon du 12/10 : deux fiches « AFS » pour https://afs-maintenance.fr.
    const expected = 'afs-maintenance.fr'
    for (const variant of [
      'https://afs-maintenance.fr',
      'https://afs-maintenance.fr/',
      'http://AFS-Maintenance.fr//',
      'https://www.afs-maintenance.fr',
      '  afs-maintenance.fr  ',
    ]) {
      expect(normalizeSiteUrl(variant)).toBe(expected)
    }
  })

  it('garde le chemin, qui distingue deux sites sur un meme domaine', () => {
    expect(normalizeSiteUrl('https://exemple.fr/blog/')).toBe('exemple.fr/blog')
    expect(normalizeSiteUrl('https://exemple.fr/blog')).not.toBe(normalizeSiteUrl('https://exemple.fr'))
  })
})
