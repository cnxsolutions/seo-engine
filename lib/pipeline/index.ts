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
//   3. CONFRONT the page with what the site already carries. The inventory read
//      in step 2 is read a SECOND consumer out of, not a second time: the
//      semantic neighbours of the focus keyword become the duplicate candidates
//      and the editorial-identity comparisons. This is the only place where the
//      network is touched for that purpose — the gate is handed the result.
//   4. GATE. The structural checks plus the existing validation pipeline
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
import { deriveLinkContext, loadSiteInventory, nearestExistingEntries } from '@/lib/existing/inventory'
import { duplicateGateMode, type DuplicateGateMode } from '@/lib/existing/mode'
import {
  compareEditorialIdentity,
  type EditorialTarget,
  type IdentityComparison,
} from '@/src/core/domain/existing/identity'
import {
  normalizeInventoryPath,
  type InventoryEntry,
  type SiteInventory,
} from '@/src/core/domain/existing/inventory'
import type { DuplicateVerdict } from '@/src/core/domain/existing/verdict'
import type { ContentToCheck } from '@/src/adapters/rag/validation/DuplicateDetector'
import {
  measureLength,
  resolveTargetWordCount,
  stripHtml,
  type LengthMeasurement,
} from './word-count'

export interface PipelineContext<P extends GeneratedPage = GeneratedPage> {
  page: P
  generationId: string
  pageType: PageType
  siteId?: string
  siteUrl: string
  /**
   * `communes` is read by the duplicate step and by nothing else here.
   *
   * It stays OPTIONAL although `Campaign.communes` is not, because two callers
   * hand this field a literal that has never carried it — the manual publish
   * route (`{ target_length }` alone) and the integration tests. Widening the
   * `Pick` outright would have made both stop compiling for a field neither of
   * them can supply. The campaign path, the one that generates city pages in the
   * first place, passes the whole row and therefore its communes.
   */
  campaign?:
    | (Pick<Campaign, 'target_length' | 'enable_images' | 'enable_external_links'>
      & Partial<Pick<Campaign, 'communes'>>)
    | null
  planBrief?: PlanItemBrief | null
  /**
   * What the site already carries, read ONCE.
   *
   * Passed in by a caller that already loaded it — the campaign runner reserves
   * the slug against this very inventory before spending a token, and reloading
   * it here would be a second read of the same rows in the same run. Left out,
   * this module loads it itself from `siteId`.
   */
  inventory?: SiteInventory
  /**
   * Create a page, or refresh one that is already online. Defaults to 'create'.
   *
   * Read by the duplicate rules once the gate accepts them: a refresh landing on
   * the path it is refreshing is not a slug collision, and judging it as one
   * would make every rewrite unpublishable.
   */
  intent?: 'create' | 'refresh'
  /**
   * Observer les duplicats, ou refuser sur eux.
   *
   * Laisse VIDE en production : la valeur vient alors de `duplicateGateMode()`,
   * l'unique lecture de SEO_DUPLICATE_GATE du produit. Ce champ existe pour le
   * seul rejeu de calibration (scripts/replay-duplicate-gate.ts), qui doit
   * pouvoir mesurer ce que le mode bloquant REFUSERAIT sans avoir a muter
   * l'environnement du processus — une mutation qui fuirait sur tout ce que le
   * script fait ensuite.
   */
  duplicateMode?: DuplicateGateMode
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
  /**
   * What the duplicate check concluded, when it ran.
   *
   * Present whether or not anything blocked — an observation that found nothing
   * is still evidence that the check ran, and the caller persists it verbatim in
   * `generations.duplicate_verdict`. Undefined means the check did not run.
   */
  duplicateVerdict?: DuplicateVerdict
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

  // Hoisted out of the try below because step 3 reads it too. ONE read, TWO
  // consumers — the link mesh and the duplicate candidates — which is the whole
  // point of `loadSiteInventory` replacing the four readers that preceded it.
  let inventory: SiteInventory | null = null
  let inventoryIsBlank = false

