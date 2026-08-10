// ─────────────────────────────────────────────────────────────────────────────
// Manual publication of a stored generation
// POST /api/publish/generation — push a page the engine already produced
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS
//
// The deferred publishing job (lib/scheduler/cron) only ever picks up rows whose
// campaign has `auto_publish = true` — see the `campaigns!inner` join in
// `listPendingPublishGenerations()`. Everything generated under a manual
// campaign therefore sits in `generated` forever, finished and paid for, with no
// way in the product to push it. This route is that way.
//
// It re-reads the page from `generations.page_payload` rather than rebuilding it
// from the scalar columns: those cannot carry the JSON-LD blocks, the FAQ or the
// internal links, so a page rebuilt from them ships stripped of all three.

import { NextRequest, NextResponse } from 'next/server'
import { getSiteById, updateGeneration } from '@/lib/db'
import { publishPage } from '@/lib/publishing/publish'
import { markGenerationRejected, runPrePublishGate } from '@/lib/pipeline'
import { claimGenerationForPublishing } from '@/lib/scheduler/editorial'
import { createServiceClient } from '@/lib/supabase'
import type { GeneratedPage } from '@/lib/ai/openai'
import type { PageType, PublishStatus } from '@/lib/types'

interface GenerationRow {
  id: string
  status: string
  site_id: string | null
  page_type: string | null
  page_payload: GeneratedPage | null
  published_page_id: number | null
  campaign: { publish_status: PublishStatus | null; target_length: number | null } | null
  site: { url: string } | null
}

