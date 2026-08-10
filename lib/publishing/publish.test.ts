// ─────────────────────────────────────────────────────────────────────────────
// The publication sequence
// SEO Engine - Five defects, one test file.
// ─────────────────────────────────────────────────────────────────────────────
//
// Each block below corresponds to something the engine was doing wrong on a
// live site, verified in the code before it was fixed:
//
//   1. `POST /api/publish` never ran the quality gate. Zero occurrences of
//      `runPrePublishGate` in the route the operator uses by hand.
//   2. A site whose type was not `nextjs` fell through to WordPress with empty
//      credentials — WordPress was the implicit `else`.
//   3. `published_at` was stamped and the URL handed to Google and IndexNow
//      whatever the page's real state: a commit on an unpromoted branch, a
//      WordPress draft at `?page_id=123`.
//   4. `published_page_id` was returned by the WordPress publisher and dropped
//      by every caller, so no page could ever be updated — only duplicated.
//   5. A failure AFTER the content had been written sent the row back to
//      `generated`, and the next tick created a second page.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedPage } from '@/lib/ai/openai'
import type { Site } from '@/lib/types'
import type { PublishOutcome } from './outcome'

// ─── Doubles ─────────────────────────────────────────────────────────────────

const updated: Array<Record<string, unknown>> = []
const indexedUrls: string[] = []
const vectorIndexed: string[] = []
const rejected: string[] = []
let gateVerdict = { publishable: true, reasons: [] as string[] }
let gateRuns = 0

vi.mock('@/lib/db', () => ({
  updateGeneration: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    updated.push({ id, ...patch })
  }),
}))

vi.mock('@/lib/seo/indexing', () => ({
  submitForIndexing: vi.fn(async ({ pageUrl }: { pageUrl: string }) => {
    indexedUrls.push(pageUrl)
    return { submitted: true }
  }),
}))

vi.mock('@/lib/pipeline', () => ({
  countHtmlWords: () => 900,
  indexPublishedPage: vi.fn(async ({ url }: { url: string }) => {
    vectorIndexed.push(url)
    return { indexed: true }
  }),
  markGenerationRejected: vi.fn(async (id: string) => {
    rejected.push(id)
  }),
  runPrePublishGate: vi.fn(async (context: { page: GeneratedPage }) => {
    gateRuns += 1
    return {
      page: context.page,
      publishable: gateVerdict.publishable,
      reasons: gateVerdict.reasons,
      warnings: [],
      degraded: [],
      durationMs: 1,
    }
  }),
}))

/** Whatever the connectors are told to answer this test. */
let nextJsAnswer: PublishOutcome
let wordPressAnswer: PublishOutcome

vi.mock('./nextjs', () => ({
  nextJsConnector: {
    label: 'Next.js',
    credentialColumns: ['github_repo', 'github_token'],
    describe: async () => ({ ok: true, message: '' }),
    publish: async () => nextJsAnswer,
  },
}))

vi.mock('./wordpress', () => ({
  wordPressConnector: {
    label: 'WordPress',
    credentialColumns: ['wp_username', 'wp_app_password'],
    describe: async () => ({ ok: true, message: '' }),
    publish: async () => wordPressAnswer,
  },
}))

const { publishPage } = await import('./publish')
const { connectorFor, UnknownConnectorError } = await import('./connector')

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PAGE = {
  title: 'Taxi gare de Troyes',
  metaDescription: 'Reserver.',
  slug: 'taxi-gare-troyes',
  focusKeyword: 'taxi gare troyes',
  htmlContent: '<h1>Taxi</h1>',
  faqItems: [],
} as unknown as GeneratedPage

const NEXTJS_SITE = {
  id: 'site-1',
  name: 'Taxidriver10',
  type: 'nextjs',
  url: 'https://taxidriver10.fr',
  github_repo: 'cnxsolutions/taxidriver10',
  github_token: 'ghp_x',
  github_branch: 'seo-engine',
} as unknown as Site

