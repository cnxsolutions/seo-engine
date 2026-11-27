import { describe, expect, it } from 'vitest'
import { maskEmail } from './email-preference'

describe('maskEmail', () => {
  it('garde deux lettres et le domaine : un e-mail transféré ne livre pas l’adresse entière', () => {
    expect(maskEmail('marie@martin-batiment.test')).toBe('ma…@martin-batiment.test')
    expect(maskEmail('a@b.fr')).toBe('a…@b.fr')
  })

  it('ne livre rien d’une valeur qui n’est pas une adresse', () => {
    expect(maskEmail('pas-une-adresse')).toBe('…')
    expect(maskEmail('@domaine.fr')).toBe('…')
  })
})
