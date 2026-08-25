// ─────────────────────────────────────────────────────────────────────────────
// Promotion to the production branch
// SEO Engine - The step whose absence made every published page invisible.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest'
import { promoteToProduction } from './promote'

const REPO = 'https://api.github.com/repos/cnxsolutions/taxidriver10'
const HEADERS = { Authorization: 'token x' }

/** Answer each GitHub call by URL and method, so a test states only what it changes. */
function mockGithub(routes: {
  repo?: { status: number; body?: unknown }
  status?: { status: number; body?: unknown }
  merge?: { status: number; body?: unknown }
}) {
  const merges: unknown[] = []

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const respond = (spec?: { status: number; body?: unknown }) =>
      new Response(JSON.stringify(spec?.body ?? {}), { status: spec?.status ?? 200 })

    if (init?.method === 'POST' && url.endsWith('/merges')) {
      merges.push(JSON.parse(String(init.body)))
      const spec = routes.merge ?? { status: 201 }
      // 204 must carry no body, or Response throws.
      return spec.status === 204 ? new Response(null, { status: 204 }) : respond(spec)
    }
    if (url.includes('/status')) return respond(routes.status ?? { status: 403, body: { message: 'nope' } })
    return respond(routes.repo ?? { status: 200, body: { default_branch: 'main' } })
  }))

  return { merges }
}

afterEach(() => vi.unstubAllGlobals())

describe('promoteToProduction', () => {
  it('fusionne la branche de publication dans la branche par defaut', () => {
    const { merges } = mockGithub({})
    return promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 'taxi-gare' })
      .then((outcome) => {
        expect(outcome.promoted).toBe(true)
        expect(outcome.base).toBe('main')
        expect(merges).toEqual([
          { base: 'main', head: 'seo-engine', commit_message: 'seo-engine: mise en ligne de /taxi-gare' },
        ])
      })
  })

  it('lit la branche par defaut au lieu de supposer main', async () => {
    const { merges } = mockGithub({ repo: { status: 200, body: { default_branch: 'master' } } })
    await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 's' })
    expect((merges[0] as { base: string }).base).toBe('master')
  })

  it('ne fusionne rien quand la publication vise deja la production', async () => {
    const { merges } = mockGithub({})
    const outcome = await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'main', slug: 's' })
    expect(outcome.promoted).toBe(false)
    expect(merges).toHaveLength(0)
    expect(outcome.reason).toMatch(/deja/)
  })

  it('traite « rien a fusionner » comme un succes', async () => {
    // 204 means the base already contains the head — the page IS in production.
    // Reporting a failure here would raise an alarm every time two pages are
    // published in the same tick.
    mockGithub({ merge: { status: 204 } })
    const outcome = await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 's' })
    expect(outcome.promoted).toBe(true)
  })

  it('nomme le conflit plutot que de le taire', async () => {
    mockGithub({ merge: { status: 409, body: { message: 'Merge conflict' } } })
    const outcome = await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 's' })
    expect(outcome.promoted).toBe(false)
    expect(outcome.reason).toMatch(/conflit/)
  })

  it('fusionne quand meme si le statut de build est illisible, en le disant', async () => {
    // The connected repository's token answers 403 on commit statuses. Refusing
    // to promote because we cannot see would recreate the exact problem this
    // module exists to fix — but claiming the build was verified would be false.
    mockGithub({ status: { status: 403, body: { message: 'Resource not accessible by personal access token' } } })
    const outcome = await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 's' })
    expect(outcome.promoted).toBe(true)
    expect(outcome.verified).toBe(false)
  })

  it('refuse de fusionner un build en echec, quand il est lisible', async () => {
    const { merges } = mockGithub({ status: { status: 200, body: { state: 'failure', statuses: [{}] } } })
    const outcome = await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 's' })
    expect(outcome.promoted).toBe(false)
    expect(outcome.verified).toBe(true)
    expect(merges).toHaveLength(0)
  })

  it('marque la promotion verifiee quand le build est vert', async () => {
    mockGithub({ status: { status: 200, body: { state: 'success', statuses: [{ context: 'vercel' }] } } })
    const outcome = await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 's' })
    expect(outcome.promoted).toBe(true)
    expect(outcome.verified).toBe(true)
  })

  it('ne fusionne pas sur un statut vert sans aucun controle declare', async () => {
    // GitHub answers `state: 'success'` for a commit nothing ever checked. Read
    // as verified, that would be a green light nobody gave.
    mockGithub({ status: { status: 200, body: { state: 'success', statuses: [] } } })
    const outcome = await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 's' })
    expect(outcome.promoted).toBe(true)
    expect(outcome.verified).toBe(false)
  })

  it('ne leve jamais : la page est deja commitee quand on arrive ici', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('reseau coupe') }))
    const outcome = await promoteToProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine', slug: 's' })
    expect(outcome.promoted).toBe(false)
    expect(outcome.reason).toBe('reseau coupe')
  })
})
