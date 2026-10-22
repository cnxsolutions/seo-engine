// ─────────────────────────────────────────────────────────────────────────────
// Geographic scope of a campaign
// SEO Engine - Local (named communes) or national (no town at all)
// ─────────────────────────────────────────────────────────────────────────────
//
// The engine was written for local businesses: every campaign had communes,
// every page a town, and an empty list fell back to the department, then to
// « Aube ». A site that sells nationwide — Flowyne, a booking app — had no way
// to say so. Its operator typed « tous » in the communes field; the engine read
// a town called « tous », appended it to every planned address
// (`/application-reservation-barber-tous`) and planned local pack pages titled
// « … près de moi » for a business with no premises.
//
// A campaign WITHOUT a real commune is now national, and this module is the
// single place that says so. No database column: `communes` already defaults to
// an empty array and `department` is nullable, so national is simply "no
// commune, no department" — and the markers below let a campaign saved with
// « tous » become national without anyone editing a row.

import type { PageType } from '@/lib/types'

interface ScopedCampaign {
  communes?: readonly string[] | null
  department?: string | null
  page_types?: readonly PageType[] | null
}

/**
 * Words typed in the communes field to mean "everywhere", never a town.
 *
 * Compared without case or accents. « Tours » is a town and is not here.
 */
const NATIONAL_MARKERS = new Set([
  'tous', 'toutes', 'tout', 'partout', 'france', 'national', 'nationale', 'toute la france', 'france entiere',
])

function bare(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
}

export function isNationalMarker(value: string | null | undefined): boolean {
  return NATIONAL_MARKERS.has(bare(value ?? ''))
}

/** The real communes of a campaign: blanks and "everywhere" markers removed. */
export function targetCommunes(communes: readonly string[] | null | undefined): string[] {
  return (communes ?? []).map((commune) => commune.trim()).filter((commune) => commune && !isNationalMarker(commune))
}

/**
 * A campaign without a single real commune sells nationwide: no town in its
 * addresses, titles or prompts, no department, and no local pack page.
 */
export function isNationalCampaign(campaign: ScopedCampaign): boolean {
  return targetCommunes(campaign.communes).length === 0
}

/** The department, which only a local campaign has. */
export function campaignDepartment(campaign: ScopedCampaign): string {
  return isNationalCampaign(campaign) ? '' : (campaign.department ?? '').trim()
}

/**
 * The town a page targets: `''` on a national campaign, whatever the slot,
 * the brief or the model says.
 *
 * On a local campaign, the candidate wins unless it is blank or a marker, and
 * the first commune stands in for it. There is no department or « Aube »
 * fallback any more: a local campaign has a commune by definition, and the
 * fallback was how a campaign with none got pages "in Aube".
 */
export function resolveTargetCity(campaign: ScopedCampaign, candidate?: string | null): string {
  if (isNationalCampaign(campaign)) return ''
  const named = (candidate ?? '').trim()
  if (named && !isNationalMarker(named)) return named
  return targetCommunes(campaign.communes)[0] ?? ''
}

/** What a campaign asks for when it says nothing. */
export const DEFAULT_PAGE_TYPES: readonly PageType[] = ['pillar', 'child']

export type CampaignScope = 'local' | 'national'

/** The choice both campaign forms offer, worded once. */
export const CAMPAIGN_SCOPE_OPTIONS: ReadonlyArray<{ value: CampaignScope; label: string; hint: string }> = [
  { value: 'local', label: 'Locale', hint: 'Des communes précises : chaque page vise une ville.' },
  { value: 'national', label: 'Nationale', hint: 'Toute la France : aucune ville, aucun département, pas de local pack.' },
]

/** A campaign's scope, as the forms show it. */
export function campaignScope(campaign: ScopedCampaign): CampaignScope {
  return isNationalCampaign(campaign) ? 'national' : 'local'
}

/** Page types without local pack, never empty: what a form keeps when a campaign turns national. */
export function withoutLocalPack(types: readonly PageType[], fallback: readonly PageType[] = DEFAULT_PAGE_TYPES): PageType[] {
  const kept = types.filter((type) => type !== 'local_pack')
  return kept.length > 0 ? kept : [...fallback]
}

/**
 * Whether a create or edit request asks for a national campaign.
 *
 * An explicit `scope` decides. Without one — an older client, a script — a list
 * made only of "everywhere" markers means national, as it does for a campaign
 * already stored that way; an empty list means nothing yet, and the route's own
 * default applies.
 */
export function isNationalRequest(scope: unknown, communes: readonly string[] | null | undefined): boolean {
  if (scope === 'national') return true
  if (scope === 'local') return false
  const listed = (communes ?? []).map((commune) => commune.trim()).filter(Boolean)
  return listed.length > 0 && targetCommunes(listed).length === 0
}

/**
 * The page types a campaign can actually produce.
 *
 * A local pack page is the page of a place — zones served, access, opening
 * hours — and a national campaign has none: asked for one anyway, the planner
 * wrote « Application pour prestataires de services près de moi ». It is
 * dropped, never replaced by something the operator did not choose; a campaign
 * left with nothing falls back to the default pair.
 */
export function plannablePageTypes(campaign: ScopedCampaign): PageType[] {
  const requested = campaign.page_types?.length ? [...campaign.page_types] : [...DEFAULT_PAGE_TYPES]
  return isNationalCampaign(campaign) ? withoutLocalPack(requested) : requested
}

/**
 * The page type a run produces, given the type the plan stored.
 *
 * A plan written before the campaign became national may still hold local pack
 * briefs: the run writes them as child pages instead of a page about a place
 * that does not exist. Regenerating the plan is the real fix; this keeps the
 * pages already scheduled from being written wrong in the meantime.
 */
export function runnablePageType(campaign: ScopedCampaign, planned?: PageType | null): PageType {
  const type = planned || plannablePageTypes(campaign)[0]
  return type === 'local_pack' && isNationalCampaign(campaign) ? 'child' : type
}
