// ─────────────────────────────────────────────────────────────────────────────
// Enhanced CRON Scheduler
// SEO Engine - Production-grade job scheduler: atomic claims, bounded catch-up,
//              across-tick retries, stale-slot recovery, logs
// ─────────────────────────────────────────────────────────────────────────────

import cron from 'node-cron'
import { createServiceClient } from '@/lib/supabase'
import { generateSeoPage } from '@/lib/ai/page-types'
import { createGeneration, getPlanItemBrief, getSiteContext, listDueCampaigns, listPendingPublishGenerations, updateCampaignSchedule, updateGeneration } from '@/lib/db'
import { getGoogleContext } from '@/lib/google/context'
import { syncAllGbp, syncAllGsc } from '@/lib/google/sync'
import {
  countHtmlWords,
  markGenerationRejected,
  runPostGenerationPipeline,
  runPrePublishGate,
  type PipelineReport,
} from '@/lib/pipeline'
import { publishPage } from '@/lib/publishing/publish'
import type { PublishOutcome } from '@/lib/publishing/outcome'
import { checkCycleCompletion } from './cycle-manager'
import {
  claimEditorialSlot,
  claimGenerationForPublishing,
  computeNextRunAt,
  failEditorialSlot,
  getGenerationOutcomes,
  listDueEditorialSlots,
  listStaleGeneratingSlots,
  listStalePublishingGenerations,
  minutesSinceLocalMidnight,
  releaseEditorialSlot,
  scheduleTimeToMinutes,
  todayLocalDate,
  updateEditorialSlot,
} from './editorial'
import type { Campaign, EditorialSlot, PageType, PlanItemBrief, Generation } from '@/lib/types'
import type { GeneratedPage } from '@/lib/ai/openai'

// ─── Scheduler State ───────────────────────────────────────────────────────────────

let schedulerStarted = false
const runningJobs = new Map<string, { startTime: number; pid: string }>()

// ─── Job Configuration ───────────────────────────────────────────────────────────

interface JobConfig {
  /**
   * Attempts allowed per subject, spent ACROSS ticks — not a retry loop.
   * Only the editorial job counts them (`editorial_calendar.attempt_count`); the
   * other jobs are naturally re-queued by their own state and run once per tick.
   */
  maxAttempts: number
  timeoutMs: number
  concurrency: number
}

const JOB_CONFIGS: Record<string, JobConfig> = {
  // The editorial timeout is generous on purpose: a page built with RAG context
  // legitimately takes minutes, and giving up on a live generation is precisely
  // what used to produce duplicates.
  editorial: { maxAttempts: 3, timeoutMs: 300000, concurrency: 2 },
  publish: { maxAttempts: 1, timeoutMs: 60000, concurrency: 3 },
  campaign: { maxAttempts: 1, timeoutMs: 180000, concurrency: 1 },
  gscSync: { maxAttempts: 1, timeoutMs: 300000, concurrency: 1 },
  gbpSync: { maxAttempts: 1, timeoutMs: 300000, concurrency: 1 },
}

// ─── Catch-up Budget ─────────────────────────────────────────────────────────────
//
// After an outage every missed slot is due at once. Each one is a full LLM page
// (thousands of tokens, minutes of work), so an unbounded burst is both the most
// expensive thing this process can do and the fastest way to hit a provider rate
// limit. The main tick runs every 15 min, so a cap of 10 still drains 40 slots
// per hour — fast enough to catch up on a day of downtime in an evening, and
// predictable enough to budget.
//
// Whatever a cap defers is logged explicitly: a silent ceiling reads exactly
// like "there was nothing left to do".

const MAX_CATCHUP_SLOTS_PER_RUN = 10
const MAX_CAMPAIGNS_PER_RUN = 10

/** Mirrors the LIMIT inside listPendingPublishGenerations (lib/db.ts). */
const PUBLISH_PAGE_SIZE = 10

/**
 * A slot left in `generating` for this long no longer has anyone waiting for it.
 * Six times the editorial timeout (5 min), so a slow but live generation is never
 * declared dead underneath itself.
 */
const STALE_GENERATING_MINUTES = 30

/**
 * A push left in `publishing` this long has no process behind it any more.
 * Well above the 60 s publish timeout, so a slow but live push is never
 * declared dead underneath itself.
 */
const STALE_PUBLISHING_MINUTES = 15

/**
 * Written by the reaper, read by the retry.
 *
 * It tells the connector that a previous attempt on this row was cut off, so a
 * page found at the same slug AND carrying the same title is ours rather than
 * the owner's. Without it the nominal recovery refused our own half-written
 * page and parked the row in `failed` with a false reason.
 */
const RECOVERY_MARK = '[reprise]'

// ─── Logging ────────────────────────────────────────────────────────────────────

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

interface LogEntry {
  timestamp: string
  level: LogLevel
  job: string
  message: string
  duration?: number
  error?: string
  context?: Record<string, unknown>
}

const jobLogs: LogEntry[] = []
const MAX_LOGS = 1000

function log(level: LogLevel, job: string, message: string, context?: Record<string, unknown>, error?: Error): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    job,
    message,
    duration: context?.duration as number,
    error: error?.message,
    context,
  }
  jobLogs.push(entry)
  if (jobLogs.length > MAX_LOGS) jobLogs.shift()

  const prefix = `[${level}] [${job}]`
  if (level === 'ERROR') {
    console.error(prefix, message, error?.message, context)
  } else if (level === 'WARN') {
    console.warn(prefix, message, context)
  } else {
    console.log(prefix, message, context || '')
  }
}

// ─── Scheduler Initialization ────────────────────────────────────────────────────

