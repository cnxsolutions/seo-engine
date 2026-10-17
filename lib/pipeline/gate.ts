// ─────────────────────────────────────────────────────────────────────────────
// Validation Gate
// SEO Engine - Post-generation pipeline
// The single place that answers "does this page ship?"
// ─────────────────────────────────────────────────────────────────────────────
//
// Four sources feed the verdict:
//
//  1. The structural checks in structure.ts and word-count.ts — length, H1,
//     JSON-LD — which are the defects the audit actually found in production.
//  2. The deep SEO + GEO audit (seo-audit.ts): every on-page concept a search
//     engine and an answer engine weigh — title and meta lengths, the keyword in
//     the title, the H1 and the intro, the heading outline, stuffing, internal
//     links, alt text, slug, placeholders, repeated paragraphs, empty links, the
//     direct answer under the H1, question headings, the FAQ and its schema, the
//     city, the business and the brief's entities, lists, invented NAP, sources.
//  3. `ValidationPipelineOrchestrator` (src/adapters/rag/validation), called
//     through its published API and never modified from here.
//  4. What the site ALREADY has online. Two independent comparisons feed it:
//     `DuplicateDetector`, which weighs BODIES lexically, and
//     `judgeEditorialIdentity`, which weighs the three things a searcher sees
//     before clicking — address, title, meta description. Both are HANDED their
//     candidates; neither goes looking for them.
//
// THE POLICY IS STRICT SINCE 2026-10-17, AND THAT REVERSES THE ORIGINAL ONE.
//
// This gate was born lenient on purpose: only a dozen codes blocked, duplicates
// and cannibalisation were OBSERVED without holding anything, and the generator's
// `directAnswer` anomaly was downgraded to a warning. The reasoning was sound for
// its time — a refused page went to `rejected` and waited for a human, so every
// extra blocking rule was a page the engine stopped producing, and a gate that
// refused too much would have looked, from the outside, exactly like a dead
// engine.
//
// The owner's decision of 2026-10-17 answers that fear instead of living with
// it: « tous les tests SEO approfondis et GEO approfondis [...] avant de
// publier, et si ça ne respecte pas : régénération ». A refusal no longer parks
// the page — lib/scheduler/cron.ts (`runCampaignNow`) regenerates it up to twice,
// handing the model the blocking reasons as corrections to make, and only a page
// that fails THREE attempts waits for a human. Blocking therefore costs a
// regeneration, not a page, and the rules can afford to say what a page must be:
//
//   - every blocking finding of the audit blocks, and each message is written as
//     an instruction, because it IS the next prompt's correction list;
//   - duplicates AND cannibalisation hold the page (`DUPLICATE_ENFORCEMENT` is
//     'block', `CANNIBALIZATION` joined BLOCKING_DUPLICATE_CODES);
//   - the direct answer is measured on the page itself (DIRECT_ANSWER), which is
//     why the generator's own `directAnswer` anomaly may stay a warning.
//
// The orchestrator's own `canPublish` is still NOT used as the verdict: it fails
// a page on "no images" or "readability is difficult", advice no regeneration can
// be expected to converge on. Its findings are read, and only the codes listed
// below stop a publication. Everything else is recorded as a warning, visible in
// the logs, and ships.
//
// `DUPLICATE_ENFORCEMENT` and `GateInput.duplicateMode` govern the
// CLASSIFICATION of the duplicate findings, never their COMPUTATION: under
// SEO_DUPLICATE_GATE=observe the very same evidence is measured and persisted,
// it simply does not hold the page.

