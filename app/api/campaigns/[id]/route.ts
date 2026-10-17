import { NextRequest, NextResponse } from 'next/server'
import { countInFlightGenerations, deleteCampaign, getCampaignByIdSafe, updateCampaign } from '@/lib/db'
import { AI_MODEL_OPTIONS, isAnthropicModel, resolveAnthropicModel } from '@/lib/ai/provider'
import type { Campaign, PageType, PublishStatus, ScheduleFrequency } from '@/lib/types'

/**
 * The campaign is serialised as-is, so it is read WITHOUT the site credentials.
 * `getCampaignById()` — the credentialed read used by the run and publish paths
 * — would put `wp_app_password` and `github_token` straight into this body.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const campaign = await getCampaignByIdSafe(id)
    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }
    return NextResponse.json({ campaign })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}

// ─── Vocabulary of a patch ───────────────────────────────────────────────────

const SCHEDULE_FREQUENCIES: ScheduleFrequency[] = ['manual', 'daily', 'every_2_days', 'every_3_days', 'weekly', 'biweekly', 'monthly', 'custom']
const PAGE_TYPES: PageType[] = ['pillar', 'child', 'local_pack', 'alternative', 'comparative']
const PUBLISH_STATUSES: PublishStatus[] = ['publish', 'draft', 'pending']

/**
 * Duplicated from app/api/analysis-runs/[id]/plan/route.ts, which keeps its
 * copy private. The two must agree: a campaign whose frequency is edited here
 * must land on the same `frequency_hours` the plan would have given it, or the
 * scheduler treats « weekly » differently depending on which screen set it.
 */
const FREQUENCY_TO_HOURS: Record<ScheduleFrequency, number> = {
  manual: 0,
  daily: 24,
  every_2_days: 48,
  every_3_days: 72,
  weekly: 168,
  biweekly: 336,
  monthly: 720,
  custom: 0,
}

/**
 * Short names the selector offers, plus the canonical Anthropic ids they
 * resolve to — a campaign already storing `claude-sonnet-5` must be able to
 * save its form without being told its own model is invalid.
 */
const ACCEPTED_MODELS = new Set<string>([
  ...AI_MODEL_OPTIONS.map((option) => option.value),
  ...AI_MODEL_OPTIONS.map((option) => option.value).filter(isAnthropicModel).map(resolveAnthropicModel),
])

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

// ─── Coercions ───────────────────────────────────────────────────────────────

/**
 * The form sends a textarea for keywords and communes; the API sends arrays.
 * Both become one clean list: split on newlines and commas, trimmed, without
 * blanks, each entry once.
 */
function toList(value: unknown): string[] | null {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]/) : null
  if (!raw || raw.some((entry) => typeof entry !== 'string')) return null
  return Array.from(new Set(raw.map((entry: string) => entry.trim()).filter(Boolean)))
}

function toInteger(value: unknown, min: number, max = Number.POSITIVE_INFINITY): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}

function invalid(field: string, detail?: string) {
  return NextResponse.json({ error: `Champ invalide : ${field}${detail ? ` — ${detail}` : ''}` }, { status: 400 })
}