export function initScheduler(): void {
  if (schedulerStarted || process.env.NEXT_RUNTIME === 'edge') {
    log('WARN', 'scheduler', 'Scheduler already started or running in edge runtime')
    return
  }
  schedulerStarted = true

  log('INFO', 'scheduler', 'Initializing SEO Engine job scheduler', {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localTime: new Date().toString(),
  })

  // A restart is the most common way a row gets stranded in `generating` or
  // `publishing`: recover before anything else, so the first tick sees them.
  void reapStaleSlots()
  void reapStalePublications()

  // Main editorial and publishing job - every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await runWithConcurrencyControl('main', async () => {
      // Sequenced first, not settled in parallel: what they recover must be
      // visible to the jobs below in this very tick.
      await reapStaleSlots()
      await reapStalePublications()

      await Promise.allSettled([
        runDueEditorialSlots(),
        publishPendingGenerations(),
        runDueCampaigns(),
        checkCycleCompletion(),
      ])
    })
  })

  // Google Search Console sync - daily at 4:00 AM
  cron.schedule('0 4 * * *', async () => {
    await runWithConcurrencyControl('gsc', async () => {
      await syncAllGsc()
    })
  })

  // Google Business Profile sync - every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    await runWithConcurrencyControl('gbp', async () => {
      await syncAllGbp()
    })
  })

  // Cleanup old logs - daily
  cron.schedule('0 0 * * *', () => {
    cleanupOldLogs()
  })

  log('INFO', 'scheduler', 'All cron jobs scheduled successfully')
}

// ─── Concurrency Control ────────────────────────────────────────────────────────

async function runWithConcurrencyControl(jobId: string, fn: () => Promise<void>): Promise<void> {
  const existing = runningJobs.get(jobId)
  if (existing) {
    log('DEBUG', jobId, `Job already running since ${new Date(existing.startTime).toISOString()}`)
    return
  }

  const job = { startTime: Date.now(), pid: crypto.randomUUID() }
  runningJobs.set(jobId, job)

  try {
    const startTime = Date.now()
    await fn()
    log('INFO', jobId, `Job completed`, { duration: Date.now() - startTime })
  } finally {
    runningJobs.delete(jobId)
  }
}

// ─── Timeout ────────────────────────────────────────────────────────────────────
//
// There is deliberately no in-tick retry loop in this file any more.
//
// Every job here ends in an LLM call or an HTTP push, and neither can be
// cancelled: `Promise.race` stops the scheduler from waiting, it does not stop
// the work. Retrying a few seconds later therefore does not replace the failed
// attempt, it runs alongside it — which is how one timed-out slot became three
// articles. Retries are spent across ticks instead, 15 minutes apart, which also
// happens to be the right backoff for a rate-limited model.

/**
 * Distinguishable on purpose: a timeout does not mean the work failed, only that
 * the scheduler stopped waiting for it. Callers that can publish must treat the
 * two cases differently.
 */
class JobTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, jobName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new JobTimeoutError(`Job ${jobName} timed out after ${ms}ms`)), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

// ─── Stale Slot Reaper ───────────────────────────────────────────────────────────

/**
 * Resolve slots abandoned in `generating`.
 *
 * Two things can leave a slot there: the process died, or the run overran its
 * timeout and the scheduler stopped waiting for it. The second case is
 * ambiguous — the abandoned run may well have finished, and re-planning the slot
 * would publish the same article twice. So the generation it produced is
 * consulted first, and the slot is only put back in the pool when that
 * generation shows nothing was produced.
 */
/**
 * Rows abandoned mid-push.
 *
 * Deliberately hands them back to `generated` rather than deciding they are
 * published: the push may have gone through, but with no record of it the safe
 * reading is "unfinished", and the occupancy guard on the next attempt is what
 * prevents a duplicate. Before this existed such a row simply stopped existing
 * for every job in the system.
 */
async function reapStalePublications(): Promise<void> {
  const stale = await listStalePublishingGenerations(STALE_PUBLISHING_MINUTES).catch((error) => {
    log('ERROR', 'reaper', 'Could not list stale publications', undefined,
      error instanceof Error ? error : new Error(String(error)))
    return []
  })
  if (stale.length === 0) return

  log('WARN', 'reaper', `${stale.length} publication(s) abandonnee(s) en 'publishing'`, {
    staleMinutes: STALE_PUBLISHING_MINUTES,
  })

  for (const row of stale) {
    // The marker travels in `error_message` rather than in a column of its own:
    // one word in a field the retry already reads, against a migration for a
    // flag that is true for at most a handful of rows a year.
    await updateGeneration(row.id, {
      status: 'generated',
      error_message: `${RECOVERY_MARK} Publication interrompue — reprise au prochain passage.`,
    }).catch(() => null)
  }
}

async function reapStaleSlots(): Promise<void> {
  // Never allowed to break the tick it runs at the head of.
  const stale = await listStaleGeneratingSlots(STALE_GENERATING_MINUTES).catch(error => {
    log('ERROR', 'reaper', 'Could not list stale slots', undefined,
      error instanceof Error ? error : new Error(String(error)))
    return [] as EditorialSlot[]
  })
  if (stale.length === 0) return

  log('WARN', 'reaper', `${stale.length} slot(s) abandoned in 'generating'`, {
    staleMinutes: STALE_GENERATING_MINUTES,
  })

  const outcomes = await getGenerationOutcomes(
    stale.map(slot => slot.generation_id).filter((id): id is string => Boolean(id))
  ).catch(() => new Map<string, string>())

  for (const slot of stale) {
    const outcome = slot.generation_id ? outcomes.get(slot.generation_id) : undefined
    const context = {
      campaignId: slot.campaign_id,
      scheduledDate: slot.scheduled_date,
      targetKeyword: slot.target_keyword,
      generationId: slot.generation_id,
      attempts: slot.attempt_count ?? 0,
      lastTouchedAt: slot.updated_at,
    }

    // The abandoned run did produce something: adopt its result instead of
    // re-running it. `publishing` counts as produced — the page exists and a push
    // may still be in flight, and generating a replacement would be the exact
    // duplicate this whole job is built to avoid.
    if (outcome && ['published', 'generated', 'publishing'].includes(outcome)) {
      await updateEditorialSlot(slot.id, {
        status: outcome === 'published' ? 'published' : 'generated',
      }).catch(() => null)
      log('WARN', 'reaper', `Slot ${slot.id} recovered from a generation in '${outcome}'`, context)
      continue
    }

    if ((slot.attempt_count ?? 0) >= JOB_CONFIGS.editorial.maxAttempts) {
      await failEditorialSlot(slot.id, `Abandonne en 'generating' apres ${slot.attempt_count ?? 0} tentative(s)`).catch(() => null)
      log('ERROR', 'reaper', `Slot ${slot.id} marked 'failed' — attempt budget exhausted`, context)
      continue
    }

    await releaseEditorialSlot(slot.id).catch(() => null)
    log('WARN', 'reaper', `Slot ${slot.id} put back to 'planned'`, context)
  }
}