import type { PageAnomaly } from '@/lib/ai/openai'
import type { DuplicateGateMode } from '@/lib/existing/mode'
import { MAX_SLUG_CHARS } from '@/lib/seo/slug'
import type { ContentQualityConfig } from '@/src/adapters/rag/validation/ContentQualityValidator'
import type { ContentToCheck, DuplicateMatch } from '@/src/adapters/rag/validation/DuplicateDetector'
import type { SeoValidationConfig } from '@/src/adapters/rag/validation/SeoValidator'
import { ValidationPipelineOrchestrator } from '@/src/adapters/rag/validation'
import {
  judgeEditorialIdentity,
  type IdentityBlockingCode,
  type IdentityComparison,
} from '@/src/core/domain/existing/identity'
import {
  buildDuplicateVerdict,
  isBlocking,
  type DuplicateMatchEvidence,
  type DuplicateVerdict,
} from '@/src/core/domain/existing/verdict'
import { auditSeoGeo, type AuditFaqItem } from './seo-audit'
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
 * `directAnswer` stays a warning, but no longer for the reason it was first
 * downgraded (a new, untested prompt requirement). The direct answer is now
 * BLOCKING through the audit's DIRECT_ANSWER, which measures the page itself —
 * the paragraph right after the H1 and the `directAnswer` field — instead of
 * trusting the generator's self-report. Blocking here as well would refuse the
 * same defect twice under two codes; when DIRECT_ANSWER fires, the anomaly is
 * not even reported (see `runValidationGate`).
 */
export const BLOCKING_ANOMALY_FIELDS = [
  'title',
  'metaDescription',
] as const

/**
 * The fourth list, and the only one this module does NOT own.
 *
 * Which duplicate codes hold a page back is a rule about editorial identity, not
 * about this pipeline: `src/core/domain/existing/verdict.ts` declares it next to
 * the shape of the persisted jsonb, and `isBlocking()` is the only reader. It is
 * re-exported here so that a reader looking for "the list next to the other
 * three" finds it — a second declaration would guarantee that a sixth blocking
 * code lands in one copy and not the other.
 */
export { BLOCKING_DUPLICATE_CODES } from '@/src/core/domain/existing/verdict'

/**
 * What the gate DOES with its duplicate verdict, by default: 'block'.
 *
 * It shipped as 'observe' — every finding computed, persisted and shown, and the
 * page shipped anyway — because a barrier nobody had measured would have cut
 * production by an amount nobody could name, with a human as the only way out.
 * Since 2026-10-17 a held page is REGENERATED with the duplicate named in its
 * correction list (lib/scheduler/cron.ts), so holding it costs an attempt, not
 * the page, and publishing a near copy of a page the site already carries is the
 * worse outcome. `SEO_DUPLICATE_GATE=observe` still restores observation.
 *
 * THIS IS ONLY A DEFAULT. The real mode arrives through `GateInput.duplicateMode`
 * and the product's single environment read (`duplicateGateMode()`,
 * lib/existing/mode.ts) belongs to the CALLER. Reading `process.env` here would
 * make the one function every publication goes through depend on an ambient a
 * test can only reach by polluting the process — and a test that pollutes the
 * process leaks into the next one.
 *
 * HANDOVER, so the switch is not born dead: `lib/pipeline/index.ts` must pass
 * `duplicateMode: duplicateGateMode()`. Without that one line, `SEO_DUPLICATE_GATE`
 * has no reader and flipping to enforcement in a later wave would mean editing
 * this file instead of an environment variable.
 */
export const DUPLICATE_ENFORCEMENT: DuplicateGateMode = 'block'

// ─── Findings ───────────────────────────────────────────────────────────────

// 'gbp' is declared for lib/publishing/gbp/gate.ts, whose findings need a source
// of their own: reusing 'seo' or 'quality' would file a Google Business Profile
// defect under a page validator and make both unreadable in a log. 'geo' files
// the answer-engine rules of seo-audit.ts apart from the search-engine ones.
export type FindingSource =
  | 'length' | 'structure' | 'links' | 'quality' | 'seo' | 'geo' | 'duplicate' | 'generator' | 'gbp'

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
  /**
   * What the page was weighed against, and what came out — ready for
   * `generations.duplicate_verdict`.
   *
   * Absent means NOT COMPARED (no candidate was supplied), which is a different
   * fact from "compared and found original": the latter is a verdict with an
   * empty `matches`, and the replay that has to size the future barrier counts
   * both.
   */
  duplicateVerdict?: DuplicateVerdict
  durationMs: number
}

