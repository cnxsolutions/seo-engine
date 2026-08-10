// ─────────────────────────────────────────────────────────────────────────────
// Generations API — the production feed of the engine
// GET  /api/generate — what the engine really produced (table `generations`)
// POST /api/generate — run one campaign now, and record what it produced
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS ROUTE EXISTS
//
// Steps 4 and 5 of the workflow (/generate, /publish) used to read
// `GET /api/articles`, which serves rows of `articles` — a table nothing in this
// codebase has ever written to. Both pages then read `data.generations`, a key
// that response never contained, and fell back to `data.articles`: an empty
// array of an incompatible shape (no `city`, no `ai_model`, no `page_type`, and
// a `status` union that shares not one member with `GenerationStatus`). The two
// pages were empty by construction, whatever the engine had produced.
//
// Everything the engine produces lives in `generations`. This is the only route
// that serves it, and BOTH pages read it: /generate shows the whole production,
// /publish filters the same feed down to the publication queue. One query, one
// shape, no chance of the two views disagreeing about what exists.

import { NextRequest, NextResponse } from 'next/server'
import { getCampaignById } from '@/lib/db'
import { runCampaignNow } from '@/lib/scheduler/cron'
import { createServiceClient } from '@/lib/supabase'
import type { GenerationStatus, PageType } from '@/lib/types'
import type { GenerationCounts } from './feed-types'

// ─── Projection ──────────────────────────────────────────────────────────────

/**
 * Every column the two views render, and nothing more.
 *
 * `content` (the full HTML page) and `page_payload` (the same page plus its
 * JSON-LD blocks) are deliberately absent: a feed of fifty pages would weigh
 * megabytes and neither view displays a single character of them.
 *
 * `error_message` is the one that matters — it is where the quality gate writes
 * why a page was refused, and the only way to find out why something never
 * shipped.
 */
// `tokens_used` is absent for a different reason: no code path in this
// repository has ever written it, so it is NULL on every row.
const FEED_COLUMNS =
  'id,campaign_id,site_id,city,slug,title,focus_keyword,page_type,status,' +
  'published_url,published_at,publish_mode,publish_live,publish_notes,refusal_kind,ai_model,error_message,created_at,updated_at'

/** Sites embedded here carry no `wp_app_password` and no `github_token`. */
const SITE_EMBED = 'site:sites(id,name,type,url)'

/** `auto_publish` explains why a finished page is still waiting. */
const CAMPAIGN_EMBED = 'campaign:campaigns(id,name,auto_publish,publish_status)'

const ALL_STATUSES: GenerationStatus[] = [
  'pending',
  'generating',
  'generated',
  'publishing',
  'published',
  'failed',
  'rejected',
]

const PAGE_TYPES: PageType[] = ['pillar', 'child', 'alternative', 'comparative', 'local_pack']

const DEFAULT_LIMIT = 60
const MAX_LIMIT = 200