// ─── Post-generation Pipeline ────────────────────────────────────────────────
//
// lib/pipeline is what stands between a generated page and a published one:
// measured length, internal links proven against the pages that really exist,
// then a blocking validation gate. It never throws and it contains no retry —
// this file owns the attempt budget and spends it across ticks.

function logPipelineReport(job: string, report: PipelineReport, context: Record<string, unknown>): void {
  const shared = {
    ...context,
    measuredWords: report.measurement.measured,
    declaredWords: report.measurement.declared,
    targetWords: report.measurement.target,
    linksKept: report.links.kept,
    linksRemoved: report.links.removed,
    score: report.gate.score,
    grade: report.gate.grade,
    duration: report.durationMs,
  }

  if (report.publishable) {
    log('INFO', job, 'Pipeline passed', shared)
  } else {
    log('ERROR', job, 'Pipeline blocked the publication', { ...shared, reasons: report.reasons })
  }

  // Said out loud rather than counted silently: from the outside a page that
  // shipped five links to nowhere and a page that shipped none look identical.
  if (report.links.removed > 0) {
    log('WARN', job, `${report.links.removed} internal link(s) removed — no existing page resolves them`, {
      ...context,
      removed: report.links.removedHrefs,
    })
  }

  for (const reason of report.degraded) {
    log('WARN', job, `Pipeline degraded: ${reason}`, context)
  }

  if (report.warnings.length > 0) {
    log('DEBUG', job, `${report.warnings.length} non-blocking finding(s)`, { ...context, warnings: report.warnings })
  }
}

// ─── Editorial Slots Job ─────────────────────────────────────────────────────────

/**
 * Is the slot allowed to run right now?
 *
 * A slot scheduled for an earlier day is late and runs immediately. A slot
 * scheduled for today waits for the campaign's `schedule_time`: comparing dates
 * alone (what this job used to do) made every slot fire on the first tick after
 * midnight, silently ignoring the hour the user chose.
 */
function isSlotDueNow(slot: EditorialSlot, now: Date, today: string): boolean {
  if (slot.scheduled_date < today) return true
  if (slot.scheduled_date > today) return false
  return minutesSinceLocalMidnight(now) >= scheduleTimeToMinutes(slot.campaign?.schedule_time)
}

async function runDueEditorialSlots(): Promise<void> {
  const config = JOB_CONFIGS.editorial
  const now = new Date()
  const today = todayLocalDate()

  log('INFO', 'editorial', 'Checking for due editorial slots', { date: today })

  const { slots, totalDue } = await listDueEditorialSlots(today, MAX_CATCHUP_SLOTS_PER_RUN)

  if (totalDue > slots.length) {
    log('WARN', 'editorial', `Catch-up capped: ${slots.length}/${totalDue} slots this run`, {
      deferredToNextTick: totalDue - slots.length,
      cap: MAX_CATCHUP_SLOTS_PER_RUN,
    })
  }

  const dueSlots = slots.filter(slot => isSlotDueNow(slot, now, today))
  const waitingForTime = slots.length - dueSlots.length
  if (waitingForTime > 0) {
    log('INFO', 'editorial', `${waitingForTime} slot(s) scheduled today but waiting for their schedule_time`)
  }

  log('INFO', 'editorial', `Found ${dueSlots.length} due slots`)

  // Process with concurrency limit
  const batch: typeof dueSlots = []
  for (const slot of dueSlots) {
    batch.push(slot)
    if (batch.length >= config.concurrency) {
      await processBatch(batch, config)
      batch.length = 0
    }
  }
  if (batch.length > 0) {
    await processBatch(batch, config)
  }
}

async function processBatch(slots: EditorialSlot[], config: JobConfig): Promise<void> {
  await Promise.allSettled(slots.map(slot => processEditorialSlot(slot, config)))
}

/**
 * Run one slot — one attempt, this tick.
 *
 * There is deliberately no retry loop here, and that is the whole point of this
 * job. A generation cannot be cancelled: when it overruns its timeout it keeps
 * running, keeps calling the model and can still publish. Retrying it five
 * seconds later therefore does not replace the failed attempt, it races it —
 * which is how one timed-out slot ended up as three articles. The attempt budget
 * is spent across ticks instead (`attempt_count`), which also gives a 15-minute
 * backoff for free.
 *
 * The claim and the `generations` row are both taken before any work starts, so
 * a second runner finds the slot already owned rather than re-reading a stale
 * copy of its status.
 */
