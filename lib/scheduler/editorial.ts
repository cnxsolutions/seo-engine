import type { Campaign, PageType, ScheduleFrequency, EditorialSlot } from '@/lib/types'
import { createServiceClient } from '@/lib/supabase'
import { SITE_SAFE_COLUMNS, type SafeCampaign } from '@/lib/db'

/** A slot whose embedded campaign carries no site credentials. */
export type SafeEditorialSlot = Omit<EditorialSlot, 'campaign'> & { campaign?: SafeCampaign }

/** Fallback publishing time when a campaign never set `schedule_time`. */
export const DEFAULT_SCHEDULE_TIME = '09:00'

const FREQUENCY_DAYS: Record<ScheduleFrequency, number> = {
  manual: 0,
  daily: 1,
  every_2_days: 2,
  every_3_days: 3,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  custom: 0,
}

export interface GenerateCalendarOptions {
  campaign: Campaign
  startDate?: Date
  slotCount?: number
}

export function generateEditorialCalendar(opts: GenerateCalendarOptions): Omit<EditorialSlot, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'generation'>[] {
  const { campaign, startDate = new Date(), slotCount = 30 } = opts
  const frequency = campaign.schedule_frequency || 'daily'
  const intervalDays = FREQUENCY_DAYS[frequency] || 1
  const pageTypes: PageType[] = campaign.page_types && campaign.page_types.length > 0 ? campaign.page_types : ['pillar', 'child']
  const keywords = campaign.keywords?.length > 0 ? campaign.keywords : [campaign.business_type]
  const communes = campaign.communes?.length > 0 ? campaign.communes : [campaign.department || 'Aube']

  if (frequency === 'manual' || intervalDays === 0) return []

  const slots: Omit<EditorialSlot, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'generation'>[] = []
  const currentDate = new Date(startDate)
  currentDate.setHours(0, 0, 0, 0)

  const pageTypeRotation = buildPageTypeRotation(pageTypes)
  let keywordIndex = 0
  let communeIndex = 0

  for (let i = 0; i < slotCount; i++) {
    if (frequency === 'custom' && campaign.schedule_days?.length) {
      const dayOfWeek = currentDate.getDay()
      if (!campaign.schedule_days.includes(dayOfWeek)) {
        currentDate.setDate(currentDate.getDate() + 1)
        i--
        if (currentDate.getTime() - startDate.getTime() > 365 * 24 * 60 * 60 * 1000) break
        continue
      }
    }

    const pageType = pageTypeRotation[i % pageTypeRotation.length]
    const keyword = keywords[keywordIndex % keywords.length]
    const city = communes[communeIndex % communes.length]

    slots.push({
      campaign_id: campaign.id,
      scheduled_date: formatLocalDate(currentDate),
      page_type: pageType,
      target_keyword: keyword,
      target_city: city,
      status: 'planned',
    })

    keywordIndex++
    if (keywordIndex % keywords.length === 0) communeIndex++

    if (frequency !== 'custom') {
      currentDate.setDate(currentDate.getDate() + intervalDays)
    } else {
      currentDate.setDate(currentDate.getDate() + 1)
    }
  }

  return slots
}

function buildPageTypeRotation(pageTypes: PageType[]): PageType[] {
  if (pageTypes.length === 1) return pageTypes

  const rotation: PageType[] = []
  const hasPillar = pageTypes.includes('pillar')
  const childTypes = pageTypes.filter((t) => t !== 'pillar')

  if (hasPillar && childTypes.length > 0) {
    rotation.push('pillar')
    for (let i = 0; i < 3; i++) {
      rotation.push(childTypes[i % childTypes.length])
    }
    for (const childType of childTypes.slice(1)) {
      rotation.push(childType)
    }
  } else {
    rotation.push(...pageTypes)
  }

  return rotation
}

/**
 * Next run instant for a campaign, always at its local `schedule_time`.
 *
 * The time is applied on every branch, including when the campaign never set one
 * — the fallback is the same DEFAULT_SCHEDULE_TIME the editorial job uses, so a
 * campaign and its calendar slots cannot disagree about when "the day" starts.
 * Parsing goes through scheduleTimeToMinutes so a malformed value can never
 * produce an Invalid Date, whose toISOString() would throw in the middle of a
 * successful run.
 */
