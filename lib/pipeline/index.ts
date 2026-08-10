// ─────────────────────────────────────────────────────────────────────────────
// Post-generation Pipeline
// SEO Engine - What happens between a generated page and a published one
// ─────────────────────────────────────────────────────────────────────────────
//
// Before this module the scheduler went generation → row → publication with no
// step in between, so a page with no H1, a broken JSON-LD block, half the
// ordered length or five links to pages that do not exist went online with
// nothing to stop it.
//
// The pipeline runs, in this order:
//
//   1. MEASURE the length. `estimatedWordCount` is what the model claims;
//      nothing had ever compared it to the HTML. The measured value replaces it
//      in the payload, and a page under 85 % of its target does not ship.
//   2. LINK, then PROVE the links. Smart linking is applied, then every internal
//      href is resolved against the pages that really exist — `site_pages` and
//      already published `generations`. Anything that does not resolve is taken
//      out of the HTML rather than published as a 404.
//   3. GATE. The structural checks plus the existing validation pipeline
//      (src/adapters/rag/validation, called through its published API and never
//      modified from here). A blocking finding parks the generation in
//      `rejected` with its reasons; it never disappears and it never ships.
//
// Two invariants hold everywhere below:
//
//   - This module NEVER throws. The page it is handed has already been paid for
//     in tokens and minutes; an unexpected failure inside a check degrades that
//     check and is reported, it does not lose the article.
//   - It contains no retry of any kind. The scheduler spends its attempts across
//     ticks (see lib/scheduler/cron.ts); a retry here would sit inside one tick
//     and race the attempt it was meant to replace.

import type { GeneratedPage } from '@/lib/ai/openai'
import type { GeneratedSeoPage } from '@/lib/ai/page-types'
import type { Campaign, PageType, PlanItemBrief } from '@/lib/types'
import type { InternalLinkTarget } from '@/lib/seo/internal-linking'
import { applySmartLinking, buildLinkGraph } from '@/lib/seo/smart-linking'
import {
  buildQualityConfig,
  buildSeoConfig,
  formatBlockingReasons,
  runValidationGate,
  type GateFinding,
} from './gate'
import { buildKnownPathSet, pruneUnresolvedInternalLinks } from './internal-links'
import { loadSiteLinkContext } from './repository'
import {
  measureLength,
  resolveTargetWordCount,
  type LengthMeasurement,
} from './word-count'

export interface PipelineContext<P extends GeneratedPage = GeneratedPage> {
  page: P
  generationId: string
  pageType: PageType
  siteId?: string
  siteUrl: string
  campaign?: Pick<Campaign, 'target_length' | 'enable_images' | 'enable_external_links'> | null
  planBrief?: PlanItemBrief | null
}

export interface PipelineLinkReport {
  /** False when the existing pages could not be read: nothing was pruned. */
  validated: boolean
  injectedInline: number
  navigation: number
  kept: number
  removed: number
  removedHrefs: string[]
}

export interface PipelineReport<P extends GeneratedPage = GeneratedPage> {
  /** The page as it should be stored and published — measured, linked, pruned. */
  page: P
  publishable: boolean
  /** Blocking reasons, ready for `generations.error_message`. */
  reasons: string[]
  warnings: string[]
  measurement: LengthMeasurement
  links: PipelineLinkReport
  gate: { score?: number; grade?: string }
  /** Steps that could not run, and why. Never empty silently. */
  degraded: string[]
  durationMs: number
}

interface PipelineOptions {
  /**
   * Apply smart linking, or only verify what is already there.
   *
   * The deferred publishing job re-runs the pipeline on a page that was already
   * linked at generation time; injecting again would append a second "see also"
   * block to every page that waited a tick before going online.
   */
  injectLinks: boolean
}

// ─── Entry Points ───────────────────────────────────────────────────────────

/** Full pipeline: measure, link, validate. Runs once, right after generation. */
export function runPostGenerationPipeline<P extends GeneratedPage>(
  context: PipelineContext<P>
): Promise<PipelineReport<P>> {
  return runPipeline(context, { injectLinks: true })
}

/**
 * The same verdict without re-linking, for the deferred publishing job.
 *
 * A page can reach a publisher without ever having met the pipeline — it was
 * generated before this module existed, or the pipeline degraded on its first
 * pass. This is the last gate before an HTTP push, and it is cheap: no model
 * call, two indexed reads.
 */
export function runPrePublishGate<P extends GeneratedPage>(
  context: PipelineContext<P>
): Promise<PipelineReport<P>> {
  return runPipeline(context, { injectLinks: false })
}

// ─── Implementation ─────────────────────────────────────────────────────────

