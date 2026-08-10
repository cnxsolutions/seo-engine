import {
  ArrowDown, ArrowUp, ArrowLeft, Inbox, LucideIcon, Minus, PlugZap, SearchX, TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import React from 'react'

/* ═══════════════════════════════════════════════════════════════════════════
   Shared UI — pure, server-renderable pieces.

   This module has NO 'use client' on purpose: server pages pass Lucide icon
   components straight in (`icon={Globe}`), which would be illegal across a
   client boundary. Anything needing state, a pointer or the keyboard lives in
   components/charts.tsx instead.

   Contract with the rest of the app: exports are only ever ADDED, and a prop
   that was optional stays optional. Five workstreams import from here.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Number formatting ───────────────────────────────────────────────
export type ValueFormat = 'number' | 'compact' | 'decimal' | 'percent' | 'position' | 'duration'

export interface FormatOptions {
  decimals?: number
  /** Appended after the number. Ignored by `percent` and `duration`. */
  unit?: string
  /** Prefix positive values with "+" — for deltas. */
  signed?: boolean
}

/** U+202F narrow no-break space — the French thousands and unit separator. */
const THIN_SPACE = String.fromCharCode(0x202f)

function groupDigits(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
}

/**
 * French formatting done by hand rather than through Intl: the ICU grouping
 * character has changed between Node releases, and a server/client mismatch
 * there shows up as a hydration error on every number in the app.
 */
function toFixedFr(value: number, decimals: number): string {
  const negative = value < 0
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.')
  return `${negative ? '-' : ''}${groupDigits(whole)}${fraction ? `,${fraction}` : ''}`
}

export function formatMetric(value: number, format: ValueFormat = 'number', options: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return '—'
  const { decimals, unit, signed } = options
  const sign = signed && value > 0 ? '+' : ''
  const suffix = unit ? `${THIN_SPACE}${unit}` : ''

  switch (format) {
    case 'compact': {
      const abs = Math.abs(value)
      if (abs < 1000) return sign + toFixedFr(value, decimals ?? 0) + suffix
      const [divisor, symbol] = abs < 1e6 ? [1e3, 'k'] : abs < 1e9 ? [1e6, 'M'] : [1e9, 'Md']
      const scaled = value / divisor
      return `${sign}${toFixedFr(scaled, Math.abs(scaled) < 10 ? 1 : 0)}${THIN_SPACE}${symbol}${suffix}`
    }
    case 'percent':
      return `${sign}${toFixedFr(value, decimals ?? 1)}${THIN_SPACE}%`
    case 'position':
      return sign + toFixedFr(value, decimals ?? 1) + suffix
    case 'decimal':
      return sign + toFixedFr(value, decimals ?? 1) + suffix
    case 'duration': {
      const total = Math.max(0, Math.round(value))
      if (total < 60) return `${total}${THIN_SPACE}s`
      if (total < 3600) {
        const minutes = Math.floor(total / 60)
        const seconds = total % 60
        return seconds ? `${minutes}${THIN_SPACE}min${THIN_SPACE}${seconds}${THIN_SPACE}s` : `${minutes}${THIN_SPACE}min`
      }
      const hours = Math.floor(total / 3600)
      const minutes = Math.round((total % 3600) / 60)
      return minutes ? `${hours}${THIN_SPACE}h${THIN_SPACE}${minutes}` : `${hours}${THIN_SPACE}h`
    }
    default:
      return sign + toFixedFr(value, decimals ?? 0) + suffix
  }
}

/** A tint that works whether `color` is a hex literal or a CSS custom property. */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

// ── PageHeader ──────────────────────────────────────────────
interface HeaderAction {
  label: string
  href?: string
  onClick?: () => void
  icon?: LucideIcon
}

