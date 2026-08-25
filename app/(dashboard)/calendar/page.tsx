'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, Store,
} from 'lucide-react'
import { Button, EmptyState, PageHeader, StatusBadge, formatDay } from '@/components/ui'
import { Modal, Tabs } from '@/components/charts'
import { PAGE_TYPE_LABELS, type Campaign, type CalendarSlot } from '@/lib/types'
// Les sept angles en français, écrits UNE fois pour tout le produit. Leur foyer
// définitif est components/ui.tsx, aux côtés de PAGE_TYPE_LABELS ; ce fichier-là
// n'appartient pas au chantier des posts, et recopier sept libellés ici est
// exactement la façon dont les cinq PAGE_TYPE_LABELS divergents du dépôt sont
// nés. Les deux modules sont des composants clients : l'import ne traverse
// aucune frontière serveur.
import { angleLabel } from '../publish/GbpTab'

// ─── View model ──────────────────────────────────────────────
//
// `CalendarSlot` is the shape GET /api/calendar returns, declared once in
// lib/types and shared with that route. This page used to redeclare it with
// `status` widened to `string`, because the scheduler was still adding a
// `failed` member to the slot union; the member landed, so the widening is gone
// and a status the API can return is now a status this page can name.
//
// The runtime fallbacks below stay: they guard against a value the DATABASE
// holds and the union does not (an old row, a hand-edited status), which is a
// different problem from a type that was merely out of date.

// ─── Status & type dictionaries ──────────────────────────────

interface StatusMeta {
  label: string
  /** Token, not a hex: the same six colours drive the badge and the month grid. */
  color: string
  badge: string
}

/**
 * Kept local rather than delegated to `StatusBadge`: the shared dictionary has
 * no `planned` nor `skipped` (it would print the raw English status), and the
 * month grid needs the matching colour for the chip rule anyway.
 */
const STATUS_META: Record<string, StatusMeta> = {
  planned: { label: 'Planifié', color: 'var(--ink-faint)', badge: 'badge badge-muted' },
  generating: { label: 'Génération…', color: 'var(--status-warning)', badge: 'badge badge-warning' },
  generated: { label: 'Généré', color: 'var(--accent)', badge: 'badge badge-info' },
  published: { label: 'Publié', color: 'var(--status-good)', badge: 'badge badge-success' },
  failed: { label: 'Échec', color: 'var(--status-critical)', badge: 'badge badge-danger' },
  skipped: { label: 'Ignoré', color: 'var(--ink-faint)', badge: 'badge badge-muted' },
}

function statusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status || 'Inconnu', color: 'var(--ink-faint)', badge: 'badge badge-muted' }
}

/** A tint that works whether the colour is a token or a literal. */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

/**
 * The shared dictionary (lib/types.ts) with the fallback this table needs: a row
 * whose `page_type` the database holds and the union does not still prints
 * something, and an empty one prints the em dash rather than a blank cell.
 */
function pageTypeLabel(pageType: string | null): string {
  return PAGE_TYPE_LABELS[pageType as keyof typeof PAGE_TYPE_LABELS] || pageType || '—'
}

// ─── Deux natures d'artefact, un seul calendrier ─────────────
//
// UN SEUL CALENDRIER, un discriminant. Un second dupliquerait la grille, le
// report de créneau et le budget de tentatives pour la seule raison que
// l'artefact produit n'est pas une page.
//
// FORME DÉCLARÉE DES DEUX CÔTÉS DU FIL. `CalendarSlot` (lib/types.ts) ne porte
// pas de champ `gbp_post` et ce fichier-là n'appartient pas au présent lot ;
// app/api/calendar/route.ts déclare donc la même forme de son côté, exactement
// comme cette page redéclare déjà l'enveloppe `{ slots }` de la réponse. Les
// deux déclarations disparaîtront ensemble le jour où lib/types portera le
// champ.

/** Le post produit par un créneau `artifact_kind = 'gbp_post'`. */
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

