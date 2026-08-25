// ─────────────────────────────────────────────────────────────────────────────
// Next.js connector
// SEO Engine - A thin translation onto the existing publisher.
// ─────────────────────────────────────────────────────────────────────────────
//
// `lib/publishers/nextjs.ts` is not touched. This file only answers the two
// questions the core needs and the old result type never carried:
//
//   live  — a page committed to a branch the host does not deploy is written,
//           not live. It is exactly the state both connected sites were in for
//           days: five commits ahead of `main`, nothing visible, and the engine
//           asking Google to index every one of them.
//   mode  — computed since yesterday at nextjs.ts, read by nobody until now.

import { publishToNextJs } from '@/lib/publishers/nextjs'
import type { Connector } from './connector'
import type { PublishOutcome, PublishRequest } from './outcome'
import type { RepoProfile } from '@/lib/publishers/nextjs-analyzer'

/** `owner/repo`, nothing else — and above all no `..`, since it is interpolated into a URL. */
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export const nextJsConnector: Connector = {
  label: 'Next.js',
  credentialColumns: ['github_repo', 'github_token'],

  async describe(site) {
    const repo = site.github_repo || ''
    if (!GITHUB_REPO_PATTERN.test(repo)) {
      return { ok: false, message: 'github_repo doit etre au format owner/repo' }
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Authorization: `token ${site.github_token || ''}`, Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      })
      if (!res.ok) return { ok: false, message: `Depot inaccessible (GitHub ${res.status})` }
      const data = await res.json()
      const branch = site.github_branch || data.default_branch
      return { ok: true, message: `${data.full_name} · branche ${branch}` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'GitHub injoignable' }
    }
  },

  async publish(request: PublishRequest): Promise<PublishOutcome> {
    const { site, page, pageType } = request
    const branch = site.github_branch || undefined

    const result = await publishToNextJs({
      githubRepo: site.github_repo || '',
      githubToken: site.github_token || '',
      page,
      siteUrl: site.url,
      repoProfile: site.repo_profile as RepoProfile | undefined,
      branch,
      pageType,
      autoPromote: site.auto_promote ?? false,
      // Le pendant Next.js de la reprise ciblee cote WordPress. Le publisher
      // ne leve sa garde que si `path` designe EXACTEMENT le slug commite ;
      // omettre la ligne rendait cette garde inatteignable et laissait la
      // validation humaine se heurter au marqueur de fichier ecrit a la main.
      replaces: request.replaces,
    })

    if (!result.success) {
      // `written: false` is safe here. The publisher's own guards refuse BEFORE
      // the commit, and a failed commit is a failed commit — GitHub's contents
      // API is a single request that either lands or does not.
      //
      // A REFUSAL is reported as such, not as an error. Without this the two
      // guards on this side — the page written by hand, the redirected URL —
      // came back as plain failures, the scheduler put the row back in the queue
      // and refused it again fifteen minutes later, for ever. A slug the site
      // already uses will still be in use at the next tick: it needs a human,
      // not a retry.
      return {
        ok: false,
        ...(result.refusal
          ? { refusal: { kind: result.refusal, message: result.error ?? '' } }
          : { error: result.error }),
        written: false,
        live: false,
        discoverable: false,
        notes: [],
      }
    }

    // No branch means the commit went straight to the branch the host deploys.
    // With a branch, only a successful promotion makes it reachable.
    const live = !branch || result.promotion?.promoted === true

    const notes: string[] = []
    if (!live) {
      notes.push(
        `Commitee sur « ${branch} » mais pas en ligne : ` +
          (result.promotion?.reason ?? 'la branche n a pas ete fusionnee vers la production')
      )
    }
    if (result.mode === 'secours') {
      notes.push('Page nue : le depot n a fourni ni charpente commune ni layout enveloppant')
    }

    return {
      ok: true,
      written: true,
      live,
      discoverable: result.sitemapUpdated === true,
      pageUrl: result.pageUrl,
      artifactUrl: result.fileUrl,
      remoteId: result.commitSha,
      mode: result.mode,
      notes,
    }
  },
}
