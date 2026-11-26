import { describe, expect, it } from 'vitest'
import { plannedBriefs } from './planned'

const plan = {
  id: 'plan-1',
  campaign_id: 'camp',
  plan_data: [
    { id: 'item-4', target_keyword: 'débouchage canalisation', target_city: 'La Chapelle-Saint-Luc', secondary_keywords: ['wc bouché', 42] },
    { id: 'item-5', target_keyword: 'plombier', target_city: 'Saint-André-les-Vergers' },
    'illisible',
    { target_keyword: 'sans identifiant' },
  ],
}

describe('plannedBriefs', () => {
  it('rend les briefs dont la page reste a ecrire, avec la date du creneau', () => {
    const briefs = plannedBriefs(plan, [
      { campaign_id: 'camp', plan_item_id: 'item-4', scheduled_date: '2026-11-28', target_keyword: null, target_city: null },
      { campaign_id: 'camp', plan_item_id: 'item-5', scheduled_date: '2026-11-30', target_keyword: 'plombier saint-andré', target_city: null },
    ])
    expect(briefs).toEqual([
      { cyclePlanId: 'plan-1', planItemId: 'item-4', day: '2026-11-28', targetKeyword: 'débouchage canalisation', targetCity: 'La Chapelle-Saint-Luc', secondaryKeywords: ['wc bouché'] },
      { cyclePlanId: 'plan-1', planItemId: 'item-5', day: '2026-11-30', targetKeyword: 'plombier saint-andré', targetCity: 'Saint-André-les-Vergers', secondaryKeywords: [] },
    ])
  })

  it('ignore un creneau d une autre campagne, ou sans brief dans le plan', () => {
    expect(plannedBriefs(plan, [
      { campaign_id: 'autre', plan_item_id: 'item-4', scheduled_date: '2026-11-28', target_keyword: null, target_city: null },
      { campaign_id: 'camp', plan_item_id: 'item-9', scheduled_date: '2026-11-28', target_keyword: null, target_city: null },
    ])).toEqual([])
    expect(plannedBriefs({ ...plan, plan_data: null }, [])).toEqual([])
  })
})
