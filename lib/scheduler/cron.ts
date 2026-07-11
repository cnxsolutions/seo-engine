// ─────────────────────────────────────────────────────────────────────────────
// Enhanced CRON Scheduler
// SEO Engine - Production-grade job scheduler with retries, logs, idempotence
// ─────────────────────────────────────────────────────────────────────────────

import cron from 'node-cron'
import { createServiceClient } from '@/lib/supabase'
import { generateSeoPage } from '@/lib/ai/page-types'
import { createGeneration, getPlanItemBrief, getSiteContext, listDueCampaigns, listPendingPublishGenerations, updateCampaignSchedule, updateGeneration } from '@/lib/db'
import { getGoogleContext } from '@/lib/google/context'
import { syncAllGbp, syncAllGsc } from '@/lib/google/sync'
import { publishToNextJs } from '@/lib/publishers/nextjs'
import { publishToWordPress } from '@/lib/publishers/wordpress'
import { submitForIndexing } from '@/lib/seo/indexing'
import { checkCycleCompletion } from './cycle-manager'
import { computeNextRunAt, listEditorialSlots, updateEditorialSlot } from './editorial'
import type { Campaign, PageType, PlanItemBrief, Generation } from '@/lib/types'

// ─── Scheduler State ───────────────────────────────────────────────────────────────

let schedulerStarted = false
const runningJobs = new Map<string, { startTime: number; pid: string }>()

// ─── Job Configuration ───────────────────────────────────────────────────────────

interface JobConfig {
  maxRetries: number
  retryDelayMs: number
  timeoutMs: number
  concurrency: number
}

const JOB_CONFIGS: Record<string, JobConfig> = {
  editorial: { maxRetries: 3, retryDelayMs: 5000, timeoutMs: 120000, concurrency: 2 },
  publish: { maxRetries: 2, retryDelayMs: 3000, timeoutMs: 60000, concurrency: 3 },
  campaign: { maxRetries: 3, retryDelayMs: 5000, timeoutMs: 180000, concurrency: 1 },
  gscSync: { maxRetries: 2, retryDelayMs: 10000, timeoutMs: 300000, concurrency: 1 },
  gbpSync: { maxRetries: 2, retryDelayMs: 10000, timeoutMs: 300000, concurrency: 1 },
}

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

  log('INFO', 'scheduler', 'Initializing SEO Engine job scheduler')

  // Main editorial and publishing job - every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await runWithConcurrencyControl('main', async () => {
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

// ─── Retry Logic ────────────────────────────────────────────────────────────────

async function withRetry<T>(
  jobName: string,
  fn: () => Promise<T>,
  config: JobConfig
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const startTime = Date.now()
      const result = await withTimeout(fn(), config.timeoutMs, jobName)
      log('DEBUG', jobName, `Attempt ${attempt}/${config.maxRetries} succeeded`, { duration: Date.now() - startTime })
      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      log('WARN', jobName, `Attempt ${attempt}/${config.maxRetries} failed`, { attempt, maxRetries: config.maxRetries }, lastError)

      if (attempt < config.maxRetries) {
        await sleep(config.retryDelayMs * attempt) // Exponential backoff
      }
    }
  }

  log('ERROR', jobName, `All ${config.maxRetries} attempts failed`, undefined, lastError)
  throw lastError
}

