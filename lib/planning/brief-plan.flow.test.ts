// ─────────────────────────────────────────────────────────────────────────────
// Brief plan — the whole flow, model and inventory simulated
// SEO Engine - Planning
// ─────────────────────────────────────────────────────────────────────────────
//
// brief-plan.test.ts locks the pure pieces (decision, prompt, normalisation).
// This file locks how generateBriefPlanWithSignals ASSEMBLES them: what is read
// once, which subjects reach the model, in which order, and what comes back.
// Written before the L4 extraction (docs/cadrage.md § 3.4) so that moving the
// orchestration around cannot change a plan without a test saying so.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GscPlanningSignals } from '@/lib/google/performance'
import type { SerpEvidence } from '@/lib/serp'
import type { QuerySuggestions } from '@/lib/serp/suggest'
import type { InventoryEntry, SiteInventory } from '@/src/core/domain/existing/inventory'
import type { Campaign, PlanItemBrief } from '@/lib/types'

vi.mock('@/lib/ai/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/provider')>()),
  generateJson: vi.fn(),
}))
vi.mock('@/lib/existing/inventory', () => ({ loadSiteInventory: vi.fn() }))

import { generateJson } from '@/lib/ai/provider'
import { loadSiteInventory } from '@/lib/existing/inventory'
import { generateBriefPlanWithSignals } from './brief-plan'

const campaign = {
  id: 'campaign-1',
  site_id: 'site-1',
  name: 'Plomberie',
  business_type: 'plombier',
  business_name: 'Plomberie Dupont',
  keywords: ['plombier', 'debouchage canalisation', 'chauffe-eau'],
  department: 'Aube',
  communes: ['Troyes', 'Sainte-Savine'],
  page_types: ['pillar', 'child'],
  schedule_frequency: 'every_2_days',
  target_length: 900,
  site: { url: 'https://exemple.fr' },
} as unknown as Campaign

function entry(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    path: '/plombier-troyes',
    url: 'https://exemple.fr/plombier-troyes',
    title: 'Plombier a Troyes',
    metaDescription: 'Plombier a Troyes, intervention rapide 7j/7.',
    focusKeyword: 'plombier troyes',
    canonicalPath: null,
    noindex: false,
    body: 'Un corps de page deja en ligne.',
    bodyIsExcerpt: true,
    origin: 'crawl',
    coversTopic: true,
    observedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  }
}

const site: SiteInventory = {
  siteId: 'site-1',
  entries: [entry()],
  takenPaths: new Set(['/plombier-troyes']),
  freshness: { state: 'fresh', lastCrawledAt: '2026-11-20T00:00:00.000Z', ageDays: 6 },
  crawledCount: 1,
  publishedCount: 0,
  truncated: false,
}

const signals: GscPlanningSignals = {
  available: true,
  windowStart: '2026-08-28',
  windowEnd: '2026-11-25',
  strikingDistance: [],
  lowCtrPages: [],
  deadPages: [],
  cannibalized: [],
  // The chauffe-eau slot is already won (the seed is compared, without its town):
  // it must never reach the model.
  blockedQueries: ['chauffe-eau'],
}

const serpEvidence: SerpEvidence[] = [{
  query: 'plombier troyes',
  fetchedAt: '2026-11-25T08:00:00.000Z',
  competitors: [{
    url: 'https://concurrent.test/plombier-troyes',
    host: 'concurrent.test',
    position: 1,
    wordCount: 1100,
    title: 'Plombier Troyes',
    h1: 'Plombier a Troyes',
    h2s: ['Nos tarifs', 'Zone d intervention'],
    hasFaq: true,
    hasSchema: false,
  }],
  peopleAlsoAsk: ['Combien coute un debouchage de canalisation ?'],
  relatedSearches: ['plombier troyes pas cher'],
  medianWordCount: 1100,
  commonSections: ['Nos tarifs'],
  faqShare: 1,
}]

