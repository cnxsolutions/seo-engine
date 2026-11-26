// ─────────────────────────────────────────────────────────────────────────────
// What the L4c and L5a integration tests build: a campaign of their own under
// Plomberie Martin, with a running plan of six pages and their slots, and the
// requests they arbitrate or place. Never the demonstration rows.
//
// Not a test file (no `.db.test.ts`): imported by the ones that need it, with
// the connection and the STAMP they clean up after themselves.
// ─────────────────────────────────────────────────────────────────────────────

import type { Client } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { getCampaignByIdSafe } from '@/lib/db'
import type { PlacementDeps } from '@/lib/keyword-requests/placement'
import { loadPlanningKnowledge, normalizeBriefs } from '@/lib/planning/brief-plan'
import type { Campaign, PlanItemBrief } from '@/lib/types'

export function seedId(seed: string): string {
  const hex = createHash('md5').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const MARTIN = seedId('demo-site-martin')
export const CLIENT_A = seedId('demo-client-a')

/** name → [days from today, page type, priority, keyword] */
export const PAGES: Record<string, [number, string, string, string]> = {
  pilier: [3, 'pillar', 'high', 'plombier troyes guide complet'],
  bas: [4, 'child', 'low', 'entretien chaudiere troyes'],
  moyen: [5, 'child', 'medium', 'robinet qui fuit troyes'],
  haut: [6, 'child', 'high', 'plombier urgence nuit troyes'],
  proche: [1, 'child', 'low', 'wc bouche troyes'],
  tard: [8, 'child', 'medium', 'remplacement ballon eau chaude troyes'],
}

export interface Scenario {
  campaign: string
  plan: string
  item(name: string): string
  day(name: string): string
}

/** A campaign of the test's own, its running plan of six pages and their slots; recorded in `campaigns` for cleanup. */
export async function scenario(db: Client, stamp: string, campaigns: string[], endsInDays = 12): Promise<Scenario> {
  const campaign = randomUUID()
  const plan = randomUUID()
  campaigns.push(campaign)
  const { rows: [{ today }] } = await db.query<{ today: string }>("select to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as today")
  const day = (name: string) => {
    const date = new Date(`${today}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + PAGES[name][0])
    return date.toISOString().slice(0, 10)
  }
  const items = Object.entries(PAGES).map(([name, [, pageType, priority, keyword]]) => ({
    id: `${plan}-${name}`,
    scheduled_date: day(name),
    page_type: pageType,
    priority,
    target_city: 'Troyes',
    target_keyword: keyword,
    secondary_keywords: [],
    search_intent: 'transactionnelle',
    proposed_title: keyword,
    proposed_slug: `${keyword.replace(/ /g, '-')}-${stamp}`,
    page_goal: 'Test.',
    outline: [],
    seo_rules: [],
    required_entities: [],
    internal_link_targets: [],
    competitor_insights: [],
    estimated_word_count: 900,
    rationale: 'Test.',
    action: { kind: 'create', slug: { status: 'free' } },
  }))

  await db.query(
    `insert into public.campaigns (id, site_id, name, business_type, business_name, keywords, department, communes, page_types, is_active)
     values ($1, $2, $3, 'plombier', 'Plomberie Martin', array['plombier'], 'Aube', array['Troyes'], array['pillar', 'child'], false)`,
    [campaign, MARTIN, `Test ${stamp}`],
  )
  await db.query(
    `insert into public.cycle_plans (id, campaign_id, cycle_number, status, cycle_duration_days, cycle_started_at, cycle_ends_at, plan_data, total_pages, total_estimated_words)
     values ($1, $2, 1, 'executing', 14, now() - interval '1 day', now() + make_interval(days => $3), $4::jsonb, 6, 5400)`,
    [plan, campaign, endsInDays, JSON.stringify(items)],
  )
  await db.query('update public.campaigns set current_cycle_id = $1 where id = $2', [plan, campaign])
  for (const item of items) {
    await db.query(
      `insert into public.editorial_calendar (campaign_id, plan_item_id, scheduled_date, page_type, target_keyword, target_city, status, artifact_kind)
       values ($1, $2, $3::date, $4, $5, 'Troyes', 'planned', 'page')`,
      [campaign, item.id, item.scheduled_date, item.page_type, item.target_keyword],
    )
  }
  return { campaign, plan, item: (name) => `${plan}-${name}`, day }
}

export interface TestRequest {
  id: string
  campaign_id: string
  keyword: string
  city: null
  desired_by: string | null
}

export async function request(
  db: Client,
  stamp: string,
  campaign: string,
  keyword: string,
  options: { status?: string; reasonCode?: string; desiredBy?: string | null } = {},
): Promise<TestRequest> {
  const id = randomUUID()
  const text = `${keyword} ${stamp}`
  await db.query(
    `insert into public.keyword_requests (id, client_id, site_id, campaign_id, keyword, keyword_normalized, status, reason_code, desired_by)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8)`,
    [id, CLIENT_A, MARTIN, campaign, text, options.status ?? 'deferred', options.reasonCode ?? 'NEXT_PERIOD', options.desiredBy ?? null],
  )
  return { id, campaign_id: campaign, keyword: text, city: null, desired_by: options.desiredBy ?? null }
}

/** The real planner guards, the model stood in for by `raw` (what it would have answered). */
export function placementDeps(raw: Partial<PlanItemBrief> = {}, during?: () => Promise<void>): PlacementDeps & { written: number } {
  const stub = {
    written: 0,
    loadCampaign: (id: string) => getCampaignByIdSafe(id) as Promise<Campaign | null>,
    loadKnowledge: (campaign: Campaign) => loadPlanningKnowledge({ campaign, gscSignals: null, serpEvidence: [], searchSuggestions: [], clientRequests: [] }),
    async writeBrief(knowledge: Parameters<PlacementDeps['writeBrief']>[0], subject: Parameters<PlacementDeps['writeBrief']>[1]) {
      stub.written++
      await during?.()
      return normalizeBriefs({
        subjects: [subject],
        rawItems: [raw],
        campaign: knowledge.campaign,
        takenPaths: knowledge.takenPaths,
        inventory: knowledge.inventory,
        signals: knowledge.signals,
        existingKeywords: knowledge.existingKeywords,
      })[0]
    },
    now: () => new Date(),
  }
  return stub
}

/** Everything a test built under these campaigns, and its stamped requests. */
export async function cleanUp(db: Client, stamp: string, campaigns: readonly string[]): Promise<void> {
  await db.query('delete from public.keyword_requests where campaign_id = any($1::uuid[]) or keyword like $2', [campaigns, `%${stamp}%`])
  await db.query('update public.campaigns set current_cycle_id = null where id = any($1::uuid[])', [campaigns])
  await db.query('delete from public.editorial_calendar where campaign_id = any($1::uuid[])', [campaigns])
  await db.query('delete from public.cycle_plans where campaign_id = any($1::uuid[])', [campaigns])
  await db.query('delete from public.campaigns where id = any($1::uuid[])', [campaigns])
}
