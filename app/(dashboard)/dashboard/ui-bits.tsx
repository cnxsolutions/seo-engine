// ─────────────────────────────────────────────────────────────────────────────
// Dashboard-specific layout pieces
//
// This file used to carry local copies of StatTile, HeroFigure, Meter, EmptyPanel
// and TileGrid, written while components/ui.tsx was being rewritten in parallel.
// They have been deleted: the shared StatTile / HeroFigure / Meter / EmptyState
// are the ones every other view uses, and two implementations of a stat tile is
// exactly the debt this wave was meant to pay off.
//
// What is left is what the design system does NOT provide and only the dashboard
// needs: a titled panel wrapper over the shared `.panel` classes, the provenance
// line each tab opens with, and the in-table magnitude bar.
// ─────────────────────────────────────────────────────────────────────────────

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// ─── Panel ───────────────────────────────────────────────────────────────────

export function Panel({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
}: {
  title: string
  subtitle?: string
  icon?: LucideIcon
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel">
      <header className="panel__header">
        <div style={{ minWidth: 0 }}>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {Icon && <Icon size={15} color="var(--ink-faint)" strokeWidth={2} />}
            {title}
          </h3>
          {subtitle && <p className="meta" style={{ marginTop: 'var(--space-1)' }}>{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  )
}

// ─── Provenance ──────────────────────────────────────────────────────────────

/**
 * Every tab states where its figures come from and over what period.
 * A metric whose origin is unknown is worth nothing.
 */
export function SourceNote({ source, period, note }: { source: string; period: string; note?: ReactNode }) {
  return (
    <p
      className="meta"
      style={{
        margin: `0 0 var(--space-5)`,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-1) var(--space-3)',
      }}
    >
      <span>
        <strong style={{ color: 'var(--ink-secondary)', fontWeight: 600 }}>Source</strong> {source}
      </span>
      <span aria-hidden>·</span>
      <span>
        <strong style={{ color: 'var(--ink-secondary)', fontWeight: 600 }}>Période</strong> {period}
      </span>
      {note && (
        <>
          <span aria-hidden>·</span>
          <span>{note}</span>
        </>
      )}
    </p>
  )
}

// ─── Magnitude bar (inside tables) ───────────────────────────────────────────

/**
 * A bar that reads a value already printed beside it — never the only encoding,
 * and never a second colour: one series slot for the whole column, because the
 * bar length already carries the comparison.
 */
export function MagnitudeBar({ value, max }: { value: number; max: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ height: 6, width: '100%', background: 'var(--surface-inset)', borderRadius: '0 3px 3px 0' }}
    >
      <div
        style={{
          height: '100%',
          width: `${max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0}%`,
          background: 'var(--series-1)',
          borderRadius: '0 3px 3px 0',
        }}
      />
    </div>
  )
}
