'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronRight,
  LayoutDashboard,
  Lock,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { WorkflowState, WorkflowStep, WorkflowStepId } from '@/app/api/workflow/state'

// ─── Navigation model ────────────────────────────────────────────────────────
//
// One entry, one destination. "Campagnes" used to sit under GÉRER and lead to
// /strategy — the very page "3. Stratégie" already opened — so the operator had
// to guess which of the two was the real one. There is now a single entry.
//
// The five steps carry no icon on purpose: a numbered rail reads as a path,
// five more glyphs read as five more links. The tools below keep their icons,
// which is what tells the two groups apart at a glance.

const STEPS: Array<{ id: WorkflowStepId; href: string; label: string }> = [
  { id: 'sites', href: '/sites', label: 'Sites' },
  { id: 'schema', href: '/schema', label: 'Schéma CMS' },
  { id: 'strategy', href: '/strategy', label: 'Stratégie' },
  { id: 'generate', href: '/generate', label: 'Générer' },
  { id: 'publish', href: '/publish', label: 'Publier' },
]

const OVERVIEW = [{ href: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' }]

/**
 * "Analytics" is deliberately absent.
 *
 * `/analytics` is now a 307 to `/dashboard?tab=performance`: the two pages were
 * merged into one page with two tabs. Keeping the entry would have put two menu
 * rows on the SAME page — the very duplication "Campagnes" / "3. Stratégie" was
 * removed for — and the active state would never light up, since the pathname
 * ends up being `/dashboard`. The route file survives for old bookmarks only.
 *
 * `/settings` is absent for a harder reason: the page no longer exists. Every
 * field it pretended to hold lives per-campaign or in an environment variable,
 * so it was deleted; leaving the entry would point the menu at a 404.
 */
const TRACKING = [
  { href: '/calendar', icon: Calendar, label: 'Calendrier' },
]

// ─── Warnings ────────────────────────────────────────────────────────────────

interface StepWarning {
  label: string
  title: string
}

/**
 * A warning is DATA, unlike the "à faire" pill below, which this component
 * derives from `isCurrent`.
 *
 * The sidebar reads `/api/workflow` and nothing else — it has no way to know
 * whether a site's inventory is fresh, and it must never go and find out: the
 * rules live in app/api/workflow/state.ts, pure and testable without Supabase.
 *
 * Read off the payload rather than off `WorkflowStep`, and validated at runtime,
 * because the field is served by a route this file does not own. Until that
 * route sends one, no badge appears; the day it does, nothing here changes.
 *
 * What it must NEVER do is turn into `state: 'blocked'`. A blocked rung renders
 * as a non-clickable `<div aria-disabled="true">`, so a crawl that never ran
 * would stop the product from producing at all — and an unknown is something to
 * signal, not something to forbid.
 */
function warningOf(step: WorkflowStep | undefined): StepWarning | null {
  if (!step || !('warning' in step)) return null

  const raw = step.warning
  if (typeof raw !== 'object' || raw === null) return null

  const { label, title } = raw as { label?: unknown; title?: unknown }
  if (typeof label !== 'string' || !label.trim()) return null

  return { label, title: typeof title === 'string' ? title : label }
}

// ─── Workflow state ──────────────────────────────────────────────────────────

/**
 * Re-read on every navigation, because the layout is not.
 *
 * App Router keeps a shared layout mounted across client navigations, so a
 * state computed server-side up there would still describe the situation as it
 * was when the tab was opened — and the moment the founder reported as broken
 * is exactly the one right after saving a site.
 *
 * `focus` covers the other half: analysing a repository finishes in the
 * background while the operator looks elsewhere.
 */
function useWorkflowState(pathname: string) {
  const [state, setState] = useState<WorkflowState | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    const load = () => {
      fetch('/api/workflow', { cache: 'no-store', signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.steps)) setState(data as WorkflowState)
        })
        // A failed read must never lock the navigation: `state` stays as it was
        // (null on a first load), and every step renders as a plain link.
        .catch(() => undefined)
    }

    load()
    window.addEventListener('focus', load)
    return () => {
      controller.abort()
      window.removeEventListener('focus', load)
    }
    // `pathname` is a trigger, not an input: the effect reads none of it, it
    // just has to run again once the operator has moved.
  }, [pathname])

  return state
}