export interface GateInput {
  pageType: string
  title: string
  metaDescription: string
  focusKeyword: string
  html: string
  /**
   * The address the page will take, site excluded.
   *
   * Required, and it is the central gesture of this delivery: the gate used to
   * receive only a derived `url`, so it could not answer a question about the
   * address itself. It is also what guarantees `SeoValidator` always has a real
   * last segment to measure — an optional `url` meant the URL rules silently did
   * not run whenever a caller omitted it.
   */
  slug: string
  url?: string
  schemaLocalBusiness?: string
  schemaFaqPage?: string
  schemaBreadcrumb?: string
  measurement: LengthMeasurement
  /** Internal links removed because they resolved to nothing. */
  deadInternalLinks?: number
  /** Defects the generator itself reported on this page. */
  anomalies?: PageAnomaly[]
  /**
   * Pages already online, BODY included, to compare lexically against.
   *
   * Carried in, never fetched here — see `runValidationGate`. An empty or absent
   * list means no comparison happens at all, and the detector is not even
   * instantiated.
   */
  existingContents?: ContentToCheck[]
  /**
   * The same neighbours, already weighed on what a SERP shows.
   *
   * Measured by `compareEditorialIdentity` in the domain, because it needs the
   * campaign's city tokens and the inventory entries — two things this module
   * has no business knowing.
   */
  identity?: IdentityComparison[]
  /** `SiteInventory.truncated`: a sampled inventory hardens the identity thresholds. */
  inventoryTruncated?: boolean
  /**
   * Taking a new address, or rewriting the one we already occupy. Defaults to
   * 'create': a caller that says nothing is asking for the stricter reading.
   */
  intent?: 'create' | 'refresh'
  /** Defaults to `DUPLICATE_ENFORCEMENT`. Never read from the environment here. */
  duplicateMode?: DuplicateGateMode
  quality?: ContentQualityConfig
  seo?: SeoValidationConfig

  // ─── What the SEO + GEO audit needs beyond the page itself ─────────────
  //
  // Every field below is optional, and absence has ONE of two meanings, fixed
  // per field in seo-audit.ts: CONTENT the page should carry counts as empty
  // (`faqItems`, `directAnswer`, `schemaArticle`); CONTEXT the caller may not
  // know switches the rule off (`city`, `businessName`, `requiredEntities`,
  // `enableExternalLinks`, `hasGoogleBusinessProfile`, the two link counts).
  // Guessing a context would refuse a correct page on a fact nobody supplied.

  /** JSON-LD Article of the page. */
  schemaArticle?: string
  /** `GeneratedPage.directAnswer`. */
  directAnswer?: string
  /** The visible FAQ (`GeneratedPage.faqItems`). */
  faqItems?: readonly AuditFaqItem[]
  /** Target city of the page. */
  city?: string
  businessName?: string
  /** `PlanItemBrief.required_entities`. */
  requiredEntities?: readonly string[]
  enableExternalLinks?: boolean
  /** False = no Google Business Profile: no phone, no street address allowed. */
  hasGoogleBusinessProfile?: boolean
  /** Pages the site already has, home and the page itself excluded. */
  knownInternalPathsCount?: number
  /** Internal links that resolved and were kept. */
  internalLinksKept?: number
  /** Tells an internal absolute link from an external source. */
  siteUrl?: string
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
    // Aligned on MAX_SLUG_CHARS instead of an invented 120, so ONE number
    // governs both the length a slug is built to and the length it is judged at.
    //
    // Not to be over-read: `validateUrl` (SeoValidator.ts:527) measures the LAST
    // SEGMENT of the path and `capLength` already caps every slug coming out of
    // `buildPageSlug` at this same figure. The rule bites only on a slug that
    // never went through the factory — one typed by hand, or a single word too
    // long to shorten. What changes is that the threshold can no longer be
    // silently unreachable by construction.
    urlMaxLength: MAX_SLUG_CHARS,
  }
}

