// ─────────────────────────────────────────────────────────────────────────────
// Promotion to the production branch
// SEO Engine - A page committed to a branch nobody deploys is not published.
// ─────────────────────────────────────────────────────────────────────────────
//
// Publishing to a dedicated branch was added so a generated page could be read
// before it reached production. In practice it meant the page reached nothing at
// all: Vercel deploys `main`, the branch collected five commits, and every page
// the engine had ever produced was invisible on the live site. The safety
// measure had quietly become a wall.
//
// This module closes the loop for sites that ask for it. The branch stays — it
// is the audit trail and the revert point — but its content is carried over to
// the branch the host actually deploys.
//
// AND IT WAITS FOR THE BUILD. The first version read the commit status once,
// four seconds after the commit, when the host had not even started building,
// and merged on "pending". Six pages whose TSX did not compile reached `main`
// that way: Vercel kept serving the previous deployment, the pages answered
// 404, and every later deployment of the client's site was going to fail until
// someone reverted by hand — while the engine reported "en ligne". The build
// verdict is the only compile check the engine can get on a repository it does
// not own, so it is worth a few minutes of waiting.
//
// Deliberately NOT fatal. The page is already committed when this runs, so a
// promotion failure is a page that exists and is not yet live, which is exactly
// where the site was before. Reporting it is the whole job; throwing would turn
// a delay into a lost editorial slot.

export interface PromotionOutcome {
  /** Whether the production branch now contains this page. */
  promoted: boolean
  /** The branch merged into, once known. */
  base?: string
  /** Why it did not happen, in French, for the log and the UI. */
  reason?: string
  /**
   * Whether a build result was consulted before merging.
   *
   * False means "merged without ever seeing a green build" — only possible when
   * the repository reports no build status at all (no host integration, or a
   * token that cannot read statuses). Saying so is the point: an unverified
   * promotion should never read as a verified one.
   */
  verified: boolean
  /** True when the merge was withheld because the build has not finished yet. */
  pending?: boolean
}

export interface PromotionWait {
  /** How long to wait for a verdict once the host has reported a status. */
  maxMs: number
  /**
   * How long to wait for the host to report ANYTHING. A repository without a
   * build integration never reports, and must not be held hostage.
   */
  graceMs: number
  pollMs: number
}

/**
 * The defaults are sized on the connected host: Vercel reports its status
 * within seconds of the commit and a build of these sites takes 40–90 s.
 * The publication job has no in-tick timeout, so the wait only delays the
 * tick, never aborts it.
 */
export const DEFAULT_PROMOTION_WAIT: PromotionWait = { maxMs: 180_000, graceMs: 45_000, pollMs: 10_000 }

/** Reads the status once and decides on what it sees: for the deferred retry. */
export const NO_WAIT: PromotionWait = { maxMs: 0, graceMs: 0, pollMs: 0 }

export interface PromotionOptions {
  repoApi: string
  headers: Record<string, string>
  /** The branch the page was committed to. */
  head: string
  /** Only for the merge message. */
  slug: string
  wait?: PromotionWait
}

/**
 * Merge the publication branch into the repository's default branch, once its
 * build is green.
 *
 * The default branch is read from GitHub rather than assumed to be `main`: it is
 * `master` on older repositories, and merging into a branch that does not exist
 * fails in a way that is tedious to read.
 */