export function computeNextRunAt(campaign: Campaign): string | null {
  const frequency = campaign.schedule_frequency || 'daily'
  if (frequency === 'manual') return null

  const intervalDays = FREQUENCY_DAYS[frequency]
  const now = new Date()
  const minutesIntoDay = scheduleTimeToMinutes(campaign.schedule_time)

  if (frequency === 'custom' && campaign.schedule_days?.length) {
    const targetDay = findNextScheduledDay(now, campaign.schedule_days)
    targetDay.setHours(Math.floor(minutesIntoDay / 60), minutesIntoDay % 60, 0, 0)
    if (targetDay <= now) targetDay.setDate(targetDay.getDate() + 7)
    return targetDay.toISOString()
  }

  const next = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000)
  next.setHours(Math.floor(minutesIntoDay / 60), minutesIntoDay % 60, 0, 0)
  return next.toISOString()
}

function findNextScheduledDay(from: Date, days: number[]): Date {
  const currentDay = from.getDay()
  const sortedDays = [...days].sort((a, b) => a - b)
  const nextDay = sortedDays.find((d) => d > currentDay)
  const targetDayOfWeek = nextDay ?? sortedDays[0]
  const daysUntil = (targetDayOfWeek - currentDay + 7) % 7 || 7
  const result = new Date(from)
  result.setDate(result.getDate() + daysUntil)
  return result
}

// ─── Local Calendar Dates ───────────────────────────────────────────────────────
//
// Every date in this pipeline is a *calendar* date, not an instant: the slots are
// built at local midnight, node-cron fires on local time, and the user picks a
// local `schedule_time`. `toISOString()` answers in UTC, so east of Greenwich it
// shifts a local-midnight date to the previous day and flips the scheduler's own
// "today" to tomorrow during the evening. In France that is a one-day error every
// evening — the exact window in which the daily slots were supposed to run.
// Both ends must therefore read the same local clock.

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayLocalDate(): string {
  return formatLocalDate(new Date())
}

/** Minutes since local midnight for a `HH:MM` or `HH:MM:SS` value. */
export function scheduleTimeToMinutes(scheduleTime?: string | null): number {
  const [hours, minutes] = (scheduleTime || DEFAULT_SCHEDULE_TIME).split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return Math.min(23, Math.max(0, hours)) * 60 + Math.min(59, Math.max(0, minutes))
}

export function minutesSinceLocalMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

export async function saveEditorialSlots(slots: Omit<EditorialSlot, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'generation'>[]) {
  if (slots.length === 0) return []
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('editorial_calendar')
    .insert(slots)
    .select('*')

  if (error) throw new Error(error.message)
  return data as EditorialSlot[]
}

/**
 * The calendar as the dashboard reads it.
 *
 * The embedded site is PROJECTED, unlike `listDueEditorialSlots()` below: this
 * is the query behind `GET /api/calendar`, whose result is serialised to the
 * browser as-is. An unqualified `site:sites(*)` here shipped every campaign's
 * WordPress application password and GitHub token in the calendar payload —
 * the same leak `lib/db.ts` closed on the sites and campaigns routes, reopened
 * one join deeper.
 *
 * Nothing on this path publishes, so nothing on it needs the secrets.
 */
export async function listEditorialSlots(campaignId?: string, fromDate?: string, toDate?: string) {
  const supabase = createServiceClient()
  let query = supabase
    .from('editorial_calendar')
    .select(`*, campaign:campaigns(*, site:sites(${SITE_SAFE_COLUMNS}))`)

  if (campaignId) query = query.eq('campaign_id', campaignId)
  if (fromDate) query = query.gte('scheduled_date', fromDate)
  if (toDate) query = query.lte('scheduled_date', toDate)

  const { data, error } = await query.order('scheduled_date', { ascending: true })
  if (error) throw new Error(error.message)
  return data as SafeEditorialSlot[]
}

