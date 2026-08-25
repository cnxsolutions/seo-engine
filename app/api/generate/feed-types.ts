// ─────────────────────────────────────────────────────────────────────────────
// Shape of GET /api/generate
// ─────────────────────────────────────────────────────────────────────────────
//
// Declared once and imported by the route that produces it and by the two views
// that render it — app/(dashboard)/generate and app/(dashboard)/publish — the
// same way `CalendarSlot` is shared between the calendar route and its page.
//
// Both views used to redeclare their own `Generation` interface and both had
// drifted from the table: one typed `status` as a four-member union missing
// `publishing`, `published` and `rejected`, so a page refused by the quality
// gate could not even be named, let alone displayed.
//
// A plain module rather than exports on `route.ts`: the views are client
// components, and this file pulls in nothing but types.

import type { GenerationIntent, GenerationStatus, PageType, RefusalKind } from '@/lib/types'
import type { DuplicateVerdict } from '@/src/core/domain/existing/verdict'

export type GenerationCounts = Record<GenerationStatus, number> & { total: number }

export interface FeedSite {
  id: string
  name: string
  type: string
  url: string
}

export interface FeedCampaign {
  id: string
  name: string
  site_id: string | null
  auto_publish: boolean
  is_active: boolean
  ai_model: string
}

export interface FeedGeneration {
  id: string
  campaign_id: string | null
  site_id: string | null
  city: string
  slug: string | null
  title: string | null
  focus_keyword: string | null
  page_type: PageType | null
  status: GenerationStatus
  published_url: string | null
  published_at: string | null
  /**
   * What actually happened at publication time.
   *
   * `status: 'published'` covered a commit on an undeployed branch, a WordPress
   * draft and a page a visitor can read, all with the same badge. These three
   * columns are what let the list tell them apart.
   */
  publish_mode: string | null
  publish_live: boolean | null
  publish_notes: string[] | null
  /**
   * Why the engine declined, when it declined on purpose.
   *
   * NULL on a breakage. A breakage retries itself on the next tick; a refusal
   * waits for a decision, and the interface has to tell them apart to offer one.
   *
   * Typed by the union rather than `string` since migration 018 gave the column
   * a CHECK: the views index `REFUSAL_TITLES` with this value, and a free string
   * let them render `undefined` for anything the table did not name. The route
   * drops what the union does not cover — that CHECK is NOT VALID, so the rows
   * already in the table were never verified against it.
   */
  refusal_kind: RefusalKind | null
  /**
   * What this row does to what is already online (migration 018).
   *
   * Not nullable, and honest even on a row written before 018 landed: the route
   * defaults it to 'create' in its projection. An `undefined` here would make
   * both views branch on a value the contract swears always exists.
   */
  intent: GenerationIntent
  /**
   * The normalised path this row updates. Never NULL once `intent` is 'refresh',
   * enforced by `generations_refresh_needs_target`.
   */
  refresh_target_path: string | null
  /** The generation that produced the page being refreshed, when the engine wrote it. */
  refresh_target_generation_id: string | null
  /**
   * What the page was weighed against, and what was concluded.
   *
   * NULL means the check never RAN — not "nothing was found". A verdict is
   * written even when nothing blocked, and that trace is the only thing telling
   * those two apart; reading a duplicate rate off rows that only exist when they
   * blocked would report 100 % every time.
   */
  duplicate_verdict: DuplicateVerdict | null
  ai_model: string
  /** Why the quality gate refused the page, when it did. */
  error_message: string | null
  created_at: string
  updated_at: string
  site: FeedSite | null
  campaign: { id: string; name: string; auto_publish: boolean; publish_status: string } | null
}

export interface GenerationFeedResponse {
  generations: FeedGeneration[]
  counts: GenerationCounts
  sites: FeedSite[]
  campaigns: FeedCampaign[]
}

/**
 * A refusal, phrased for the operator: `kind` gives the title, `message` the
 * detail, `targetUrl` the page it collided with when there is one.
 *
 * The sentences themselves live in lib/publishing/refusal-labels.ts, with
 * `describeRefusal` that builds this. They cannot live here: this module is
 * imported by two client components on the promise (line 15) that it pulls in
 * nothing but types, and a runtime export turns an erasable module into a real
 * one.
 */
export interface FeedRefusalNotice {
  kind: RefusalKind
  message: string
  targetUrl?: string
}