async function processEditorialSlot(slot: EditorialSlot, config: JobConfig): Promise<void> {
  const campaign = slot.campaign
  if (!campaign) {
    log('WARN', 'editorial_slot', `Slot ${slot.id} has no campaign — skipped`)
    return
  }

  const attempt = (slot.attempt_count ?? 0) + 1

  const claimed = await claimEditorialSlot(slot.id, attempt)
  if (!claimed) {
    log('DEBUG', 'editorial_slot', `Slot ${slot.id} already claimed by another run — skipped`)
    return
  }

  const override = {
    pageType: slot.page_type as PageType,
    targetKeyword: slot.target_keyword,
    targetCity: slot.target_city,
  }

  let generationId: string
  try {
    generationId = await openGeneration(campaign, override)
    // Linked immediately, not at the end: the reaper needs this pointer to tell
    // an abandoned run that produced nothing from one that already published.
    await updateEditorialSlot(slot.id, { generation_id: generationId })
  } catch (error) {
    // Nothing was produced, so this is not a failed slot: hand it back rather
    // than parking it in `failed` for what is almost always a database blip.
    await releaseEditorialSlot(slot.id).catch(() => null)
    log('ERROR', 'editorial_slot', `Could not open a generation for slot ${slot.id}`, undefined,
      error instanceof Error ? error : new Error(String(error)))
    return
  }

  const startTime = Date.now()

  try {
    const planBrief = await getPlanItemBrief(campaign.id, slot.plan_item_id, campaign.current_cycle_id).catch(() => null)

    const result = await withTimeout(
      runCampaignNow(campaign, { ...override, planBrief: planBrief || undefined, generationId }),
      config.timeoutMs,
      'editorial_slot'
    )

    // Refused by the pipeline: the page exists, it is stored, and it must not
    // be retried. A retry would pay for a second generation of a page a human
    // has to look at anyway, so the slot goes to `failed` — terminal, visible in
    // the editorial calendar, carrying the reasons.
    if (result.rejected) {
      const reason = `Rejete par le pipeline : ${result.rejected.reasons.join(' | ')}`
      await failEditorialSlot(slot.id, reason, result.generationId).catch(() => null)

      log('ERROR', 'editorial_slot', `Slot ${slot.id} rejected before publication — human review required`, {
        campaignId: campaign.id,
        generationId: result.generationId,
        generationStatus: result.rejected.status,
        attempt,
        reasons: result.rejected.reasons,
      })

      await logJobExecution({
        job_type: 'editorial_slot',
        job_id: slot.id,
        campaign_id: campaign.id,
        generation_id: result.generationId,
        status: 'rejected',
        error_message: reason,
        duration_ms: Date.now() - startTime,
      })
      return
    }

    await updateEditorialSlot(slot.id, {
      status: result.publishedUrl ? 'published' : 'generated',
      generation_id: result.generationId,
    })

    log('INFO', 'editorial_slot', `Slot ${slot.id} ${result.publishedUrl ? 'published' : 'generated'}`, {
      campaignId: campaign.id,
      generationId: result.generationId,
      attempt,
      duration: Date.now() - startTime,
    })

    await logJobExecution({
      job_type: 'editorial_slot',
      job_id: slot.id,
      campaign_id: campaign.id,
      generation_id: result.generationId,
      status: result.publishedUrl ? 'published' : 'generated',
      published_url: result.publishedUrl,
      duration_ms: Date.now() - startTime,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur scheduler'
    const timedOut = error instanceof JobTimeoutError

    // A timeout says nothing about what the run did — it may still be writing
    // its page. The slot is left in `generating` for the reaper, which decides
    // once the outcome is knowable instead of guessing now.
    if (timedOut) {
      log('WARN', 'editorial_slot', `Slot ${slot.id} timed out — left to the reaper`, {
        campaignId: campaign.id,
        generationId,
        attempt,
        staleAfterMinutes: STALE_GENERATING_MINUTES,
      })
    } else if (attempt >= config.maxAttempts) {
      await failEditorialSlot(slot.id, message, generationId).catch(() => null)
      log('ERROR', 'editorial_slot', `Slot ${slot.id} failed after ${attempt} attempt(s) — giving up`, {
        campaignId: campaign.id,
        generationId,
      }, error instanceof Error ? error : new Error(message))
    } else {
      // Back to the pool: the next tick retries, 15 minutes later, which is a
      // far better backoff for a rate-limited model than five seconds.
      await releaseEditorialSlot(slot.id, message).catch(() => null)
      log('WARN', 'editorial_slot', `Slot ${slot.id} failed (attempt ${attempt}/${config.maxAttempts}) — retried next tick`, {
        campaignId: campaign.id,
        generationId,
      }, error instanceof Error ? error : new Error(message))
    }

    await logJobExecution({
      job_type: 'editorial_slot',
      job_id: slot.id,
      campaign_id: campaign.id,
      generation_id: generationId,
      status: timedOut ? 'timeout' : 'failed',
      error_message: message,
      duration_ms: Date.now() - startTime,
    })
  }
}

// ─── Publishing Job ─────────────────────────────────────────────────────────────

async function publishPendingGenerations(): Promise<void> {
  const config = JOB_CONFIGS.publish
  const pending = await listPendingPublishGenerations()

  log('INFO', 'publish', `Found ${pending.length} pending publications`)

  // The catch-up cap for this job lives in listPendingPublishGenerations (oldest
  // first, LIMIT). A full page therefore means "there may be more waiting", and
  // that has to be said out loud — from here a drained queue and a saturated one
  // look identical.
  if (pending.length >= PUBLISH_PAGE_SIZE) {
    log('WARN', 'publish', `Publication queue returned a full page (${PUBLISH_PAGE_SIZE}) — the rest is deferred to the next tick`)
  }

  const batch: typeof pending = []
  for (const gen of pending) {
    batch.push(gen)
    if (batch.length >= config.concurrency) {
      await publishBatch(batch, config)
      batch.length = 0
    }
  }
  if (batch.length > 0) {
    await publishBatch(batch, config)
  }
}

type PendingPublishGeneration = Awaited<ReturnType<typeof listPendingPublishGenerations>>[number]

/**
 * Rebuild a publishable page from the scalar columns alone.
 *
 * Only reachable for rows generated before `page_payload` existed. The JSON-LD
 * schemas, FAQ items and internal links were never persisted for those rows and
 * cannot be recovered after the fact, so they are emitted empty — the caller
 * warns so these publications are visible rather than silently degraded.
 */
function buildLegacyPageFallback(gen: PendingPublishGeneration, content: string): GeneratedPage {
  // Counted on the text, not on the markup: the previous split counted every
  // tag as a word and reported a 400-word page as a 900-word one.
  const wordCount = countHtmlWords(content)

  return {
    title: gen.title || '',
    metaDescription: gen.meta_description || '',
    slug: gen.slug || '',
    focusKeyword: gen.focus_keyword || '',
    secondaryKeywords: [],
    ogTitle: gen.title || '',
    ogDescription: gen.meta_description || '',
    twitterTitle: gen.title || '',
    twitterDescription: gen.meta_description || '',
    htmlContent: content,
    schemaLocalBusiness: '{}',
    schemaFaqPage: '{}',
    schemaBreadcrumb: '{}',
    internalLinks: [],
    internalLinksHtml: [],
    faqItems: [],
    imageAlts: gen.image_alts || [],
    ctaText: '',
    targetLength: gen.campaign?.target_length || 800,
    estimatedWordCount: wordCount,
    readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 200)),
  }
}

async function publishBatch(generations: Awaited<ReturnType<typeof listPendingPublishGenerations>>, config: JobConfig): Promise<void> {
  await Promise.allSettled(generations.map(gen => publishGeneration(gen, config)))
}

/**
 * Publish one generation, exactly once.
 *
 * The claim is a compare-and-swap, not the status test this job used to do: a
 * status read once at query time cannot protect anything, and a second push to
 * WordPress creates a second page rather than failing.
 */
