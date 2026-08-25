// ─────────────────────────────────────────────────────────────────────────────
// Workflow State Tests
// SEO Engine - Step progression, blocking reasons and next action
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { deriveWorkflowState, type WorkflowFacts, type WorkflowSiteFacts } from './state'

function makeFacts(overrides: Partial<WorkflowFacts> = {}): WorkflowFacts {
  return {
    sites: [],
    campaigns: 0,
    confirmedCycles: 0,
    draftCycles: 0,
    plannedSlots: 0,
    awaitingPublication: 0,
    produced: 0,
    published: 0,
    ...overrides,
  }
}

function makeSite(overrides: Partial<WorkflowSiteFacts> = {}): WorkflowSiteFacts {
  return {
    id: 'site-1',
    name: 'BoxnFit',
    type: 'wordpress',
    isActive: true,
    hasRepoProfile: false,
    hasCmsSchemaAccess: false,
    googleConnected: false,
    ...overrides,
  }
}

/** A site the engine knows how to write for, with Search Console plugged in. */
const readySite = makeSite({ hasCmsSchemaAccess: true, googleConnected: true })

describe('deriveWorkflowState', () => {
  it('numbers the five steps in order', () => {
    const state = deriveWorkflowState(makeFacts())
    expect(state.steps.map((step) => step.id)).toEqual(['sites', 'schema', 'strategy', 'generate', 'publish'])
    expect(state.steps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5])
  })

  it('never blocks a step without saying why', () => {
    const scenarios = [
      makeFacts(),
      makeFacts({ sites: [makeSite()] }),
      makeFacts({ sites: [makeSite({ isActive: false })] }),
      makeFacts({ sites: [readySite], campaigns: 1, confirmedCycles: 1 }),
    ]

    for (const facts of scenarios) {
      for (const step of deriveWorkflowState(facts).steps) {
        if (step.state === 'blocked') expect(step.reason).toBeTruthy()
      }
    }
  })

  it('blocks everything but step 1 without an active site', () => {
    const state = deriveWorkflowState(makeFacts())

    expect(state.steps.map((step) => step.state)).toEqual(['available', 'blocked', 'blocked', 'blocked', 'blocked'])
    expect(state.currentStepId).toBe('sites')
    expect(state.nextAction?.href).toBe('/sites/new')
  })

  it('sends an operator whose sites are all disabled back to the list', () => {
    const state = deriveWorkflowState(makeFacts({ sites: [makeSite({ isActive: false })] }))

    expect(state.steps[0].state).toBe('available')
    expect(state.nextAction?.href).toBe('/sites')
    expect(state.nextAction?.label).toContain('Réactiver')
  })

  it('points a fresh WordPress site at its schema extraction', () => {
    const state = deriveWorkflowState(makeFacts({ sites: [makeSite()] }))

    expect(state.steps[0].state).toBe('done')
    expect(state.steps[1].state).toBe('available')
    expect(state.currentStepId).toBe('schema')
    expect(state.nextAction?.href).toBe('/schema')
    expect(state.nextAction?.label).toContain('BoxnFit')
  })

  it('points a fresh Next.js site at its repository analysis', () => {
    const state = deriveWorkflowState(
      makeFacts({ sites: [makeSite({ type: 'nextjs', name: 'Vitrine' })] })
    )

    expect(state.steps[1].state).toBe('available')
    expect(state.nextAction?.href).toBe('/sites')
    expect(state.nextAction?.label).toContain('dépôt')
  })

  it('counts a repository profile as a described site', () => {
    const state = deriveWorkflowState(
      makeFacts({ sites: [makeSite({ type: 'nextjs', hasRepoProfile: true })] })
    )

    expect(state.steps[1].state).toBe('done')
  })

  it('asks for the Google connection once the site is described', () => {
    const state = deriveWorkflowState(makeFacts({ sites: [makeSite({ hasCmsSchemaAccess: true })] }))

    expect(state.steps[1].state).toBe('done')
    expect(state.currentStepId).toBe('strategy')
    expect(state.nextAction?.label).toContain('Google')
  })

  it('asks for a strategy, then for the cycle to be confirmed', () => {
    const noCampaign = deriveWorkflowState(makeFacts({ sites: [readySite] }))
    expect(noCampaign.nextAction?.href).toBe('/strategy/new')

    const draftPlan = deriveWorkflowState(makeFacts({ sites: [readySite], campaigns: 1, draftCycles: 1 }))
    expect(draftPlan.steps[2].state).toBe('available')
    expect(draftPlan.nextAction?.href).toBe('/strategy')
  })

  it('marks the strategy done as soon as a cycle left the draft stage', () => {
    const state = deriveWorkflowState(makeFacts({ sites: [readySite], campaigns: 1, confirmedCycles: 1 }))

    expect(state.steps[2].state).toBe('done')
    expect(state.steps[3].state).toBe('blocked')
    expect(state.steps[3].reason).toContain('créneau')
  })

  it('opens generation as soon as a slot is planned', () => {
    const state = deriveWorkflowState(
      makeFacts({ sites: [readySite], campaigns: 1, confirmedCycles: 1, plannedSlots: 3 })
    )

    expect(state.steps[3].state).toBe('available')
    expect(state.steps[3].detail).toBe('3 créneaux planifiés')
    expect(state.currentStepId).toBe('generate')
    expect(state.nextAction?.href).toBe('/generate')
  })

  it('reports pending work rather than past work', () => {
    const state = deriveWorkflowState(
      makeFacts({
        sites: [readySite],
        campaigns: 1,
        confirmedCycles: 1,
        awaitingPublication: 2,
        produced: 5,
        published: 3,
      })
    )

    expect(state.steps[3].state).toBe('done')
    expect(state.steps[4].state).toBe('available')
    expect(state.steps[4].detail).toBe('2 pages prêtes')
    expect(state.currentStepId).toBe('publish')
    expect(state.nextAction?.href).toBe('/publish')
  })

  it('stops asking once the whole path is walked', () => {
    const state = deriveWorkflowState(
      makeFacts({
        sites: [readySite],
        campaigns: 1,
        confirmedCycles: 1,
        produced: 5,
        published: 5,
      })
    )

    expect(state.steps.every((step) => step.state === 'done')).toBe(true)
    expect(state.currentStepId).toBeNull()
    expect(state.nextAction).toBeNull()
  })

  it('singularises the counts it displays', () => {
    const one = deriveWorkflowState(makeFacts({ sites: [makeSite()] }))
    expect(one.steps[0].detail).toBe('1 site actif')
    expect(one.steps[1].detail).toBe('1 site à décrire')

    const many = deriveWorkflowState(
      makeFacts({ sites: [makeSite(), makeSite({ id: 'site-2', name: 'Second' })] })
    )
    expect(many.steps[0].detail).toBe('2 sites actifs')
    expect(many.steps[1].detail).toBe('2 sites à décrire')
  })
})