export async function promoteToProduction(opts: PromotionOptions): Promise<PromotionOutcome> {
  const { repoApi, headers, head, slug, wait = DEFAULT_PROMOTION_WAIT } = opts

  try {
    const repoRes = await fetch(repoApi, { headers, cache: 'no-store' })
    if (!repoRes.ok) {
      return { promoted: false, verified: false, reason: `depot illisible (GitHub ${repoRes.status})` }
    }
    const base: string = (await repoRes.json()).default_branch

    if (!base || base === head) {
      // Publication already targets production. Nothing to carry over, and
      // saying "promoted" would be a lie about work that never happened.
      return { promoted: false, base, verified: false, reason: 'la publication vise deja la branche de production' }
    }

    const build = await awaitBuildOutcome(repoApi, headers, head, wait)
    if (build === 'failure') {
      return {
        promoted: false,
        base,
        verified: true,
        reason: `le build de « ${head} » est en echec — rien n'a ete fusionne, la page n'est pas en ligne`,
      }
    }
    if (build === 'pending') {
      return {
        promoted: false,
        base,
        verified: false,
        pending: true,
        reason: `le build de « ${head} » n'a pas rendu son verdict — fusion reportee au prochain passage`,
      }
    }

    const mergeRes = await fetch(`${repoApi}/merges`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base,
        head,
        commit_message: `seo-engine: mise en ligne de /${slug}`,
      }),
    })

    // 204 means the base already contains the head. That is a success — the page
    // IS in production — and treating it as a failure would raise an alert every
    // time two pages are published in the same tick.
    if (mergeRes.status === 204) {
      return { promoted: true, base, verified: build === 'success' }
    }
    if (mergeRes.status === 201) {
      return { promoted: true, base, verified: build === 'success' }
    }
    if (mergeRes.status === 409) {
      return {
        promoted: false,
        base,
        verified: build === 'success',
        reason: `conflit entre « ${head} » et « ${base} » — fusion a faire a la main`,
      }
    }

    const body = await mergeRes.json().catch(() => ({}))
    return {
      promoted: false,
      base,
      verified: build === 'success',
      reason: `GitHub ${mergeRes.status} : ${(body as { message?: string }).message ?? 'fusion refusee'}`,
    }
  } catch (error) {
    return {
      promoted: false,
      verified: false,
      reason: error instanceof Error ? error.message : 'erreur reseau pendant la fusion',
    }
  }
}

type BuildOutcome = 'success' | 'failure' | 'pending' | 'unavailable'

/**
 * Poll the branch tip until the host has spoken, within the allowed wait.
 *
 * - `unavailable` (the token cannot read statuses, or nobody reported one within
 *   the grace period) merges unverified, as before: refusing to promote because
 *   we cannot see would reproduce the very problem this module exists to fix.
 * - `pending` past the wait is reported as such and NOT merged: a build that is
 *   still running may still fail, and the deferred retry will read the verdict.
 */
async function awaitBuildOutcome(
  repoApi: string,
  headers: Record<string, string>,
  branch: string,
  wait: PromotionWait
): Promise<BuildOutcome> {
  const started = Date.now()
  let reported = false

  for (;;) {
    const read = await readBuildOutcome(repoApi, headers, branch)
    if (read.outcome === 'success' || read.outcome === 'failure' || read.outcome === 'unavailable') {
      return read.outcome
    }
    reported ||= read.reported

    const elapsed = Date.now() - started
    if (!reported && elapsed >= wait.graceMs) return 'unavailable'
    if (reported && elapsed >= wait.maxMs) return 'pending'

    await new Promise((resolve) => setTimeout(resolve, wait.pollMs))
  }
}

/**
 * The build result for the branch tip, when the token is allowed to see it.
 *
 * `reported` says whether any status exists at all: a combined state of
 * `pending` with an empty list means nobody has reported yet (or ever will),
 * which the caller tells apart from a build in progress by waiting a little.
 */
async function readBuildOutcome(
  repoApi: string,
  headers: Record<string, string>,
  branch: string
): Promise<{ outcome: BuildOutcome; reported: boolean }> {
  try {
    const res = await fetch(`${repoApi}/commits/${encodeURIComponent(branch)}/status`, {
      headers,
      cache: 'no-store',
    })
    if (!res.ok) return { outcome: 'unavailable', reported: false }

    const status = await res.json()
    const reported = (status.statuses?.length ?? 0) > 0
    if (status.state === 'success' && reported) return { outcome: 'success', reported }
    if (status.state === 'failure' || status.state === 'error') return { outcome: 'failure', reported }
    return { outcome: 'pending', reported }
  } catch {
    return { outcome: 'unavailable', reported: false }
  }
}