// ─── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const payload = await req.json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
    }

    const existing = await getCampaignByIdSafe(id)
    if (!existing) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    const values: Partial<Campaign> = {}
    const has = (field: string) => field in payload

    for (const field of ['business_name', 'business_type', 'department'] as const) {
      if (!has(field)) continue
      if (typeof payload[field] !== 'string' || !payload[field].trim()) return invalid(field, 'texte requis')
      values[field] = payload[field].trim()
    }

    if (has('keywords')) {
      const keywords = toList(payload.keywords)
      if (!keywords) return invalid('keywords')
      values.keywords = keywords
    }

    if (has('communes')) {
      const communes = toList(payload.communes)
      if (!communes) return invalid('communes')
      // Same floor as the creation: a campaign with no territory would plan
      // nothing and the scheduler would report a silent, empty cycle.
      if (communes.length === 0) {
        return NextResponse.json({ error: 'Au moins une commune ou une zone valide est requise.' }, { status: 400 })
      }
      values.communes = communes
    }

    if (has('page_types')) {
      const pageTypes = toList(payload.page_types)
      if (!pageTypes || pageTypes.length === 0) return invalid('page_types', 'au moins un type de page')
      const unknown = pageTypes.find((type) => !PAGE_TYPES.includes(type as PageType))
      if (unknown) return invalid('page_types', `« ${unknown} » n'est pas un type de page`)
      values.page_types = pageTypes as PageType[]
    }

    if (has('schedule_frequency')) {
      if (!SCHEDULE_FREQUENCIES.includes(payload.schedule_frequency)) return invalid('schedule_frequency')
      values.schedule_frequency = payload.schedule_frequency
    }

    if (has('schedule_days')) {
      if (!Array.isArray(payload.schedule_days)) return invalid('schedule_days')
      const days = payload.schedule_days.map((day: unknown) => toInteger(day, 0, 6))
      if (days.includes(null)) return invalid('schedule_days', 'jours de 0 (dimanche) à 6')
      values.schedule_days = Array.from(new Set(days as number[])).sort((a, b) => a - b)
    }

    if (has('schedule_time')) {
      if (typeof payload.schedule_time !== 'string' || !TIME_PATTERN.test(payload.schedule_time)) {
        return invalid('schedule_time', 'format HH:MM')
      }
      values.schedule_time = payload.schedule_time
    }

    if (has('ai_model')) {
      if (typeof payload.ai_model !== 'string' || !ACCEPTED_MODELS.has(payload.ai_model)) return invalid('ai_model')
      values.ai_model = payload.ai_model
    }

    if (has('target_length')) {
      const length = toInteger(payload.target_length, 300)
      if (length === null) return invalid('target_length', 'entier ≥ 300')
      values.target_length = length
    }

    if (has('publish_status')) {
      if (!PUBLISH_STATUSES.includes(payload.publish_status)) return invalid('publish_status')
      values.publish_status = payload.publish_status
    }

    for (const field of ['auto_publish', 'is_active', 'cycle_auto_renew', 'enable_external_links', 'enable_images'] as const) {
      if (!has(field)) continue
      if (typeof payload[field] !== 'boolean') return invalid(field, 'booléen attendu')
      values[field] = payload[field]
    }

    if (has('cycle_duration_days')) {
      const days = toInteger(payload.cycle_duration_days, 7, 90)
      if (days === null) return invalid('cycle_duration_days', 'entre 7 et 90 jours')
      values.cycle_duration_days = days
    }

    if (has('external_link_count')) {
      const count = toInteger(payload.external_link_count, 0, 10)
      if (count === null) return invalid('external_link_count', 'entre 0 et 10')
      values.external_link_count = count
    }

    if (has('image_per_page')) {
      const count = toInteger(payload.image_per_page, 0, 10)
      if (count === null) return invalid('image_per_page', 'entre 0 et 10')
      values.image_per_page = count
    }

    if (has('frequency_hours')) {
      const hours = toInteger(payload.frequency_hours, 0)
      if (hours === null) return invalid('frequency_hours', 'entier ≥ 0')
      values.frequency_hours = hours
    }

    // A new frequency carries its own hours, unless the caller set them
    // explicitly (« custom » is exactly that case). Without this, switching
    // « daily » to « weekly » would leave the 24 h cadence in place and the
    // scheduler would keep running daily under a label that says otherwise.
    if (values.schedule_frequency && values.schedule_frequency !== existing.schedule_frequency && !has('frequency_hours')) {
      values.frequency_hours = FREQUENCY_TO_HOURS[values.schedule_frequency]
    }

    if (Object.keys(values).length > 0) {
      await updateCampaign(id, values)
    }

    // Re-read rather than echo the merge: the row carries trigger-set columns
    // (`updated_at`) and the embedded site this handler did not touch.
    const campaign = await getCampaignByIdSafe(id)
    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    return NextResponse.json({ success: true, campaign })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params

    const existing = await getCampaignByIdSafe(id)
    if (!existing) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    // Same refusal as the site: a worker or a publisher half-way through this
    // campaign would finish against a row that no longer exists.
    if ((await countInFlightGenerations({ campaign_id: id })) > 0) {
      return NextResponse.json(
        { error: 'Une publication ou une génération est en cours sur cette campagne — réessayez dans quelques minutes.' },
        { status: 409 }
      )
    }

    const deleted = await deleteCampaign(id)
    if (!deleted) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deleted })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
