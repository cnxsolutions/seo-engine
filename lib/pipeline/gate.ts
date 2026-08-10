// ─────────────────────────────────────────────────────────────────────────────
// Validation Gate
// SEO Engine - Post-generation pipeline
// The single place that answers "does this page ship?"
// ─────────────────────────────────────────────────────────────────────────────
//
// Two sources feed the verdict:
//
//  1. The structural checks in structure.ts and word-count.ts — length, H1,
//     JSON-LD — which are the defects the audit actually found in production.
//  2. `ValidationPipelineOrchestrator` (src/adapters/rag/validation), called
//     through its published API and never modified from here.
//
// The orchestrator's own `canPublish` is deliberately NOT used as the verdict.
// It fails a page as soon as any validator reports a single error, including
// "no images" and "readability is difficult" — advice, not release blockers.
// Wiring it straight to the publisher would reject nearly every page and the
// engine would stop producing anything, which is a worse outcome than the one
// this gate exists to fix. So the orchestrator's findings are read, and only the
// codes listed below stop a publication. Everything else is recorded as a
// warning, visible in the logs, and ships.

import type { PageAnomaly } from '@/lib/ai/openai'
import type { ContentQualityConfig } from '@/src/adapters/rag/validation/ContentQualityValidator'
import type { SeoValidationConfig } from '@/src/adapters/rag/validation/SeoValidator'
import { ValidationPipelineOrchestrator } from '@/src/adapters/rag/validation'
import { checkAllJsonLd, censusHeadings } from './structure'
import { MAX_LENGTH_RATIO, MIN_LENGTH_RATIO, type LengthMeasurement } from './word-count'

// ─── Blocking Policy ────────────────────────────────────────────────────────

/**
 * Quality defects that make the page not worth publishing at all.
 *
 * `WORD_COUNT_TOO_LOW` overlaps with the pipeline's own length measurement on
 * purpose: the validator counts against its configured minimum, the pipeline
 * against the brief. Whichever fires, the page is short.
 */
export const BLOCKING_QUALITY_CODES = [
  'WORD_COUNT_TOO_LOW',
  'PARAGRAPH_COUNT_TOO_LOW',
  'HEADING_COUNT_TOO_LOW',
  'MISSING_H2',
] as const

/**
 * SEO defects that make the page pointless.
 *
 * `TITLE_TOO_LONG` is knowingly absent: a truncated SERP title is a cosmetic
 * loss, not a reason to withhold a whole page from the index.
 */
export const BLOCKING_SEO_CODES = [
  'TITLE_MISSING',
  'KEYWORD_NOT_FOUND',
] as const

/**
 * JSON-LD defects worth refusing a page over.
 *
 * The dividing line is whether REGENERATING would fix it.
 *
 * A malformed node, a breadcrumb numbered 1-3-7, a property of the wrong type:
 * the model had everything it needed and got it wrong. Blocking sends the slot
 * back for another attempt, which is likely to succeed. Rating and review
 * defects block for a different reason — an aggregateRating with no Review node,
 * or a self-serving review, violates Google's structured-data policy, and the
 * risk there is a manual action rather than a missing snippet.
 *
 * A LocalBusiness with no `address` is the opposite case: the data was never
 * supplied, and the generator prompt explicitly forbids inventing a NAP. No
 * amount of regeneration produces an address we do not have, so blocking would
 * refuse every correct page of every campaign without a postal address, forever.
 * That costs a rich result and nothing else — warn, and publish.
 */
export const BLOCKING_JSON_LD_CODES = [
  // Unusable markup
  'MALFORMED_JSON',
  'NOT_AN_OBJECT',
  'MISSING_CONTEXT',
  'INVALID_CONTEXT',
  'MISSING_TYPE',
  // Generation defects a retry can fix
  'INVALID_PROPERTY_TYPE',
  'INVALID_URL',
  'BREADCRUMB_POSITION_INVALID',
  // Google structured-data policy violations
  'RATING_INCOMPLETE',
  'RATING_OUT_OF_RANGE',
  'SELF_SERVING_REVIEW',
] as const

