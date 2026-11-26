import { describe, expect, it } from 'vitest'
import { pickRequestCampaign } from './campaign'

const c = (id: string, isActive: boolean, hasCycle: boolean, createdAt: string) => ({ id, isActive, hasCycle, createdAt })

describe('pickRequestCampaign', () => {
  it('la campagne active qui tourne un cycle, puis active, puis en cycle, puis la plus recente', () => {
    expect(pickRequestCampaign([c('old', false, false, '2026-01-01'), c('run', true, true, '2025-01-01'), c('on', true, false, '2026-06-01')])?.id).toBe('run')
    expect(pickRequestCampaign([c('cycle', false, true, '2026-01-01'), c('on', true, false, '2025-01-01')])?.id).toBe('on')
    expect(pickRequestCampaign([c('a', false, false, '2026-01-01'), c('b', false, false, '2026-03-01')])?.id).toBe('b')
  })

  it('aucune campagne, aucun choix', () => {
    expect(pickRequestCampaign([])).toBeNull()
  })
})
