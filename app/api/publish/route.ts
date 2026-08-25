// ─────────────────────────────────────────────────────────────────────────────
// Publish API
// POST /api/publish — push one page to its site
// ─────────────────────────────────────────────────────────────────────────────
//
// The single HTTP publishing path. `POST /api/publish/wordpress` proxies here,
// and `POST /api/publish/generation` calls it after re-reading a stored page and
// re-running the quality gate.
//
// Everything this route used to do by hand — pick a connector, decide what
// "published" means, stamp a date, submit to the indexing APIs — now lives in
// `lib/publishing`. Two things changed as a result, and both were defects:
//
//  - the quality gate runs on this path. It never did. A page pushed from the
//    interface skipped every check the scheduler applies.
//  - a site whose type is neither `nextjs` nor `wordpress` is refused by name.
//    It used to fall through to WordPress with empty credentials.

import { NextRequest, NextResponse } from 'next/server'
import { createGeneration, getSiteById } from '@/lib/db'
import { publishPage } from '@/lib/publishing/publish'
import type { GeneratedPage } from '@/lib/ai/openai'
import type { PageType } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { page, siteId, publishStatus = 'draft', generationId, pageType, force, knownRemoteId } =
      await req.json()

    if (!page || !siteId) {
      return NextResponse.json({ error: 'page et siteId sont requis' }, { status: 400 })
    }

    const site = await getSiteById(siteId)
    if (!site) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }

    const currentPage = page as GeneratedPage

    // An untracked push still gets a row: without one there is no publication
    // date, no vector index entry and no way to find the page again.
    const trackedGeneration = generationId
      ? null
      : await createGeneration({
          campaign_id: undefined,
          site_id: site.id,
          city: currentPage.focusKeyword,
          slug: currentPage.slug,
          title: currentPage.title,
          meta_description: currentPage.metaDescription,
          focus_keyword: currentPage.focusKeyword,
          content: currentPage.htmlContent,
          status: 'publishing',
          ai_model: 'manual',
        })

    const { outcome, gate, record } = await publishPage({
      site,
      page: currentPage,
      pageType: pageType as PageType | undefined,
      intent: publishStatus === 'publish' ? 'publie' : 'brouillon',
      generationId: generationId || trackedGeneration?.id,
      force: force === true,
      knownRemoteId: typeof knownRemoteId === 'number' ? knownRemoteId : undefined,
      // NOT settable from the request body. It used to be, so a caller could
      // switch off the quality gate with a boolean — on the route whose whole
      // purpose was to start applying it. The one caller that legitimately
      // gates beforehand (/api/publish/generation) now calls publishPage
      // directly instead of coming through here.
      gateAlreadyRan: false,
    })

    if (!outcome.ok) {
      return NextResponse.json(
        {
          error: outcome.refusal?.message ?? outcome.error ?? 'Erreur de publication',
          refusal: outcome.refusal?.kind,
          // A page refused by the gate deserves its reasons, not just a verdict.
          reasons: gate?.publishable === false ? gate.reasons : undefined,
          // Load-bearing for the caller: true means the content is at the other
          // end despite the failure, so do not push again.
          written: outcome.written,
        },
        { status: 422 }
      )
    }

    return NextResponse.json({
      success: true,
      pageUrl: outcome.pageUrl,
      pageId: outcome.remoteId,
      artifactUrl: outcome.artifactUrl,
      mode: outcome.mode,
      live: outcome.live,
      discoverable: outcome.discoverable,
      indexed: record?.indexed ?? false,
      notes: [...outcome.notes, ...(record?.problems ?? [])],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