  try {
    // ONE read of what the site already carries, for the whole pipeline.
    //
    // The caller usually already holds it: the campaign runner loads the
    // inventory to reserve the slug BEFORE spending a token, and passing it down
    // is what keeps that read from happening twice per page.
    //
    // `loadSiteInventory` never throws — a failure comes back as a BLIND
    // inventory, indistinguishable from a site that genuinely has nothing. The
    // test below chooses which of the two to assume, and it is a real trade:
    //
    //   - treating it as "empty" prunes every internal link out of a page that
    //     has already been paid for, every time the database hiccups;
    //   - treating it as "unknown" ships a handful of dead hrefs on the first
    //     pages of a site nobody has crawled yet.
    //
    // The second is the smaller, self-correcting harm, and the pre-existing rule
    // says so out loud a few lines below: a read failure degrades the check, it
    // never rewrites the page. Either way the degradation is NAMED.
    inventory = context.inventory
      ?? (context.siteId ? await loadSiteInventory(context.siteId) : null)

    inventoryIsBlank = Boolean(
      inventory && inventory.entries.length === 0 && inventory.freshness.state === 'blind'
    )

    const siteContext = inventory && !inventoryIsBlank ? deriveLinkContext(inventory) : null

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

  // ─── 3. What the site already carries, weighed against what was written ───
  //
  // The second consumer of the ONE inventory read above. Everything the
  // duplicate rules need is computed HERE and handed to the gate as a value:
  // `runValidationGate` must never touch the network or the database, and it is
  // that invariant — not the absence of a duplicate check — that makes it fast
  // and testable.
  //
  // COST DECLARED, so nobody discovers it on an invoice: `nearestExistingEntries`
  // asks the vector store for the neighbours of the focus keyword, and that call
  // buys ONE OpenAI embedding (findSimilar → generateEmbedding). It is therefore
  // one billed round-trip PER GENERATED PAGE, and it must never be put in a loop
  // over pages, over candidates, or over retries. The price buys the only thing a
  // lexical comparison cannot see: that "taxi conventionne CPAM" and "transport
  // medical assis" are the same page.
  const intent = context.intent ?? 'create'
  const targetPath = normalizeInventoryPath(context.page.slug)
  let existingContents: ContentToCheck[] = []
  let identity: IdentityComparison[] = []

  if (context.siteId && inventory && !inventoryIsBlank) {
    try {
      const neighbours = await nearestExistingEntries(
        inventory.siteId || context.siteId,
        context.page.focusKeyword,
        inventory,
        MAX_DUPLICATE_CANDIDATES,
      )

      const candidates = neighbours.filter(entry => isComparable(entry, targetPath, intent))

      // The body is stripped of its markup before it is compared or read for
      // intent: an inventory body is plain text (`site_pages.content_excerpt`),
      // and handing raw HTML to the other side of the comparison would make the
      // first 800 characters — the window `detectIntents` looks at — a list of
      // tags rather than a sentence.
      const target: EditorialTarget = {
        path: targetPath,
        title: context.page.title,
        metaDescription: context.page.metaDescription,
        focusKeyword: context.page.focusKeyword,
        body: stripHtml(html),
      }

      const cityTokens = cityTokensOf(context)

      existingContents = candidates.map(toContentToCheck)
      identity = candidates.map(entry => compareEditorialIdentity(target, entry, cityTokens))

      // Entries, but not one of them crawled. The inventory still holds the
      // engine's own generations, so the comparison RUNS — against half a site.
      // Whatever the owner wrote themselves is invisible to it, and staying
      // silent here would let "no duplicate found" be read as "no duplicate",
      // which is the reading this whole observation period exists to avoid.
      if (inventory.crawledCount === 0) {
        degraded.push('inventaire indisponible — duplicat evalue contre les pages du moteur uniquement')
      }
    } catch (error) {
      // Never an exception. The page has been paid for; losing it because the
      // vector store hiccuped would be a far worse outcome than shipping it
      // without the duplicate evidence, and the missing evidence is NAMED.
      degraded.push(`duplicat non evalue : ${error instanceof Error ? error.message : String(error)}`)
    }
  } else if (context.siteId) {
    // Deliberately NOT the message above. Zero entries means zero comparisons,
    // and telling the operator the page was "weighed against the engine's own
    // pages" when it was weighed against nothing is the kind of false report that
    // makes someone trust an empty measurement.
    degraded.push('duplicat non evalue : inventaire indisponible')
  }

  // ─── 4. Blocking gate ─────────────────────────────────────────────────
  const verdict = await runValidationGate({
    pageType: context.pageType,
    title: context.page.title,
    metaDescription: context.page.metaDescription,
    focusKeyword: context.page.focusKeyword,
    html,
    slug: context.page.slug,
    intent,
    // LA PASSATION QUE gate.ts RECLAME EXPLICITEMENT.
    //
    // Sans cette ligne, `DUPLICATE_ENFORCEMENT` ('observe') s'applique toujours,
    // SEO_DUPLICATE_GATE n'a aucun lecteur, et la basculer en 'block' ne
    // changerait rien — il faudrait editer le code du gate. L'interrupteur
    // serait ne mort, ce que l'en-tete de gate.ts nomme mot pour mot.
    duplicateMode: context.duplicateMode ?? duplicateGateMode(),
    existingContents,
    identity,
    // A truncated crawl makes the rules STRICTER, never more confident: the page
    // that looks most like this one may simply not be in what we can see.
    inventoryTruncated: inventory?.truncated ?? false,
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

  // ─── 5. The page as it must be stored ─────────────────────────────────
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
    // Handed up UNCHANGED, blocking or not. The caller files it against the
    // generation whether the page ships or is refused: a rejection rate computed
    // on rows that only exist when they blocked reads 100 % for ever, and that
    // number is the one the switch to blocking mode will be decided on.
    duplicateVerdict: verdict.duplicateVerdict,
    degraded,
    durationMs: Date.now() - startedAt,
  }
}

function describeFindings(findings: GateFinding[]): string[] {
  return findings.map(finding => `${finding.code}: ${finding.message}`)
}

// ─── Duplicate candidates ───────────────────────────────────────────────────

/**
 * How many existing pages the new one is weighed against.
 *
 * Well under `DuplicateDetector`'s own `maxCandidates` of 300, and deliberately
 * so: the comparison is linear, but each candidate carries a body, and the point
 * of asking the vector store first is that the pages worth comparing to are the
 * NEAREST ones. Thirty covers a whole city cluster of a mono-service site; past
 * that the list is no longer neighbours, it is the site.
 *
 * Unrelated to `MAX_PROMPT_NEIGHBOURS` (lib/existing/prompt-block.ts), which
 * bounds what a MODEL is shown and is therefore bounded by a token budget. These
 * candidates are never sent anywhere.
 */
const MAX_DUPLICATE_CANDIDATES = 30

/**
 * The entries it is HONEST to compare against.
 *
 * `compareEditorialIdentity` measures and refuses to filter, by design: a policy
 * that dropped its own candidates would make "nothing looks alike" and "nothing
 * was compared" indistinguishable. Choosing them is therefore this caller's job,
 * and three exclusions are not optional.
 *
 *  - `!coversTopic`: a `failed` generation keeps its ADDRESS in the inventory and
 *    releases its SUBJECT. Comparing against it would refuse the retry of a page
 *    for looking like the attempt that never shipped.
 *  - `noindex` and pages canonicalised elsewhere: they are not in the index, so
 *    they cannot compete for a click. Blocking a new page against a page Google
 *    was explicitly told to ignore is a refusal with no upside.
 *  - on a REFRESH, the page being refreshed: a successful rewrite resembles what
 *    it replaces by construction. Without this line every refresh would report
 *    itself as a near-duplicate of itself, and the observation period — whose only
 *    job is to measure the REAL rate — would count each of them as a hit.
 *    `judgeEditorialIdentity` guards the identity side of this on its own; the
 *    lexical detector cannot, because the orchestrator gives its target the fixed
 *    id 'new' (ValidationPipelineOrchestrator.ts:263), so its own
 *    `candidate.id === target.id` skip never fires.
 */
function isComparable(
  entry: InventoryEntry,
  targetPath: string,
  intent: 'create' | 'refresh',
): boolean {
  if (!entry.coversTopic) return false
  if (entry.noindex) return false
  if (entry.canonicalPath && entry.canonicalPath !== entry.path) return false
  if (intent === 'refresh' && entry.path === targetPath) return false
  return true
}

/** `ContentToCheck` keyed by PATH: the id is what the evidence will point at. */
function toContentToCheck(entry: InventoryEntry): ContentToCheck {
  return {
    id: entry.path,
    title: entry.title ?? '',
    content: entry.body,
    url: entry.url,
  }
}

/**
 * The city names whose tokens are stripped from titles before they are compared.
 *
 * This is what makes the check see the real failure mode of a one-page-per-city
 * generator: raw, "Taxi Troyes" against "Taxi Sainte-Savine" scores about 0.41
 * and no reasonable threshold ever fires. The whole campaign's communes are
 * passed, not just the current one — stripping only the city of the page being
 * written would leave the OTHER page's city in its vector and keep the score low.
 */
function cityTokensOf(context: PipelineContext): string[] {
  const tokens = [...(context.campaign?.communes ?? [])]
  const briefCity = context.planBrief?.target_city
  if (briefCity) tokens.push(briefCity)
  return tokens
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

export { markGenerationRejected, persistDuplicateVerdict } from './repository'
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