// ─── Gate ───────────────────────────────────────────────────────────────────

/**
 * Run every check and return a verdict. Never throws, and never touches the
 * network.
 *
 * That second property no longer rests on duplicate detection being switched
 * off — it is ON as of this delivery. It rests on WHERE the comparison happens.
 * `DuplicateDetector` is purely lexical (its only import is `./text-utils`),
 * `judgeEditorialIdentity` is pure domain, and both are handed their candidates
 * through `GateInput`. Nothing here may import `loadSiteInventory`,
 * `nearestExistingEntries`, `createServiceClient` or `SupabaseVectorStore`:
 * loading the neighbours is `lib/pipeline/index.ts`'s job, and it costs a
 * database read plus an embedding round trip. Paying that from inside the one
 * function every publication path calls would make the gate unusable from a
 * test, a script or a route handler.
 */
export async function runValidationGate(input: GateInput): Promise<GateVerdict> {
  const startedAt = Date.now()
  const blocking: GateFinding[] = []
  const warnings: GateFinding[] = []
  const duplicates: DuplicateObservation[] = []

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

  // ─── 5. The deep SEO + GEO audit ──────────────────────────────────────
  //
  // Pure and synchronous, so it runs outside the validators' try/catch: a
  // validator crash must not silently switch off the rules this policy rests
  // on. Its blocking messages are, word for word, the corrections the next
  // regeneration is asked to make.
  const audit = auditSeoGeo({
    html: input.html,
    title: input.title,
    metaDescription: input.metaDescription,
    focusKeyword: input.focusKeyword,
    slug: input.slug,
    city: input.city,
    businessName: input.businessName,
    requiredEntities: input.requiredEntities,
    faqItems: input.faqItems,
    schemas: {
      localBusiness: input.schemaLocalBusiness,
      faqPage: input.schemaFaqPage,
      breadcrumb: input.schemaBreadcrumb,
      article: input.schemaArticle,
    },
    directAnswer: input.directAnswer,
    pageType: input.pageType,
    enableExternalLinks: input.enableExternalLinks,
    hasGoogleBusinessProfile: input.hasGoogleBusinessProfile,
    knownInternalPathsCount: input.knownInternalPathsCount,
    internalLinksKept: input.internalLinksKept,
    siteUrl: input.siteUrl,
  })

  for (const finding of audit) {
    const entry: GateFinding = { code: finding.code, source: finding.source, message: finding.message }
    if (finding.severity === 'blocking') blocking.push(entry)
    else warnings.push(entry)
  }

  const directAnswerMeasured = audit.some(finding => finding.code === 'DIRECT_ANSWER')

  // ─── 6. What the generator already told us about this page ────────────
  //
  // Checked here, before the external validators, so these findings survive a
  // validator crash: they cost nothing and they are first-hand.
  for (const anomaly of input.anomalies ?? []) {
    // Said once: DIRECT_ANSWER above already measured this defect on the page.
    if (anomaly.field === 'directAnswer' && directAnswerMeasured) continue

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

  // ─── 7. Editorial identity: the part that needs no score ──────────────
  //
  // Address, title, meta description. Run BEFORE the validators, and outside
  // their try/catch, for the same reason as the anomalies above: these findings
  // are deterministic and must survive a validator crash. A path collision in
  // particular is a binary fact — two pages cannot share one address — and
  // making it depend on a lexical detector would be inventing a measurement for
  // something already known.
  duplicates.push(...observeIdentity(input))

  // ─── 8. Existing validation pipeline ──────────────────────────────────
  let score: number | undefined
  let grade: string | undefined
  let degraded: string | undefined

  try {
    const orchestrator = new ValidationPipelineOrchestrator({
      validators: {
        // No ContentSchema is declared for generated pages.
        schema: false,
        contentQuality: true,
        seo: true,
        // TWO switches were off, and they only mean something together: this
        // flag, and the `existingContents` handed to validate() below. The
        // orchestrator skips the whole step when the candidate list is empty
        // (ValidationPipelineOrchestrator.ts:262), so turning this one on alone
        // would produce no observable effect whatsoever — and leave everyone
        // believing duplicate detection was live.
        duplicate: (input.existingContents?.length ?? 0) > 0,
      },
      contentQuality: input.quality,
      seo: input.seo,
      stopOnFirstError: false,
    })

    const result = await orchestrator.validate({
      // The other half of the switch. Empty list, no comparison, no detector.
      existingContents: input.existingContents ?? [],
      content: {
        fields: {},
        contentType: input.pageType,
        title: input.title,
        metaTitle: input.title,
        metaDescription: input.metaDescription,
        content: input.html,
        url: pageUrl(input),
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

    // The third switch, and the least visible of the three: until now nothing
    // READ `results.duplicate`. The loop above consumes contentQuality, seo and
    // jsonLd only, so a detector wired in without this would have computed
    // verdicts straight into the bin — the exact bug the generator's anomalies
    // lived with until BLOCKING_ANOMALY_FIELDS gave them a reader.
    duplicates.push(...observeContentDuplicates(result.results.duplicate?.result.duplicates ?? [], input))
  } catch (error) {
    // The validators are the part of this gate that is being rebuilt elsewhere.
    // If they break, the structural checks above still stand and the page is
    // judged on those alone — a broken validator must not silently become a
    // blanket rejection of everything the engine produces.
    degraded = error instanceof Error ? error.message : String(error)
  }

  // ─── 9. What the duplicate findings are worth, and where they land ────
  //
  // The measurement above is identical in both modes; only this classification
  // changes. Figures gathered under 'observe' describe exactly what 'block'
  // refuses — otherwise the replay (scripts/replay-duplicate-gate.ts) would
  // measure a rule other than the one in force.
  const duplicateVerdict = summarizeDuplicates(duplicates, input)

  // `isBlocking` rather than a second membership test against
  // BLOCKING_DUPLICATE_CODES: the list has one reader, and the question is asked
  // of the object that will actually be persisted, not of a local array.
  const enforced = duplicateVerdict !== undefined
    && duplicateVerdict.mode === 'block'
    && isBlocking(duplicateVerdict)

  for (const observation of duplicates) {
    if (observation.holdsPage && enforced) blocking.push(observation.finding)
    else warnings.push(observation.finding)
  }

  return {
    publishable: blocking.length === 0,
    blocking,
    warnings,
    score,
    grade,
    degraded,
    duplicateVerdict,
    durationMs: Date.now() - startedAt,
  }
}

/** One-line reasons, ready for `generations.error_message`. */
export function formatBlockingReasons(findings: GateFinding[]): string[] {
  return findings.map(finding => `${finding.code}: ${finding.message}`)
}

// ─── Duplicate observations ─────────────────────────────────────────────────

/**
 * One duplicate observation, before anyone decides what to do with it.
 *
 * `holdsPage` is set AT THE SOURCE, where the code is a literal. Deriving it
 * here by testing membership of BLOCKING_DUPLICATE_CODES would turn
 * `isBlocking()` into dead code and give that list a second reader — which is
 * precisely what moving it into the domain was meant to prevent.
 */
interface DuplicateObservation {
  finding: GateFinding
  /** Absent when the observation has no domain code worth persisting. */
  evidence?: DuplicateMatchEvidence
  holdsPage: boolean
}

/**
 * The address the validators are given.
 *
 * An explicit `url` still wins — callers that know the absolute address pass it
 * — but a caller that gives only a slug no longer silently disables every URL
 * rule in `SeoValidator`, which reads the last path segment and finds nothing
 * when `url` is undefined.
 */
function pageUrl(input: GateInput): string {
  return input.url ?? `/${input.slug.replace(/^\/+/, '')}`
}

/**
 * The documentary key of an existing page, written the way vector indexing
 * writes it (`page:<path>`). It is the only key that spans the lexical and the
 * vector side, which is why `DuplicateMatchEvidence` insists on it rather than
 * on the uuid of an embedding row.
 */
function pageKey(path: string): string {
  return `page:${path}`
}

/** Deterministic identity findings, from comparisons measured in the domain. */
function observeIdentity(input: GateInput): DuplicateObservation[] {
  const comparisons = input.identity ?? []
  if (comparisons.length === 0) return []

  const verdict = judgeEditorialIdentity(comparisons, {
    intent: input.intent ?? 'create',
    truncated: input.inventoryTruncated ?? false,
  })

  // `judgeEditorialIdentity` still files CANNIBALIZATION under `warnings`: the
  // domain says what the measurements ALLOW, the gate decides what they cost.
  // Since 2026-10-17 two pages chasing the same query is a reason to hold the
  // page and regenerate it on another angle, so its warnings hold the page too.
  return [
    ...verdict.blocking.map(item => identityObservation(item.code, item.comparison, true)),
    ...verdict.warnings.map(item => identityObservation(item.code, item.comparison, true)),
  ]
}

const IDENTITY_HEADLINES: Record<IdentityBlockingCode | 'CANNIBALIZATION', string> = {
  TITLE_NEAR_DUPLICATE: 'Titre quasi identique a celui de',
  META_NEAR_DUPLICATE: 'Meta description quasi identique a celle de',
  SLUG_COLLISION: 'Adresse deja occupee par',
  CANNIBALIZATION: 'Meme requete visee que',
}

function identityObservation(
  code: IdentityBlockingCode | 'CANNIBALIZATION',
  comparison: IdentityComparison,
  holdsPage: boolean,
): DuplicateObservation {
  const evidence: DuplicateMatchEvidence = {
    entryKey: pageKey(comparison.entryPath),
    entryPath: comparison.entryPath,
    code,
    similarity: identitySimilarity(code, comparison),
    partial: comparison.comparisonIsPartial,
  }
  if (comparison.entryUrl) evidence.entryUrl = comparison.entryUrl

  return { finding: duplicateFinding(evidence, IDENTITY_HEADLINES[code]), evidence, holdsPage }
}

function identitySimilarity(
  code: IdentityBlockingCode | 'CANNIBALIZATION',
  comparison: IdentityComparison,
): number {
  switch (code) {
    case 'META_NEAR_DUPLICATE':
      return comparison.metaSimilarity
    // A collision is not measured, it is observed. `DuplicateMatchEvidence`
    // fixes its similarity at 1 by convention so the field stays comparable.
    case 'SLUG_COLLISION':
      return 1
    default:
      return comparison.titleSimilarity
  }
}

/** Lexical findings, from bodies the detector actually compared. */
function observeContentDuplicates(
  matches: readonly DuplicateMatch[],
  input: GateInput,
): DuplicateObservation[] {
  if (matches.length === 0) return []

  const urlById = new Map((input.existingContents ?? []).map(candidate => [candidate.id, candidate.url]))
  const partialByPath = new Map(
    (input.identity ?? []).map(comparison => [comparison.entryPath, comparison.comparisonIsPartial]),
  )

  const observations: DuplicateObservation[] = []

  for (const match of matches) {
    // `findDuplicatesFor` compares OUR page (source) against each candidate
    // (target), so `targetId` names the CANDIDATE. Reading `sourceId` here would
    // show the operator the address of the page he is writing, accused of
    // duplicating itself — a report nobody could act on.
    const entryPath = match.targetId
    const evidence: DuplicateMatchEvidence = {
      entryKey: pageKey(entryPath),
      entryPath,
      code: match.matchType === 'exact' ? 'DUPLICATE_EXACT' : 'DUPLICATE_NEAR',
      similarity: match.similarity,
      // Without an identity comparison for this entry we do NOT know whether the
      // body we compared was the whole page. Admitting it beats promising a
      // complete comparison that was never made — and it only ever understates
      // confidence, never manufactures a duplicate.
      partial: partialByPath.get(entryPath) ?? true,
    }
    const url = urlById.get(entryPath)
    if (url) evidence.entryUrl = url

    if (match.matchType === 'exact' || match.matchType === 'near') {
      const headline = match.matchType === 'exact'
        ? 'Contenu identique a celui de'
        : 'Contenu quasi identique a celui de'
      observations.push({ finding: duplicateFinding(evidence, headline), evidence, holdsPage: true })
      continue
    }

    // Holds the page since 2026-10-17, like its identity twin above: the
    // regeneration is told which page already answers this query.
    if (match.reason === 'cannibalization') {
      const cannibal: DuplicateMatchEvidence = { ...evidence, code: 'CANNIBALIZATION' }
      observations.push({
        finding: duplicateFinding(cannibal, IDENTITY_HEADLINES.CANNIBALIZATION),
        evidence: cannibal,
        holdsPage: true,
      })
      continue
    }

    // A partial overlap carries no domain code, and none is invented for it:
    // `DUPLICATE_CODES` is ordered by severity and the UI reads that order, so a
    // seventh member would silently renumber every existing one. The finding is
    // reported without an evidence line — visible in the logs, absent from the
    // persisted verdict, where `parseDuplicateVerdict` would drop it anyway.
    observations.push({
      holdsPage: false,
      finding: {
        code: 'DUPLICATE_PARTIAL',
        source: 'duplicate',
        message: `Recoupement partiel avec ${evidence.entryUrl ?? entryPath} `
          + `(${percent(match.similarity)})`,
      },
    })
  }

  return observations
}

function duplicateFinding(evidence: DuplicateMatchEvidence, headline: string): GateFinding {
  const where = evidence.entryUrl ?? evidence.entryPath

  // An unmeasured fact gets neither a score nor a caveat about the measurement:
  // printing "100 %" and "partial comparison" under a path collision would make
  // a binary fact read like a fragile estimate.
  const detail = evidence.code === 'SLUG_COLLISION'
    ? ''
    : ` (${percent(evidence.similarity)})`
      + (evidence.partial ? ` — comparaison partielle, une des deux pages n'a pas ete vue en entier` : '')

  return { code: evidence.code, source: 'duplicate', message: `${headline} ${where}${detail}` }
}

function percent(similarity: number): string {
  return `${Math.round(similarity * 100)} %`
}

/**
 * The verdict as it will be persisted.
 *
 * Built as soon as ANY candidate was supplied, even when nothing matched: an
 * absent verdict has to keep meaning "not compared". Confusing the two would
 * make a site nobody crawled look exactly like a site with no duplicates.
 *
 * `reasons` lists the findings that hold the page, whatever the mode. Under
 * SEO_DUPLICATE_GATE=observe they read as would-be refusals, which is what the
 * replay counts.
 */
function summarizeDuplicates(
  observations: readonly DuplicateObservation[],
  input: GateInput,
): DuplicateVerdict | undefined {
  const compared = (input.existingContents?.length ?? 0) > 0 || (input.identity?.length ?? 0) > 0
  if (!compared) return undefined

  return buildDuplicateVerdict(
    {
      decidedBy: 'policy',
      mode: input.duplicateMode ?? DUPLICATE_ENFORCEMENT,
      reasons: observations.filter(o => o.holdsPage).map(o => o.finding.message),
      matches: observations.flatMap(o => (o.evidence ? [o.evidence] : [])),
    },
    new Date(),
  )
}