type Slot = CalendarSlot & { gbp_post?: CalendarSlotGbpPost | null }

function isGbpPost(slot: Slot): boolean {
  return slot.artifact_kind === 'gbp_post'
}

/**
 * Ce que le créneau produit, nommé.
 *
 * `page_type` est NULL sur un créneau de post PAR CONTRAINTE
 * (`editorial_calendar_page_type_check`) : ce n'est pas une donnée manquante,
 * c'est une donnée sans objet. Y afficher le tiret cadratin dirait « on a perdu
 * quelque chose » là où il n'y a jamais rien eu à perdre — c'est le libellé qui
 * change de nature, pas la valeur qui manque.
 */
function artifactLabel(slot: Slot): string {
  if (!isGbpPost(slot)) return pageTypeLabel(slot.page_type)
  const angle = slot.gbp_post?.angle
  return angle ? angleLabel(angle) : 'Post fiche'
}

/**
 * Le titre d'un créneau.
 *
 * Un post de fiche n'a PAS de requête cible — `target_keyword` est NULL par
 * contrainte — et y afficher celle d'à côté, ou une chaîne vide, mentirait sur
 * ce que le créneau va produire.
 */
function slotTitle(slot: Slot): string {
  if (isGbpPost(slot)) {
    const angle = slot.gbp_post?.angle
    return angle ? `Post de fiche — ${angleLabel(angle)}` : 'Post de fiche'
  }
  return slot.target_keyword || 'Sans requête cible'
}

// ─── Slot diagnostics ────────────────────────────────────────

/**
 * The slot carries its own message once it has one; otherwise fall back to the
 * artefact that failed — the generation for a page, the post for a listing post.
 */
function slotError(slot: Slot): string | null {
  const own = slot.error_message?.trim()
  if (own) return own
  if (isGbpPost(slot)) return slot.gbp_post?.error_message?.trim() || null
  return slot.generation?.error_message?.trim() || null
}

/**
 * Le titre du bloc de message.
 *
 * Un créneau de post encore `planned` qui porte un message n'a pas échoué : il a
 * été REPORTÉ, parce que tous les angles étaient en cooldown ou qu'aucune page
 * n'était disponible à annoncer. `lib/gbp/posts/run.ts` écrit le motif verbatim
 * dans `error_message` — la colonne existe déjà, et une spécification
 * d'interface ne crée pas de schéma. L'appeler « Dernière erreur » ferait
 * chercher une panne là où le moteur a simplement refusé de se répéter.
 */
function slotErrorTitle(slot: Slot): string {
  return isGbpPost(slot) && slot.status === 'planned' ? 'Créneau reporté' : 'Dernière erreur'
}

function hasFailed(slot: Slot): boolean {
  return slot.status === 'failed' || slot.generation?.status === 'failed'
}

/**
 * A slot still 'generating' after its scheduled day is stuck, not running.
 *
 * The scheduler now has a reaper (STALE_GENERATING_MINUTES in
 * lib/scheduler/cron.ts) that resolves such slots within ~30 minutes, so this is
 * a safety net rather than the primary signal — it catches the window before the
 * reaper runs, and the case where the reaper itself cannot run. Kept because a
 * slot that looks eternally in progress is the one failure mode nobody notices.
 */
function isStalled(slot: Slot, today: string): boolean {
  return slot.status === 'generating' && Boolean(today) && slot.scheduled_date < today
}

/** Deliberately ignores a leftover error message: a generation keeps its last error even after a successful retry. */
function needsAttention(slot: Slot, today: string): boolean {
  return hasFailed(slot) || isStalled(slot, today)
}

// ─── Date helpers ────────────────────────────────────────────