// ─── GET /api/generate ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const siteId = searchParams.get('site_id') || undefined
    const statuses = parseStatuses(searchParams.get('status'))
    const limit = parseLimit(searchParams.get('limit'))

    const supabase = createServiceClient()

    // Filters first, then order and limit: `.limit()` returns a transform
    // builder, which no longer accepts `.eq()`.
    let filtered = supabase
      .from('generations')
      .select(`${FEED_COLUMNS}, ${SITE_EMBED}, ${CAMPAIGN_EMBED}`)

    if (siteId) filtered = filtered.eq('site_id', siteId)
    if (statuses.length > 0) filtered = filtered.in('status', statuses)

    // The counts must describe the whole scope, not the page of rows returned:
    // a founder filtering on "rejetées" still needs to know that 12 pages are
    // waiting to be published.
    //
    // One `select('status')` and a tally in JS looked cheaper and was WRONG:
    // PostgREST answers at most 1000 rows and says nothing about the rest, so
    // every counter here would have frozen the day a site passed a thousand
    // generations — silently, with no error and no visible break. Seven
    // `head: true` counts are seven round-trips that cannot lie; they run in
    // parallel and transfer no rows at all.
    const tallyQueries = ALL_STATUSES.map((status) => {
      let query = supabase.from('generations').select('id', { count: 'exact', head: true }).eq('status', status)
      if (siteId) query = query.eq('site_id', siteId)
      return query
    })

    const [feed, sites, campaigns, ...tallies] = await Promise.all([
      filtered.order('created_at', { ascending: false }).limit(limit),
      supabase.from('sites').select('id,name,type,url').order('name'),
      supabase
        .from('campaigns')
        .select('id,name,site_id,auto_publish,is_active,ai_model')
        .order('created_at', { ascending: false }),
      ...tallyQueries,
    ])

    if (feed.error) throw new Error(feed.error.message)
    if (sites.error) throw new Error(sites.error.message)
    if (campaigns.error) throw new Error(campaigns.error.message)

    const counts = tallyStatuses(tallies)

    return NextResponse.json({
      generations: feed.data ?? [],
      counts,
      sites: sites.data ?? [],
      campaigns: campaigns.data ?? [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[GET /api/generate]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── POST /api/generate ──────────────────────────────────────────────────────

/**
 * Run one campaign, now.
 *
 * WHAT THIS REPLACED. This handler used to call `generateLocalSeoPage()` and
 * return the page as JSON without writing a single row: the tokens were spent,
 * the page existed for the duration of one HTTP response, and nothing in the
 * product ever saw it again. The /generate page called it with an empty body,
 * so it also answered 400 on every click — a button that could only fail, in
 * front of an endpoint that could only lose its output.
 *
 * `runCampaignNow()` is the real entry point: it opens the `generations` row,
 * builds the RAG context, runs the post-generation pipeline (length, internal
 * links, quality gate), parks a refused page in `rejected` WITH its reasons, and
 * publishes inline when the campaign says so. The response therefore describes
 * an outcome that survives the request.
 *
 * It is deliberately synchronous, like `POST /api/campaigns/[id]/run`: a full
 * page takes minutes, and this is a single-operator tool where the caller is a
 * human who just clicked and is watching.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const campaignId = typeof body.campaign_id === 'string' ? body.campaign_id : ''

    if (!campaignId) {
      return NextResponse.json(
        { error: 'campaign_id est requis : une génération appartient toujours à une campagne.' },
        { status: 400 }
      )
    }

    const pageType = body.page_type
    if (pageType && !PAGE_TYPES.includes(pageType as PageType)) {
      return NextResponse.json(
        { error: `page_type inconnu : ${pageType}. Valeurs acceptées : ${PAGE_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Credentialed on purpose: `runCampaignNow` publishes inline from
    // `campaign.site` when the campaign auto-publishes.
    const campaign = await getCampaignById(campaignId)
    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    const result = await runCampaignNow(campaign, {
      targetCity: typeof body.city === 'string' && body.city.trim() ? body.city.trim() : undefined,
      pageType: pageType as PageType | undefined,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[POST /api/generate]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseStatuses(raw: string | null): GenerationStatus[] {
  if (!raw) return []
  const wanted = raw.split(',').map((value) => value.trim())
  // Unknown members are dropped rather than rejected: a stale bookmark must not
  // turn into a 400 in front of a list that would otherwise render fine.
  return ALL_STATUSES.filter((status) => wanted.includes(status))
}

function parseLimit(raw: string | null): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(Math.round(parsed), MAX_LIMIT)
}

/**
 * One exact count per status, in the order of `ALL_STATUSES`.
 *
 * A failed count throws rather than being read as zero: "we could not count"
 * and "there are none" are different facts, and printing the second for the
 * first is how a dashboard starts lying.
 */
function tallyStatuses(
  results: Array<{ count: number | null; error: { message: string } | null }>
): GenerationCounts {
  const counts = {
    pending: 0,
    generating: 0,
    generated: 0,
    publishing: 0,
    published: 0,
    failed: 0,
    rejected: 0,
    total: 0,
  } as GenerationCounts

  ALL_STATUSES.forEach((status, index) => {
    const result = results[index]
    if (result?.error) throw new Error(`comptage ${status}: ${result.error.message}`)
    const value = result?.count ?? 0
    counts[status] = value
    counts.total += value
  })

  return counts
}
