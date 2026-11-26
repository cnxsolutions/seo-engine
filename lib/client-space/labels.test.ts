import { describe, expect, it } from 'vitest'
import { readSignInNotice } from './labels'

describe('readSignInNotice', () => {
  it('reconnait les motifs connus', () => {
    expect(readSignInNotice('revoque')).toBe('revoque')
    expect(readSignInNotice(['expiree', 'lien'])).toBe('expiree')
  })

  it('ignore tout le reste, y compris les noms herites d Object', () => {
    for (const raw of [undefined, '', 'inconnu', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(readSignInNotice(raw)).toBeNull()
    }
  })
})
