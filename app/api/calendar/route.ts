import { NextResponse } from 'next/server'
import { listEditorialSlots } from '@/lib/scheduler/editorial'
import { createServiceClient } from '@/lib/supabase'
import type { CalendarSlot, CalendarSlotGeneration } from '@/lib/types'
// La lecture de « la table n'existe pas encore », écrite une seule fois pour
// tout le canal GBP. Ce module ne dépend de rien — ni next/server, ni Supabase,
// ni React — et le réécrire ici ferait deux détections du même fait, condamnées
// à diverger sur le jour où PostgREST changera de code d'erreur.
import { isMissingGbpTable } from '@/app/api/gbp/posts/feed-types'

// ─── Response shape ──────────────────────────────────────────
//
// `CalendarSlot` lives in lib/types and is shared with the page that renders it
// (app/(dashboard)/calendar/page.tsx). It carries the real slot union, `failed`
// included: this route used to widen `status` to `string` while that member was
// still being added, and the widening has outlived its reason.
//
// Read-only on purpose. A POST used to live here that deleted the campaign's
// planned slots and regenerated a bare calendar — no cycle plan, no briefs, so
// every recreated slot lost the `plan_item_id` the generator reads its brief
// from. Nothing called it, and the only supported way to fill the calendar is
// confirming a cycle plan (PATCH /api/campaigns/:id/plan). Rescheduling a single
// slot goes through PATCH /api/calendar/:id.

/**
 * listEditorialSlots() only joins the campaign, so a slot that has already run
 * arrives without any trace of its outcome. Resolve the generations separately
 * instead of leaving the calendar unable to show published URLs and errors.
 */
async function attachGenerations(slots: CalendarSlot[]): Promise<CalendarSlot[]> {
  const ids = Array.from(new Set(slots.map((s) => s.generation_id).filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return slots

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('generations')
    .select('id, title, slug, status, published_url, error_message, updated_at')
    .in('id', ids)

  if (error) {
    // A missing outcome must not hide the plan itself: serve the slots as-is.
    console.warn('[calendar] generations lookup failed:', error.message)
    return slots
  }

  const byId = new Map<string, CalendarSlotGeneration>(
    (data ?? []).map((row) => [row.id as string, row as CalendarSlotGeneration])
  )
  return slots.map((slot) => ({
    ...slot,
    generation: slot.generation_id ? byId.get(slot.generation_id) ?? null : null,
  }))
}

// ─── Les posts de fiche ──────────────────────────────────────
//
// Un créneau `artifact_kind = 'gbp_post'` n'a ni `page_type`, ni
// `target_keyword`, ni génération : ses trois colonnes éditoriales sont NULL par
// contrainte (migration 019). Sans cette jointure, la ligne du calendrier
// n'aurait donc RIEN à afficher — ni titre, ni type, ni résultat — et un post
// planifié ressemblerait à un créneau vide.
//
// FORME DÉCLARÉE DES DEUX CÔTÉS DU FIL, délibérément. `CalendarSlot` (lib/types)
// ne porte pas de champ `gbp_post` et lib/types.ts n'appartient pas à ce lot ;
// la page redéclare donc la même forme de son côté, exactement comme elle le
// fait déjà pour l'enveloppe `{ slots }` de cette réponse. Le jour où lib/types
// portera ce champ, les deux déclarations disparaissent ensemble.

/** Ce qu'un créneau de post doit montrer, et rien de plus. */
interface CalendarSlotGbpPost {
  id: string
  angle: string | null
  summary: string
  status: string
  remote_search_url: string | null
  remote_state: string | null
  error_message: string | null
  published_at: string | null
}

type CalendarSlotWithPost = CalendarSlot & { gbp_post?: CalendarSlotGbpPost | null }

/**
 * Résout les posts des créneaux qui en désignent un.
 *
 * Une requête séparée plutôt qu'une jointure PostgREST : depuis la migration 019
 * il existe DEUX clefs étrangères entre `gbp_posts` et `editorial_calendar`
 * (`gbp_posts.calendar_slot_id` et `editorial_calendar.gbp_post_id`). PostgREST
 * refuse une jointure ambiguë et répond 300 tant qu'on ne la désambiguë pas —
 * ce qui viderait le calendrier ENTIER pour une colonne d'affichage.
 *
 * Un échec ne fait jamais tomber le plan : la migration 019 peut ne pas être
 * appliquée, et les créneaux de pages n'en dépendent pas.
 */
async function attachGbpPosts(slots: CalendarSlot[]): Promise<CalendarSlotWithPost[]> {
  const ids = Array.from(new Set(slots.map((s) => s.gbp_post_id).filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return slots

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('gbp_posts')
    .select('id, angle, summary, status, remote_search_url, remote_state, error_message, published_at')
    .in('id', ids)

  if (error) {
    // « La table n'existe pas » n'est pas une panne : c'est 019 qui n'a pas été
    // jouée. Le dire nommément dans le journal évite qu'un opérateur cherche un
    // défaut de code, et le calendrier des pages continue de servir.
    console.warn(
      isMissingGbpTable(error)
        ? '[calendar] gbp_posts absente (migration 019 non appliquée) : créneaux de post servis sans leur post'
        : `[calendar] gbp_posts lookup failed: ${error.message}`
    )
    return slots
  }

  const byId = new Map<string, CalendarSlotGbpPost>(
    (data ?? []).map((row) => [row.id as string, row as CalendarSlotGbpPost])
  )
  return slots.map((slot) => ({
    ...slot,
    gbp_post: slot.gbp_post_id ? byId.get(slot.gbp_post_id) ?? null : null,
  }))
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaign_id') || undefined
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined

  try {
    const slots = await listEditorialSlots(campaignId, from, to)
    return NextResponse.json({ slots: await attachGbpPosts(await attachGenerations(slots)) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur serveur' },
      { status: 500 }
    )
  }
}