async function publishGeneration(gen: PendingPublishGeneration, config: JobConfig): Promise<void> {
  if (!gen.site || !gen.content) return

  const claimed = await claimGenerationForPublishing(gen.id)
  if (!claimed) {
    log('DEBUG', 'publish', `Generation ${gen.id} already claimed by another run — skipped`)
    return
  }

  const site = gen.site
  const content = gen.content
  const startTime = Date.now()

  // Republish exactly what was generated. The scalar columns cannot carry
  // the JSON-LD schemas, the FAQ or the internal links, so rebuilding from
  // them means publishing a page stripped of all of them.
  const storedPage = gen.page_payload ?? buildLegacyPageFallback(gen, content)

  if (!gen.page_payload) {
    log('WARN', 'publish', 'No page_payload — publishing without schema/FAQ/internal links', {
      generationId: gen.id,
    })
  }

  // Last gate before an HTTP push, and the reason it exists here as well as at
  // generation time: a row can reach this job without ever having met the
  // pipeline — generated before it existed, or generated while one of its steps
  // was degraded. Cheap by construction (no model call, two indexed reads) and
  // it does not re-link: the page was already linked, injecting again would
  // append a second "see also" block to every page that waited a tick.
  const gate = await runPrePublishGate({
    page: storedPage,
    generationId: gen.id,
    pageType: (gen.page_type as PageType) ?? 'child',
    siteId: gen.site_id,
    siteUrl: site.url,
    campaign: gen.campaign,
  }).catch(error => {
    // Fail open, and loudly. The row is already claimed in `publishing`; making
    // the gate's own crash strand it there would lose a finished page, which is
    // a worse failure than publishing one that was not re-checked.
    log('ERROR', 'publish', `Pre-publish gate crashed for generation ${gen.id} — publishing unchecked`, {
      siteId: gen.site_id,
    }, error instanceof Error ? error : new Error(String(error)))
    return null
  })

  if (gate) logPipelineReport('publish', gate, { generationId: gen.id, siteId: gen.site_id })

  if (gate && !gate.publishable) {
    const outcome = await markGenerationRejected(gen.id, gate.reasons).catch(async error => {
      log('ERROR', 'publish', `Generation ${gen.id} refused but could not be marked rejected`, {
        reasons: gate.reasons,
      }, error instanceof Error ? error : new Error(String(error)))

      // The claim left the row in `publishing`, a status this job never reads
      // back. Handing it to `generated` keeps it in the queue: the next tick
      // re-runs the same gate and tries to record the rejection again, instead
      // of the row vanishing from every list in the product.
      await updateGeneration(gen.id, {
        status: 'generated',
        error_message: gate.reasons.join(' | ').slice(0, 2000),
      }).catch(() => null)

      return null
    })

    await logJobExecution({
      job_type: 'publish',
      job_id: gen.id,
      campaign_id: gen.campaign_id || undefined,
      generation_id: gen.id,
      status: outcome?.status ?? 'rejected',
      error_message: gate.reasons.join(' | ').slice(0, 2000),
      duration_ms: Date.now() - startTime,
    })
    return
  }

  const page = gate?.page ?? storedPage

  // Deliberately ONE attempt, only a timeout — no retry loop around the push.
  // A retry loop cannot tell "the push failed" from "the push worked and the
  // status write failed", and re-pushing the second case creates a duplicate
  // page that nothing will ever clean up. The tick itself is the retry.
  //
  // The gate already ran above, on this exact page: `publishPage` is told so
  // rather than paying for it twice and risking a different verdict.
  const { outcome, record } = await publishPage({
    site,
    page,
    pageType: (gen.page_type as PageType) ?? undefined,
    intent: (gen.campaign?.publish_status || 'draft') === 'publish' ? 'publie' : 'brouillon',
    generationId: gen.id,
    // Tells "the page we already wrote" from "a page belonging to the owner".
    // Without it a republication is refused as an occupied slug.
    knownRemoteId: gen.published_page_id ?? undefined,
    recovering: (gen.error_message ?? '').startsWith(RECOVERY_MARK),
    gateAlreadyRan: true,
  }).catch((error): { outcome: PublishOutcome; record?: undefined } => ({
    outcome: {
      ok: false,
      error: error instanceof Error ? error.message : 'Erreur publication',
      // Unknown, and the safe reading of unknown is "nothing was written" only
      // because the connectors report `written` themselves when they got
      // through. A throw here is a bug in our own code, not a half-push.
      written: false,
      live: false,
      discoverable: false,
      notes: [],
    },
  }))

  if (!outcome.ok) {
    const message = outcome.refusal?.message ?? outcome.error ?? 'Erreur publication'

    // THE anti-duplicate rule.
    //
    // Back to `generated` ONLY when nothing reached the destination. If the
    // content is already there, requeuing is how a second page appears — and on
    // WordPress, where a create is not idempotent, that second page is real,
    // numbered `-2`, and nothing ever cleans it up. `publishPage` has already
    // recorded the row in that case.
    //
    // A deliberate REFUSAL is not a transient failure either. An occupied slug
    // or a redirected URL will be just as occupied in fifteen minutes: requeuing
    // turns a decision into a log line every quarter of an hour, forever. It
    // needs a human to change the slug, so it goes to `failed` with the reason.
    if (outcome.refusal) {
      await updateGeneration(gen.id, { status: 'failed', error_message: message }).catch(() => null)
      log('WARN', 'publish', `Generation ${gen.id} refusee (${outcome.refusal.kind}) — intervention requise`, {
        siteId: gen.site_id,
      })
    } else if (!outcome.written) {
      await updateGeneration(gen.id, { status: 'generated', error_message: message }).catch(() => null)
    } else {
      log('ERROR', 'publish', `Generation ${gen.id} a atteint la destination mais la suite a echoue — PAS de nouvelle tentative`, {
        siteId: gen.site_id,
        pageUrl: outcome.pageUrl,
      })
    }

    log('ERROR', 'publish', `Generation ${gen.id} could not be published`, {
      siteId: gen.site_id,
      written: outcome.written,
    }, new Error(message))

    await logJobExecution({
      job_type: 'publish',
      job_id: gen.id,
      campaign_id: gen.campaign_id || undefined,
      generation_id: gen.id,
      status: 'failed',
      error_message: message,
      duration_ms: Date.now() - startTime,
    })
    return
  }

  const publishedUrl = outcome.pageUrl

  // Said out loud rather than inferred from a green log line: a page committed
  // to an unpromoted branch, or saved as a WordPress draft, is published from
  // the engine's side and invisible from a visitor's.
  if (!outcome.live) {
    log('WARN', 'publish', `Generation ${gen.id} publiee mais PAS en ligne`, {
      siteId: gen.site_id,
      mode: outcome.mode,
      notes: outcome.notes,
    })
  }
  for (const problem of record?.problems ?? []) {
    log('WARN', 'publish', `Generation ${gen.id} : ${problem}`, { siteId: gen.site_id })
  }

  await logJobExecution({
    job_type: 'publish',
    job_id: gen.id,
    campaign_id: gen.campaign_id || undefined,
    generation_id: gen.id,
    status: 'published',
    published_url: publishedUrl,
    duration_ms: Date.now() - startTime,
  })
}

