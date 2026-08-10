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

import type { GenerationStatus, PageType } from '@/lib/types'

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
   */
  refusal_kind: string | null
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
