// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Publication vocabulary
// SEO Engine - What "published" means, said once for every kind of site.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Before this module the two connectors answered different questions and the
// callers averaged them. The word "published" covered four different states â€”
// committed to a branch nobody deploys, saved as a WordPress draft, live and
// reachable, live and in the sitemap â€” and the engine recorded all four the same
// way. It then asked Google and IndexNow to index every one of them.
//
// The distinction that matters is not "did the call succeed". It is:
//
//   written      the destination accepted the content. Do NOT retry after this,
//                whatever else fails: a retry on a non-idempotent create is how
//                a second page appears.
//   live         a visitor typing the URL sees the page. A page committed to an
//                unpromoted branch is written and not live; so is a draft.
//   discoverable something points at it â€” a sitemap entry, a link. Live without
//                discoverable is a page that exists and that nothing will find.
//
// Only `live` may open the door to indexing. That is the whole reason these are
// three fields and not one boolean.

import type { GeneratedPage } from '@/lib/ai/openai'
import type { PageType, RefusalKind, Site } from '@/lib/types'

/** Whether the destination should show the page immediately or hold it back. */
export type PublishIntent = 'brouillon' | 'publie'

export interface PublishRequest {
  site: Site
  page: GeneratedPage
  pageType?: PageType
  intent: PublishIntent
  /** The row this publication belongs to, when it is tracked. */
  generationId?: string
  /**
   * The destination's own id for this page, from a previous publication.
   *
   * The database is the reference for "did I write here?" â€” it answers without
   * a network call, and it stays true when someone edits the page by hand. A
   * marker left on the remote page would be blind to everything published
   * before it existed.
   */
  knownRemoteId?: number
  /**
   * Bypass the OCCUPANCY and REDIRECT guards â€” never the quality gate.
   *
   * An admission that the engine's view of the destination is stale (a page
   * deleted by hand, a file reverted), not a way to publish something the gate
   * rejected. Those are different problems and only one of them is the
   * operator's to overrule.
   */
  force?: boolean
  /**
   * A previous attempt on this row was cut off mid-publish.
   *
   * Set by the reaper's recovery path. It does not lift the occupancy guard â€”
   * it lets the guard recognise our own half-written page by evidence (same
   * slug AND same title) instead of refusing it as the owner's work, which is
   * what the nominal recovery produced: a real page at the client, a row in
   * `failed`, and a reason that was false.
   */
  recovering?: boolean
  /**
   * Authorise writing over ONE named page of the owner's â€” and only that one.
   *
   * `force` lifts the destination guards blindly: whatever sits at the slug is
   * taken over. This lifts them for a path the caller had to name, which a human
   * had to see. The connector accepts only when `path` matches the slug it is
   * about to write exactly; anything else falls back to the ordinary 'occupe'
   * refusal, word for word. That exact match is the whole safety property â€” a
   * target that is merely advisory would be decorative.
   *
   * Never lifts the quality gate. Same separation as `force`, already stated in
   * the header of publish.ts: one asks whether our view of the site is stale, the
   * other whether the article is good enough.
   *
   * `remoteId` is optional and has NO column behind it: `decideTarget` finds the
   * page by slug and the Next.js connector has no remote id at all. It exists for
   * a caller that already knows it, not as a field of the model.
   */
  replaces?: { path: string; remoteId?: number }
  signal?: AbortSignal
}

/**
 * Why the connector declined, when it declined on purpose.
 *
 * Separate from `error` because these are not failures: nothing broke, the
 * engine refused. They deserve a different HTTP status, a different log level
 * and a different sentence in the UI.
 */
export type PublishRefusal =
  | { kind: 'occupe'; message: string }
  | { kind: 'redirection'; message: string }
  | { kind: 'identifiants'; message: string }
  /**
   * The site already covers this subject. `targetUrl` is the page it covers it
   * with â€” a refusal the operator cannot act on is a refusal that comes back
   * every fifteen minutes.
   */
  | { kind: 'duplicat'; message: string; targetUrl?: string }

/**
 * These kinds are written verbatim into `generations.refusal_kind` (publish.ts),
 * a column typed `RefusalKind` and constrained by `generations_refusal_kind_check`.
 * If this union ever grows a member `RefusalKind` does not have, the line below
 * stops compiling â€” which is the only moment the drift is cheap to fix.
 *
 * Type-only on purpose: the check costs nothing at runtime.
 */
type Aligned<T extends true> = T
export type _RefusalKindsAligned = Aligned<
  PublishRefusal['kind'] extends RefusalKind ? true : false
>

export interface PublishOutcome {
  ok: boolean
  /** Set when the engine declined deliberately. Mutually exclusive with `error`. */
  refusal?: PublishRefusal
  /** Set when something broke. */
  error?: string

  /**
   * The destination accepted the content.
   *
   * True even when a later step failed. This is the anti-duplicate flag: a
   * caller that sees `written: true` must never queue the page for another
   * push, because the page already exists at the other end.
   */
  written: boolean

  /** A visitor can reach it right now. Gates indexing, and nothing else does. */
  live: boolean

  /** Something points at it: sitemap entry, route registry, internal link. */
  discoverable: boolean

  /** Public URL of the page, once known. */
  pageUrl?: string
  /** The destination's own identifier â€” a WordPress post id, for instance. */
  remoteId?: string
  /** Where to look at what was written: a commit, an admin screen. */
  artifactUrl?: string

  /**
   * How the connector produced the page, in its own words.
   *
   * A free string on purpose. `contrat` and `charpente` mean nothing to
   * WordPress, and a shared union would force every connector to pretend it
   * belongs to the same taxonomy. It is read by humans, never branched on.
   */
  mode?: string

  /** Everything worth telling the operator that is not an error. */
  notes: string[]
}

/** A refusal, shaped so callers never have to assemble one by hand. */
export function refuse(refusal: PublishRefusal): PublishOutcome {
  return { ok: false, refusal, written: false, live: false, discoverable: false, notes: [] }
}

/** A breakage. `written` is explicit: only the connector knows if it got through. */
export function failed(error: string, written = false): PublishOutcome {
  return { ok: false, error, written, live: false, discoverable: false, notes: [] }
}
