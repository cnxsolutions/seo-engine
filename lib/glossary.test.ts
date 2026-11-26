import { describe, expect, it } from 'vitest'
import * as clientLabels from '@/lib/client-space/labels'
import { OPERATOR_STATUS_LABELS } from '@/lib/keyword-requests/operator-labels'
import { REQUEST_STATUS_TERMS, CLIENT_FORBIDDEN_WORDS, GLOSSARY } from './glossary'

/** Every string a value yields: strings as they are, functions called with plausible arguments, objects walked. */
function texts(value: unknown, depth = 0): string[] {
  if (depth > 6) return []
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') {
    try {
      return texts((value as (...args: unknown[]) => unknown)(3, '26 nov.', 'Troyes'), depth + 1)
    } catch {
      return []
    }
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap((entry) => texts(entry, depth + 1))
  return []
}

function forbiddenIn(text: string): string[] {
  const lower = text.toLowerCase()
  return CLIENT_FORBIDDEN_WORDS.filter((word) => new RegExp(`(^|[^a-zà-ÿ])${word}([^a-zà-ÿ]|$)`).test(lower))
}

describe('le glossaire (design.md § 10)', () => {
  it('le client ne lit jamais un mot du moteur ni de l operateur', () => {
    const clientTexts = [
      ...texts(clientLabels),
      ...Object.values(REQUEST_STATUS_TERMS).map((term) => term.client),
      ...Object.values(GLOSSARY).flatMap((term) => (term.client ? [term.client] : [])),
    ]
    expect(clientTexts.length).toBeGreaterThan(50)
    const leaks = clientTexts.flatMap((text) => forbiddenIn(text).map((word) => `${word} : ${text}`))
    expect(leaks).toEqual([])
  })

  it('les deux lectures d un statut viennent du glossaire', () => {
    expect(OPERATOR_STATUS_LABELS.review.label).toBe(REQUEST_STATUS_TERMS.review.operator)
    expect(clientLabels.REQUEST_STATE_LABELS.review.label).toBe(REQUEST_STATUS_TERMS.review.client)
    expect(clientLabels.REQUEST_STATE_LABELS.analysing.label).toBe(REQUEST_STATUS_TERMS.received.client)
  })
})