/**
 * Generator anomalies (`GeneratedPage.anomalies`) that stop a publication.
 *
 * The generator reports its own defects with a `blocking` / `warning` severity,
 * but it deliberately does not act on them — it has already been paid for the
 * page by the time it notices. Something has to read them, and this is the only
 * place that decides whether a page ships. Until this list existed nothing
 * called `hasBlockingAnomaly`, so every anomaly the generator raised was
 * computed, attached to the payload, and never looked at again.
 *
 * The generator marks three fields `blocking`: `title`, `metaDescription` and
 * `directAnswer`. Only the first two are honoured here.
 *
 * `directAnswer` is deliberately downgraded to a warning. It is a brand-new
 * prompt requirement with no production track record, and blocking on it would
 * mean that any model drift on one optional JSON field silently stops the whole
 * engine — the exact failure this gate is built to avoid. A page without its
 * extract block loses a featured-snippet opportunity; it is not unpublishable.
 * Promote it here once the observed rate says it is safe.
 */
export const BLOCKING_ANOMALY_FIELDS = [
  'title',
  'metaDescription',
] as const

// ─── Findings ───────────────────────────────────────────────────────────────

export type FindingSource = 'length' | 'structure' | 'links' | 'quality' | 'seo' | 'duplicate' | 'generator'

export interface GateFinding {
  code: string
  source: FindingSource
  message: string
}

export interface GateVerdict {
  publishable: boolean
  blocking: GateFinding[]
  warnings: GateFinding[]
  /** Orchestrator score out of 100, or undefined when it could not run. */
  score?: number
  grade?: string
  /** Set when the external validators failed and only the structural checks ran. */
  degraded?: string
  durationMs: number
}

export interface GateInput {
  pageType: string
  title: string
  metaDescription: string
  focusKeyword: string
  html: string
  url?: string
  schemaLocalBusiness?: string
  schemaFaqPage?: string
  schemaBreadcrumb?: string
  measurement: LengthMeasurement
  /** Internal links removed because they resolved to nothing. */
  deadInternalLinks?: number
  /** Defects the generator itself reported on this page. */
  anomalies?: PageAnomaly[]
  quality?: ContentQualityConfig
  seo?: SeoValidationConfig
}

// ─── Validator Configuration ────────────────────────────────────────────────

/**
 * Validator thresholds derived from the campaign, not from the library defaults.
 *
 * The defaults assume a 300-word blog post; these pages are ordered at a length
 * the campaign chose, and a pillar page is 2.5x a child page. Feeding the
 * measured target in is what makes `WORD_COUNT_TOO_LOW` mean anything.
 */
export function buildQualityConfig(opts: {
  targetWordCount: number
  expectsImages?: boolean
}): ContentQualityConfig {
  const target = opts.targetWordCount > 0 ? opts.targetWordCount : 300

  return {
    minWordCount: Math.round(target * MIN_LENGTH_RATIO),
    // Three times the order is not "too long" for a pillar page; the ceiling is
    // only here to catch a runaway loop repeating the same section.
    maxWordCount: Math.max(5000, target * 3),
    minParagraphCount: 3,
    minHeadingCount: 2,
    requiredHeadings: ['h2'],
    minImageCount: opts.expectsImages ? 1 : 0,
    imageAltRequired: true,
    // Internal and external links are audited against the real site by
    // internal-links.ts; counting them here would double-report.
    minInternalLinks: 0,
    minExternalLinks: 0,
    checkReadability: true,
  }
}

export function buildSeoConfig(): SeoValidationConfig {
  return {
    metaTitleMinLength: 30,
    metaTitleMaxLength: 70,
    metaDescMinLength: 110,
    metaDescMaxLength: 170,
    keywordDensityMin: 0.3,
    keywordDensityMax: 4,
    checkSchema: true,
    checkOpenGraph: false, // Open Graph lives in the payload, not in the HTML.
    urlMaxLength: 120,     // Long-tail slugs are a deliberate strategy here.
  }
}

// ─── Gate ───────────────────────────────────────────────────────────────────

/**
 * Run every check and return a verdict. Never throws, never touches the network:
 * duplicate detection is left off, so the orchestrator runs entirely in memory.
 */
