// ─────────────────────────────────────────────────────────────────────────────
// Dashboard-specific layout pieces
//
// This file used to carry local copies of StatTile, HeroFigure, Meter, EmptyPanel
// and TileGrid, written while components/ui.tsx was being rewritten in parallel.
// They have been deleted: the shared StatTile / HeroFigure / Meter / EmptyState
// are the ones every other view uses, and two implementations of a stat tile is
// exactly the debt this wave was meant to pay off.
//
// `SourceNote` and `MagnitudeBar` have since made the same trip: both were
// promoted verbatim into components/ui.tsx, because /sites/[id]/existing and the
// publication screens need the very same "where does this figure come from" line
// and the very same in-table bar. They are re-exported here rather than deleted
// so the two tabs keep one import for their layout pieces — the implementation
// exists once, in the design system.
//
// What is genuinely left is what the design system does NOT provide and only the
// dashboard needs: a titled panel wrapper over the shared `.panel` classes.
// ─────────────────────────────────────────────────────────────────────────────

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export { MagnitudeBar, SourceNote } from '@/components/ui'

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