// ─── Campaign Job ────────────────────────────────────────────────────────────────

async function runDueCampaigns(): Promise<void> {
  const config = JOB_CONFIGS.campaign
  const allCampaigns = await listDueCampaigns()

  log('INFO', 'campaign', `Found ${allCampaigns.length} due campaigns`)

  // Oldest due date first, so a backlog drains in the order it accumulated.
  const campaigns = [...allCampaigns]
    .sort((a, b) => (a.next_run_at || '').localeCompare(b.next_run_at || ''))
    .slice(0, MAX_CAMPAIGNS_PER_RUN)

  if (allCampaigns.length > campaigns.length) {
    log('WARN', 'campaign', `Catch-up capped: ${campaigns.length}/${allCampaigns.length} campaigns this run`, {
      deferredToNextTick: allCampaigns.length - campaigns.length,
      cap: MAX_CAMPAIGNS_PER_RUN,
    })
  }

  // Kept sequential — campaign concurrency is 1 by configuration — but each
  // campaign is isolated. A failed run used to throw its way out of this loop
  // and skip every campaign queued behind the failing one: one broken site
  // silently froze all the others.
  //
  // One attempt per tick, like the editorial slots and for the same reason: a
  // generation cannot be cancelled, so an in-tick retry races the attempt it was
  // meant to replace. A failed run leaves `next_run_at` untouched, so the
  // campaign simply stays due and is picked up again at the next tick.
  for (const campaign of campaigns) {
    try {
      await runWithConcurrencyControl(`campaign_${campaign.id}`, async () => {
        const generationId = await openGeneration(campaign)
        await withTimeout(runCampaignNow(campaign, { generationId }), config.timeoutMs, `campaign_${campaign.id}`)
      })
    } catch (error) {
      log('ERROR', 'campaign', `Campaign ${campaign.id} failed — remaining campaigns unaffected, retried next tick`, {
        campaignId: campaign.id,
      }, error instanceof Error ? error : new Error(String(error)))
    }
  }
}

// ─── Main Campaign Runner ───────────────────────────────────────────────────────

interface RunOverride {
  pageType?: PageType
  targetKeyword?: string
  targetCity?: string
  planBrief?: PlanItemBrief
  /**
   * Write into this `generations` row instead of creating one.
   *
   * The scheduler opens the row itself, before starting the run: it needs the id
   * to link the slot even when the run never returns, and it must be the one
   * deciding how many rows a slot may create. Left out, this function creates its
   * own row — the manual "run now" path.
   */
  generationId?: string
}

/** Resolved the same way by the caller that opens the row and by the run itself. */
function resolveRunTarget(campaign: Campaign, override?: RunOverride): { city: string; pageType: PageType } {
  return {
    city: override?.targetCity || campaign.communes[0] || campaign.department || 'Aube',
    pageType: override?.pageType || campaign.page_types?.[0] || 'child',
  }
}

/**
 * Open the single `generations` row a scheduled run is allowed to fill.
 *
 * Called before the run starts so the id exists whatever happens next: the slot
 * can be linked to it immediately, and a run that dies mid-flight still leaves a
 * traceable row instead of a new one on every attempt.
 */
async function openGeneration(campaign: Campaign, override?: RunOverride): Promise<string> {
  const { city, pageType } = resolveRunTarget(campaign, override)

  const generation = await createGeneration({
    campaign_id: campaign.id,
    site_id: campaign.site_id,
    city,
    page_type: pageType,
    status: 'generating',
    ai_model: campaign.ai_model,
  })

  return generation.id
}

export interface RunCampaignResult {
  generationId: string
  city: string
  publishedUrl?: string
  /**
   * Present when the post-generation pipeline refused the page.
   *
   * Deliberately a return value rather than a thrown error: throwing would put
   * the slot back in the retry budget and pay for a second generation of a page
   * that needs a human, not another attempt. The page itself is stored and the
   * generation row carries the same reasons.
   */
  rejected?: { reasons: string[]; status: 'rejected' | 'failed' }
}

