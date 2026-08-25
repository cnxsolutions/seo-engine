// ─────────────────────────────────────────────────────────────────────────────
// HTTP evidence
// SEO Engine - Did the destination have time to write, before it answered?
// ─────────────────────────────────────────────────────────────────────────────
//
// Extracted, not rewritten, from the WordPress connector. A POST to
// `.../locations/{l}/localPosts` is exactly as non-idempotent as a POST to
// `/wp/v2/pages`, and this is the most expensive reasoning in the repository:
// re-deriving it a second time for the Google listing would have derived it
// DIFFERENTLY, and the price of the difference is a duplicate post on a client's
// business listing — visible to their customers, and impossible to un-publish
// from here.
//
// The question is never "did the call succeed". It is "may I send it again?",
// and only two answers are safe:
//
//   4xx RECEIVED   the destination refused BEFORE acting: nothing was created.
//   408 / 429      the two 4xx that prove nothing (see below).
//   5xx            the insert may have happened, and something after it failed:
//                  a plugin can fatal AFTER wp_insert_post().
//   cut / timeout  no answer at all, therefore no proof at all.
//
// Decided on the STATUS, never on the failure's name or class. `rest_filtre` is
// raised both for a WAF answering 403 in front of WordPress (nothing written)
// and for a 502 from nginx (possibly written, after insertion) — the status
// separates them, the name does not. The status is also the only thing a
// connector that has never heard of `WpError` can hand over, which is the whole
// reason this module takes a number and not an error.
//
// The two answers are NOT symmetrical, and that asymmetry decides every doubtful
// case. Calling a write "not written" when it went through makes the scheduler
// send it again and creates a second page or a second post. Calling it "maybe
// written" when nothing happened costs one operator check. Whenever the evidence
// is thin, this module chooses the check.

/**
 * Did the destination refuse on arrival — before it could have written anything?
 *
 * `undefined` means no status ever came back: a cut connection, a client-side
 * timeout, a DNS failure. That is doubt, not proof, and doubt answers `false`.
 *
 * `200`, and any other 2xx or 3xx, also answers `false`, and it means the same
 * thing it means on a 502: "do not conclude that nothing was written". Here it
 * is not doubt but its opposite — a 2xx is the proof that the write DID land.
 * Both callers only ask this question from a failure path, where a 2xx never
 * arrives; the test pins it anyway, so that nobody later reads `false` as
 * "written" or as "not written". This function answers exactly one question, and
 * `false` is always its negative answer, never a second verdict.
 *
 * TWO EXCEPTIONS among the 4xx, both because the request may have been processed
 * despite the refusal:
 *   - 408: a proxy times out on a request the server already served in full.
 *   - 429: rate limiting can sit in front of the handler or behind it, and
 *     neither the WordPress REST API nor the Google Business Profile API
 *     documents which. Google answers 429 / RESOURCE_EXHAUSTED on a quota it
 *     usually checks first, but "usually" is not evidence.
 *
 * NOTE — 429 is the one behaviour change carried by the extraction. The inline
 * WordPress version excluded 408 only, so a 429 there used to conclude "nothing
 * written" and allow an immediate retry. It now concludes "maybe written". The
 * change is deliberate and goes in the direction of prudence: it trades a retry
 * that could duplicate a page for a manual check. Pinned by the test that
 * compares this function to the original rule over every status.
 */
export function rejectedOnArrival(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
}

/**
 * What may be said about the content at the other end, and nothing more.
 *
 * Two values because there are two safe answers, not because the third one is
 * missing: "written for certain" is never established by a failure, it is
 * established by a 2xx and a read-back.
 */
export type WriteEvidence = 'certainement-pas-ecrit' | 'peut-etre-ecrit'

/**
 * Position in the sequence, then evidence — in that order, both required.
 *
 * @param attemptedWrite whether the create request had already been handed to
 *   the destination. Taken from the caller's POSITION in the sequence, set just
 *   BEFORE the call, never guessed from the kind of error — guessing is what
 *   made this wrong in both directions at once: a timeout after insertion
 *   reported as not written (the next tick creates a second page), and a lookup
 *   that failed before the POST reported as written (row marked published, no
 *   page anywhere).
 * @param status the HTTP status actually received, or `undefined` when none was.
 *
 * Position answers UNCERTAINTY; a received 4xx is not uncertainty, which is why
 * the status can still overrule it. Nothing overrules the other way round: a
 * status can never turn `attemptedWrite: false` into "maybe written", since a
 * request never sent cannot have been served.
 */
export function evidenceFor(attemptedWrite: boolean, status: number | undefined): WriteEvidence {
  if (!attemptedWrite) return 'certainement-pas-ecrit'
  return rejectedOnArrival(status) ? 'certainement-pas-ecrit' : 'peut-etre-ecrit'
}
