import { describe, expect, it } from 'vitest'
import { checkKeyword, checkSubmission, cleanText, normalizedRequest, requestQuery } from './normalize'

const NOW = new Date('2026-11-26T10:00:00Z')

describe('checkKeyword (regle 1 : refusee a la saisie)', () => {
  it('nettoie les espaces et les caracteres invisibles', () => {
    expect(checkKeyword('  fuite​ d’eau   troyes ')).toEqual({ ok: true, keyword: 'fuite d’eau troyes' })
    expect(cleanText('a\u0007b')).toBe('a b')
  })

  it('refuse le vide, le trop long, le trop de mots et les adresses', () => {
    expect(checkKeyword('   ')).toEqual({ ok: false, problem: 'empty' })
    expect(checkKeyword('!!!')).toEqual({ ok: false, problem: 'empty' })
    expect(checkKeyword('a'.repeat(81))).toEqual({ ok: false, problem: 'too_long' })
    expect(checkKeyword('un deux trois quatre cinq six sept huit neuf')).toEqual({ ok: false, problem: 'too_many_words' })
    expect(checkKeyword('voir https://concurrent.test')).toEqual({ ok: false, problem: 'url' })
    expect(checkKeyword('www.exemple')).toEqual({ ok: false, problem: 'url' })
    expect(checkKeyword('plombier-troyes.fr')).toEqual({ ok: false, problem: 'url' })
  })

  it('accepte huit mots et quatre-vingts caracteres', () => {
    expect(checkKeyword('un deux trois quatre cinq six sept huit').ok).toBe(true)
    expect(checkKeyword('a'.repeat(80)).ok).toBe(true)
  })
})

describe('la recherche d une demande', () => {
  it('ajoute la ville quand le mot-cle ne la nomme pas', () => {
    expect(requestQuery('plombier', 'Troyes')).toBe('plombier Troyes')
    expect(requestQuery('plombier à Troyes', 'Troyes')).toBe('plombier à Troyes')
    expect(requestQuery('chauffe-eau', null)).toBe('chauffe-eau')
  })

  it('« Plombier » a Troyes et « plombier troyes » sont la meme demande', () => {
    expect(normalizedRequest('Plombier', 'Troyes')).toBe(normalizedRequest('plombier troyes', null))
    expect(normalizedRequest('Débouchage', 'Sainte-Savine')).toBe('debouchage sainte savine')
  })
})

describe('checkSubmission', () => {
  it('rend les mots-cles, un par ligne, sans les lignes vides ni les doublons', () => {
    const check = checkSubmission({ keywords: 'plombier\n\n  Plombier \nfuite d eau\r\n', city: 'Troyes', note: '  ', desiredBy: '' }, NOW)
    expect(check).toEqual({
      ok: true,
      items: [
        { keyword: 'plombier', normalized: 'plombier troyes' },
        { keyword: 'fuite d eau', normalized: 'fuite d eau troyes' },
      ],
      city: 'Troyes',
      note: null,
      desiredBy: null,
    })
  })

  it('dit tous les problemes d un coup, ligne par ligne', () => {
    const check = checkSubmission({ keywords: 'plombier\nhttps://x.test\n' + 'mot '.repeat(9), note: 'x'.repeat(501), desiredBy: '2026-11-25' }, NOW)
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.problems).toEqual(
      expect.arrayContaining([
        { field: 'note', code: 'too_long' },
        { field: 'desiredBy', code: 'past' },
        { field: 'keywords', code: 'url', line: 2, text: 'https://x.test' },
        { field: 'keywords', code: 'too_many_words', line: 3, text: 'mot '.repeat(9).trim() },
      ]),
    )
  })

  it('borne un envoi a dix mots-cles', () => {
    const check = checkSubmission({ keywords: Array.from({ length: 11 }, (_, i) => `service ${i}`).join('\n') }, NOW)
    expect(check).toEqual({ ok: false, problems: [{ field: 'keywords', code: 'too_many' }] })
    expect(checkSubmission({ keywords: '\n \n' }, NOW)).toEqual({ ok: false, problems: [{ field: 'keywords', code: 'none' }] })
  })

  it('« pour quand » : un vrai jour, d aujourd hui a un an', () => {
    expect(checkSubmission({ keywords: 'plombier', desiredBy: '2026-11-26' }, NOW)).toMatchObject({ ok: true, desiredBy: '2026-11-26' })
    expect(checkSubmission({ keywords: 'plombier', desiredBy: '2026-02-30' }, NOW)).toMatchObject({ ok: false, problems: [{ field: 'desiredBy', code: 'invalid' }] })
    expect(checkSubmission({ keywords: 'plombier', desiredBy: '2028-01-01' }, NOW)).toMatchObject({ ok: false, problems: [{ field: 'desiredBy', code: 'too_far' }] })
  })

  it('refuse une adresse a la place d une ville', () => {
    expect(checkSubmission({ keywords: 'plombier', city: 'www.troyes.fr' }, NOW)).toMatchObject({ ok: false, problems: [{ field: 'city', code: 'url' }] })
  })
})