export async function runCampaignNow(
  campaign: Campaign,
  override?: RunOverride
): Promise<RunCampaignResult> {
  const { city, pageType } = resolveRunTarget(campaign, override)
  const startTime = Date.now()

  // Fetch existing site context for deduplication
  let existingSlugs: string[] = []
  let existingKeywords: string[] = []
  if (campaign.site_id) {
    const context = await getSiteContext(campaign.site_id).catch(() => null)
    if (context) {
      existingSlugs = context.usedSlugs
      existingKeywords = context.usedKeywords
    }
  }

  // The scheduler opens the row itself (see openGeneration); only the manual
  // "run now" path arrives here without one.
  const generationId = override?.generationId ?? (await createGeneration({
    campaign_id: campaign.id,
    site_id: campaign.site_id,
    city,
    page_type: pageType,
    status: 'generating',
    ai_model: campaign.ai_model,
  })).id

  try {
    // Get Google context if available
    const googleContext = campaign.site_id
      ? await getGoogleContext(campaign.site_id).catch(() => null)
      : null

    // Generate the page
    const generated = await generateSeoPage({
      pageType,
      city,
      department: campaign.department || 'Aube',
      businessType: campaign.business_type,
      businessName: campaign.business_name,
      keywords: override?.targetKeyword
        ? [override.targetKeyword, ...campaign.keywords]
        : campaign.keywords,
      siteUrl: campaign.site?.url || '',
      targetLength: campaign.target_length,
      model: campaign.ai_model,
      enableExternalLinks: campaign.enable_external_links ?? true,
      externalLinkCount: campaign.external_link_count ?? 3,
      enableImages: campaign.enable_images ?? true,
      imagePerPage: campaign.image_per_page ?? 2,
      existingSlugs,
      existingKeywords,
      planBrief: override?.planBrief,
      googleContext,
      // Without these two the RAG context is never built: generateSeoPage gates
      // the whole retrieval step on `siteId` being present. Omitting them here
      // is what made the taxonomy, competitor, Google and vector-store context
      // dead weight on the scheduled path — the one path that matters.
      siteId: campaign.site_id,
      campaignId: campaign.id,
    })

    if (generated.ragStats) {
      log('INFO', 'campaign', 'RAG context used for generation', {
        generationId,
        sources: generated.ragStats.sourcesUsed,
        keywords: generated.ragStats.keywordsIncluded,
        links: generated.ragStats.linksSuggested,
        buildMs: generated.ragStats.buildTimeMs,
      })
    } else {
      log('WARN', 'campaign', 'Generated without RAG context', {
        generationId,
        siteId: campaign.site_id,
      })
    }

    // ─── Post-generation pipeline ─────────────────────────────────────────
    //
    // Everything between "the model answered" and "the page goes online":
    // the length is measured instead of believed, the internal mesh is built
    // and then proven against the pages that really exist, and a blocking gate
    // decides. `page` from here on is the vetted page, and it is the only one
    // that is stored or pushed.
    //
    // The `catch` is the last line of defence for the rule that governs this
    // whole file: an unexpected failure must never lose a page that has already
    // been generated and paid for. If the pipeline itself breaks, the raw page
    // is stored and published exactly as it was before the pipeline existed.
    const report = await runPostGenerationPipeline({
      page: generated,
      generationId,
      pageType,
      siteId: campaign.site_id,
      siteUrl: campaign.site?.url || '',
      campaign,
      planBrief: override?.planBrief,
    }).catch(error => {
      log('ERROR', 'campaign', 'Post-generation pipeline crashed — page kept as generated', {
        generationId,
        campaignId: campaign.id,
      }, error instanceof Error ? error : new Error(String(error)))
      return null
    })

    const page = report?.page ?? generated
    if (report) logPipelineReport('campaign', report, { generationId, campaignId: campaign.id })

    // What the generator itself flagged, said out loud. The gate decides what
    // blocks (see BLOCKING_ANOMALY_FIELDS); this line exists so a model that
    // starts dropping a field is visible in the logs before it is visible in the
    // rejection rate.
    if (generated.anomalies && generated.anomalies.length > 0) {
      const blocking = generated.anomalies.filter(anomaly => anomaly.severity === 'blocking')
      log(blocking.length > 0 ? 'WARN' : 'DEBUG', 'campaign', `Generateur : ${generated.anomalies.length} anomalie(s) signalee(s)`, {
        generationId,
        campaignId: campaign.id,
        anomalies: generated.anomalies.map(anomaly => `${anomaly.severity}/${anomaly.field}: ${anomaly.reason}`),
      })
    }

    // Update generation with generated content.
    // `page_payload` carries the schemas, FAQ and internal links that have no
    // scalar column of their own; the deferred publishing job reads it back
    // instead of rebuilding a stripped-down page.
    await updateGeneration(generationId, {
      slug: page.slug,
      title: page.title,
      meta_description: page.metaDescription,
      focus_keyword: page.focusKeyword,
      content: page.htmlContent,
      external_links: page.externalLinks as unknown as Generation['external_links'],
      image_alts: page.imageAlts,
      page_payload: page,
      // Always `generated` first, even when auto-publishing: it is the state the
      // publishing claim below transitions from, and the state the deferred job
      // needs to find if anything goes wrong from here on.
      status: 'generated',
    })

    // Refused: the content is already stored above, so nothing is lost — the row
    // only changes status. It is moved OUT of `generated` on purpose: that is
    // the status the deferred publishing job reads, and leaving it there would
    // publish, fifteen minutes later, exactly what was just refused.
    if (report && !report.publishable) {
      const outcome = await markGenerationRejected(generationId, report.reasons).catch(error => {
        log('ERROR', 'campaign', 'Page refused but the rejection could not be recorded', {
          generationId,
          campaignId: campaign.id,
          reasons: report.reasons,
        }, error instanceof Error ? error : new Error(String(error)))
        return null
      })

      // The schedule still advances: this run happened and was paid for, and a
      // campaign left due would generate the same page again on the next tick.
      await updateCampaignSchedule(campaign.id, {
        last_run_at: new Date().toISOString(),
        next_run_at: computeNextRunAt(campaign) || undefined,
      }).catch(() => null)

      await logJobExecution({
        job_type: 'campaign',
        job_id: campaign.id,
        generation_id: generationId,
        status: outcome?.status ?? 'rejected',
        error_message: report.reasons.join(' | ').slice(0, 2000),
        duration_ms: Date.now() - startTime,
      })

      return {
        generationId,
        city,
        rejected: { reasons: report.reasons, status: outcome?.status ?? 'rejected' },
      }
    }

    let publishedUrl: string | undefined
    let publishClaimed = false
    /** `publishPage` already closed the row and handled indexing. */
    let recorded = false

    // Auto-publish if enabled.
    //
    // Guarded by the same compare-and-swap the deferred job uses, because this
    // row can have more than one candidate publisher: a generation that overran
    // its timeout is still running while the tick moved on. Only the winner of
    // the claim pushes.
    //
    // A publishing error is deliberately NOT rethrown either: the page exists and
    // is stored, so re-running the caller would pay for a second generation and
    // risk a second article. Leaving the row in `generated` hands it to the
    // deferred publishing job, which retries the push alone.
    if (campaign.auto_publish && campaign.site) {
      publishClaimed = await claimGenerationForPublishing(generationId).catch(() => false)
    }

    if (publishClaimed && campaign.site) {
      const site = campaign.site
      try {
        // The gate ran on this page a few lines above, inside the generation
        // pipeline. `publishPage` also records the row and submits the page for
        // indexing — but only if it is actually reachable.
        const { outcome, record } = await publishPage({
          site,
          page,
          pageType,
          intent: campaign.publish_status === 'publish' ? 'publie' : 'brouillon',
          generationId,
          gateAlreadyRan: true,
        })

        if (outcome.ok) {
          publishedUrl = outcome.pageUrl
          recorded = true
          if (!outcome.live) {
            log('WARN', 'campaign', 'Page publiee mais PAS en ligne', {
              generationId,
              mode: outcome.mode,
              notes: outcome.notes,
            })
          }
          for (const problem of record?.problems ?? []) {
            log('WARN', 'campaign', problem, { generationId })
          }
        } else if (outcome.written) {
          // Reached the destination and failed afterwards. The deferred job must
          // NOT pick this up: a second push creates a second page.
          recorded = true
          log('ERROR', 'campaign', 'Page ecrite mais la suite a echoue — pas de nouvelle tentative', {
            generationId,
            pageUrl: outcome.pageUrl,
          })
        } else {
          throw new Error(outcome.refusal?.message ?? outcome.error ?? 'Erreur publication')
        }
      } catch (publishError) {
        log('ERROR', 'campaign', 'Inline publish failed — handed over to the deferred publishing job', {
          generationId,
          campaignId: campaign.id,
        }, publishError instanceof Error ? publishError : new Error(String(publishError)))
      }
    } else if (campaign.auto_publish && campaign.site) {
      log('WARN', 'campaign', 'Publishing claim not obtained — inline publish skipped', {
        generationId,
        campaignId: campaign.id,
      })
    }

    // Update generation and campaign schedule.
    //
    // Past this point the expensive, irreversible work is done. A database error
    // here must not send the caller back for another full generation, so it is
    // logged rather than thrown — at worst the row keeps its intermediate status
    // while the page itself is intact.
    //
    // The status is only rewritten when this run owns the row: the content write
    // above already left it in `generated`, and overwriting a status held by
    // whoever won the publishing claim would release their claim mid-push.
    const nextRunAt = computeNextRunAt(campaign)

    try {
      // Only when nothing wrote the row already. `publishPage` owns the status,
      // the publication date and the indexing whenever it ran; rewriting them
      // here would re-date the page and, worse, hand a written page back to the
      // deferred job as `generated`.
      if (publishClaimed && !recorded) {
        await updateGeneration(generationId, {
          status: 'generated',
          error_message: 'Publication non aboutie — reprise par le job de publication differee',
        })
      }

      await updateCampaignSchedule(campaign.id, {
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAt || undefined,
      })
    } catch (bookkeepingError) {
      log('ERROR', 'campaign', 'Page produced but its status could not be recorded', {
        generationId,
        campaignId: campaign.id,
        publishedUrl,
      }, bookkeepingError instanceof Error ? bookkeepingError : new Error(String(bookkeepingError)))
    }

    await logJobExecution({
      job_type: 'campaign',
      job_id: campaign.id,
      generation_id: generationId,
      status: publishedUrl ? 'published' : 'generated',
      published_url: publishedUrl,
      duration_ms: Date.now() - startTime,
    })

    return { generationId, city, publishedUrl }
  } catch (error) {
    // Swallowed on purpose: if the status write fails too, the caller still has
    // to see the original error rather than a database error masking it.
    await updateGeneration(generationId, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Erreur scheduler',
    }).catch(() => null)

    await logJobExecution({
      job_type: 'campaign',
      job_id: campaign.id,
      generation_id: generationId,
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
    })

    throw error
  }
}

