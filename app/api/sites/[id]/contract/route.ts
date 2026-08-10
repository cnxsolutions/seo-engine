import { NextRequest, NextResponse } from 'next/server'
import { getSiteById } from '@/lib/db'
import { buildContractFiles } from '@/lib/publishers/contract-source'
import type { RepoProfile } from '@/lib/publishers/nextjs-analyzer'
import { EMPTY_CHROME } from '@/lib/publishers/scaffold'

/**
 * The files the site owner pastes into their own repository.
 *
 * Returned, never committed. The engine writing an adapter into a repository it
 * cannot compile is the exact failure the contract exists to remove — twice, a
 * page it wrote turned out not to build, and the client's CI found out first.
 * A human pastes these, runs their own build, and only then does anything
 * change.
 *
 * Generated from the stored profile, so the component list reflects what the
 * analysis actually read. Re-analyse first if the repository has moved on.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const site = await getSiteById(id)

  if (!site) {
    return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
  }
  if (site.type !== 'nextjs') {
    return NextResponse.json({ error: 'Le contrat de publication ne concerne que les sites Next.js' }, { status: 400 })
  }

  const profile = site.repo_profile as RepoProfile | undefined
  if (!profile) {
    return NextResponse.json(
      { error: 'Dépôt jamais analysé — lance l’analyse avant de générer le contrat' },
      { status: 409 }
    )
  }

  const files = buildContractFiles({
    adapterFolder: `${profile.srcPrefix ?? 'src/'}components/seo-engine`,
    pageFolder: profile.pageFolder,
    srcPrefix: profile.srcPrefix ?? 'src/',
    chrome: profile.chrome ?? EMPTY_CHROME,
    componentProps: profile.componentProps ?? {},
    layoutShell: profile.layoutShell,
  })

  return NextResponse.json({
    files,
    // What the engine already sees, so the page can say whether the paste has
    // landed without asking the operator to re-analyse to find out.
    contract: profile.contract ?? { present: false, reason: null },
    // One line the engine cannot write for them: the spread into their registry.
    manualStep:
      "Ajoute `...GENERATED_ROUTES` dans ROUTES (src/lib/seo/routes.ts) et importe-le depuis './routes.generated'. " +
      'Sans cette ligne, les pages publiées existent mais restent absentes du sitemap.',
  })
}
