// ─────────────────────────────────────────────────────────────────────────────
// Search suggestions — tests
// SEO Engine - What Google and Bing propose while someone types.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanSuggestions, clearSuggestionCache, fetchSuggestions, parseOpenSearch } from './suggest'

const fetchMock = vi.fn()

beforeEach(() => {
  clearSuggestionCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function answer(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status }))
}

describe('parseOpenSearch', () => {
  it('reads the suggestion list and nothing else', () => {
    expect(parseOpenSearch(['q', ['a', 'b', 3], [], {}])).toEqual(['a', 'b'])
    expect(parseOpenSearch({ error: 'nope' })).toEqual([])
  })
})

describe('cleanSuggestions', () => {
  it('drops the query itself, duplicates once folded, and business listings', () => {
    expect(
      cleanSuggestions('couvreur châlons', [
        'couvreur chalons',
        'couvreur châlons-en-champagne',
        'Couvreur Chalons en Champagne',
        'couvreur à châlons en champagne lr rénovation couverture & dépannage avis',
      ])
    ).toEqual(['couvreur châlons-en-champagne'])
  })
})

describe('fetchSuggestions', () => {
  it('asks Google twice (the query, then the next word) and Bing once', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('bing')) return answer(['couvreur châlons', ['couvreur châlons en champagne']])
      return url.includes('q=couvreur+ch%C3%A2lons+')
        ? answer(['couvreur châlons ', ['couvreur châlons prix']])
        : answer(['couvreur châlons', ['couvreur châlons-en-champagne']])
    })

    const result = await fetchSuggestions('couvreur châlons')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.google).toEqual(['couvreur châlons-en-champagne', 'couvreur châlons prix'])
    expect(result.bing).toEqual(['couvreur châlons en champagne'])
  })

  it('never throws: a failed or blocked box is an empty list', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('bing') ? Promise.reject(new Error('timeout')) : answer('blocked', 429)
    )
    await expect(fetchSuggestions('plombier troyes')).resolves.toMatchObject({ google: [], bing: [] })
  })

  it('remembers an answer for the day, but not an empty one', async () => {
    fetchMock.mockImplementation(() => answer(['q', []]))
    await fetchSuggestions('taxi troyes')
    await fetchSuggestions('taxi troyes')
    expect(fetchMock).toHaveBeenCalledTimes(6)

    fetchMock.mockReset()
    fetchMock.mockImplementation(() => answer(['q', ['taxi troyes gare']]))
    await fetchSuggestions('taxi troyes')
    await fetchSuggestions('Taxi Troyes')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