async function runPipeline<P extends GeneratedPage>(
  context: PipelineContext<P>,
  options: PipelineOptions
): Promise<PipelineReport<P>> {
  const startedAt = Date.now()
  const degraded: string[] = []

  // ─── 1. Length, measured on what the model wrote ──────────────────────
  //
  // Measured before any linking: the "see also" block is our boilerplate, not
  // the article, and counting it would let a short page pass on the strength of
  // its own navigation.
  const measurement = measureLength({
    html: context.page.htmlContent,
    declared: context.page.estimatedWordCount,
    target: resolveTargetWordCount({
      briefWordCount: context.planBrief?.estimated_word_count,
      pageTargetLength: context.page.targetLength,
      campaignTargetLength: context.campaign?.target_length,
    }),
  })

  // ─── 2. Internal mesh, then proof that it resolves ────────────────────
  let html = context.page.htmlContent || ''
  const links: PipelineLinkReport = {
    validated: false,
    injectedInline: 0,
    navigation: 0,
    kept: 0,
    removed: 0,
    removedHrefs: [],
  }
  let internalLinksHtml = context.page.internalLinksHtml ?? []

  try {
    const siteContext = context.siteId ? await loadSiteLinkContext(context.siteId) : null

    if (options.injectLinks && siteContext) {
      const smart = applySmartLinking({
        htmlContent: html,
        currentPage: {
          id: context.generationId,
          slug: context.page.slug,
          pageType: context.pageType,
        },
        linkGraph: buildLinkGraph(siteContext.publishedGenerations),
        siteUrl: context.siteUrl,
        externalLinks: context.campaign?.enable_external_links === false
          ? []
          : (context.page as Partial<GeneratedSeoPage>).externalLinks ?? [],
        extraTargets: rankCandidates(siteContext.candidates, html),
      })

      html = smart.htmlContent
      links.injectedInline = smart.injectedInternalLinks.length
      links.navigation = smart.navigationLinks.length
    }

    if (siteContext) {
      // The page being published counts as existing: it is about to.
      const knownPaths = buildKnownPathSet([...siteContext.knownPaths, context.page.slug])
      const audit = pruneUnresolvedInternalLinks({ html, knownPaths, siteUrl: context.siteUrl })

      html = audit.html
      links.validated = true
      links.kept = audit.kept.length
      links.removed = audit.removed.length
      links.removedHrefs = audit.removed
      internalLinksHtml = audit.keptHtml
    } else if (context.siteId) {
      degraded.push('maillage interne non verifie : contexte du site indisponible')
    } else {
      degraded.push('maillage interne non verifie : generation sans site_id')
    }
  } catch (error) {
    // Read failure, not a content defect. Publishing the page with its links
    // untouched is what happened before this module existed; stripping every
    // link because a query timed out would be a regression of its own.
    degraded.push(`maillage interne non verifie : ${error instanceof Error ? error.message : String(error)}`)
  }

  // ─── 3. Blocking gate ─────────────────────────────────────────────────
  const verdict = await runValidationGate({
    pageType: context.pageType,
    title: context.page.title,
    metaDescription: context.page.metaDescription,
    focusKeyword: context.page.focusKeyword,
    html,
    url: context.page.slug ? `/${context.page.slug.replace(/^\//, '')}` : undefined,
    schemaLocalBusiness: context.page.schemaLocalBusiness,
    schemaFaqPage: context.page.schemaFaqPage,
    schemaBreadcrumb: context.page.schemaBreadcrumb,
    measurement,
    deadInternalLinks: links.removed,
    // The generator's own findings. Nothing read these before: they were
    // computed, stored in `page_payload` and forgotten.
    anomalies: (context.page as Partial<GeneratedSeoPage>).anomalies,
    quality: buildQualityConfig({
      targetWordCount: measurement.target,
      expectsImages: context.campaign?.enable_images ?? false,
    }),
    seo: buildSeoConfig(),
  })

  if (verdict.degraded) {
    degraded.push(`validateurs indisponibles : ${verdict.degraded}`)
  }

  // ─── 4. The page as it must be stored ─────────────────────────────────
  //
  // The measured count replaces the declared one here and nowhere else: this
  // object is what goes into `generations.page_payload`, so the figure the rest
  // of the system reads back is the one that was counted.
  //
  // Cast: spreading a generic and overriding four of its members is exactly the
  // shape TypeScript cannot prove stays a `P`. Every field of the original page
  // is preserved at runtime.
  const page = {
    ...context.page,
    htmlContent: html,
    estimatedWordCount: measurement.measured,
    readingTimeMinutes: Math.max(1, Math.ceil(measurement.measured / 200)),
    internalLinksHtml,
  } as P

  return {
    page,
    publishable: verdict.publishable,
    reasons: formatBlockingReasons(verdict.blocking),
    warnings: describeFindings(verdict.warnings),
    measurement,
    links,
    gate: { score: verdict.score, grade: verdict.grade },
    degraded,
    durationMs: Date.now() - startedAt,
  }
}

function describeFindings(findings: GateFinding[]): string[] {
  return findings.map(finding => `${finding.code}: ${finding.message}`)
}

/**
 * Pages whose title already appears in the copy come first.
 *
 * The linker only weaves a link where its phrase is already written, and it is
 * given a handful of slots. Ordering by publication date alone spends those
 * slots on pages the article never mentions, and the whole mesh degrades into a
 * "see also" list. The sort is stable, so recency still breaks ties.
 */
function rankCandidates(candidates: InternalLinkTarget[], html: string): InternalLinkTarget[] {
  const haystack = html.toLowerCase()
  const mentioned = (target: InternalLinkTarget) => (haystack.includes(target.anchor.toLowerCase()) ? 0 : 1)

  return [...candidates].sort((a, b) => mentioned(a) - mentioned(b))
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export { markGenerationRejected, loadSiteLinkContext } from './repository'
export { indexPublishedPage } from './indexing'
export {
  countHtmlWords,
  countWords,
  measureLength,
  resolveTargetWordCount,
  stripHtml,
  MIN_LENGTH_RATIO,
  type LengthMeasurement,
} from './word-count'
export {
  buildKnownPathSet,
  classifyHref,
  extractInternalHrefs,
  normalizePath,
  pruneUnresolvedInternalLinks,
  type LinkAudit,
} from './internal-links'
export { runValidationGate, type GateVerdict, type GateFinding } from './gate'