interface MonthCursor {
  year: number
  month: number
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function daysInMonth({ year, month }: MonthCursor): number {
  return new Date(year, month + 1, 0).getDate()
}

/** Monday-first offset of the 1st of the month. */
function leadingBlanks({ year, month }: MonthCursor): number {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

function monthLabel({ year, month }: MonthCursor): string {
  return new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

// ─── Page ────────────────────────────────────────────────────

export default function CalendarPage() {
  const [slots, setSlots] = useState<Slot[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [siteId, setSiteId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [artifactFilter, setArtifactFilter] = useState('')
  const [view, setView] = useState<'month' | 'list'>('month')
  const [selected, setSelected] = useState<Slot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Resolved on mount only: reading the clock during render would make the
  // server HTML and the browser disagree whenever their timezones differ.
  const [cursor, setCursor] = useState<MonthCursor | null>(null)
  const [today, setToday] = useState('')

  useEffect(() => {
    const now = new Date()
    setCursor({ year: now.getFullYear(), month: now.getMonth() })
    setToday(dateKey(now.getFullYear(), now.getMonth(), now.getDate()))
  }, [])

  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => r.json())
      .then((d) => setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []))
      .catch(() => setCampaigns([]))
  }, [])

  const load = useCallback(async () => {
    if (!cursor) return
    setLoading(true)
    setError(null)

    const from = dateKey(cursor.year, cursor.month, 1)
    const to = dateKey(cursor.year, cursor.month, daysInMonth(cursor))
    const params = new URLSearchParams({ from, to })
    if (campaignId) params.set('campaign_id', campaignId)

    try {
      const res = await fetch(`/api/calendar?${params}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      setSlots(Array.isArray(data.slots) ? data.slots : [])
    } catch (err) {
      setSlots([])
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [cursor, campaignId])

  useEffect(() => {
    load()
  }, [load])

  // ── Scope ──
  const sites = useMemo(() => {
    const map = new Map<string, string>()
    for (const campaign of campaigns) {
      if (campaign.site_id) map.set(campaign.site_id, campaign.site?.name ?? 'Site sans nom')
    }
    return [...map].map(([id, name]) => ({ id, name }))
  }, [campaigns])

  const visibleCampaigns = useMemo(
    () => (siteId ? campaigns.filter((campaign) => campaign.site_id === siteId) : campaigns),
    [campaigns, siteId]
  )

  // Filtering the site is a client-side narrowing of what the month already
  // returned: the route scopes by campaign, and a slot always carries its own.
  const scopedSlots = useMemo(
    () => (siteId ? slots.filter((slot) => slot.campaign?.site_id === siteId) : slots),
    [slots, siteId]
  )

  const statusOptions = useMemo(
    // Unknown statuses coming from the database stay filterable.
    () => Array.from(new Set([...Object.keys(STATUS_META), ...scopedSlots.map((s) => s.status)])),
    [scopedSlots]
  )

  // La nature de l'artefact, comptée sur la portée déjà filtrée par site et par
  // campagne : le libellé du filtre annonce ce qu'il va montrer.
  const artifactCounts = useMemo(() => {
    let posts = 0
    for (const slot of scopedSlots) if (isGbpPost(slot)) posts += 1
    return { post: posts, page: scopedSlots.length - posts }
  }, [scopedSlots])

  const visibleSlots = useMemo(
    () =>
      scopedSlots.filter(
        (s) =>
          (!statusFilter || s.status === statusFilter) &&
          (!artifactFilter || (artifactFilter === 'gbp_post') === isGbpPost(s))
      ),
    [scopedSlots, statusFilter, artifactFilter]
  )

  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const slot of visibleSlots) {
      const bucket = map.get(slot.scheduled_date)
      if (bucket) bucket.push(slot)
      else map.set(slot.scheduled_date, [slot])
    }
    return map
  }, [visibleSlots])

  const counts = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const slot of scopedSlots) acc[slot.status] = (acc[slot.status] ?? 0) + 1
    return acc
  }, [scopedSlots])

  const problemSlots = useMemo(
    () => scopedSlots.filter((s) => needsAttention(s, today)),
    [scopedSlots, today]
  )

  const goToMonth = (delta: number) =>
    setCursor((prev) => {
      if (!prev) return prev
      const next = new Date(prev.year, prev.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })

  const goToToday = () => {
    const now = new Date()
    setCursor({ year: now.getFullYear(), month: now.getMonth() })
  }

  const changeSite = (nextSiteId: string) => {
    setSiteId(nextSiteId)
    // A campaign from another site would silently empty the view.
    if (nextSiteId && campaignId) {
      const stillVisible = campaigns.some((c) => c.id === campaignId && c.site_id === nextSiteId)
      if (!stillVisible) setCampaignId('')
    }
  }

  return (
    <div>
      <PageHeader
        icon={CalendarDays}
        badge="Suivi"
        title="Calendrier éditorial"
        subtitle="Ce que le moteur doit publier, ce qu’il a publié, et ce qui a échoué."
        meta={
          scopedSlots.length > 0
            ? <span>{scopedSlots.length} créneau{scopedSlots.length > 1 ? 'x' : ''} ce mois-ci</span>
            : undefined
        }
        action={{ label: 'Planifier un cycle', href: '/strategy', icon: CalendarDays }}
      />

      <div className="toolbar">
        {sites.length > 1 && (
          <select
            value={siteId}
            onChange={(e) => changeSite(e.target.value)}
            className="input"
            style={{ maxWidth: 220 }}
            aria-label="Site"
          >
            <option value="">Tous les sites</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        )}

        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className="input"
          style={{ maxWidth: 240 }}
          aria-label="Campagne"
        >
          <option value="">Toutes les campagnes</option>
          {visibleCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input"
          style={{ maxWidth: 180 }}
          aria-label="Statut"
        >
          <option value="">Tous les statuts</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>{statusMeta(status).label}</option>
          ))}
        </select>

        {/* Un QUATRIÈME select, et non un second contrôle segmenté : la barre en
            porte déjà un pour la vue Mois/Liste, et deux segmentés côte à côte ne
            se distinguent pas — rien ne dirait lequel est la vue et lequel est le
            filtre. Même forme, même place, même grammaire que les trois filtres
            voisins. */}
        <select
          value={artifactFilter}
          onChange={(e) => setArtifactFilter(e.target.value)}
          className="input"
          style={{ maxWidth: 200 }}
          aria-label="Nature du créneau"
        >
          <option value="">Tous les types</option>
          <option value="page">Pages ({artifactCounts.page})</option>
          <option value="gbp_post">Posts fiche ({artifactCounts.post})</option>
        </select>

        <Button variant="ghost" size="sm" icon={RefreshCw} loading={loading} onClick={load}>
          Actualiser
        </Button>

        <span className="toolbar__spacer" />

        <Tabs
          variant="segmented"
          ariaLabel="Vue du calendrier"
          value={view}
          onChange={(id) => setView(id === 'list' ? 'list' : 'month')}
          items={[{ id: 'month', label: 'Mois' }, { id: 'list', label: 'Liste' }]}
        />

        <button type="button" onClick={() => goToMonth(-1)} className="btn-icon" aria-label="Mois précédent">
          <ChevronLeft size={15} />
        </button>
        <span style={{ fontWeight: 600, minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>
          {cursor ? monthLabel(cursor) : '—'}
        </span>
        <button type="button" onClick={() => goToMonth(1)} className="btn-icon" aria-label="Mois suivant">
          <ChevronRight size={15} />
        </button>
        <Button variant="ghost" size="sm" onClick={goToToday}>Aujourd’hui</Button>
      </div>

      {/* Status recap for the visible month */}
      {scopedSlots.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          {Object.entries(counts).map(([status, count]) => {
            const meta = statusMeta(status)
            return (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
                className={meta.badge}
                aria-pressed={statusFilter === status}
                style={{
                  border: statusFilter === status ? `1px solid ${meta.color}` : '1px solid transparent',
                  cursor: 'pointer',
                }}
              >
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color }} />
                {count} {meta.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Failures first: the whole point of the page */}
      {problemSlots.length > 0 && (
        <div
          className="glass-card"
          style={{
            borderLeft: '3px solid var(--status-critical)', marginBottom: 'var(--space-4)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          }}
        >
          <AlertTriangle size={16} color="var(--status-critical)" style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 'var(--fs-sm)' }}>
            <strong>{problemSlots.length}</strong> créneau{problemSlots.length > 1 ? 'x' : ''} en échec ou bloqué
            {problemSlots.length > 1 ? 's' : ''} ce mois-ci. Un créneau en échec ne repart jamais tout seul.
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setView('list'); setSelected(problemSlots[0]) }}
          >
            Voir le détail
          </Button>
        </div>
      )}

      {error && (
        <EmptyState
          variant="error"
          title="Calendrier indisponible"
          description={error}
          action={{ label: 'Réessayer', onClick: () => load() }}
        />
      )}

      {!error && loading && (
        <div className="glass-card" style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-12)' }}>
          <Loader2 size={22} className="animate-spin" color="var(--ink-faint)" />
          <span className="meta">Chargement des créneaux…</span>
        </div>
      )}

      {!error && !loading && visibleSlots.length === 0 && (
        artifactFilter === 'gbp_post' ? (
          // Les posts de fiche sont un opt-in strict, campagne par campagne :
          // « aucun créneau » est ici le comportement NORMAL et non une panne.
          <EmptyState
            icon={Store}
            variant="no-data"
            title="Aucun créneau de post sur ce mois"
            description="Les posts de fiche s’activent campagne par campagne, avec leur propre cadence. Tant qu’aucune campagne ne les autorise, le calendrier ne planifie que des pages."
            action={{ label: 'Piloter les posts', href: '/publish' }}
          />
        ) : (
        <EmptyState
          icon={CalendarDays}
          variant="no-data"
          title="Aucun créneau sur cette période"
          description={
            statusFilter || campaignId || siteId
              ? 'Aucun créneau ne correspond aux filtres pour ce mois. Changez de mois ou retirez les filtres.'
              : 'Le calendrier se remplit quand un cycle est confirmé depuis la page Stratégie. Rien n’est planifié pour ce mois.'
          }
          action={{ label: 'Planifier un cycle', href: '/strategy' }}
        />
        )
      )}

      {!error && !loading && visibleSlots.length > 0 && view === 'month' && cursor && (
        <MonthGrid cursor={cursor} today={today} slotsByDate={slotsByDate} onSelect={setSelected} />
      )}

      {!error && !loading && visibleSlots.length > 0 && view === 'list' && (
        <SlotTable slots={visibleSlots} today={today} onSelect={setSelected} />
      )}

      {selected && (
        <SlotDetail
          slot={selected}
          today={today}
          onClose={() => setSelected(null)}
          onRescheduled={() => { setSelected(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Month grid ──────────────────────────────────────────────

function MonthGrid({
  cursor,
  today,
  slotsByDate,
  onSelect,
}: {
  cursor: MonthCursor
  today: string
  slotsByDate: Map<string, Slot[]>
  onSelect: (slot: Slot) => void
}) {
  const totalDays = daysInMonth(cursor)
  const blanks = leadingBlanks(cursor)

  return (
    <div className="panel">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            style={{
              padding: 'var(--space-2)', textAlign: 'center',
              fontSize: 'var(--fs-2xs)', fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: 'var(--ls-eyebrow)', color: 'var(--ink-muted)',
              background: 'var(--surface-inset)', borderBottom: '1px solid var(--line)',
            }}
          >
            {day}
          </div>
        ))}

        {Array.from({ length: blanks }).map((_, i) => (
          <div key={`blank-${i}`} style={{ minHeight: 98, borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)' }} />
        ))}

        {Array.from({ length: totalDays }).map((_, i) => {
          const day = i + 1
          const key = dateKey(cursor.year, cursor.month, day)
          const daySlots = slotsByDate.get(key) ?? []
          const isToday = key === today

          return (
            <div
              key={key}
              style={{
                padding: 'var(--space-1)', minHeight: 98,
                borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)',
                background: isToday ? 'var(--accent-wash)' : undefined,
              }}
            >
              <div
                style={{
                  fontSize: 'var(--fs-2xs)', fontWeight: isToday ? 700 : 500,
                  color: isToday ? 'var(--accent-text)' : 'var(--ink-muted)',
                  marginBottom: 3, paddingLeft: 2,
                }}
              >
                {day}
              </div>
              {daySlots.slice(0, 3).map((slot) => (
                <SlotChip key={slot.id} slot={slot} today={today} onSelect={onSelect} />
              ))}
              {daySlots.length > 3 && (
                <button type="button" onClick={() => onSelect(daySlots[3])} className="btn-link" style={{ padding: '2px 4px' }}>
                  +{daySlots.length - 3} autre{daySlots.length - 3 > 1 ? 's' : ''}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SlotChip({ slot, today, onSelect }: { slot: Slot; today: string; onSelect: (slot: Slot) => void }) {
  const meta = statusMeta(slot.status)
  const attention = needsAttention(slot, today)
  // A stalled slot keeps its own label but borrows the failure colour: in a
  // month grid the colour is the only thing read at a glance.
  const color = attention ? statusMeta('failed').color : meta.color
  const post = isGbpPost(slot)

  return (
    <button
      type="button"
      onClick={() => onSelect(slot)}
      title={`${post ? 'Post fiche — ' : ''}${slotTitle(slot)}${slot.target_city ? ` — ${slot.target_city}` : ''} · ${meta.label}${isStalled(slot, today) ? ' (bloqué)' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 3, width: '100%',
        padding: '2px 5px', marginBottom: 2, borderRadius: 'var(--radius-xs)',
        background: tint(color, 12), border: 'none', borderLeft: `2px solid ${color}`,
        fontSize: 'var(--fs-2xs)', color: 'var(--ink-primary)', textAlign: 'left', cursor: 'pointer',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >
      {attention && <AlertTriangle size={9} color={color} style={{ flexShrink: 0 }} />}
      {/* La COULEUR reste le STATUT dans cette grille : elle est déjà prise, et
          une septième teinte pour la nature ne se lirait plus. Le type
          d'artefact passe donc par un GLYPHE, doublé du mot « Post fiche » dans
          l'infobulle et dans le titre de la ligne — deux encodages, dont un non
          chromatique. */}
      {post && <Store size={9} color="var(--ink-secondary)" style={{ flexShrink: 0 }} aria-hidden="true" />}
      <span className="truncate">{slotTitle(slot)}</span>
    </button>
  )
}

// ─── List view ───────────────────────────────────────────────

function SlotTable({ slots, today, onSelect }: { slots: Slot[]; today: string; onSelect: (slot: Slot) => void }) {
  const sorted = [...slots].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))

  return (
    <div className="panel scroll-x">
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Requête cible</th>
            <th>Type</th>
            <th>Campagne</th>
            <th>Statut</th>
            <th>Résultat</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((slot) => {
            const meta = statusMeta(slot.status)
            const attention = needsAttention(slot, today)
            const message = attention ? slotError(slot) : null
            const stalled = isStalled(slot, today)

            return (
              <tr key={slot.id} onClick={() => onSelect(slot)} style={{ cursor: 'pointer' }}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDay(slot.scheduled_date)}</td>
                <td>
                  <div className="cell-strong" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    {isGbpPost(slot) && (
                      <span className="chip"><Store size={10} aria-hidden="true" /> Post fiche</span>
                    )}
                    <span>{slotTitle(slot)}</span>
                  </div>
                  {slot.target_city && <div className="meta">{slot.target_city}</div>}
                  {message && (
                    <div
                      className="truncate"
                      style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical-text)', marginTop: 2, maxWidth: 380 }}
                      title={message}
                    >
                      {message}
                    </div>
                  )}
                </td>
                <td>{artifactLabel(slot)}</td>
                <td>{slot.campaign?.name ?? '—'}</td>
                <td>
                  <span className={meta.badge}>{meta.label}</span>
                  {stalled && <span className="badge badge-danger" style={{ marginLeft: 4 }}>Bloqué</span>}
                </td>
                <td>
                  <SlotOutcome slot={slot} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Ce que le créneau a produit, quelle que soit sa nature.
 *
 * Un créneau de post ne pointe vers aucune page publiée : son résultat est sur
 * la fiche Google, et `remote_search_url` est le seul lien que Google en donne.
 * Sans cette branche, la colonne resterait vide sur tous les posts — c'est-à-dire
 * qu'elle dirait « rien n'a été produit » d'un post en ligne.
 */
function SlotOutcome({ slot }: { slot: Slot }) {
  if (isGbpPost(slot)) {
    const post = slot.gbp_post
    if (post?.remote_search_url) {
      return (
        <a
          href={post.remote_search_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="btn-link"
        >
          Voir sur la fiche <ExternalLink size={12} />
        </a>
      )
    }
    return (
      <span className="meta truncate" style={{ display: 'inline-block', maxWidth: 280 }} title={post?.summary}>
        {post?.summary ?? 'Pas encore composé'}
      </span>
    )
  }

  if (slot.generation?.published_url) {
    return (
      <a
        href={slot.generation.published_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="btn-link"
      >
        Voir la page <ExternalLink size={12} />
      </a>
    )
  }

  return <span className="meta">{slot.generation?.title ?? '—'}</span>
}

// ─── Detail modal ────────────────────────────────────────────

function SlotDetail({
  slot, today, onClose, onRescheduled,
}: {
  slot: Slot
  today: string
  onClose: () => void
  onRescheduled: () => void
}) {
  const meta = statusMeta(slot.status)
  const message = slotError(slot)
  const stalled = isStalled(slot, today)
  const postponed = isGbpPost(slot) && slot.status === 'planned'

  const [date, setDate] = useState(slot.scheduled_date)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /**
   * Only a `planned` slot may move. The scheduler owns `status` and
   * `attempt_count` through compare-and-swap claims, and PATCH /api/calendar/:id
   * refuses everything but the four editorial fields — rescheduling a slot that
   * is already running would fight the runner that holds it.
   */
  const reschedule = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/calendar/${slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_date: date }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(data.error || `Erreur ${res.status}`)
        return
      }
      onRescheduled()
    } catch {
      setSaveError('Impossible de joindre le serveur')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={slotTitle(slot)}
      subtitle={
        // `pageTypeLabel` n'est PAS appelée sur un créneau de post : `page_type`
        // y est NULL par contrainte et la fonction rendrait « — », c'est-à-dire
        // « donnée manquante » pour une donnée sans objet. C'est le libellé
        // d'angle qui prend la place.
        <>
          {formatDay(slot.scheduled_date)}
          {slot.target_city ? ` · ${slot.target_city}` : ''} · {artifactLabel(slot)}
        </>
      }
      onClose={onClose}
      size="md"
    >
      <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className={meta.badge}>{meta.label}</span>
          {stalled && <span className="badge badge-danger">Bloqué</span>}
          {slot.attempt_count ? <span className="chip">{slot.attempt_count} tentative{slot.attempt_count > 1 ? 's' : ''}</span> : null}
        </div>

        <DetailRow label="Campagne" value={slot.campaign?.name ?? '—'} />
        <DetailRow label="Site" value={slot.campaign?.site?.name ?? '—'} />
        <DetailRow label="Nature" value={isGbpPost(slot) ? 'Post de fiche Google' : 'Page du site'} />

        {isGbpPost(slot) ? <GbpSlotDetail post={slot.gbp_post ?? null} /> : <PageSlotDetail slot={slot} />}

        {/* Un report n'est pas une panne : le moteur a refusé de se répéter, ce
            qui est le comportement attendu. Il garde donc le ton de
            l'avertissement, jamais celui de l'échec — peindre en rouge une
            décision correcte apprend à l'opérateur à ignorer le rouge. */}
        {message && (
          <div className="inset" style={{ borderLeft: `3px solid ${postponed ? 'var(--status-warning)' : 'var(--status-critical)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: postponed ? 'var(--status-warning-text)' : 'var(--status-critical-text)', fontWeight: 600, fontSize: 'var(--fs-xs)', marginBottom: 4 }}>
              <AlertTriangle size={13} /> {slotErrorTitle(slot)}
            </div>
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {message}
            </p>
          </div>
        )}

        {stalled && !message && (
          <p className="meta" style={{ margin: 0 }}>
            Le créneau est resté en génération après sa date prévue : la tâche planifiée n’est jamais revenue.
            Le planificateur le reprend automatiquement au bout de 30 minutes — s’il est toujours dans cet état
            après le prochain quart d’heure, c’est que le planificateur lui-même ne tourne pas.
          </p>
        )}

        {slot.status === 'planned' && (
          <div className="inset" style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600 }}>Reporter ce créneau</span>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="date"
                className="input"
                style={{ maxWidth: 180 }}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Nouvelle date de publication"
              />
              <Button
                size="sm"
                icon={CheckCircle2}
                loading={saving}
                disabled={!date || date === slot.scheduled_date}
                onClick={reschedule}
              >
                Enregistrer
              </Button>
            </div>
            {saveError && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical-text)' }}>{saveError}</span>}
            <span className="meta">
              Seul un créneau encore planifié peut être déplacé : au-delà, le planificateur détient déjà le créneau.
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Le détail d'un créneau de page : la génération, son état, sa mise en ligne. */
function PageSlotDetail({ slot }: { slot: Slot }) {
  return (
    <>
      <DetailRow
        label="Page générée"
        value={slot.generation?.title ?? (slot.generation_id ? 'Sans titre' : 'Pas encore générée')}
      />
      {slot.generation?.status && (
        <DetailRow label="État de la génération" value={<StatusBadge status={slot.generation.status} />} />
      )}
      {slot.generation?.published_url && (
        <a
          href={slot.generation.published_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary"
          style={{ justifySelf: 'start' }}
        >
          Ouvrir la page publiée <ExternalLink size={13} />
        </a>
      )}
    </>
  )
}

/**
 * Le détail d'un créneau de post.
 *
 * `post === null` couvre deux cas que rien ne permet de distinguer d'ici, et
 * c'est pourquoi la phrase ne tranche pas : le créneau n'a pas encore tourné, ou
 * la migration 019 n'est pas appliquée et la jointure n'a rien pu lire. Les deux
 * mènent à la même conduite — il n'y a pas de post à montrer — et affirmer l'un
 * des deux serait inventer.
 */
function GbpSlotDetail({ post }: { post: CalendarSlotGbpPost | null }) {
  if (!post) {
    return <DetailRow label="Post" value="Pas encore composé" />
  }

  return (
    <>
      <DetailRow label="Angle" value={angleLabel(post.angle)} />
      <DetailRow
        label="État du post"
        value={<StatusBadge status={post.status} label={post.status === 'incertain' ? 'État inconnu' : undefined} />}
      />
      {/* L'état que Google rapporte, quand il en rapporte un. 'PROCESSING' et
          'REJECTED' sont précisément ce qu'un opérateur doit voir : un post
          enregistré n'est pas encore un post affiché. */}
      {post.remote_state && <DetailRow label="État sur Google" value={post.remote_state} />}
      <div className="inset">
        <span className="field-label">Texte du post</span>
        <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {post.summary}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {post.remote_search_url && (
          <a href={post.remote_search_url} target="_blank" rel="noopener noreferrer" className="btn-secondary">
            Ouvrir le post sur la fiche <ExternalLink size={13} />
          </a>
        )}
        <a href="/publish" className="btn-ghost">Piloter les posts</a>
      </div>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
      <span className="meta" style={{ flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}