interface PageHeaderProps {
  icon: LucideIcon
  iconColor?: string
  badge: string
  title: string
  subtitle?: string
  action?: HeaderAction
  /** A second, quieter action beside the primary one. */
  secondaryAction?: HeaderAction
  /** Arbitrary controls on the right — a site switcher, a date range. */
  actions?: React.ReactNode
  /** Small facts under the title: last sync, row count, connector. */
  meta?: React.ReactNode
  backHref?: string
  /** Rendered flush under the header — the natural slot for a tab bar. */
  children?: React.ReactNode
}

export function PageHeader({
  icon: Icon, iconColor = 'var(--accent)', badge, title, subtitle,
  action, secondaryAction, actions, meta, backHref, children,
}: PageHeaderProps) {
  return (
    <header style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-6)' }}>
        <div style={{ minWidth: 0 }}>
          {backHref && (
            <Link href={backHref} className="btn-link" style={{ marginBottom: 'var(--space-2)' }}>
              <ArrowLeft size={12} /> Retour
            </Link>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <span
              style={{
                width: 22, height: 22, borderRadius: 'var(--radius-sm)',
                background: tint(iconColor, 12),
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Icon size={13} color={iconColor} strokeWidth={2.2} />
            </span>
            <span className="eyebrow" style={{ color: iconColor }}>{badge}</span>
          </div>
          <h1 className="section-title">{title}</h1>
          {subtitle && <p className="section-subtitle section-subtitle--flush">{subtitle}</p>}
          {meta && (
            <div className="meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-4)', marginTop: 'var(--space-2)' }}>
              {meta}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          {actions}
          {secondaryAction && <HeaderButton action={secondaryAction} variant="btn-ghost" />}
          {action && <HeaderButton action={action} variant="btn-primary" />}
        </div>
      </div>
      {children && <div style={{ marginTop: 'var(--space-5)' }}>{children}</div>}
    </header>
  )
}

function HeaderButton({ action, variant }: { action: HeaderAction; variant: string }) {
  const body = (
    <>
      {action.icon && <action.icon size={14} />}
      {action.label}
    </>
  )
  return action.href
    ? <Link href={action.href} className={variant}>{body}</Link>
    : <button type="button" className={variant} onClick={action.onClick}>{body}</button>
}

// ── FormField ───────────────────────────────────────────────
interface FormFieldProps {
  label: string
  hint?: string
  children: React.ReactNode
  htmlFor?: string
  /** Shown in place of the hint, in the critical status colour. */
  error?: string
  required?: boolean
}

export function FormField({ label, hint, children, htmlFor, error, required }: FormFieldProps) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required && <span style={{ color: 'var(--status-critical-text)', marginLeft: 3 }} aria-hidden="true">*</span>}
        {hint && !error && <span className="field-hint" style={{ marginLeft: 'var(--space-2)' }}>{hint}</span>}
      </label>
      {children}
      {error && (
        <p style={{ marginTop: 'var(--space-1)', fontSize: 'var(--fs-xs)', color: 'var(--status-critical-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <TriangleAlert size={12} /> {error}
        </p>
      )}
    </div>
  )
}

// ── EmptyState ──────────────────────────────────────────────
/**
 * "Nothing here yet" and "you never plugged it in" are different problems with
 * different next steps, so they are different variants — not one grey box.
 */
export type EmptyStateVariant = 'no-data' | 'not-connected' | 'no-results' | 'error'

const EMPTY_VARIANTS: Record<EmptyStateVariant, { icon: LucideIcon; title: string; description: string; color: string }> = {
  'no-data': {
    icon: Inbox,
    title: 'Aucune donnée',
    description: "Rien à afficher pour l'instant. Les mesures apparaîtront dès qu'il y aura de l'activité.",
    color: 'var(--ink-faint)',
  },
  'not-connected': {
    icon: PlugZap,
    title: 'Source non connectée',
    description: "Cette vue attend une source de données. Connectez-la pour commencer la collecte.",
    color: 'var(--accent)',
  },
  'no-results': {
    icon: SearchX,
    title: 'Aucun résultat',
    description: 'Aucun élément ne correspond aux filtres actifs.',
    color: 'var(--ink-faint)',
  },
  error: {
    icon: TriangleAlert,
    title: 'Chargement impossible',
    description: "Les données n'ont pas pu être récupérées. Réessayez dans un instant.",
    color: 'var(--status-critical)',
  },
}

interface EmptyStateProps {
  icons?: React.ReactNode[]
  /** Single icon shortcut. Overrides the variant default. */
  icon?: LucideIcon
  title?: string
  description?: string
  variant?: EmptyStateVariant
  action?: { label: string; href?: string; onClick?: () => void; icon?: LucideIcon }
  secondaryAction?: { label: string; href?: string; onClick?: () => void }
  /** Drop the card frame when it already sits inside a panel. */
  bare?: boolean
  className?: string
}

export function EmptyState({
  icons, icon, title, description, variant = 'no-data', action, secondaryAction, bare, className,
}: EmptyStateProps) {
  const preset = EMPTY_VARIANTS[variant]
  const Icon = icon ?? preset.icon
  const frame = bare ? '' : 'glass-card'

  return (
    <div className={`${frame} empty ${className ?? ''}`.trim()}>
      {icons ? (
        <div className="empty__icons">{icons}</div>
      ) : (
        <div className="empty__icons">
          <span
            style={{
              width: 44, height: 44, borderRadius: 'var(--radius-lg)',
              background: tint(preset.color, 12),
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon size={20} color={preset.color} strokeWidth={1.8} />
          </span>
        </div>
      )}
      <h3 className="empty__title">{title ?? preset.title}</h3>
      <p className="empty__desc">{description ?? preset.description}</p>
      {(action || secondaryAction) && (
        <div className="empty__actions">
          {action && (
            action.href
              ? <Link href={action.href} className="btn-primary">{action.icon && <action.icon size={14} />}{action.label}</Link>
              : <button type="button" className="btn-primary" onClick={action.onClick}>{action.icon && <action.icon size={14} />}{action.label}</button>
          )}
          {secondaryAction && (
            secondaryAction.href
              ? <Link href={secondaryAction.href} className="btn-ghost">{secondaryAction.label}</Link>
              : <button type="button" className="btn-ghost" onClick={secondaryAction.onClick}>{secondaryAction.label}</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── IconBox ─────────────────────────────────────────────────
interface IconBoxProps {
  icon: LucideIcon
  color: string
  size?: number
  boxSize?: number
}

export function IconBox({ icon: Icon, color, size = 18, boxSize = 36 }: IconBoxProps) {
  return (
    <span style={{
      width: boxSize, height: boxSize, minWidth: boxSize,
      background: tint(color, 12),
      borderRadius: Math.round(boxSize * 0.25),
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={size} color={color} strokeWidth={2} />
    </span>
  )
}

// ── StatusBadge ─────────────────────────────────────────────
const STATUS_STYLES: Record<string, { cls: string; label: string }> = {
  published:    { cls: 'badge badge-success', label: 'Publié' },
  generated:    { cls: 'badge badge-info',    label: 'Généré' },
  pending:      { cls: 'badge badge-warning', label: 'En attente' },
  generating:   { cls: 'badge badge-warning', label: 'En cours…' },
  publishing:   { cls: 'badge badge-info',    label: 'Publication…' },
  scheduled:    { cls: 'badge badge-info',    label: 'Planifié' },
  queued:       { cls: 'badge badge-muted',   label: 'En file' },
  running:      { cls: 'badge badge-warning', label: 'En cours…' },
  completed:    { cls: 'badge badge-success', label: 'Terminé' },
  failed:       { cls: 'badge badge-danger',  label: 'Erreur' },
  error:        { cls: 'badge badge-danger',  label: 'Erreur' },
  rejected:     { cls: 'badge badge-muted',   label: 'Rejeté' },
  draft:        { cls: 'badge badge-muted',   label: 'Brouillon' },
  active:       { cls: 'badge badge-success', label: 'Actif' },
  inactive:     { cls: 'badge badge-muted',   label: 'Inactif' },
  connected:    { cls: 'badge badge-success', label: 'Connecté' },
  disconnected: { cls: 'badge badge-muted',   label: 'Non connecté' },
  synced:       { cls: 'badge badge-success', label: 'Synchronisé' },
  stale:        { cls: 'badge badge-warning', label: 'À rafraîchir' },
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const style = STATUS_STYLES[status] ?? { cls: 'badge badge-muted', label: status }
  return <span className={style.cls}>{label ?? style.label}</span>
}

// ── Button ─────────────────────────────────────────────
interface ButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  className?: string
  type?: 'button' | 'submit'
  icon?: LucideIcon
  iconRight?: LucideIcon
  /** Renders a Link styled as the button. */
  href?: string
  fullWidth?: boolean
  title?: string
  ariaLabel?: string
}

const BUTTON_VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
} as const

export function Button({
  children, variant = 'primary', size = 'md', disabled = false, loading = false,
  onClick, className = '', type = 'button', icon: Icon, iconRight: IconRight,
  href, fullWidth, title, ariaLabel,
}: ButtonProps) {
  const classes = [
    BUTTON_VARIANTS[variant],
    size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
    fullWidth ? 'btn-block' : '',
    className,
  ].filter(Boolean).join(' ')

  const body = (
    <>
      {loading ? <span className="spinner" aria-hidden="true" /> : Icon && <Icon size={size === 'sm' ? 13 : 15} />}
      {children}
      {IconRight && !loading && <IconRight size={size === 'sm' ? 13 : 15} />}
    </>
  )

  if (href && !disabled && !loading) {
    return <Link href={href} className={classes} title={title} aria-label={ariaLabel}>{body}</Link>
  }

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={classes}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
    >
      {body}
    </button>
  )
}

// ── StatTile ────────────────────────────────────────────────
/**
 * A single number is not a chart — it is this. Label, value, an optional
 * signed delta against a named period, and an optional recessive sparkline.
 * The delta always ships an arrow glyph, so its colour is never the only
 * carrier of "good" or "bad".
 */
export interface StatDelta {
  value: number
  /** What the change is measured against: "30 j", "semaine dernière". */
  period?: string
  /** Which way is good. `none` renders the delta neutral. */
  goodDirection?: 'up' | 'down' | 'none'
  format?: ValueFormat
  decimals?: number
  unit?: string
}

export interface StatTileProps {
  label: string
  value: string | number
  icon?: LucideIcon
  /** Applied when `value` is a number. */
  format?: ValueFormat
  decimals?: number
  unit?: string
  delta?: StatDelta
  /** One line of context under the value. */
  hint?: string
  /** Roughly 12 points, oldest → newest. */
  trend?: React.ReactNode
  href?: string
  /** Pull the tile forward when it is the one that matters on the row. */
  emphasis?: boolean
  className?: string
}

function DeltaTag({ delta }: { delta: StatDelta }) {
  const direction = delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat'
  const good = delta.goodDirection ?? 'up'
  const tone =
    direction === 'flat' || good === 'none' ? 'flat'
      : (direction === 'up') === (good === 'up') ? 'good' : 'bad'
  const Arrow = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus

  return (
    <span className={`delta delta--${tone}`}>
      <Arrow size={12} strokeWidth={2.4} aria-hidden="true" />
      {formatMetric(delta.value, delta.format ?? 'number', { decimals: delta.decimals, unit: delta.unit, signed: true })}
      {delta.period && <span style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>vs {delta.period}</span>}
    </span>
  )
}

export function StatTile({
  label, value, icon: Icon, format = 'number', decimals, unit, delta, hint, trend, href, emphasis, className,
}: StatTileProps) {
  const display = typeof value === 'number' ? formatMetric(value, format, { decimals, unit }) : value

  const content = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span className="stat-label" style={{ marginTop: 0 }}>{label}</span>
        {Icon && <Icon size={15} color="var(--ink-faint)" strokeWidth={2} />}
      </div>
      <div className="stat-value" style={{ marginTop: 'var(--space-2)' }}>{display}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-3)', marginTop: 'var(--space-2)', minHeight: 20 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {delta && <DeltaTag delta={delta} />}
          {hint && <span className="meta truncate">{hint}</span>}
        </span>
        {trend}
      </div>
    </>
  )

  const style: React.CSSProperties = emphasis
    ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent-wash)' }
    : {}

  return href
    ? <Link href={href} className={`stat-card card--interactive ${className ?? ''}`.trim()} style={{ display: 'block', ...style }}>{content}</Link>
    : <div className={`stat-card ${className ?? ''}`.trim()} style={style}>{content}</div>
}

// ── HeroFigure ──────────────────────────────────────────────
export interface HeroFigureProps {
  label: string
  value: string | number
  format?: ValueFormat
  decimals?: number
  unit?: string
  delta?: StatDelta
  caption?: string
  trend?: React.ReactNode
  className?: string
}

/** The one number a view leads with. Exactly one per page. */
export function HeroFigure({ label, value, format = 'compact', decimals, unit, delta, caption, trend, className }: HeroFigureProps) {
  const display = typeof value === 'number' ? formatMetric(value, format, { decimals, unit }) : value
  return (
    <div className={className}>
      <div className="stat-label" style={{ marginTop: 0 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
        <span className="hero-figure">{display}</span>
        {delta && <span style={{ paddingBottom: 6 }}><DeltaTag delta={delta} /></span>}
        {trend && <span style={{ marginLeft: 'auto' }}>{trend}</span>}
      </div>
      {caption && <div className="meta" style={{ marginTop: 'var(--space-2)' }}>{caption}</div>}
    </div>
  )
}

// ── Meter ───────────────────────────────────────────────────
export interface MeterProps {
  value: number
  max?: number
  label?: string
  /** Overrides the formatted `value / max` readout. */
  valueLabel?: string
  /** `auto` derives the tone from `thresholds`. */
  tone?: 'accent' | 'warning' | 'critical' | 'auto'
  /** Fractions of `max`, e.g. `{ warning: 0.8, critical: 0.95 }`. */
  thresholds?: { warning?: number; critical?: number }
  className?: string
}

/** A single ratio against a limit — never a two-slice pie. */
export function Meter({ value, max = 100, label, valueLabel, tone = 'accent', thresholds, className }: MeterProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const resolved =
    tone !== 'auto' ? tone
      : thresholds?.critical !== undefined && ratio >= thresholds.critical ? 'critical'
        : thresholds?.warning !== undefined && ratio >= thresholds.warning ? 'warning'
          : 'accent'

  return (
    <div className={className}>
      {(label || valueLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          {label && <span className="meta">{label}</span>}
          <span className="meta num" style={{ color: 'var(--ink-primary)', fontWeight: 600 }}>
            {valueLabel ?? `${formatMetric(value)} / ${formatMetric(max)}`}
          </span>
        </div>
      )}
      <div
        className={`meter ${resolved === 'accent' ? '' : `meter--${resolved}`}`.trim()}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className="meter__fill" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}

// ── TabNav ──────────────────────────────────────────────────
export interface TabNavItem {
  id: string
  label: string
  href: string
  count?: number
}

export interface TabNavProps {
  items: TabNavItem[]
  /** `id` of the current item. */
  active: string
  ariaLabel?: string
  className?: string
}

/**
 * Link-based tabs, for dashboards whose sections are real URLs (and therefore
 * bookmarkable and server-rendered). Use `Tabs` from components/charts.tsx
 * when the switch is client state instead.
 *
 * These are links, so they get `aria-current="page"` rather than the tab role:
 * a tablist that navigates lies to a screen reader about what will happen.
 */
export function TabNav({ items, active, ariaLabel = 'Sections', className }: TabNavProps) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <div className="tabs__list">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="tabs__tab"
            aria-current={item.id === active ? 'page' : undefined}
          >
            {item.label}
            {item.count !== undefined && <span className="tabs__count">{item.count}</span>}
          </Link>
        ))}
      </div>
    </nav>
  )
}

// ── Schema Components ──────────────────────────────────────────

// SchemaField - A single field in a schema
interface SchemaFieldProps {
  name: string
  type: string
  required?: boolean
  description?: string
  children?: React.ReactNode
}

/**
 * The type used to carry one of seventeen hand-picked hues. Seventeen colour
 * classes cannot be told apart, and none of them meant anything — the type
 * name already says what the field is. It is a mono chip now; the only colour
 * left is the one that carries state ("requis").
 */
export function SchemaField({ name, type, required, description, children }: SchemaFieldProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-3)',
      padding: 'var(--space-3)',
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--line)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <code style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--ink-primary)' }}>{name}</code>
          <span className="chip">{type}</span>
          {required && <span className="badge badge-danger">Requis</span>}
        </div>
        {description && <p className="meta" style={{ marginTop: 'var(--space-1)' }}>{description}</p>}
        {children}
      </div>
    </div>
  )
}

// ContentTypeCard - Card showing a content type with its fields
interface ContentTypeCardProps {
  name: string
  label: string
  fieldCount: number
  requiredCount: number
  isExpanded?: boolean
  onToggle?: () => void
  children?: React.ReactNode
}

export function ContentTypeCard({ name, label, fieldCount, requiredCount, isExpanded, onToggle, children }: ContentTypeCardProps) {
  return (
    <div className="panel">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--ink-primary)' }}>{label}</div>
          <div className="meta mono">{name}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="badge badge-muted">{fieldCount} champs</span>
          {requiredCount > 0 && <span className="badge badge-info">{requiredCount} requis</span>}
          <span
            aria-hidden="true"
            style={{
              color: 'var(--ink-muted)',
              transition: 'transform var(--dur) var(--ease)',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              fontSize: 10,
            }}
          >
            ▼
          </span>
        </div>
      </button>
      {isExpanded && children && (
        <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// SeoConfigBadge - Badge showing SEO configuration
interface SeoConfigBadgeProps {
  plugin?: string
  schemaTypes?: string[]
}

const SEO_PLUGIN_LABELS: Record<string, string> = {
  rankmath: 'RankMath',
  yoast: 'Yoast SEO',
  'all-in-one': 'All in One SEO',
  custom: 'SEO sur mesure',
}

export function SeoConfigBadge({ plugin, schemaTypes = [] }: SeoConfigBadgeProps) {
  const label = plugin ? SEO_PLUGIN_LABELS[plugin] ?? plugin : null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
      {label
        ? <StatusBadge status="connected" label={label} />
        : <StatusBadge status="stale" label="Aucun plugin SEO détecté" />}
      {schemaTypes.slice(0, 3).map((type) => <span key={type} className="chip">{type}</span>)}
      {schemaTypes.length > 3 && <span className="chip">+{schemaTypes.length - 3}</span>}
    </div>
  )
}

// GenerationWizard - Step-by-step wizard for content generation
interface Step {
  id: string
  title: string
  description: string
  icon: React.ReactNode
}

interface GenerationWizardProps {
  steps: Step[]
  currentStep: number
  onStepChange: (step: number) => void
  children: React.ReactNode
}

export function GenerationWizard({ steps, currentStep, onStepChange, children }: GenerationWizardProps) {
  return (
    <div>
      <ol style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)', listStyle: 'none', padding: 0 }}>
        {steps.map((step, index) => {
          const done = index < currentStep
          const current = index === currentStep
          return (
            <li key={step.id} style={{ flex: index < steps.length - 1 ? 1 : 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <button
                type="button"
                onClick={() => done && onStepChange(index)}
                disabled={index > currentStep}
                aria-current={current ? 'step' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', border: 'none',
                  background: current ? 'var(--accent-wash)' : 'transparent',
                  color: done || current ? 'var(--accent-text)' : 'var(--ink-muted)',
                  cursor: done ? 'pointer' : 'default',
                  fontSize: 'var(--fs-xs)', fontWeight: 600,
                }}
              >
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: done || current ? 'var(--accent)' : 'var(--surface-inset)',
                  color: done || current ? 'var(--accent-on)' : 'var(--ink-muted)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                }}>
                  {done ? '✓' : index + 1}
                </span>
                <span className="hidden sm:inline">{step.title}</span>
              </button>
              {index < steps.length - 1 && (
                <span style={{ flex: 1, height: 1, background: done ? 'var(--accent)' : 'var(--line)' }} />
              )}
            </li>
          )
        })}
      </ol>
      <div className="glass-card">{children}</div>
    </div>
  )
}

// SiteCard - Card for displaying a connected site
interface SiteCardProps {
  name: string
  url: string
  type: 'wordpress' | 'sanity'
  schemaStatus: 'not_extracted' | 'extracting' | 'extracted' | 'error'
  lastSync?: string
  contentTypesCount?: number
  onExtract?: () => void
  onViewSchema?: () => void
  onEdit?: () => void
}

const SCHEMA_STATUS: Record<SiteCardProps['schemaStatus'], string> = {
  not_extracted: 'draft',
  extracting: 'running',
  extracted: 'completed',
  error: 'failed',
}

export function SiteCard({ name, url, type, schemaStatus, lastSync, contentTypesCount, onExtract, onViewSchema, onEdit }: SiteCardProps) {
  return (
    <div className="panel">
      <div className="panel__body">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--ink-primary)' }}>{name}</div>
            <div className="meta truncate">{url}</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <span className="chip">{type}</span>
            <StatusBadge status={SCHEMA_STATUS[schemaStatus]} />
          </div>
        </div>

        {schemaStatus === 'extracted' && (
          <div className="inset" style={{ display: 'flex', gap: 'var(--space-6)', marginBottom: 'var(--space-4)' }}>
            <div>
              <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--ink-primary)' }}>{contentTypesCount ?? 0}</div>
              <div className="meta">Types de contenu</div>
            </div>
            {lastSync && (
              <div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>{lastSync}</div>
                <div className="meta">Dernière synchronisation</div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {schemaStatus !== 'extracted' && (
            <button type="button" className="btn-primary btn-sm" onClick={onExtract}>
              {schemaStatus === 'extracting' ? 'Extraction…' : 'Extraire le schéma'}
            </button>
          )}
          {schemaStatus === 'extracted' && (
            <button type="button" className="btn-secondary btn-sm" onClick={onViewSchema}>Voir le schéma</button>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={onEdit}>Modifier</button>
        </div>
      </div>
    </div>
  )
}

// ValidationResult - Shows content validation results
interface ValidationResultProps {
  isValid: boolean
  errors?: Array<{ field: string; message: string }>
  warnings?: Array<{ field: string; message: string }>
}

export function ValidationResult({ isValid, errors = [], warnings = [] }: ValidationResultProps) {
  const tone = isValid ? 'good' : 'critical'
  return (
    <div style={{
      borderRadius: 'var(--radius-md)',
      border: `1px solid var(--status-${tone})`,
      background: `var(--status-${tone}-wash)`,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: errors.length || warnings.length ? '1px solid var(--line)' : 'none',
        fontWeight: 600,
        color: `var(--status-${tone}-text)`,
      }}>
        <TriangleAlert size={14} style={{ opacity: isValid ? 0 : 1 }} />
        {isValid ? 'Contenu valide' : 'Contenu avec erreurs'}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', background: 'var(--surface-card)' }}>
          {errors.map((error, i) => (
            <div key={`err-${i}`}>
              <code style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical-text)' }}>{error.field}</code>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)' }}>{error.message}</p>
            </div>
          ))}
          {warnings.map((warning, i) => (
            <div key={`warn-${i}`}>
              <code style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-warning-text)' }}>{warning.field}</code>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)' }}>{warning.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ExtractorWizard - Full extraction wizard
interface ExtractorWizardProps {
  siteName: string
  siteType: 'wordpress' | 'sanity'
  steps: Array<{
    id: string
    title: string
    status: 'pending' | 'running' | 'completed' | 'error'
    details?: string
  }>
  onClose?: () => void
}

const EXTRACT_STEP_TONE: Record<string, string> = {
  pending: 'var(--ink-faint)',
  running: 'var(--status-warning)',
  completed: 'var(--status-good)',
  error: 'var(--status-critical)',
}

export function ExtractorWizard({ siteName, siteType, steps, onClose }: ExtractorWizardProps) {
  const done = steps.filter((s) => s.status === 'completed').length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Extraction du schéma — ${siteName}`}
      style={{
        position: 'fixed', inset: 0, background: 'var(--surface-scrim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 'var(--space-4)',
      }}
    >
      <div className="panel" style={{ width: '100%', maxWidth: 480, boxShadow: 'var(--shadow-lg)' }}>
        <div className="panel__header">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--ink-primary)' }}>Extraction du schéma</div>
            <div className="meta truncate">{siteName} · {siteType}</div>
          </div>
          {onClose && <button type="button" className="btn-icon" onClick={onClose} aria-label="Fermer">✕</button>}
        </div>

        <div className="panel__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {steps.map((step) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: tint(EXTRACT_STEP_TONE[step.status], 15),
                color: EXTRACT_STEP_TONE[step.status],
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>
                {step.status === 'completed' ? '✓' : step.status === 'error' ? '✕' : step.status === 'running' ? '◐' : '○'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: 'var(--ink-primary)', fontSize: 'var(--fs-sm)' }}>{step.title}</div>
                {step.details && <div className="meta">{step.details}</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="panel__footer">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span>Progression</span>
            <span className="num" style={{ color: 'var(--ink-primary)', fontWeight: 600 }}>{done} / {steps.length}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── MetricCard ──────────────────────────────────────────────
interface MetricCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  change?: string
  changeType?: 'up' | 'down'
  /** Optional recessive trend, rendered by the caller (Sparkline). */
  trend?: React.ReactNode
  href?: string
}

/**
 * Kept for the pages already written against it. New code should reach for
 * `StatTile`, which carries a typed delta instead of a pre-formatted string.
 */
export function MetricCard({ icon: Icon, label, value, change, changeType, trend, href }: MetricCardProps) {
  const tone = changeType === 'up' ? 'good' : changeType === 'down' ? 'bad' : 'flat'
  const Arrow = changeType === 'up' ? ArrowUp : changeType === 'down' ? ArrowDown : Minus

  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span className="stat-label" style={{ marginTop: 0 }}>{label}</span>
        <Icon size={15} color="var(--ink-faint)" strokeWidth={2} />
      </div>
      <div className="stat-value" style={{ marginTop: 'var(--space-2)' }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-3)', marginTop: 'var(--space-2)', minHeight: 20 }}>
        {change ? (
          <span className={`delta delta--${tone}`}>
            <Arrow size={12} strokeWidth={2.4} aria-hidden="true" />
            {change}
          </span>
        ) : <span />}
        {trend}
      </div>
    </>
  )

  return href
    ? <Link href={href} className="stat-card card--interactive" style={{ display: 'block' }}>{body}</Link>
    : <div className="stat-card">{body}</div>
}