function withTimeout<T>(promise: Promise<T>, ms: number, jobName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Job ${jobName} timed out after ${ms}ms`)), ms)
    ),
  ])
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Editorial Slots Job ─────────────────────────────────────────────────────────

async function runDueEditorialSlots(): Promise<void> {
  const config = JOB_CONFIGS.editorial
  const today = new Date().toISOString().split('T')[0]

  log('INFO', 'editorial', 'Checking for due editorial slots', { date: today })

  const slots = await listEditorialSlots(undefined, undefined, today)
  const dueSlots = slots.filter(s => s.status === 'planned' && s.scheduled_date <= today)

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

async function processBatch(slots: Awaited<ReturnType<typeof listEditorialSlots>>, config: JobConfig): Promise<void> {
  await Promise.allSettled(
    slots.map(slot =>
      withRetry('editorial_slot', async () => {
        if (!slot.campaign) return

        // Idempotency check - skip if already processing
        if (slot.status !== 'planned') {
          log('DEBUG', 'editorial_slot', `Skipping slot ${slot.id} with status ${slot.status}`)
          return
        }

        await updateEditorialSlot(slot.id, { status: 'generating' })

        const planBrief = await getPlanItemBrief(slot.campaign.id, slot.plan_item_id, slot.campaign.current_cycle_id).catch(() => null)

        const result = await runCampaignNow(slot.campaign, {
          pageType: slot.page_type as PageType,
          targetKeyword: slot.target_keyword,
          targetCity: slot.target_city,
          planBrief: planBrief || undefined,
        })

        await updateEditorialSlot(slot.id, {
          status: result.publishedUrl ? 'published' : 'generated',
          generation_id: result.generationId,
        })

        // Log success
        await logJobExecution({
          job_type: 'editorial_slot',
          job_id: slot.id,
          campaign_id: slot.campaign.id,
          generation_id: result.generationId,
          status: result.publishedUrl ? 'published' : 'generated',
          published_url: result.publishedUrl,
          duration_ms: Date.now(),
        })
      }, config)
    )
  )
}

// ─── Publishing Job ─────────────────────────────────────────────────────────────

async function publishPendingGenerations(): Promise<void> {
  const config = JOB_CONFIGS.publish
  const pending = await listPendingPublishGenerations()

  log('INFO', 'publish', `Found ${pending.length} pending publications`)

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

async function publishBatch(generations: Awaited<ReturnType<typeof listPendingPublishGenerations>>, config: JobConfig): Promise<void> {
  await Promise.allSettled(
    generations.map(gen =>
      withRetry('publish', async () => {
        if (!gen.site || !gen.content) return

        // Idempotency check
        if (gen.status !== 'generated') {
          log('DEBUG', 'publish', `Skipping generation ${gen.id} with status ${gen.status}`)
          return
        }

        await updateGeneration(gen.id, { status: 'publishing' })

        const page = {
          title: gen.title || '',
          metaDescription: gen.meta_description || '',
          slug: gen.slug || '',
          focusKeyword: gen.focus_keyword || '',
          secondaryKeywords: [],
          ogTitle: gen.title || '',
          ogDescription: gen.meta_description || '',
          twitterTitle: gen.title || '',
          twitterDescription: gen.meta_description || '',
          htmlContent: gen.content,
          schemaLocalBusiness: '{}',
          schemaFaqPage: '{}',
          schemaBreadcrumb: '{}',
          internalLinks: [],
          internalLinksHtml: [],
          faqItems: [],
          imageAlts: gen.image_alts || [],
          ctaText: '',
          targetLength: gen.campaign?.target_length || 800,
          estimatedWordCount: gen.content.split(/\s+/).length,
          readingTimeMinutes: Math.ceil(gen.content.split(/\s+/).length / 200),
        }

        let publishedUrl: string | undefined

        if (gen.site.type === 'nextjs') {
          const result = await publishToNextJs({
            githubRepo: gen.site.github_repo || '',
            githubToken: gen.site.github_token || '',
            page,
            siteUrl: gen.site.url,
            repoProfile: gen.site.repo_profile as Parameters<typeof publishToNextJs>[0]['repoProfile'],
          })
          if (!result.success) throw new Error(result.error)
          publishedUrl = result.pageUrl
        } else {
          const result = await publishToWordPress({
            siteUrl: gen.site.url,
            appUsername: gen.site.wp_username || '',
            appPassword: gen.site.wp_app_password || '',
            page,
            publishStatus: gen.campaign?.publish_status || 'draft',
            pageTemplate: gen.site.wp_page_template || undefined,
          })
          if (!result.success) throw new Error(result.error)
          publishedUrl = result.pageUrl
        }

        await updateGeneration(gen.id, {
          status: 'published',
          published_url: publishedUrl,
        })

        if (publishedUrl) {
          await submitForIndexing({ pageUrl: publishedUrl, siteUrl: gen.site.url }).catch(() => null)
        }

        await logJobExecution({
          job_type: 'publish',
          job_id: gen.id,
          campaign_id: gen.campaign_id || undefined,
          status: 'published',
          published_url: publishedUrl,
          duration_ms: Date.now(),
        })
      }, config)
    )
  )
}

// ─── Campaign Job ────────────────────────────────────────────────────────────────

async function runDueCampaigns(): Promise<void> {
  const config = JOB_CONFIGS.campaign
  const campaigns = await listDueCampaigns()

  log('INFO', 'campaign', `Found ${campaigns.length} due campaigns`)

  for (const campaign of campaigns) {
    await runWithConcurrencyControl(`campaign_${campaign.id}`, async () => {
      await withRetry(`campaign_${campaign.id}`, async () => {
        await runCampaignNow(campaign)
      }, config)
    })
  }
}

// ─── Main Campaign Runner ───────────────────────────────────────────────────────

export async function runCampaignNow(
  campaign: Campaign,
  override?: {
    pageType?: PageType
    targetKeyword?: string
    targetCity?: string
    planBrief?: PlanItemBrief
  }
): Promise<{ generationId: string; city: string; publishedUrl?: string }> {
  const city = override?.targetCity || campaign.communes[0] || campaign.department || 'Aube'
  const pageType = override?.pageType || campaign.page_types?.[0] || 'child'

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

  // Create generation record
  const generation = await createGeneration({
    campaign_id: campaign.id,
    site_id: campaign.site_id,
    city,
    page_type: pageType,
    status: 'generating',
    ai_model: campaign.ai_model,
  })

  try {
    // Get Google context if available
    const googleContext = campaign.site_id
      ? await getGoogleContext(campaign.site_id).catch(() => null)
      : null

    // Generate the page
    const page = await generateSeoPage({
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
    })

    // Update generation with generated content
    await updateGeneration(generation.id, {
      slug: page.slug,
      title: page.title,
      meta_description: page.metaDescription,
      focus_keyword: page.focusKeyword,
      content: page.htmlContent,
      external_links: page.externalLinks as unknown as Generation['external_links'],
      image_alts: page.imageAlts,
      status: campaign.auto_publish ? 'publishing' : 'generated',
    })

    let publishedUrl: string | undefined

    // Auto-publish if enabled
    if (campaign.auto_publish && campaign.site) {
      if (campaign.site.type === 'nextjs') {
        const result = await publishToNextJs({
          githubRepo: campaign.site.github_repo || '',
          githubToken: campaign.site.github_token || '',
          page,
          siteUrl: campaign.site.url,
          repoProfile: campaign.site.repo_profile as Parameters<typeof publishToNextJs>[0]['repoProfile'],
        })
        if (!result.success) throw new Error(result.error)
        publishedUrl = result.fileUrl
      } else {
        const result = await publishToWordPress({
          siteUrl: campaign.site.url,
          appUsername: campaign.site.wp_username || '',
          appPassword: campaign.site.wp_app_password || '',
          page,
          publishStatus: campaign.publish_status,
          pageTemplate: campaign.site.wp_page_template || undefined,
        })
        if (!result.success) throw new Error(result.error)
        publishedUrl = result.pageUrl
      }
    }

    // Submit for indexing
    if (publishedUrl && campaign.site) {
      await submitForIndexing({
        pageUrl: publishedUrl,
        siteUrl: campaign.site.url,
      }).catch(() => null)
    }

    // Update generation and campaign schedule
    const nextRunAt = computeNextRunAt(campaign)

    await updateGeneration(generation.id, {
      status: publishedUrl ? 'published' : 'generated',
      published_url: publishedUrl,
    })

    await updateCampaignSchedule(campaign.id, {
      last_run_at: new Date().toISOString(),
      next_run_at: nextRunAt || undefined,
    })

    await logJobExecution({
      job_type: 'campaign',
      job_id: campaign.id,
      generation_id: generation.id,
      status: publishedUrl ? 'published' : 'generated',
      published_url: publishedUrl,
      duration_ms: Date.now(),
    })

    return { generationId: generation.id, city, publishedUrl }
  } catch (error) {
    await updateGeneration(generation.id, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Erreur scheduler',
    })

    await logJobExecution({
      job_type: 'campaign',
      job_id: campaign.id,
      generation_id: generation.id,
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now(),
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
  duration_ms: number
}

async function logJobExecution(log: JobExecutionLog): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('job_executions').insert({
    job_type: log.job_type,
    job_id: log.job_id,
    campaign_id: log.campaign_id,
    generation_id: log.generation_id,
    status: log.status,
    published_url: log.published_url,
    error_message: log.error_message,
    duration_ms: log.duration_ms,
    executed_at: new Date().toISOString(),
  }) // Non-blocking - fire and forget
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
    default:
      throw new Error(`Unknown job: ${jobName}`)
  }
}