const suggestions: QuerySuggestions[] = [{
  query: 'debouchage canalisation troyes',
  google: ['debouchage canalisation troyes prix'],
  bing: [],
  fetchedAt: '2026-11-25T08:00:00.000Z',
}]

/** The model's answer, one item per subject it was sent. */
const answer = {
  items: [
    {
      target_keyword: 'plombier troyes urgence nuit',
      proposed_title: 'Plombier a Troyes la nuit : intervention d urgence',
      proposed_slug: 'plombier-troyes-urgence-nuit',
      outline: ['H2: Quand appeler', 'H2: Tarifs de nuit'],
      estimated_word_count: 1200,
    },
    {
      target_keyword: 'debouchage canalisation troyes',
      proposed_title: 'Debouchage de canalisation a Troyes',
      proposed_slug: 'debouchage-canalisation-troyes',
      outline: ['H2: Les signes', 'H2: Le prix'],
    },
    {
      // Reuses the existing page's keyword: dropped after writing, with its reason.
      target_keyword: 'plombier troyes',
      proposed_title: 'Plombier a Troyes',
      proposed_slug: 'plombier-a-troyes',
    },
  ],
}

/** What does not depend on randomness: ids are UUIDs drawn at each run. */
function stable(items: PlanItemBrief[]) {
  return items.map(({ id, ...rest }) => ({ hasId: typeof id === 'string' && id.length > 0, ...rest }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-26T10:00:00'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(loadSiteInventory).mockResolvedValue(site)
  vi.mocked(generateJson).mockResolvedValue(JSON.stringify(answer))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(generateJson).mockReset()
  vi.mocked(loadSiteInventory).mockReset()
})

describe('generateBriefPlanWithSignals — le plan entier', () => {
  it('lit l existant une fois, ne soumet au modele que les sujets a ecrire, et garde chaque decision', async () => {
    const result = await generateBriefPlanWithSignals({
      campaign,
      cycleDays: 8,
      gscSignals: signals,
      serpEvidence,
      searchSuggestions: suggestions,
    })

    expect(loadSiteInventory).toHaveBeenCalledTimes(1)
    expect(loadSiteInventory).toHaveBeenCalledWith('site-1')
    expect(generateJson).toHaveBeenCalledTimes(1)

    // What the model was asked, and what the plan became: both frozen.
    const [request] = vi.mocked(generateJson).mock.calls[0]
    expect(request.userPrompt).toMatchSnapshot('prompt')
    expect(stable(result.items)).toMatchSnapshot('items')

    expect(result.signals).toBe(signals)
    expect(result.serpEvidence).toBe(serpEvidence)
    expect(result.suggestions).toBe(suggestions)
    expect(result.items.every((item) => item.id)).toBe(true)
  })

  it('n ouvre pas le modele quand tous les sujets sont ecartes', async () => {
    // An empty site: a page resembling the subject would turn it into a distinct angle, not a skip.
    vi.mocked(loadSiteInventory).mockResolvedValue({ ...site, entries: [], takenPaths: new Set() })
    const blocked: GscPlanningSignals = {
      ...signals,
      blockedQueries: ['plombier', 'debouchage canalisation', 'chauffe-eau'],
    }

    const result = await generateBriefPlanWithSignals({
      campaign,
      cycleDays: 8,
      gscSignals: blocked,
      serpEvidence: [],
      searchSuggestions: [],
    })

    expect(generateJson).not.toHaveBeenCalled()
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item) => item.action?.kind === 'skip')).toBe(true)
  })

  it('sans calendrier (frequence manuelle), ne lit ni ne paie rien de plus', async () => {
    const result = await generateBriefPlanWithSignals({
      campaign: { ...campaign, schedule_frequency: 'manual' } as Campaign,
      cycleDays: 8,
      gscSignals: null,
      serpEvidence: [],
      searchSuggestions: [],
    })

    expect(result.items).toEqual([])
    expect(generateJson).not.toHaveBeenCalled()
  })
})
