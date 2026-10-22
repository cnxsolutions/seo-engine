// ─────────────────────────────────────────────────────────────────────────────
// Geographic scope — tests
// SEO Engine - A business that sells nationwide has no town.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  campaignDepartment,
  campaignScope,
  isNationalCampaign,
  isNationalRequest,
  plannablePageTypes,
  resolveTargetCity,
  runnablePageType,
  targetCommunes,
  withoutLocalPack,
} from './scope'

// Flowyne as it was saved before national campaigns existed: « tous » typed as
// the commune, the form's default department left in place, every page type.
const FLOWYNE = {
  communes: ['tous'],
  department: 'Aube',
  page_types: ['pillar', 'child', 'local_pack', 'alternative', 'comparative'] as const,
}
const LOCAL = { communes: ['Troyes', 'Sainte-Savine'], department: 'Aube', page_types: ['pillar', 'local_pack'] as const }

describe('scope of a campaign', () => {
  it('reads « tous », « France », « partout » and an empty list as national — never « Tours »', () => {
    expect(isNationalCampaign(FLOWYNE)).toBe(true)
    expect(isNationalCampaign({ communes: [] })).toBe(true)
    expect(isNationalCampaign({ communes: [' France ', 'partout', 'Toute la France'] })).toBe(true)
    expect(isNationalCampaign({ communes: ['Tours'] })).toBe(false)
    expect(isNationalCampaign(LOCAL)).toBe(false)
    expect(campaignScope(FLOWYNE)).toBe('national')
  })

  it('keeps the real communes only', () => {
    expect(targetCommunes(['Troyes', ' tous ', '', 'Sainte-Savine'])).toEqual(['Troyes', 'Sainte-Savine'])
  })

  it('gives a national campaign no town and no department, whatever the slot or the model says', () => {
    expect(resolveTargetCity(FLOWYNE, 'tous')).toBe('')
    expect(resolveTargetCity(FLOWYNE, 'Paris')).toBe('')
    expect(campaignDepartment(FLOWYNE)).toBe('')
  })

  it('gives a local campaign the named town, or its first commune — never « Aube »', () => {
    expect(resolveTargetCity(LOCAL, 'Sainte-Savine')).toBe('Sainte-Savine')
    expect(resolveTargetCity(LOCAL, '')).toBe('Troyes')
    expect(resolveTargetCity(LOCAL, 'tous')).toBe('Troyes')
    expect(campaignDepartment(LOCAL)).toBe('Aube')
  })

  it('plans no local pack without a place, and never leaves a campaign without a page type', () => {
    expect(plannablePageTypes(FLOWYNE)).toEqual(['pillar', 'child', 'alternative', 'comparative'])
    expect(plannablePageTypes({ communes: [], page_types: ['local_pack'] })).toEqual(['pillar', 'child'])
    expect(plannablePageTypes(LOCAL)).toEqual(['pillar', 'local_pack'])
    expect(withoutLocalPack(['local_pack'], ['child'])).toEqual(['child'])
  })

  it('writes a local pack brief planned before the switch as a child page', () => {
    expect(runnablePageType(FLOWYNE, 'local_pack')).toBe('child')
    expect(runnablePageType(FLOWYNE, 'comparative')).toBe('comparative')
    expect(runnablePageType(LOCAL, 'local_pack')).toBe('local_pack')
  })
})

describe('isNationalRequest', () => {
  it('follows an explicit scope', () => {
    expect(isNationalRequest('national', ['Troyes'])).toBe(true)
    expect(isNationalRequest('local', ['tous'])).toBe(false)
  })

  it('without one, reads a list of markers only as national, and an empty list as nothing said', () => {
    expect(isNationalRequest(undefined, ['tous'])).toBe(true)
    expect(isNationalRequest(undefined, ['Troyes', 'tous'])).toBe(false)
    expect(isNationalRequest(undefined, [])).toBe(false)
  })
})
