// ─────────────────────────────────────────────────────────────────────────────
// Keeping the publication branch level with production
// SEO Engine - The build that gates a page must be the build of the real site.
// ─────────────────────────────────────────────────────────────────────────────
//
// The engine commits to its own branch and merges it into the branch the host
// deploys, once that branch's build is green. But nothing ever carried
// production BACK into the engine's branch: as the owner kept developing on
// `main`, the branch stayed on an old version of the site, and the build the
// host verified was "old site + new page". A component renamed on `main` would
// pass that build and break the next one. It also kept six broken files alive
// on the branch after they had been reverted from `main`.
//
// So, before every commit, the branch is brought level with production: a
// fast-forward when it is simply behind, a merge when both sides moved. Never a
// force push — the branch is the audit trail. A merge conflict is reported, not
// forced: the promotion would hit the same conflict and says so too.

export type BranchSync =
  | { how: 'a-jour' }
  | { how: 'avance-rapide' }
  | { how: 'fusion' }
  | { how: 'conflit'; reason: string }
  | { how: 'inconnu'; reason: string }

export interface BranchSyncOptions {
  repoApi: string
  headers: Record<string, string>
  /** The engine's branch. */
  head: string
}

export async function syncBranchWithProduction(opts: BranchSyncOptions): Promise<BranchSync> {
  const { repoApi, headers, head } = opts

  try {
    const repoRes = await fetch(repoApi, { headers, cache: 'no-store' })
    if (!repoRes.ok) return { how: 'inconnu', reason: `depot illisible (GitHub ${repoRes.status})` }
    const base: string = (await repoRes.json()).default_branch
    if (!base || base === head) return { how: 'a-jour' }

    // `head...base`: how `base` stands relative to `head`. "ahead" means
    // production has commits the branch lacks and nothing the other way round.
    const cmpRes = await fetch(
      `${repoApi}/compare/${encodeURIComponent(head)}...${encodeURIComponent(base)}`,
      { headers, cache: 'no-store' }
    )
    if (!cmpRes.ok) return { how: 'inconnu', reason: `comparaison impossible (GitHub ${cmpRes.status})` }
    const cmp = await cmpRes.json()

    if (cmp.status === 'identical' || cmp.status === 'behind') return { how: 'a-jour' }

    if (cmp.status === 'ahead') {
      const sha: string | undefined = cmp.commits?.at(-1)?.sha
      if (!sha) return { how: 'inconnu', reason: 'sha de production introuvable' }
      const ffRes = await fetch(`${repoApi}/git/refs/heads/${encodeURIComponent(head)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ sha, force: false }),
      })
      if (!ffRes.ok) return { how: 'inconnu', reason: `avance rapide refusee (GitHub ${ffRes.status})` }
      return { how: 'avance-rapide' }
    }

    // Diverged: both sides moved. Merge production INTO the branch.
    const mergeRes = await fetch(`${repoApi}/merges`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ base: head, head: base, commit_message: `seo-engine: synchronisation avec ${base}` }),
    })
    if (mergeRes.status === 201 || mergeRes.status === 204) return { how: 'fusion' }
    if (mergeRes.status === 409) {
      return { how: 'conflit', reason: `« ${head} » et « ${base} » sont en conflit — fusion a faire a la main` }
    }
    const body = await mergeRes.json().catch(() => ({}))
    return { how: 'inconnu', reason: `GitHub ${mergeRes.status} : ${(body as { message?: string }).message ?? 'fusion refusee'}` }
  } catch (error) {
    return { how: 'inconnu', reason: error instanceof Error ? error.message : 'erreur reseau' }
  }
}
