// ─────────────────────────────────────────────────────────────────────────────
// Reservation de slug — tests
// SEO Engine - Ce que seule une base concurrente peut faire arriver.
// ─────────────────────────────────────────────────────────────────────────────
//
// La politique de desambiguation est pure et deja verrouillee ailleurs
// (lib/seo/slug.test.ts). Ce fichier ne la reteste pas : il teste les trois
// faits que la politique ne peut pas connaitre, et qui ont chacun casse en
// production ou s'appretaient a le faire.
//
//   1. La charge utile de l'UPDATE. Si une seule autre colonne s'y glisse, le
//      bug de cron.ts:1111 revient : une collision fait echouer l'ecriture
//      entiere et le HTML deja paye est perdu. L'assertion porte donc sur les
//      CLES de l'objet, pas sur l'absence de tel ou tel champ — une assertion
//      negative laisserait passer la colonne qu'on n'a pas pensee.
//   2. La traduction du 23505. L'index unique partiel est l'arbitre de deux
//      ticks concurrents ; s'il remonte en exception, l'arbitrage devient une
//      panne et le tick meurt.
//   3. La frontiere entre un refus et une panne. Une erreur Supabase qui n'est
//      PAS 23505 doit continuer de jeter : l'avaler ferait dire « adresse
//      occupee » a une base injoignable, et l'operateur chercherait une page
//      qui n'existe pas.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteInventory } from '@/src/core/domain/existing/inventory'

// ─── Double Supabase ─────────────────────────────────────────────────────────

interface UpdateCall {
  table: string
  payload: Record<string, unknown>
  column: string
  value: unknown
}

const updateCalls: UpdateCall[] = []

/** Ce que la base repondra au prochain UPDATE. null = elle accepte. */
let nextError: { code: string; message: string } | null = null

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          updateCalls.push({ table, payload, column, value })
          return { error: nextError }
        },
      }),
    }),
  }),
}))

const { reserveSlug } = await import('./reservation')

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SITE_ID = 'site-1'
const GENERATION_ID = 'gen-42'

/** buildPageSlug({ focusKeyword: 'taxi gare', city: 'Troyes' }) rend ceci. */
const BASE_SLUG = 'taxi-gare-troyes'
const BASE_PATH = `/${BASE_SLUG}`
const DISAMBIGUATED_SLUG = 'conventionne-taxi-gare-troyes'

function inventaire(taken: readonly string[]): SiteInventory {
  return {
    siteId: SITE_ID,
    entries: [],
    takenPaths: new Set(taken),
    freshness: { state: 'fresh', lastCrawledAt: '2026-08-20T10:00:00.000Z', ageDays: 1 },
    crawledCount: taken.length,
    publishedCount: 0,
    truncated: false,
  }
}

function reservation(taken: readonly string[], disambiguators: readonly string[] = []) {
  return reserveSlug({
    siteId: SITE_ID,
    generationId: GENERATION_ID,
    city: 'Troyes',
    slugInput: { focusKeyword: 'taxi gare', city: 'Troyes' },
    inventory: inventaire(taken),
    disambiguators,
  })
}

beforeEach(() => {
  updateCalls.length = 0
  nextError = null
})

// ─── Le chemin nominal ───────────────────────────────────────────────────────

describe('reserveSlug', () => {
  it('rend ok et le slug resolu quand l adresse est libre', async () => {
    const result = await reservation([])

    expect(result).toEqual({ ok: true, slug: BASE_SLUG })
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].table).toBe('generations')
    expect(updateCalls[0].column).toBe('id')
    expect(updateCalls[0].value).toBe(GENERATION_ID)
  })

  it('rend le slug desambigue, et c est LUI qui est ecrit', async () => {
    // L'adresse ecrite en base doit etre celle que la page portera. Ecrire le
    // slug de base « parce que c'est celui qu'on avait demande » ferait pointer
    // la reservation sur une autre page que celle qui sera publiee.
    const result = await reservation([BASE_PATH], ['conventionne'])

    expect(result).toEqual({
      ok: true,
      slug: DISAMBIGUATED_SLUG,
      disambiguatedFrom: BASE_PATH,
      token: 'conventionne',
    })
    expect(updateCalls[0].payload).toEqual({ slug: DISAMBIGUATED_SLUG })
  })

  // ─── 1. La charge utile ────────────────────────────────────────────────────

  it('n ecrit QUE la colonne slug', async () => {
    await reservation([])

    // L'assertion est sur les CLES : aujourd'hui `content`, `title` et
    // `page_payload` sont les colonnes qui feraient le plus de degats, mais
    // c'est la colonne qu'on n'a pas prevue qui reviendra. Une egalite stricte
    // sur la liste des cles est la seule forme qui les couvre toutes.
    expect(Object.keys(updateCalls[0].payload)).toEqual(['slug'])
  })

  it('n ecrit pas updated_at : le trigger de la table s en charge', async () => {
    await reservation([])

    // trigger_generations_updated_at, BEFORE UPDATE (db/000_baseline.sql:912).
    // Le champ n'est pas seulement inutile : sa presence banaliserait l'idee
    // qu'on peut ajouter « juste un champ de plus » a cette ecriture.
    expect(updateCalls[0].payload).not.toHaveProperty('updated_at')
  })

  // ─── 2. L'index comme arbitre ──────────────────────────────────────────────

  it('traduit une violation 23505 en refus, et NE JETTE PAS', async () => {
    nextError = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "idx_generations_unique_slug_site"',
    }

    const result = await reservation([])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('inatteignable')
    expect(result.refusal).toBe('collision')
    expect(result.occupiedBy).toBe(BASE_PATH)
    // Le message doit nommer la ville : un operateur qui pilote quarante
    // communes ne peut rien faire d'un chemin sans contexte.
    expect(result.message).toContain('Troyes')
  })

  it('ne laisse jamais un 23505 remonter en exception', async () => {
    nextError = { code: '23505', message: 'duplicate key value' }

    await expect(reservation([])).resolves.toBeDefined()
  })

  // ─── 3. Refus contre panne ─────────────────────────────────────────────────

  it('propage une erreur Supabase qui n est pas 23505', async () => {
    nextError = { code: '08006', message: 'connection failure' }

    await expect(reservation([])).rejects.toThrow('connection failure')
  })

  it('propage aussi une violation de contrainte qui n est pas d unicite', async () => {
    // 23514 = check_violation. generations_refresh_needs_target et
    // generations_intent_check sont des CHECK poses par la migration 018 : les
    // confondre avec une collision de slug ferait afficher « adresse occupee »
    // sur une ligne dont l'intention est incoherente.
    nextError = { code: '23514', message: 'new row violates check constraint' }

    await expect(reservation([])).rejects.toThrow('check constraint')
  })

  // ─── Le refus qui ne coute rien ────────────────────────────────────────────

  it('refuse sans ecrire quand aucun desambiguateur ne libere d adresse', async () => {
    const result = await reservation([BASE_PATH, `/${DISAMBIGUATED_SLUG}`], ['conventionne'])

    expect(result).toEqual({
      ok: false,
      refusal: 'collision',
      occupiedBy: BASE_PATH,
      message: expect.stringContaining('Troyes'),
    })
    // Aucun aller-retour vers la base : la decision est purement locale, et
    // c'est ce qui rend un refus moins cher qu'une page.
    expect(updateCalls).toHaveLength(0)
  })
})