export function Sidebar() {
  const pathname = usePathname()
  const workflow = useWorkflowState(pathname)

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  const stepOf = (id: WorkflowStepId): WorkflowStep | undefined =>
    workflow?.steps.find((step) => step.id === id)

  const allDone = workflow ? workflow.steps.every((step) => step.state === 'done') : false

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div style={{
          width: 36, height: 36,
          background: 'var(--accent)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Zap size={18} color="var(--accent-on)" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', lineHeight: 1.2, color: 'var(--ink-primary)' }}>SEO Engine</div>
          <div className="meta">AI Content Platform</div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '0.5rem 0', overflowY: 'auto' }}>
        <div style={{ height: 8 }} />
        {OVERVIEW.map((item) => (
          <ToolLink key={item.href} {...item} active={isActive(item.href)} />
        ))}

        <div className="nav-section-label">PARCOURS</div>
        <div style={{ position: 'relative' }}>
          {STEPS.map((step, index) => (
            <StepRow
              key={step.id}
              href={step.href}
              label={step.label}
              number={index + 1}
              step={stepOf(step.id)}
              isCurrent={workflow?.currentStepId === step.id}
              isLast={index === STEPS.length - 1}
              active={isActive(step.href)}
            />
          ))}
        </div>

        <div className="nav-section-label">SUIVI</div>
        {TRACKING.map((item) => (
          <ToolLink key={item.href} {...item} active={isActive(item.href)} />
        ))}
      </nav>

      <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {workflow?.nextAction && <NextActionCard action={workflow.nextAction} />}
        {allDone && <AllDoneCard />}

        <div className="team-badge">
          <div style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)',
            background: 'var(--surface-inset)',
            border: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--ink-secondary)',
          }}>
            SE
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--ink-primary)' }}>Admin</div>
            <div className="meta">Mode local</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function ToolLink({
  href, icon: Icon, label, active,
}: {
  href: string
  icon: LucideIcon
  label: string
  active: boolean
}) {
  return (
    <Link href={href} className={`nav-item ${active ? 'active' : ''}`}>
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
      <span style={{ flex: 1 }}>{label}</span>
      {active && <ChevronRight size={14} style={{ opacity: 0.5 }} />}
    </Link>
  )
}

const ROW_LAYOUT = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.75rem',
  padding: '0.625rem 1.25rem',
  margin: '0.1rem 0.75rem',
  borderRadius: 8,
  fontSize: '0.85rem',
  fontWeight: 500,
  position: 'relative',
} as const

/**
 * One rung of the path.
 *
 * A blocked step is rendered as text rather than a link, and always with the
 * sentence that says what would unblock it. `nav-item` is deliberately not
 * reused there: its hover state would promise a click that never happens.
 */
