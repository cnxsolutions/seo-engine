'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, X,
} from 'lucide-react'
import { Button, EmptyState, PageHeader, StatusBadge } from '@/components/ui'
import { Tabs } from '@/components/charts'
import type { Campaign, CalendarSlot } from '@/lib/types'

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

const PAGE_TYPE_LABELS: Record<string, string> = {
  pillar: 'Pilier',
  child: 'Fille',
  alternative: 'Alternative',
  comparative: 'Comparatif',
  local_pack: 'Local Pack',
}

function pageTypeLabel(pageType: string): string {
  return PAGE_TYPE_LABELS[pageType] || pageType || '—'
}

// ─── Slot diagnostics ────────────────────────────────────────

/** The slot carries its own message once it has one; otherwise fall back to the generation that failed. */
function slotError(slot: CalendarSlot): string | null {
  const own = slot.error_message?.trim()
  if (own) return own
  return slot.generation?.error_message?.trim() || null
}

function hasFailed(slot: CalendarSlot): boolean {
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
function isStalled(slot: CalendarSlot, today: string): boolean {
  return slot.status === 'generating' && Boolean(today) && slot.scheduled_date < today
}

/** Deliberately ignores a leftover error message: a generation keeps its last error even after a successful retry. */
function needsAttention(slot: CalendarSlot, today: string): boolean {
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

function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return date
  return new Date(year, month - 1, day).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

/** Mirrors the `--z-modal` token: csstype rejects a custom property here. */
const MODAL_Z = 100

// ─── Page ────────────────────────────────────────────────────

export default function CalendarPage() {
  const [slots, setSlots] = useState<CalendarSlot[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [siteId, setSiteId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [view, setView] = useState<'month' | 'list'>('month')
  const [selected, setSelected] = useState<CalendarSlot | null>(null)
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

  const visibleSlots = useMemo(
    () => (statusFilter ? scopedSlots.filter((s) => s.status === statusFilter) : scopedSlots),
    [scopedSlots, statusFilter]
  )

  const slotsByDate = useMemo(() => {
    const map = new Map<string, CalendarSlot[]>()
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
  slotsByDate: Map<string, CalendarSlot[]>
  onSelect: (slot: CalendarSlot) => void
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

function SlotChip({ slot, today, onSelect }: { slot: CalendarSlot; today: string; onSelect: (slot: CalendarSlot) => void }) {
  const meta = statusMeta(slot.status)
  const attention = needsAttention(slot, today)
  // A stalled slot keeps its own label but borrows the failure colour: in a
  // month grid the colour is the only thing read at a glance.
  const color = attention ? statusMeta('failed').color : meta.color

  return (
    <button
      type="button"
      onClick={() => onSelect(slot)}
      title={`${slot.target_keyword}${slot.target_city ? ` — ${slot.target_city}` : ''} · ${meta.label}${isStalled(slot, today) ? ' (bloqué)' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 3, width: '100%',
        padding: '2px 5px', marginBottom: 2, borderRadius: 'var(--radius-xs)',
        background: tint(color, 12), border: 'none', borderLeft: `2px solid ${color}`,
        fontSize: 'var(--fs-2xs)', color: 'var(--ink-primary)', textAlign: 'left', cursor: 'pointer',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >
      {attention && <AlertTriangle size={9} color={color} style={{ flexShrink: 0 }} />}
      <span className="truncate">{slot.target_keyword}</span>
    </button>
  )
}

// ─── List view ───────────────────────────────────────────────

function SlotTable({ slots, today, onSelect }: { slots: CalendarSlot[]; today: string; onSelect: (slot: CalendarSlot) => void }) {
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
                  <div className="cell-strong">{slot.target_keyword}</div>
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
                <td>{pageTypeLabel(slot.page_type)}</td>
                <td>{slot.campaign?.name ?? '—'}</td>
                <td>
                  <span className={meta.badge}>{meta.label}</span>
                  {stalled && <span className="badge badge-danger" style={{ marginLeft: 4 }}>Bloqué</span>}
                </td>
                <td>
                  {slot.generation?.published_url ? (
                    <a
                      href={slot.generation.published_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="btn-link"
                    >
                      Voir la page <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="meta">{slot.generation?.title ?? '—'}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Detail modal ────────────────────────────────────────────

function SlotDetail({
  slot, today, onClose, onRescheduled,
}: {
  slot: CalendarSlot
  today: string
  onClose: () => void
  onRescheduled: () => void
}) {
  const meta = statusMeta(slot.status)
  const message = slotError(slot)
  const stalled = isStalled(slot, today)

  const [date, setDate] = useState(slot.scheduled_date)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Créneau — ${slot.target_keyword}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: MODAL_Z, padding: 'var(--space-6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--surface-scrim)',
      }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 580, maxHeight: '86vh', overflow: 'auto', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="panel__header">
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title">{slot.target_keyword}</h2>
            <div className="meta">
              {formatDay(slot.scheduled_date)}
              {slot.target_city ? ` · ${slot.target_city}` : ''} · {pageTypeLabel(slot.page_type)}
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fermer">
            <X size={15} />
          </button>
        </div>

        <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className={meta.badge}>{meta.label}</span>
            {stalled && <span className="badge badge-danger">Bloqué</span>}
            {slot.attempt_count ? <span className="chip">{slot.attempt_count} tentative{slot.attempt_count > 1 ? 's' : ''}</span> : null}
          </div>

          <DetailRow label="Campagne" value={slot.campaign?.name ?? '—'} />
          <DetailRow label="Site" value={slot.campaign?.site?.name ?? '—'} />
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

          {message && (
            <div className="inset" style={{ borderLeft: '3px solid var(--status-critical)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--status-critical-text)', fontWeight: 600, fontSize: 'var(--fs-xs)', marginBottom: 4 }}>
                <AlertTriangle size={13} /> Dernière erreur
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
      </div>
    </div>
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
