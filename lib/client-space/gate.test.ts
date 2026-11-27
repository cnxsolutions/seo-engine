import { describe, expect, it } from 'vitest'
import { isClientSpacePath, isPublicClientPath } from './gate'

describe('client space gate', () => {
  it('reconnaît les chemins de l’espace, et seulement eux', () => {
    expect(isClientSpacePath('/espace')).toBe(true)
    expect(isClientSpacePath('/api/espace/sites/s1/demandes')).toBe(true)
    expect(isClientSpacePath('/espacex')).toBe(false)
    expect(isClientSpacePath('/dashboard')).toBe(false)
  })

  it('ouvre sans session la connexion et la désinscription, rien d’autre', () => {
    expect(isPublicClientPath('/espace/connexion')).toBe(true)
    expect(isPublicClientPath('/api/espace/connexion/code')).toBe(true)
    expect(isPublicClientPath('/auth/callback')).toBe(true)
    expect(isPublicClientPath('/espace/desinscription/6f1c2c8e-1111-4a4a-9b9b-123456789abc')).toBe(true)
    expect(isPublicClientPath('/api/espace/desinscription/6f1c2c8e-1111-4a4a-9b9b-123456789abc')).toBe(true)

    expect(isPublicClientPath('/espace')).toBe(false)
    expect(isPublicClientPath('/espace/s1/demandes')).toBe(false)
    expect(isPublicClientPath('/api/espace/sites/s1/demandes')).toBe(false)
    expect(isPublicClientPath('/espace/desinscriptionx')).toBe(false)
  })
})
