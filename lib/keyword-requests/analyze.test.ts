import { describe, expect, it, vi } from 'vitest'
import { blindInventory } from '@/src/core/domain/existing/inventory'
import { analyzeReceivedRequests, type AnalysisPorts } from './analyze'
import type { CampaignRow, StoredVerdict } from './repository'

vi.mock('@/lib/supabase', () => ({ createServiceClient: () => { throw new Error('aucune base dans ce test') } }))

const CAMPAIGN: CampaignRow = {
  id: 'camp',
  site_id: 'site-a',
  business_type: 'plombier',
  business_name: 'Plomberie Martin',
  keywords: ['plombier', 'chauffe-eau'],
  communes: ['Troyes', 'Sainte-Savine'],
  department: '10',
  is_active: true,
  current_cycle_id: 'plan-1',
  created_at: '2026-01-01T00:00:00Z',
}

function ports(overrides: Partial<AnalysisPorts> = {}): AnalysisPorts & { written: StoredVerdict[] } {
  const written: StoredVerdict[] = []
  return {
    written,
    listReceived: async () => [
      { id: 'r1', site_id: 'site-a', keyword: "fuite d'eau", city: 'Troyes' },
      { id: 'r2', site_id: 'site-a', keyword: 'débouchage', city: null },
      { id: 'r3', site_id: 'site-a', keyword: 'plombier', city: 'Romilly-sur-Seine' },
      { id: 'r4', site_id: 'site-b', keyword: 'électricien', city: null },
    ],
    listCampaigns: async () => [CAMPAIGN],
    listPlans: async () => ({
      plans: [{ id: 'plan-1', campaign_id: 'camp', plan_data: [{ id: 'item-6', target_keyword: "fuite d'eau troyes", target_city: 'Troyes' }] }],
      slots: [{ campaign_id: 'camp', plan_item_id: 'item-6', scheduled_date: '2026-11-28', target_keyword: null, target_city: null }],
    }),
    listSiteUrls: async () => new Map([['site-a', 'https://plomberie-martin.test'], ['site-b', 'https://durand.test']]),
    loadKnowledge: async (siteId) => ({ inventory: blindInventory(siteId, 'jamais-analyse'), signals: null }),
    judgeFit: async () => ({ fit: 'in', service: 'débouchage', city: null, intent: 'transactionnelle', reason: 'Service du métier.' }),
    applyVerdicts: async (verdicts) => {
      written.push(...verdicts)
      return verdicts.map((verdict) => verdict.id)
    },
    ...overrides,
  }
}

describe('analyzeReceivedRequests', () => {
  it('rend un verdict par demande, en une ecriture, et ne consulte le modele que si les mesures se taisent', async () => {
    const judgeFit = vi.fn(async () => ({ fit: 'in' as const, service: 'débouchage', city: null, intent: null, reason: 'Service du métier.' }))
    const fake = ports({ judgeFit })
    const result = await analyzeReceivedRequests(fake)

    expect(result).toEqual({ analysed: 4, written: 4 })
    const byId = new Map(fake.written.map((verdict) => [verdict.id, verdict]))
    expect(byId.get('r1')).toMatchObject({ status: 'scheduled', reason_code: 'ALREADY_PLANNED', campaign_id: 'camp', cycle_plan_id: 'plan-1', plan_item_id: 'item-6', scheduled_for: '2026-11-28' })
    expect(byId.get('r2')).toMatchObject({ status: 'deferred', reason_code: 'NEXT_PERIOD', cycle_plan_id: null })
    expect(byId.get('r3')).toMatchObject({ status: 'review', reason_code: 'CITY_OUT_OF_AREA' })
    // Le site b n'a pas de campagne : CNX regarde, sans appel au modele.
    expect(byId.get('r4')).toMatchObject({ status: 'review', reason_code: 'NO_CAMPAIGN', campaign_id: null })
    expect(judgeFit).toHaveBeenCalledTimes(1)
    expect(judgeFit).toHaveBeenCalledWith(expect.objectContaining({ search: 'débouchage', communes: ['Troyes', 'Sainte-Savine'] }))
  })

  it('ne charge le contexte qu une fois par site', async () => {
    const loadKnowledge = vi.fn(async (siteId: string) => ({ inventory: blindInventory(siteId, 'jamais-analyse'), signals: null }))
    const listCampaigns = vi.fn(async () => [CAMPAIGN])
    await analyzeReceivedRequests(ports({ loadKnowledge, listCampaigns }))
    expect(loadKnowledge).toHaveBeenCalledTimes(2)
    expect(listCampaigns).toHaveBeenCalledTimes(1)
    expect(listCampaigns).toHaveBeenCalledWith(['site-a', 'site-b'])
  })

  it('rien a analyser, rien a ecrire', async () => {
    const applyVerdicts = vi.fn(async () => [])
    expect(await analyzeReceivedRequests(ports({ listReceived: async () => [], applyVerdicts }))).toEqual({ analysed: 0, written: 0 })
    expect(applyVerdicts).not.toHaveBeenCalled()
  })
})
