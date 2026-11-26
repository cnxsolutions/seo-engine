// ─────────────────────────────────────────────────────────────────────────────
// The publication sequence
// SEO Engine - One path, used by the scheduler and by the operator alike.
// ─────────────────────────────────────────────────────────────────────────────
//
// Three callers used to run their own version of these steps: the HTTP route,
// the deferred publishing job, and the campaign job. They agreed on nothing.
// The most expensive disagreement: `POST /api/publish` — the path the operator
// uses by hand, and the target of both `/publish/wordpress` and
// `/publish/generation` — never ran the quality gate at all. A page pushed from
// the interface skipped every check the scheduler applies, and there was nothing
// in the code to notice.
//
// The order below is not arbitrary:
//
//   1. gate      before anything leaves the building. A page that fails is not
//                worth a network call, and refusing after the push is too late.
//   2. connector the only step allowed to touch a remote system.
//   3. record    bookkeeping and indexing, which may never fail the publication.
//
// `force` skips the destination guards — occupancy, redirects — and NEVER the
// gate. Those are different questions: one asks whether our view of the site is
// stale, the other whether the article is good enough. Only the first is the
// operator's to overrule.
//
// `replaces` is the same permission narrowed to one named page, and it obeys the
// same rule: destination guards yes, gate never. The two may not travel
// together — see the guard at step 0.

import {
  markGenerationRejected,
  persistDuplicateVerdict,
  runPrePublishGate,
  type PipelineReport,
} from '@/lib/pipeline'
import { updateGeneration } from '@/lib/db'
import { connectorFor, missingCredentials, UnknownConnectorError } from './connector'
import { recordPublication, type RecordReport } from './record'
import { failed, refuse, type PublishOutcome, type PublishRequest } from './outcome'
import type { PageType } from '@/lib/types'

export interface PublishPageOptions extends PublishRequest {
  /**
   * The caller has already run the gate on this exact page.
   *
   * `/api/publish/generation` re-reads a stored page and gates it before
   * calling; running it twice would double the cost and could disagree with
   * itself on a borderline page.
   */
  gateAlreadyRan?: boolean
  campaign?: Parameters<typeof runPrePublishGate>[0]['campaign']
}

export interface PublishPageResult {
  outcome: PublishOutcome
  /** Present when the gate ran here. */
  gate?: PipelineReport
  record?: RecordReport
}

export async function publishPage(opts: PublishPageOptions): Promise<PublishPageResult> {
  const { site, pageType, generationId, gateAlreadyRan, campaign } = opts
  let page = opts.page

  // ─── 0. Is the request itself coherent? ────────────────────────────────────
  //
  // `replaces` and `force` say contradictory things about the same write.
  // `replaces` authorises ONE named page and refuses everything else; `force`
  // takes over whatever it finds. Accepted together, `force` wins by
  // construction and the named target becomes decoration — the caller believes
  // it constrained the write to the page a human looked at, and it did not.
  //
  // Refused here rather than arbitrated in each connector: two connectors
  // resolving a contradiction on their own is two chances to resolve it
  // differently, and the safe answer is that nobody resolves it.
  if (opts.replaces && opts.force) {
    return {
      outcome: failed(
        `Requete contradictoire : « replaces » designe la page /${opts.replaces.path.replace(/^\/+/, '')} ` +
          `et « force » leve la garde sur n'importe laquelle. Choisir l'un des deux. Aucune publication tentee.`
      ),
    }
  }

  // ─── 0 bis. Do we even know this kind of site? ─────────────────────────────
  //
  // Checked before the credentials, because `missingCredentials` asks the
  // connector which ones it needs.
  try {
    connectorFor(site.type)
  } catch (error) {
    if (error instanceof UnknownConnectorError) {
      return { outcome: failed(error.message) }
    }
    throw error
  }

  const missing = missingCredentials(site)
  if (missing.length > 0) {
    return {
      outcome: refuse({
        kind: 'identifiants',
        message: `Identifiants manquants pour ${site.name} : ${missing.join(', ')}`,
      }),
    }
  }

  // ─── 1. The quality gate ───────────────────────────────────────────────────
  let gate: PipelineReport | undefined
  if (!gateAlreadyRan) {
    gate = await runPrePublishGate({
      page,
      generationId: generationId ?? 'sans-generation',
      pageType: pageType ?? 'child',
      siteId: site.id,
      siteUrl: site.url,
      campaign,
    })

    if (!gate.publishable) {
      if (generationId) {
        // The evidence before the verdict, and both before the row is parked.
        //
        // A refusal for duplication that arrives without the pages it collided
        // with is not actionable: the operator reads "duplicat" and has nothing
        // to look at. Written first so the row is never in `rejected` with its
        // proof still in memory, and never blocking on a write that may fail —
        // `persistDuplicateVerdict` swallows its own errors on purpose.
        if (gate.duplicateVerdict) {
          await persistDuplicateVerdict(generationId, gate.duplicateVerdict)
        }
        await markGenerationRejected(generationId, gate.reasons).catch(() => null)
      }
      return {
        outcome: failed(`Page refusee par la barriere qualite : ${gate.reasons.join(' · ')}`),
        gate,
      }
    }

    // The gate returns the page it would publish — measured, linked, pruned.
    // Publishing the input instead would ship the unpruned version.
    page = gate.page
  }

  // ─── 2. The push ───────────────────────────────────────────────────────────
  const connector = connectorFor(site.type)
  const outcome = await connector.publish({ ...opts, page })

  // ─── 3. Bookkeeping ────────────────────────────────────────────────────────
  //
  // Runs whenever the content reached the destination, INCLUDING on a failure
  // that got that far. A caller that requeues a page already written creates a
  // second one, so the row must carry the truth even when the call reports
  // failure.
  if (!outcome.ok && !outcome.written) {
    if (generationId) {
      await updateGeneration(generationId, {
        status: 'failed',
        error_message: outcome.refusal?.message ?? outcome.error,
        // Recorded so the interface can tell a decision from an accident. A
        // breakage retries itself on the next tick; a refusal needs someone to
        // change a slug or take over the page, and it had no way to ask.
        refusal_kind: outcome.refusal?.kind ?? null,
      }).catch(() => null)
    }
    return { outcome, gate }
  }

  const record = await recordPublication({
    site,
    page,
    pageType: pageType as PageType | undefined,
    generationId,
    outcome,
  })

  return { outcome, gate, record }
}
