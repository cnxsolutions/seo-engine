import { describe, it, expect, vi } from 'vitest'
import { describeIndexState } from './describe'

vi.mock('@/lib/supabase', () => ({ createServiceClient: () => { throw new Error('no database in tests') } }))

const base = {
  url: 'https://www.example.fr/a/',
  indexing_state: null,
  robots_txt_state: null,
  page_fetch_state: null,
  google_canonical: null,
  user_canonical: null,
  resubmit_count: 0,
}

describe('describeIndexState', () => {
  it('tells the owner that a noindex will not be solved by resending', () => {
    const text = describeIndexState({ ...base, state: 'blocked', indexing_state: 'BLOCKED_BY_META_TAG' })
    expect(text).toMatchObject({ label: 'Bloquée', tone: 'critical' })
    expect(text.advice).toContain('noindex')
  })

  it('names the 404 rather than a generic fetch failure', () => {
    expect(describeIndexState({ ...base, state: 'fetch_error', page_fetch_state: 'NOT_FOUND' }).advice).toContain('404')
  })

  it('says how many times the sitemap was resent for a page still unseen', () => {
    expect(describeIndexState({ ...base, state: 'not_discovered', resubmit_count: 2 }).advice).toContain('2 fois')
  })

  it('distinguishes a canonical the page declares from one Google picked', () => {
    const declared = describeIndexState({ ...base, state: 'canonical_elsewhere', user_canonical: 'https://www.example.fr/b/' })
    const picked = describeIndexState({
      ...base,
      state: 'canonical_elsewhere',
      user_canonical: 'https://example.fr/a',
      google_canonical: 'https://www.example.fr/b/',
    })
    expect(declared.advice).toContain('déclare elle-même')
    expect(picked.advice).toContain('Google a retenu')
  })
})