// ─── Job Execution Logging ─────────────────────────────────────────────────────

interface JobExecutionLog {
  job_type: string
  job_id: string
  campaign_id?: string
  generation_id?: string
  status: string
  published_url?: string
  error_message?: string
  /** Elapsed milliseconds. Not a timestamp — it used to be `Date.now()`. */
  duration_ms: number
}

async function logJobExecution(entry: JobExecutionLog): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('job_executions').insert({
    job_type: entry.job_type,
    job_id: entry.job_id,
    campaign_id: entry.campaign_id,
    generation_id: entry.generation_id,
    status: entry.status,
    published_url: entry.published_url,
    error_message: entry.error_message,
    duration_ms: entry.duration_ms,
    executed_at: new Date().toISOString(),
  })

  // Never fatal — but never silent either: supabase-js returns the error instead
  // of throwing, so a missing table or a schema drift would erase the whole audit
  // trail without a single line anywhere.
  if (error) {
    log('WARN', 'job_executions', 'Could not record job execution', {
      jobType: entry.job_type,
      jobId: entry.job_id,
      reason: error.message,
    })
  }
}

// ─── Log Management ────────────────────────────────────────────────────────────

function cleanupOldLogs(): void {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7) // Keep 7 days of logs

  const supabase = createServiceClient()
  supabase.from('job_executions')
    .delete()
    .lt('executed_at', cutoff.toISOString())
    .then(() => {
      log('INFO', 'cleanup', `Cleaned up job executions older than ${cutoff.toISOString()}`)
    })

  // Clear in-memory logs older than 1 hour
  const oneHourAgo = Date.now() - 3600000
  while (jobLogs.length > 0 && new Date(jobLogs[0].timestamp).getTime() < oneHourAgo) {
    jobLogs.shift()
  }
}

export function getJobLogs(limit = 100): LogEntry[] {
  return jobLogs.slice(-limit)
}

export function getRunningJobs(): Array<{ jobId: string; startTime: number; pid: string }> {
  return Array.from(runningJobs.entries()).map(([jobId, data]) => ({ jobId, ...data }))
}

// ─── Manual Trigger ────────────────────────────────────────────────────────────

export async function triggerJob(jobName: string, options?: Record<string, unknown>): Promise<void> {
  log('INFO', 'manual', `Triggering job: ${jobName}`, options)

  switch (jobName) {
    case 'editorial':
      await runDueEditorialSlots()
      break
    case 'publish':
      await publishPendingGenerations()
      break
    case 'campaigns':
      await runDueCampaigns()
      break
    case 'gsc':
      await syncAllGsc()
      break
    case 'gbp':
      await syncAllGbp()
      break
    case 'cycle':
      await checkCycleCompletion()
      break
    case 'reaper':
      await reapStaleSlots()
      break
    default:
      throw new Error(`Unknown job: ${jobName}`)
  }
}