function StepRow({
  href, label, number, step, isCurrent, isLast, active,
}: {
  href: string
  label: string
  number: number
  /** Undefined while the state is loading, or after a failed read. */
  step?: WorkflowStep
  isCurrent: boolean
  isLast: boolean
  active: boolean
}) {
  const state = step?.state
  const done = state === 'done'
  const blocked = state === 'blocked'
  const note = blocked ? step?.reason : isCurrent ? step?.detail : undefined
  const warning = warningOf(step)

  const body = (
    <>
      <StepBadge number={number} done={done} blocked={blocked} current={isCurrent} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', lineHeight: 1.45 }}>{label}</span>
        {note && (
          <span style={{
            display: 'block',
            marginTop: 2,
            fontSize: 'var(--fs-xs)',
            fontWeight: 500,
            lineHeight: 'var(--lh-snug)',
            color: 'var(--ink-muted)',
          }}>
            {note}
          </span>
        )}
      </span>
      {active && !blocked && <ChevronRight size={14} style={{ opacity: 0.5, marginTop: 3 }} />}
      {/* Same slot as the "à faire" pill, and the two can show together: one
          says where the operator stands, the other what the engine cannot see. */}
      {warning && (
        <span
          title={warning.title}
          style={{
            marginTop: 2,
            padding: '0.1rem 0.4rem',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--status-warning-wash)',
            color: 'var(--status-warning-text)',
            fontSize: 'var(--fs-2xs)',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {warning.label}
        </span>
      )}
      {!active && isCurrent && (
        <span style={{
          marginTop: 2,
          padding: '0.1rem 0.4rem',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--accent-wash)',
          color: 'var(--accent-text)',
          fontSize: 'var(--fs-2xs)',
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}>
          à faire
        </span>
      )}
    </>
  )

  return (
    <div style={{ position: 'relative' }}>
      {!isLast && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 41,
            top: 32,
            bottom: -12,
            width: 2,
            borderRadius: 1,
            background: done ? 'var(--status-good)' : 'var(--line)',
            opacity: done ? 0.45 : 1,
          }}
        />
      )}

      {blocked ? (
        <div
          aria-disabled="true"
          title={step?.reason}
          style={{ ...ROW_LAYOUT, color: 'var(--ink-muted)', cursor: 'not-allowed' }}
        >
          {body}
        </div>
      ) : (
        <Link
          href={href}
          className={`nav-item ${active ? 'active' : ''}`}
          style={{ alignItems: 'flex-start', position: 'relative' }}
        >
          {body}
        </Link>
      )}
    </div>
  )
}

function StepBadge({
  number, done, blocked, current,
}: {
  number: number
  done: boolean
  blocked: boolean
  current: boolean
}) {
  const palette = done
    ? { background: 'var(--status-good-wash)', color: 'var(--status-good-text)', border: '1px solid var(--status-good-wash)' }
    : blocked
      ? { background: 'var(--surface-inset)', color: 'var(--ink-muted)', border: '1px solid var(--line)' }
      : current
        ? { background: 'var(--accent)', color: 'var(--accent-on)', border: '1px solid var(--accent)' }
        : { background: 'var(--surface-rail)', color: 'var(--ink-muted)', border: '1px solid var(--line)' }

  return (
    <span
      style={{
        ...palette,
        position: 'relative',
        flexShrink: 0,
        width: 20,
        height: 20,
        borderRadius: 9999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.66rem',
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {done ? <Check size={12} strokeWidth={3} /> : blocked ? <Lock size={10} strokeWidth={2.4} /> : number}
    </span>
  )
}

// ─── Call to action ──────────────────────────────────────────────────────────

function NextActionCard({ action }: { action: NonNullable<WorkflowState['nextAction']> }) {
  return (
    <Link
      href={action.href}
      style={{
        display: 'block',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--accent-wash)',
        border: '1px solid var(--accent-ring)',
        textDecoration: 'none',
      }}
    >
      <div className="eyebrow" style={{ color: 'var(--accent-text)', marginBottom: 4 }}>
        PROCHAINE ÉTAPE
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--ink-primary)', lineHeight: 'var(--lh-snug)',
      }}>
        <span style={{ flex: 1 }}>{action.label}</span>
        <ArrowRight size={13} color="var(--accent-text)" style={{ flexShrink: 0 }} />
      </div>
      <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
        {action.reason}
      </div>
    </Link>
  )
}

function AllDoneCard() {
  return (
    <Link
      // Straight to the tab, not through the /analytics redirect: one hop less,
      // and the destination stays true if the shim is ever deleted.
      href="/dashboard?tab=performance"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--status-good-wash)',
        border: '1px solid var(--status-good-wash)',
        textDecoration: 'none',
      }}
    >
      <Check size={14} color="var(--status-good-text)" strokeWidth={3} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
        Parcours complet — suivez les résultats
      </span>
    </Link>
  )
}
