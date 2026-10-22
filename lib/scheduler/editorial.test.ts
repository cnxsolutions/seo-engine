// ─────────────────────────────────────────────────────────────────────────────
// Calendrier editorial — tests
// SEO Engine - Le calendrier ne produit que ce que le plan a demande.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanItemBrief } from '@/lib/types'

// ─── Double Supabase ─────────────────────────────────────────────────────────
//
// Meme principe que lib/db.test.ts : les assertions portent sur la question
// posee a la base, pas sur sa reponse.

const calls: Array<{ method: string; args: readonly unknown[] }> = []

function queryDouble(): Record<string, unknown> {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'lte', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.then = (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) =>
    resolve({ data: [], error: null, count: 0 })
  return builder
}

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({ from: () => queryDouble() }),
}))

const { generateEditorialCalendar, listDueEditorialSlots, planItemActionKind, slotsFromPlan } = await import('./editorial')

beforeEach(() => {
  calls.length = 0
})

// ─── Du plan aux creneaux ────────────────────────────────────────────────────
//
// Le planificateur ecrit aussi des sujets 'refresh' (une page existante a mettre
// a jour) et 'skip' (un sujet qu'il a ecarte). Le calendrier ne sait que CREER :
// un creneau tire de l'un d'eux devenait une page neuve — refusee sur une
// adresse occupee, doublon sinon.

function item(id: string, action?: PlanItemBrief['action']): PlanItemBrief {
  return {
    id,
    scheduled_date: '2026-10-12',
    page_type: 'child',
    target_city: 'Troyes',
    target_keyword: 'taxi troyes',
    ...(action ? { action } : {}),
  } as PlanItemBrief
}

describe('slotsFromPlan', () => {
  it('ne cree un creneau que pour les creations', () => {
    const slots = slotsFromPlan('c1', [
      item('creer', { kind: 'create' } as PlanItemBrief['action']),
      item('rafraichir', { kind: 'refresh' } as PlanItemBrief['action']),
      item('ecarter', { kind: 'skip', reasons: ['bloque'] } as PlanItemBrief['action']),
    ])

    expect(slots.map((slot) => slot.plan_item_id)).toEqual(['creer'])
  })

  it('garde les plans ecrits avant `action` : ce sont des creations', () => {
    expect(slotsFromPlan('c1', [item('ancien')])).toHaveLength(1)
    expect(planItemActionKind(item('ancien'))).toBe('create')
  })

  it('recopie le sujet dans le creneau', () => {
    const [slot] = slotsFromPlan('c1', [item('creer')])

    expect(slot).toEqual({
      campaign_id: 'c1',
      plan_item_id: 'creer',
      scheduled_date: '2026-10-12',
      page_type: 'child',
      target_keyword: 'taxi troyes',
      target_city: 'Troyes',
      status: 'planned',
    })
  })
})

// ─── Une campagne desactivee s'arrete ────────────────────────────────────────

describe('listDueEditorialSlots', () => {
  it('ignore les creneaux des campagnes desactivees', async () => {
    await listDueEditorialSlots('2026-10-12', 10)

    // Jointure INTERNE : sans elle, le filtre sur la campagne vide `campaign`
    // au lieu d'ecarter le creneau, qui part quand meme.
    expect(calls.find((call) => call.method === 'select')?.args[0]).toContain('campaigns!inner')
    expect(calls.filter((call) => call.method === 'eq').map((call) => call.args)).toContainEqual(['campaign.is_active', true])
  })
})

// ─── Une campagne nationale n'a pas de ville ─────────────────────────────────
//
// Flowyne, une application vendue dans toute la France, avait ete saisie avec
// « tous » comme commune : chaque creneau visait une ville nommee « tous », et
// trois d'entre eux etaient des local packs.

describe('generateEditorialCalendar — portee', () => {
  const base = {
    id: 'c1',
    business_type: 'application de reservation',
    keywords: ['application de reservation', 'agenda en ligne'],
    schedule_frequency: 'every_3_days',
    page_types: ['pillar', 'child', 'local_pack', 'alternative', 'comparative'],
  }
  const calendar = (overrides: Record<string, unknown>) =>
    generateEditorialCalendar({
      campaign: { ...base, ...overrides } as unknown as Parameters<typeof generateEditorialCalendar>[0]['campaign'],
      startDate: new Date('2026-10-22T00:00:00'),
      slotCount: 12,
    })

  it('ne vise aucune ville et ne planifie aucun local pack pour une campagne nationale', () => {
    for (const communes of [['tous'], []]) {
      const slots = calendar({ communes, department: 'Aube' })
      expect(slots).toHaveLength(12)
      expect(new Set(slots.map((slot) => slot.target_city))).toEqual(new Set(['']))
      expect(slots.map((slot) => slot.page_type)).not.toContain('local_pack')
    }
  })

  it('garde les communes et le local pack d\'une campagne locale', () => {
    const slots = calendar({ communes: ['Troyes', 'tous'], department: 'Aube' })
    expect(new Set(slots.map((slot) => slot.target_city))).toEqual(new Set(['Troyes']))
    expect(slots.map((slot) => slot.page_type)).toContain('local_pack')
  })
})