export async function updateEditorialSlot(id: string, values: Partial<EditorialSlot>) {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('editorial_calendar')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Due Slots ──────────────────────────────────────────────────────────────────

export interface DueEditorialSlots {
  /** Oldest-first, capped at the caller's limit. */
  slots: EditorialSlot[]
  /** How many slots are due in total, ignoring the cap — what the cap hides. */
  totalDue: number
}

/**
 * Slots waiting to run, oldest first and hard-capped.
 *
 * Filtering server-side matters after an outage: the scheduler must not load a
 * three-week backlog into memory only to run a handful of it, and it must run
 * the oldest slots first so the backlog drains in editorial order.
 */
export async function listDueEditorialSlots(uptoDate: string, limit: number): Promise<DueEditorialSlots> {
  const supabase = createServiceClient()
  const { data, error, count } = await supabase
    .from('editorial_calendar')
    .select('*, campaign:campaigns(*, site:sites(*))', { count: 'exact' })
    .eq('status', 'planned')
    .lte('scheduled_date', uptoDate)
    .order('scheduled_date', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)
  return { slots: (data ?? []) as EditorialSlot[], totalDue: count ?? (data?.length ?? 0) }
}

// ─── Atomic Claims ──────────────────────────────────────────────────────────────
//
// These live here rather than in lib/db.ts only because that file is owned
// elsewhere; they are scheduler-internal data access.
//
// A read-then-write guard (`if (slot.status !== 'planned')`) proves nothing: the
// row it tests was read once, minutes earlier, and every retry re-tests the same
// stale copy. The claim below is a compare-and-swap — the database decides who
// owns the slot, and only one caller can win.

/**
 * Take ownership of a slot and count the attempt. Returns false when someone
 * else already has it (a concurrent tick, or a previous run still in flight):
 * that is a normal outcome, not an error.
 *
 * `attempt` is supplied by the caller rather than incremented in SQL because
 * supabase-js cannot express `attempt_count + 1`; the compare-and-swap on
 * `status` still guarantees a single writer, so the value cannot drift.
 */
export async function claimEditorialSlot(id: string, attempt: number): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('editorial_calendar')
    .update({
      status: 'generating',
      error_message: null,
      attempt_count: attempt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'planned')
    .select('id')

  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

/**
 * Record why a slot could not be produced, so it stops being invisible. The
 * generation id is kept even on failure: it is the only way back to the partial
 * row and its own error message.
 */
export async function failEditorialSlot(id: string, message: string, generationId?: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('editorial_calendar')
    .update({
      status: 'failed',
      error_message: message.slice(0, 2000),
      ...(generationId ? { generation_id: generationId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Hand a slot back to the pool without marking it failed (nothing was produced).
 * `message` is kept so the reason for the extra attempt survives in the calendar.
 */
export async function releaseEditorialSlot(id: string, message?: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('editorial_calendar')
    .update({
      status: 'planned',
      error_message: message ? message.slice(0, 2000) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'generating')
  if (error) throw new Error(error.message)
}

/**
 * Slots stuck in `generating` for longer than `staleMinutes`.
 *
 * A process that dies mid-generation leaves its slot there, and nothing ever
 * looks at `generating` again — the slot is lost for good. The threshold must
 * stay well above the editorial job's own timeout so a slow but live run is
 * never declared dead underneath itself.
 *
 * The rows are only listed, not repaired: the caller has to look at what the run
 * actually left behind before deciding, and re-running a slot whose page is
 * already online is how a duplicate article gets published.
 */
export async function listStaleGeneratingSlots(staleMinutes: number): Promise<EditorialSlot[]> {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('editorial_calendar')
    .select('*')
    .eq('status', 'generating')
    .lt('updated_at', cutoff)
    .order('scheduled_date', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as EditorialSlot[]
}

/**
 * Status of the generations a set of slots points at, keyed by generation id.
 *
 * Read with an explicit `in` rather than a PostgREST embed: the embed would need
 * a declared foreign key between editorial_calendar and generations, and the base
 * schema is not in this repository to guarantee one.
 */
export async function getGenerationOutcomes(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('generations')
    .select('id, status')
    .in('id', ids)

  if (error) throw new Error(error.message)

  const outcomes = new Map<string, string>()
  for (const row of (data ?? []) as { id: string; status: string }[]) {
    outcomes.set(row.id, row.status)
  }
  return outcomes
}

/**
 * Same compare-and-swap for the deferred publishing job: without it two ticks
 * (or two retry attempts) can both push the same generation, and WordPress
 * happily accepts the duplicate.
 */
/**
 * @param fromStatuses which statuses may be claimed. `generated` alone for the
 *   scheduler; the operator may also pick up a row the engine REFUSED, which
 *   otherwise had no way out of `failed` — no job reads that status, and the
 *   publication screen does not list it.
 */
export async function claimGenerationForPublishing(
  id: string,
  fromStatuses: string[] = ['generated']
): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('generations')
    .update({ status: 'publishing', updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', fromStatuses)
    .select('id')

  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

/**
 * Generations stranded in `publishing`.
 *
 * `claimGenerationForPublishing` moves a row there and nothing moves it back on
 * a crash, a restart, or a throw outside the handler. `listPendingPublishGenerations`
 * only reads `generated`, so the row leaves every queue: the page may well be
 * online at the client, with no `published_url`, no `published_at`, no indexing,
 * and nothing that will ever look at it again.
 */
export async function listStalePublishingGenerations(minutes: number): Promise<Array<{ id: string; site_id: string | null; slug: string | null }>> {
  const supabase = createServiceClient()
  const threshold = new Date(Date.now() - minutes * 60_000).toISOString()

  const { data, error } = await supabase
    .from('generations')
    .select('id,site_id,slug')
    .eq('status', 'publishing')
    .lt('updated_at', threshold)
    .limit(50)

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function deleteEditorialSlots(campaignId: string) {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('editorial_calendar')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('status', 'planned')
  if (error) throw new Error(error.message)
}