export async function POST(req: NextRequest) {
  // Set once the row has been moved to `publishing`. Nothing reads that status
  // back, so an unexpected throw below must hand the row to `generated` rather
  // than leave a finished page in a state no job will ever pick up again.
  let claimedId: string | null = null

  try {
    const body = await req.json().catch(() => ({}))
    const generationId = typeof body.generationId === 'string' ? body.generationId : ''
    // Take over a page the engine refused. Lifts ONLY the destination guards —
    // occupancy, redirect — and never the quality gate, which is a different
    // question and not the operator's to overrule.
    const force = body.force === true

    if (!generationId) {
      return NextResponse.json({ error: 'generationId est requis' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('generations')
      .select(
        'id,status,site_id,page_type,page_payload,published_page_id,' +
          'campaign:campaigns(publish_status,target_length),site:sites(url)'
      )
      .eq('id', generationId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    const generation = data as GenerationRow | null

    if (!generation) {
      return NextResponse.json({ error: 'Génération introuvable' }, { status: 404 })
    }

    const siteId = generation.site_id
    const storedPage = generation.page_payload

    if (!siteId) {
      return NextResponse.json(
        { error: "Cette génération n'est rattachée à aucun site : rien à publier." },
        { status: 422 }
      )
    }
    if (!storedPage) {
      return NextResponse.json(
        {
          error:
            'Page indisponible : cette génération est antérieure au stockage du payload complet '
            + '(migration 006). La republier reviendrait à publier une page sans schéma, sans FAQ '
            + 'et sans maillage interne.',
        },
        { status: 422 }
      )
    }

    // Compare-and-swap, exactly like the deferred job: a status read once cannot
    // protect anything, and a second push to WordPress creates a second page
    // rather than failing.
    // A refused row sits in `failed`, which no job reads and the publication
    // screen does not list. Letting the operator claim it from there is the only
    // way out; without it a slug collision parked a finished page for good.
    const claimed = await claimGenerationForPublishing(generationId, ['generated', 'failed'])
    if (claimed) claimedId = generationId
    if (!claimed) {
      return NextResponse.json(
        {
          error:
            `Publication impossible depuis le statut « ${generation.status} ». `
            + 'Seule une page en « generated » ou refusee attend une publication.',
        },
        { status: 409 }
      )
    }

    const pageType = (generation.page_type as PageType) ?? 'child'

    // Last gate before an HTTP push. Fails open, and loudly: the row is already
    // claimed in `publishing`, so letting the gate's own crash strand it there
    // would lose a finished page — a worse outcome than publishing one that was
    // not re-checked.
    const gate = await runPrePublishGate({
      page: storedPage,
      generationId,
      pageType,
      siteId,
      siteUrl: generation.site?.url ?? '',
      campaign: generation.campaign
        ? { target_length: generation.campaign.target_length ?? 0 }
        : null,
    }).catch((error) => {
      console.error('[POST /api/publish/generation] gate en échec — publication non revérifiée', error)
      return null
    })

    if (gate && !gate.publishable) {
      const outcome = await markGenerationRejected(generationId, gate.reasons).catch(async (error) => {
        console.error('[POST /api/publish/generation] rejet non enregistré', error)
        // The claim left the row in `publishing`, a status nothing reads back.
        // Handing it to `generated` keeps it visible and re-checkable instead of
        // stranding a finished page in a status no job will ever pick up.
        await updateGeneration(generationId, {
          status: 'generated',
          error_message: gate.reasons.join(' | ').slice(0, 2000),
        }).catch(() => null)
        return null
      })

      claimedId = null
      return NextResponse.json(
        {
          error: 'Page refusée par le contrôle qualité — elle n’a pas été publiée.',
          rejected: { reasons: gate.reasons, status: outcome?.status ?? 'rejected' },
        },
        { status: 422 }
      )
    }

    // Called directly, not proxied over HTTP.
    //
    // The proxy cost two things. It sent `gateAlreadyRan` through a JSON body,
    // so any caller of /api/publish could switch the quality gate off with a
    // boolean — on the very route whose header comment claims the gate now runs
    // everywhere. And it read the 422 back as a flat failure, throwing away
    // `written`: a page WordPress had already created was requeued, and the next
    // tick made another one.
    const site = await getSiteById(siteId)
    if (!site) {
      claimedId = null
      await updateGeneration(generationId, { status: 'generated', error_message: 'Site introuvable' }).catch(() => null)
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }

    const { outcome, record } = await publishPage({
      site,
      page: gate?.page ?? storedPage,
      pageType,
      intent: (generation.campaign?.publish_status ?? 'draft') === 'publish' ? 'publie' : 'brouillon',
      generationId,
      knownRemoteId: generation.published_page_id ?? undefined,
      force,
      // The gate ran a few lines above, on this exact page. Running it twice
      // doubles the cost and can disagree with itself on a borderline article.
      gateAlreadyRan: true,
    })

    claimedId = null

    if (!outcome.ok) {
      // Back to `generated` ONLY when nothing reached the site. When the content
      // is already there, `publishPage` has recorded the row and requeuing would
      // create a second page — a WordPress create is not idempotent.
      if (!outcome.written) {
        await updateGeneration(generationId, {
          status: 'generated',
          error_message: (outcome.refusal?.message ?? outcome.error ?? 'Erreur de publication').slice(0, 2000),
        }).catch(() => null)
      } else {
        console.error(
          '[POST /api/publish/generation] page ecrite mais la suite a echoue — PAS de nouvelle tentative',
          { generationId, pageUrl: outcome.pageUrl }
        )
      }

      return NextResponse.json(
        {
          error: outcome.refusal?.message ?? outcome.error ?? 'Erreur de publication',
          refusal: outcome.refusal?.kind,
          written: outcome.written,
        },
        { status: 422 }
      )
    }

    return NextResponse.json({
      success: true,
      pageUrl: outcome.pageUrl,
      pageId: outcome.remoteId,
      mode: outcome.mode,
      live: outcome.live,
      indexed: record?.indexed ?? false,
      notes: [...outcome.notes, ...(record?.problems ?? [])],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[POST /api/publish/generation]', message)

    if (claimedId) {
      await updateGeneration(claimedId, { status: 'generated', error_message: message.slice(0, 2000) }).catch(() => null)
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
