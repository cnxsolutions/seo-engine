// ─────────────────────────────────────────────────────────────────────────────
// One H1 per page — tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { takeLeadingH1 } from './h1'

describe('takeLeadingH1', () => {
  it('takes the first H1 out and returns its text, entities decoded', () => {
    const { h1, body } = takeLeadingH1('<h1 class="t">Taxi &amp; <em>VTC</em> à Troyes</h1>\n<p class="reponse-directe">Réponse.</p>')
    expect(h1).toBe('Taxi & VTC à Troyes')
    expect(body).toBe('<p class="reponse-directe">Réponse.</p>')
  })

  it('leaves an article without H1 untouched', () => {
    expect(takeLeadingH1('<p>Texte</p>')).toEqual({ h1: null, body: '<p>Texte</p>' })
  })

  it('removes one H1 only', () => {
    expect(takeLeadingH1('<h1>A</h1><h1>B</h1>').body).toBe('<h1>B</h1>')
  })
})
