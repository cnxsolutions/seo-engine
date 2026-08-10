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
   * False means "merged without ever seeing a green build" — which is the normal
   * case here, because the repository token cannot read commit statuses. Saying
   * so is the point: an unverified promotion should never read as a verified one.
   */
  verified: boolean
}

export interface PromotionOptions {
  repoApi: string
  headers: Record<string, string>
  /** The branch the page was committed to. */
  head: string
  /** Only for the merge message. */
  slug: string
}

/**
 * Merge the publication branch into the repository's default branch.
 *
 * The default branch is read from GitHub rather than assumed to be `main`: it is
 * `master` on older repositories, and merging into a branch that does not exist
 * fails in a way that is tedious to read.
 */
export async function promoteToProduction(opts: PromotionOptions): Promise<PromotionOutcome> {
  const { repoApi, headers, head, slug } = opts

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

    const build = await readBuildOutcome(repoApi, headers, head)
    if (build === 'failure') {
      return {
        promoted: false,
        base,
        verified: true,
        reason: `le build de « ${head} » est en echec — rien n'a ete fusionne`,
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

/**
 * The build result for the branch tip, when the token is allowed to see it.
 *
 * A fine-grained token without `Commit statuses: read` answers 403 here, which
 * is the current situation on the connected repository. That is treated as
 * `unknown`, not as failure: refusing to promote because we cannot see would
 * reproduce the very problem this module exists to fix.
 *
 * `pending` is also `unknown` on purpose. A build started seconds ago is always
 * pending, and waiting for it would mean either blocking the tick or dropping
 * the promotion — the merge happens, and the host's own build is what gates
 * deployment anyway.
 */
async function readBuildOutcome(
  repoApi: string,
  headers: Record<string, string>,
  branch: string
): Promise<'success' | 'failure' | 'unknown'> {
  try {
    const res = await fetch(`${repoApi}/commits/${encodeURIComponent(branch)}/status`, {
      headers,
      cache: 'no-store',
    })
    if (!res.ok) return 'unknown'

    const status = await res.json()
    if (status.state === 'success' && (status.statuses?.length ?? 0) > 0) return 'success'
    if (status.state === 'failure' || status.state === 'error') return 'failure'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}
