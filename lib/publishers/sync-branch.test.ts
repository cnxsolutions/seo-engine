// ─────────────────────────────────────────────────────────────────────────────
// Synchronisation de la branche de publication — tests
// SEO Engine - Le build qui garde une page doit etre celui du vrai site.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncBranchWithProduction } from './sync-branch'

const REPO = 'https://api.github.com/repos/cnxsolutions/renovation-bt'
const HEADERS = { Authorization: 'token x' }

/** Repond a chaque appel GitHub selon l'URL et la methode, et retient les ecritures. */
function mockGithub(compare: { status: string; commits?: Array<{ sha: string }> }, merge = { status: 201 }) {
  const writes: Array<{ method: string; url: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' || init?.method === 'POST') {
      writes.push({ method: init.method, url: String(url), body: JSON.parse(String(init.body)) })
      return new Response(init.method === 'POST' && merge.status === 204 ? null : '{}', {
        status: init.method === 'POST' ? merge.status : 200,
      })
    }
    if (String(url).includes('/compare/')) return new Response(JSON.stringify(compare), { status: 200 })
    return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 })
  }))
  return { writes }
}

afterEach(() => vi.unstubAllGlobals())

describe('syncBranchWithProduction', () => {
  it('ne touche a rien quand la branche est deja au niveau', async () => {
    const { writes } = mockGithub({ status: 'identical' })
    expect(await syncBranchWithProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine' })).toEqual({ how: 'a-jour' })
    expect(writes).toHaveLength(0)
  })

  it('ne touche a rien quand seule la branche a avance', async () => {
    // `behind` : production est derriere la branche — la fusion vers main s'en charge.
    const { writes } = mockGithub({ status: 'behind' })
    expect((await syncBranchWithProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine' })).how).toBe('a-jour')
    expect(writes).toHaveLength(0)
  })

  it('avance la branche sans forcer quand production a avance seule', async () => {
    // Le cas du 12/10 : main revertee par un humain, la branche encore sur les
    // six fichiers casses. Toute page commitee dessus avait un build rouge.
    const { writes } = mockGithub({ status: 'ahead', commits: [{ sha: 'aaa' }, { sha: 'prod-sha' }] })
    const sync = await syncBranchWithProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine' })

    expect(sync).toEqual({ how: 'avance-rapide' })
    expect(writes).toEqual([
      { method: 'PATCH', url: `${REPO}/git/refs/heads/seo-engine`, body: { sha: 'prod-sha', force: false } },
    ])
  })

  it('fusionne production dans la branche quand les deux ont avance', async () => {
    const { writes } = mockGithub({ status: 'diverged' })
    const sync = await syncBranchWithProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine' })

    expect(sync).toEqual({ how: 'fusion' })
    expect(writes[0].method).toBe('POST')
    expect(writes[0].body).toMatchObject({ base: 'seo-engine', head: 'main' })
  })

  it('nomme le conflit au lieu de forcer', async () => {
    mockGithub({ status: 'diverged' }, { status: 409 })
    const sync = await syncBranchWithProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine' })
    expect(sync.how).toBe('conflit')
  })

  it('ne leve jamais : la publication continue sans synchronisation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('reseau coupe') }))
    const sync = await syncBranchWithProduction({ repoApi: REPO, headers: HEADERS, head: 'seo-engine' })
    expect(sync).toEqual({ how: 'inconnu', reason: 'reseau coupe' })
  })
})