const WP_SITE = {
  id: 'site-2',
  name: 'Un site WordPress',
  type: 'wordpress',
  url: 'https://exemple.fr',
  wp_username: 'admin',
  wp_app_password: 'xxxx',
} as unknown as Site

function outcome(over: Partial<PublishOutcome>): PublishOutcome {
  return { ok: true, written: true, live: true, discoverable: true, notes: [], ...over }
}

beforeEach(() => {
  updated.length = 0
  indexedUrls.length = 0
  vectorIndexed.length = 0
  rejected.length = 0
  gateVerdict = { publishable: true, reasons: [] }
  gateRuns = 0
  nextJsAnswer = outcome({ pageUrl: 'https://taxidriver10.fr/taxi-gare-troyes', mode: 'contrat' })
  wordPressAnswer = outcome({ pageUrl: 'https://exemple.fr/taxi-gare-troyes', remoteId: '412' })
})

// ─── 2. L'aiguillage ─────────────────────────────────────────────────────────

describe('aiguillage par type de site', () => {
  it('refuse un type inconnu au lieu de partir sur WordPress', async () => {
    const { outcome: result } = await publishPage({
      site: { ...NEXTJS_SITE, type: 'astro' } as unknown as Site,
      page: PAGE,
      intent: 'publie',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('astro')
    expect(result.written).toBe(false)
    // Nothing was attempted: no gate, no push, no row touched.
    expect(gateRuns).toBe(0)
    expect(updated).toHaveLength(0)
  })

  it('nomme le type inconnu dans l erreur levee', () => {
    expect(() => connectorFor('shopify')).toThrow(UnknownConnectorError)
    expect(() => connectorFor('shopify')).toThrow(/shopify/)
  })

  it('refuse un site dont les identifiants manquent, sans appel reseau', async () => {
    const { outcome: result } = await publishPage({
      site: { ...WP_SITE, wp_app_password: '' } as unknown as Site,
      page: PAGE,
      intent: 'publie',
    })

    expect(result.refusal?.kind).toBe('identifiants')
    expect(result.refusal?.message).toContain('wp_app_password')
    expect(gateRuns).toBe(0)
  })
})

// ─── 1. La barriere qualite ──────────────────────────────────────────────────

describe('barriere qualite', () => {
  it('tourne sur le chemin manuel, qui la sautait entierement', async () => {
    await publishPage({ site: NEXTJS_SITE, page: PAGE, intent: 'publie', generationId: 'gen-1' })
    expect(gateRuns).toBe(1)
  })

  it('bloque la publication et enregistre le refus', async () => {
    gateVerdict = { publishable: false, reasons: ['Trop court', 'JSON-LD invalide'] }

    const { outcome: result } = await publishPage({
      site: NEXTJS_SITE, page: PAGE, intent: 'publie', generationId: 'gen-1',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Trop court')
    expect(rejected).toEqual(['gen-1'])
    expect(indexedUrls).toHaveLength(0)
  })

  it('`force` ne desactive PAS la barriere', async () => {
    // `force` exists to overrule a stale view of the destination, never to
    // publish an article the gate rejected. Different questions.
    gateVerdict = { publishable: false, reasons: ['Trop court'] }
    const { outcome: result } = await publishPage({
      site: NEXTJS_SITE, page: PAGE, intent: 'publie', force: true,
    })
    expect(result.ok).toBe(false)
  })

  it('ne la rejoue pas quand l appelant vient de la jouer', async () => {
    await publishPage({
      site: NEXTJS_SITE, page: PAGE, intent: 'publie', generationId: 'gen-1', gateAlreadyRan: true,
    })
    expect(gateRuns).toBe(0)
  })
})

// ─── 3. L'indexation suit `live`, pas le succes ──────────────────────────────

describe('indexation', () => {
  it('soumet une page reellement en ligne', async () => {
    await publishPage({ site: NEXTJS_SITE, page: PAGE, intent: 'publie', generationId: 'gen-1' })

    expect(indexedUrls).toEqual(['https://taxidriver10.fr/taxi-gare-troyes'])
    expect(vectorIndexed).toHaveLength(1)
    expect(updated[0].published_at).toBeTruthy()
  })

  it('ne soumet RIEN pour une page commitee sur une branche non promue', async () => {
    // The real state of both connected sites for days: five commits ahead of
    // `main`, nothing deployed, and Google asked to index every one of them.
    nextJsAnswer = outcome({ live: false, discoverable: false, pageUrl: 'https://taxidriver10.fr/x' })

    await publishPage({ site: NEXTJS_SITE, page: PAGE, intent: 'publie', generationId: 'gen-1' })

    expect(indexedUrls).toHaveLength(0)
    expect(vectorIndexed).toHaveLength(0)
  })

  it('ne date pas une page qui n est pas en ligne', async () => {
    // `published_at` drives the J+30 Search Console measurement. Dating a page
    // from a commit nobody deployed measures thirty days during which no
    // visitor could reach it.
    nextJsAnswer = outcome({ live: false, pageUrl: 'https://taxidriver10.fr/x' })

    await publishPage({ site: NEXTJS_SITE, page: PAGE, intent: 'publie', generationId: 'gen-1' })

    expect(updated[0].status).toBe('published')
    expect(updated[0].published_at).toBeUndefined()
  })

  it('ne soumet pas un brouillon WordPress', async () => {
    wordPressAnswer = outcome({ live: false, discoverable: false, pageUrl: 'https://exemple.fr/?page_id=412' })

    await publishPage({ site: WP_SITE, page: PAGE, intent: 'brouillon', generationId: 'gen-2' })

    expect(indexedUrls).toHaveLength(0)
  })
})

// ─── 4. L'identifiant distant ────────────────────────────────────────────────

describe('identifiant distant', () => {
  it('enregistre le page_id WordPress, que tout le monde jetait', async () => {
    await publishPage({ site: WP_SITE, page: PAGE, intent: 'publie', generationId: 'gen-2' })
    expect(updated[0].published_page_id).toBe(412)
  })

  it('n ecrit pas un SHA de commit dans une colonne entiere', async () => {
    nextJsAnswer = outcome({ pageUrl: 'https://taxidriver10.fr/x', remoteId: '3c886ea' })
    await publishPage({ site: NEXTJS_SITE, page: PAGE, intent: 'publie', generationId: 'gen-1' })
    expect(updated[0].published_page_id).toBeUndefined()
  })
})

// ─── 5. La regle anti-doublon ────────────────────────────────────────────────

describe('anti-doublon', () => {
  it('n enregistre pas en echec une page qui a ete ecrite', async () => {
    // WordPress makes two calls; a failure on the second leaves a real page
    // behind. Marking the row `failed` or `generated` is what makes the next
    // tick create a second one.
    wordPressAnswer = {
      ok: false,
      error: 'Reseau coupe apres la creation',
      written: true,
      live: false,
      discoverable: false,
      remoteId: '412',
      notes: [],
    }

    const { outcome: result } = await publishPage({
      site: WP_SITE, page: PAGE, intent: 'publie', generationId: 'gen-2',
    })

    expect(result.written).toBe(true)
    expect(updated[0].status).toBe('published')
    expect(updated[0].status).not.toBe('generated')
    expect(updated[0].published_page_id).toBe(412)
  })

  it('marque en echec quand rien n a ete ecrit', async () => {
    wordPressAnswer = {
      ok: false, error: 'Auth refusee', written: false, live: false, discoverable: false, notes: [],
    }

    await publishPage({ site: WP_SITE, page: PAGE, intent: 'publie', generationId: 'gen-2' })

    expect(updated[0].status).toBe('failed')
    expect(updated[0].error_message).toBe('Auth refusee')
  })
})