export async function runValidationGate(input: GateInput): Promise<GateVerdict> {
  const startedAt = Date.now()
  const blocking: GateFinding[] = []
  const warnings: GateFinding[] = []

  // ─── 1. Length ────────────────────────────────────────────────────────
  if (!input.measurement.meetsTarget) {
    blocking.push({
      code: 'LENGTH_BELOW_TARGET',
      source: 'length',
      message: `${input.measurement.measured} mots mesures pour une cible de ${input.measurement.target} `
        + `(${Math.round(input.measurement.ratio * 100)} %, minimum ${Math.round(MIN_LENGTH_RATIO * 100)} %)`,
    })
  }

  // Warning, never blocking: an over-long page still ranks, a thin one does not.
  // But when the target came from the SERP, exceeding it by half means the page
  // is markedly longer than everything currently ranking for that query.
  if (input.measurement.exceedsTarget) {
    warnings.push({
      code: 'LENGTH_ABOVE_TARGET',
      source: 'length',
      message: `${input.measurement.measured} mots mesures pour une cible de ${input.measurement.target} `
        + `(${Math.round(input.measurement.ratio * 100)} %, seuil ${Math.round(MAX_LENGTH_RATIO * 100)} %) — `
        + `page nettement plus longue que la concurrence mesuree`,
    })
  }

  if (input.measurement.overDeclaredBy > 0) {
    warnings.push({
      code: 'WORD_COUNT_OVER_DECLARED',
      source: 'length',
      message: `Le modele annonce ${input.measurement.declared} mots, la page en contient ${input.measurement.measured}`,
    })
  }

  // ─── 2. Structure ─────────────────────────────────────────────────────
  const headings = censusHeadings(input.html)

  if (!input.html || input.html.trim().length === 0) {
    blocking.push({ code: 'EMPTY_CONTENT', source: 'structure', message: 'La page ne contient aucun HTML' })
  } else if (headings.h1 === 0) {
    blocking.push({ code: 'MISSING_H1', source: 'structure', message: 'Aucun H1 dans la page' })
  } else if (headings.h1 > 1) {
    warnings.push({
      code: 'MULTIPLE_H1',
      source: 'structure',
      message: `${headings.h1} H1 dans la page : ${headings.h1Texts.join(' | ')}`,
    })
  }

  // ─── 3. JSON-LD ───────────────────────────────────────────────────────
  for (const check of checkAllJsonLd(input)) {
    if (check.empty) {
      warnings.push({
        code: 'SCHEMA_ABSENT',
        source: 'structure',
        message: `${check.label} : aucun schema emis`,
      })
      continue
    }
    if (!check.valid) {
      blocking.push({
        code: 'INVALID_JSON_LD',
        source: 'structure',
        message: `${check.label} : ${check.error}`,
      })
    }
  }

  // ─── 4. Internal links ────────────────────────────────────────────────
  if (input.deadInternalLinks && input.deadInternalLinks > 0) {
    warnings.push({
      code: 'DEAD_INTERNAL_LINKS_REMOVED',
      source: 'links',
      message: `${input.deadInternalLinks} lien(s) interne(s) retire(s) faute de page cible`,
    })
  }

  // ─── 5. What the generator already told us about this page ────────────
  //
  // Checked here, before the external validators, so these findings survive a
  // validator crash: they cost nothing and they are first-hand.
  for (const anomaly of input.anomalies ?? []) {
    const finding: GateFinding = {
      code: `GENERATOR_${anomaly.field.toUpperCase()}`,
      source: 'generator',
      message: anomaly.reason,
    }

    const blocks = anomaly.severity === 'blocking'
      && (BLOCKING_ANOMALY_FIELDS as readonly string[]).includes(anomaly.field)

    if (blocks) blocking.push(finding)
    else warnings.push(finding)
  }

  // ─── 6. Existing validation pipeline ──────────────────────────────────
  let score: number | undefined
  let grade: string | undefined
  let degraded: string | undefined

  try {
    const orchestrator = new ValidationPipelineOrchestrator({
      validators: {
        // No ContentSchema is declared for generated pages, and the detector
        // would need every published page's body loaded to say anything.
        schema: false,
        contentQuality: true,
        seo: true,
        duplicate: false,
      },
      contentQuality: input.quality,
      seo: input.seo,
      stopOnFirstError: false,
    })

    const result = await orchestrator.validate({
      content: {
        fields: {},
        contentType: input.pageType,
        title: input.title,
        metaTitle: input.title,
        metaDescription: input.metaDescription,
        content: input.html,
        url: input.url,
        focusKeyword: input.focusKeyword,
        schemaMarkup: input.schemaLocalBusiness,
        // All three generated payloads, not just LocalBusiness.
        //
        // Passing `schemaMarkup` alone put exactly one of the three blocks in
        // front of `JsonLdValidator`, so a broken FAQPage or a BreadcrumbList
        // with non-contiguous positions reached production unexamined — and
        // those are precisely the blocks whose only job is to open a rich
        // result. The structural check above proves a block PARSES; this proves
        // it says something Google will accept.
        schemas: {
          localBusiness: input.schemaLocalBusiness,
          faqPage: input.schemaFaqPage,
          breadcrumb: input.schemaBreadcrumb,
        },
      },
    })

    score = result.overallScore
    grade = result.summary.grade

    for (const error of result.results.contentQuality?.result.errors ?? []) {
      const finding: GateFinding = {
        code: error.code,
        source: 'quality',
        message: error.message,
      }
      if ((BLOCKING_QUALITY_CODES as readonly string[]).includes(error.code)) blocking.push(finding)
      else warnings.push(finding)
    }

    for (const warning of result.results.contentQuality?.result.warnings ?? []) {
      warnings.push({ code: warning.code, source: 'quality', message: warning.message })
    }

    for (const error of result.results.seo?.result.errors ?? []) {
      const finding: GateFinding = {
        code: error.code,
        source: 'seo',
        message: `[${error.impact}] ${error.message}`,
      }
      if ((BLOCKING_SEO_CODES as readonly string[]).includes(error.code)) blocking.push(finding)
      else warnings.push(finding)
    }

    // Schema.org findings, split by what the defect actually costs.
    //
    // Only MALFORMED markup blocks: JSON that does not parse, a node that is not
    // an object, a missing @context or @type. Those make the block inert while
    // looking, from our side, exactly like one that works.
    //
    // An INCOMPLETE but well-formed node does NOT block. A LocalBusiness without
    // `address` forfeits its rich result; it does not damage the page, and
    // blocking on it would contradict the generator outright — the prompt
    // forbids inventing a NAP that was never supplied, so every campaign without
    // a real postal address would generate correct pages that are then refused,
    // forever. Publish, and warn.
    //
    // `JsonLdValidator` already treats the generator's `'{}'` fallback as ABSENT
    // rather than invalid, so a page emitting no schema at all is only warned
    // about, in step 3 above.
    for (const issue of result.results.jsonLd?.result.errors ?? []) {
      const finding: GateFinding = {
        code: `JSON_LD_${issue.code}`,
        source: 'structure',
        message: `${issue.node} : ${issue.message}`,
      }
      if ((BLOCKING_JSON_LD_CODES as readonly string[]).includes(issue.code)) blocking.push(finding)
      else warnings.push(finding)
    }

    for (const issue of result.results.jsonLd?.result.warnings ?? []) {
      warnings.push({
        code: `JSON_LD_${issue.code}`,
        source: 'structure',
        message: `${issue.node} : ${issue.message}`,
      })
    }
  } catch (error) {
    // The validators are the part of this gate that is being rebuilt elsewhere.
    // If they break, the structural checks above still stand and the page is
    // judged on those alone — a broken validator must not silently become a
    // blanket rejection of everything the engine produces.
    degraded = error instanceof Error ? error.message : String(error)
  }

  return {
    publishable: blocking.length === 0,
    blocking,
    warnings,
    score,
    grade,
    degraded,
    durationMs: Date.now() - startedAt,
  }
}

/** One-line reasons, ready for `generations.error_message`. */
export function formatBlockingReasons(findings: GateFinding[]): string[] {
  return findings.map(finding => `${finding.code}: ${finding.message}`)
}
