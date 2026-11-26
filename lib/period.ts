// ─────────────────────────────────────────────────────────────────────────────
// The period in progress of a site — one reading, two doors
// ─────────────────────────────────────────────────────────────────────────────
//
// The client's home shows it (lib/client-space/overview.ts, behind the scope
// of the session), and so does the console's site header (L5b, the thread of
// design.md § 6). One reading, so the two never disagree on what « la période
// en cours » holds. Named columns only: nothing here can reach a client that
// is not already in PeriodSummary.

import { createServiceClient } from '@/lib/supabase'
import {
  parisDay,
  planTitles,
  summarizePeriod,
  type CycleRow,
  type PeriodSummary,
  type SlotRow,
} from '@/src/core/domain/client-space/overview'

/** A site with more campaigns than this is not a client site; it is a test bench. */
const CAMPAIGNS_PER_SITE_MAX = 20
/** A period holds a few dozen pages at most. */
const SLOTS_PER_PERIOD_MAX = 200

function fail(action: string, message: string): never {
  throw new Error(`[periode] ${action} : ${message}`)
}

async function campaignIdsOf(siteId: string): Promise<string[]> {
  const { data, error } = await createServiceClient()
    .from('campaigns').select('id').eq('site_id', siteId).limit(CAMPAIGNS_PER_SITE_MAX)
  if (error) fail('campagnes du site', error.message)
  return (data ?? []).map((row) => row.id as string)
}

/**
 * The executing cycles of the site's campaigns, their pages in the calendar
 * (pages only — Business Profile posts live in the same table), and the titles
 * their plans proposed. Three queries, whatever the number of pages.
 *
 * Takes a site id: the client's door (readPeriod) resolves it from the
 * session's ClientSiteDto, the console's from its own gate.
 */
export async function readSitePeriod(siteId: string, today: string = parisDay(new Date())): Promise<PeriodSummary | null> {
  const campaignIds = await campaignIdsOf(siteId)
  if (campaignIds.length === 0) return null

  const supabase = createServiceClient()
  const { data: cycles, error: cyclesError } = await supabase
    .from('cycle_plans')
    .select('cycle_started_at,cycle_ends_at,plan_data')
    .in('campaign_id', campaignIds)
    .eq('status', 'executing')
    .limit(CAMPAIGNS_PER_SITE_MAX)
  if (cyclesError) fail('periode en cours', cyclesError.message)

  const rows = (cycles ?? []) as Array<CycleRow & { plan_data: unknown }>
  const dated = rows.filter((cycle) => cycle.cycle_started_at && cycle.cycle_ends_at)
  if (dated.length === 0) return null

  const from = dated.map((cycle) => parisDay(cycle.cycle_started_at as string)).sort()[0]
  const to = dated.map((cycle) => parisDay(cycle.cycle_ends_at as string)).sort().at(-1) as string

  const { data: slots, error: slotsError } = await supabase
    .from('editorial_calendar')
    .select('id,scheduled_date,status,target_keyword,target_city,plan_item_id')
    .in('campaign_id', campaignIds)
    .eq('artifact_kind', 'page')
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .order('scheduled_date', { ascending: true })
    .limit(SLOTS_PER_PERIOD_MAX)
  if (slotsError) fail('pages de la periode', slotsError.message)

  const titles = new Map<string, string>()
  for (const cycle of dated) for (const [id, title] of planTitles(cycle.plan_data)) titles.set(id, title)

  return summarizePeriod(dated, (slots ?? []) as SlotRow[], titles, today)
}
