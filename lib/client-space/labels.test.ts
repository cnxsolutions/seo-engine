import { describe, expect, it } from 'vitest'
import { readSignInNotice, requestDetailSentence, requestStateLabel } from './labels'

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

describe('la phrase d’une demande, partagée par l’espace et les e-mails', () => {
  it('date une demande prévue', () => {
    const request = { state: 'scheduled', detail: { kind: 'planned', day: '2026-12-12', already: false } } as const
    expect(requestStateLabel(request)).toBe('Prévue le 12 déc.')
    expect(requestDetailSentence(request)).toEqual({ text: 'Elle est au programme : la page est prévue le 12 déc.', url: null })
  })

  it('donne le lien de la page en ligne, ou de la page qui répond déjà', () => {
    expect(requestDetailSentence({ state: 'published', detail: { kind: 'page', url: 'https://exemple.fr/p' } }))
      .toEqual({ text: 'La page est en ligne.', url: 'https://exemple.fr/p' })
    expect(requestDetailSentence({ state: 'covered', detail: { kind: 'won', position: 3, url: 'https://exemple.fr/q' } }))
      .toEqual({ text: 'Votre site est déjà en position 3 sur cette recherche.', url: 'https://exemple.fr/q' })
    expect(requestDetailSentence({ state: 'covered', detail: { kind: 'none' } }))
      .toEqual({ text: 'Votre site répond déjà à cette recherche.', url: null })
  })

  it('montre le motif écrit pour le client, ou la phrase par défaut', () => {
    expect(requestDetailSentence({ state: 'declined', detail: { kind: 'declined', reason: 'Hors de votre métier.' } }).text).toBe('Hors de votre métier.')
    expect(requestDetailSentence({ state: 'declined', detail: { kind: 'declined', reason: null } }).text).toBe('CNX Solutions vous en dira plus.')
  })
})
