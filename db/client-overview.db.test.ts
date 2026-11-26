// ─────────────────────────────────────────────────────────────────────────────
// L2 — what a client reads about a site, against the LOCAL Supabase and its
// demonstration data (db/seed-local.sql). Read-only: nothing is written here.
//
// Plomberie Martin (client A) has a period in progress: 7 pages, the first 3
// online — one visible on Google, one not yet discovered, one never checked.
// Électricité Durand (client B) has a campaign and no cycle.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { findClientSite } from '@/lib/client-space/repository'
import { toClientSiteDto } from '@/lib/client-space/dto'
import { readOnlinePages, readPeriod } from '@/lib/client-space/overview'
import { parisDay } from '@/src/core/domain/client-space/overview'

/** md5(seed)::uuid, as db/seed-local.sql derives its ids. */
function seedId(seed: string): string {
  const hex = createHash('md5').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function clientSite(client: string, site: string) {
  const row = await findClientSite(seedId(client), seedId(site))
  if (!row) throw new Error(`site de demonstration introuvable : ${site} — npm run db:local:reset ?`)
  return toClientSiteDto(row)
}

describe('espace client — lecture d un site (L2)', () => {
  it('la periode en cours : dates, pages prevues, en ligne, a venir', async () => {
    const period = await readPeriod(await clientSite('demo-client-a', 'demo-site-martin'))
    expect(period).not.toBeNull()
    expect(period?.planned).toBe(7)
    expect(period?.published).toBe(3)
    expect(period?.progress).toBeGreaterThan(0)
    expect(period?.progress).toBeLessThan(1)
    // Pages still to come carry a title in plain French, never a page type.
    const today = parisDay(new Date())
    for (const page of period?.upcoming ?? []) {
      expect(page.day >= today).toBe(true)
      expect(page.title).not.toMatch(/pillar|child|local_pack/)
    }
    expect(period?.upcoming.length).toBeGreaterThan(0)
  })

  it('un site sans cycle en cours n a pas de periode', async () => {
    expect(await readPeriod(await clientSite('demo-client-b', 'demo-site-durand'))).toBeNull()
  })

  it('les pages en ligne, recentes d abord, avec ce qu en fait Google', async () => {
    const { pages, total } = await readOnlinePages(await clientSite('demo-client-a', 'demo-site-martin'), { offset: 0, limit: 20 })
    expect(total).toBe(3)
    expect(pages.map((page) => page.state).sort()).toEqual(['indexing', 'indexing', 'visible'])
    expect(pages[0].publishedDay! >= pages[2].publishedDay!).toBe(true)
    for (const page of pages) expect(Object.keys(page).sort()).toEqual(['id', 'publishedDay', 'state', 'title', 'url'])
  })

  it('la pagination borne la lecture', async () => {
    const { pages, total } = await readOnlinePages(await clientSite('demo-client-a', 'demo-site-martin'), { offset: 2, limit: 2 })
    expect(total).toBe(3)
    expect(pages).toHaveLength(1)
  })

  it('le site d un autre client ne s obtient pas : la lecture commence toujours par lui', async () => {
    expect(await findClientSite(seedId('demo-client-b'), seedId('demo-site-martin'))).toBeNull()
  })
})
