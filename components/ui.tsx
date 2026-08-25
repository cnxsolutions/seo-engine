import {
  ArrowDown, ArrowUp, ArrowLeft, ArrowRight, CircleCheck, CircleQuestionMark, Inbox, Info,
  LucideIcon, MapPin, Minus, OctagonAlert, PlugZap, SearchX, ShieldAlert, TriangleAlert, X,
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
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

/**
 * The error line of a field, on its own.
 *
 * It is exported because `FormField` REQUIRES `label` and renders it above its
 * children: inside a `<td>` of a `.data-table`, wrapping an input in a
 * `FormField` would repeat the column header on every row. The cell needs the
 * error, not a second heading.
 */
export function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ marginTop: 'var(--space-1)', fontSize: 'var(--fs-xs)', color: 'var(--status-critical-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
      <TriangleAlert size={12} /> {children}
    </p>
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

  /* Inventory freshness and write intent — the same strings the API emits, so
     no screen needs a translation table. `stale` above doubles as the "stale
     inventory" badge: SeoConfigBadge already overrides its label, so its
     default is indifferent to that call site, and a second key for one state
     is how a vocabulary starts to drift.

     `blind` is muted, NOT danger: a site that was never crawled is not a
     failure, and painting it red would punish the operator for a crawl that
     nobody has run yet. `create` is muted for the same reason — an intent is
     not an outcome. */
  fresh:        { cls: 'badge badge-success', label: 'Inventaire à jour' },
  blind:        { cls: 'badge badge-muted',   label: 'Site jamais analysé' },
  refresh:      { cls: 'badge badge-info',    label: 'Mise à jour' },
  create:       { cls: 'badge badge-muted',   label: 'Nouvelle page' },
  duplicat:     { cls: 'badge badge-danger',  label: 'Quasi-doublon' },
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
  /**
   * Widened from `string | number` so a tile can carry `<UnknownValue/>`.
   * A dashboard that prints 0 for "we never crawled this site" is lying, and
   * the tile is exactly where that lie used to be cheapest to tell. The
   * `typeof value === 'number'` branch below is unchanged, so every existing
   * caller keeps its formatting.
   */
  value: string | number | React.ReactNode
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
  /**
   * A class on the TRACK, not on the wrapper.
   *
   * `className` lands on the outer div, and `.meter` paints an opaque
   * `background: var(--ramp-1)` over anything behind it — so texturing the
   * track through `className` is silently invisible. `.hatch` needs this prop.
   */
  trackClassName?: string
}

/** A single ratio against a limit — never a two-slice pie. */
export function Meter({ value, max = 100, label, valueLabel, tone = 'accent', thresholds, className, trackClassName }: MeterProps) {
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
        className={['meter', resolved === 'accent' ? '' : `meter--${resolved}`, trackClassName ?? ''].filter(Boolean).join(' ')}
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

/* ═══════════════════════════════════════════════════════════════════════════
   What the engine knows about the site it writes on
   ───────────────────────────────────────────────────────────────────────────
   Everything below shows a page that ALREADY EXISTS, or a verdict about one.

   Two rules govern the whole block and neither is decoration:

   · When the engine does not KNOW, the screen says so. "No crawl, so nothing
     to count" and "zero pages" are different facts, and rendering both as 0
     is exactly how a dashboard starts to lie. `UnknownValue` is the single
     shape that fact takes.

   · Every state carries AT LEAST TWO encodings, one of them non-chromatic.
     Measured against `--surface-card`, a bare `--status-warning` dot is
     1.79:1 and a bare `--status-serious` dot is 2.57:1 — both under the 3:1
     that a graphic object needs. So severity is a badge (colour + glyph +
     word), a score is a number (the bar is redundant, never alone), and a
     partial comparison is a texture (`.hatch`), which survives greyscale and
     colour-vision deficiency where a hue does not.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── UnknownValue ────────────────────────────────────────────────────
/**
 * The absence of knowledge, rendered.
 *
 * `why` is not optional: "inconnu" without a reason is the same dead end as
 * the 0 it replaces. It is on the `title` for the pointer and repeated in
 * `.sr-only` because a tooltip is unreachable by keyboard and by screen
 * reader.
 */
export function UnknownValue({ why }: { why: string }) {
  return (
    <span className="meta" title={why}>
      Inconnu
      <span className="sr-only"> — {why}</span>
    </span>
  )
}

// ── RiskBadge ───────────────────────────────────────────────────────
export type RiskLevel = 'bloquant' | 'serieux' | 'avertissement' | 'sain' | 'inconnu'

/**
 * The ONE place a severity gets a colour. Each rung ships a distinct glyph and
 * a distinct word, so 'serieux' and 'avertissement' stay apart under
 * deuteranopia and protanopia, where --status-serious and --status-warning
 * very nearly meet.
 *
 * `CircleQuestionMark` is the canonical lucide name. `CircleHelp` and
 * `HelpCircle` do exist in 0.577.0 — they are aliases of this very icon — but
 * they are the deprecated spelling that lucide drops from release to release.
 */
const RISK_STYLES: Record<RiskLevel, { cls: string; label: string; icon: LucideIcon }> = {
  bloquant:      { cls: 'badge badge-danger',  label: 'Bloquant',       icon: OctagonAlert },
  serieux:       { cls: 'badge badge-serious', label: 'Sérieux',        icon: TriangleAlert },
  avertissement: { cls: 'badge badge-warning', label: 'Avertissement',  icon: Info },
  sain:          { cls: 'badge badge-success', label: 'Aucun conflit',  icon: CircleCheck },
  inconnu:       { cls: 'badge badge-muted',   label: 'Non vérifiable', icon: CircleQuestionMark },
}

export function RiskBadge({ level, label, size = 'md' }: { level: RiskLevel; label?: string; size?: 'sm' | 'md' }) {
  const preset = RISK_STYLES[level]
  const Icon = preset.icon

  // `||`, not `??`: a caller passing label="" would otherwise ship a badge that
  // is nothing but a coloured square with a glyph — the exact failure this
  // component exists to prevent. The word is never optional.
  return (
    <span className={preset.cls} style={size === 'sm' ? { padding: '0.0625rem 0.375rem' } : undefined}>
      <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
      {label || preset.label}
    </span>
  )
}

// ── SimilarityScore ─────────────────────────────────────────────────
/**
 * How close a proposed page is to one already online.
 *
 * `value` and `threshold` are RATIOS, and the readout is "82 / 100 · seuil 80"
 * — never "82 %". A cosine of 0.82 is not "82 % of the text is duplicated",
 * and the threshold beside it is what makes the number actionable.
 *
 * `threshold` travels in from the match that DECIDED, never a constant written
 * here: a truncated inventory lowers TITLE_NEAR_DUPLICATE from 0.80 to 0.72,
 * and a hard-coded "seuil 80" would sit next to a block that fired at 0.74.
 *
 * The bar is redundant on purpose. Its fill against its track measures 3.14:1
 * in light and 2.75:1 in dark, and in the warning tone it drops to 1.65:1 —
 * so the bar can never be the only carrier. The number always ships.
 */
export function SimilarityScore({ value, threshold, label, partial, className }: {
  value: number
  threshold: number
  label: string
  partial?: boolean
  className?: string
}) {
  // `partial` OVERRIDES the verdict rather than shading it: a low cosine
  // against an excerpt proves nothing, and "aucun conflit" printed over a
  // half-read page is a green light on exactly the pages worth protecting.
  const level: RiskLevel = partial
    ? 'inconnu'
    : value >= threshold ? 'bloquant'
      : value >= threshold * 0.9 ? 'avertissement'
        : 'sain'

  return (
    <div className={className}>
      <div className="meta">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
        <span className="num" style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: partial ? 'var(--ink-muted)' : 'var(--ink-primary)' }}>
          {formatMetric(value * 100, 'number', { decimals: 0 })}
        </span>
        <span className="num" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-muted)' }}>/ 100</span>
        {/* The threshold is a figure the operator decides on, so it does not
            wear `.meta`: --ink-muted on --surface-inset measures 4.42:1, under AA. */}
        <span className="num" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)' }}>
          · seuil {formatMetric(threshold * 100, 'number', { decimals: 0 })}
        </span>
        <RiskBadge level={level} size="sm" />
      </div>
      <div style={{ marginTop: 'var(--space-2)' }}>
        <Meter
          value={value}
          max={1}
          tone="auto"
          thresholds={{ warning: threshold * 0.9, critical: threshold }}
          trackClassName={partial ? 'hatch' : undefined}
        />
      </div>
      {partial && (
        // No character count here: the excerpt cap belongs to the crawler, and
        // a figure copied into the design system outlives the truth it quoted.
        <p style={{ marginTop: 'var(--space-1)', fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
          Comparée à un extrait de la page, pas à son texte complet — un score bas ne prouve rien.
        </p>
      )}
    </div>
  )
}

// ── ComparePanel ────────────────────────────────────────────────────
export interface CompareSide {
  kind: 'existante' | 'proposee'
  /** Normalised, as `normalizeInventoryPath()` returns it. Never a raw path. */
  path: string
  url?: string
  /** ISO. On the 'existante' side: `InventoryEntry.observedAt`. */
  observedAt?: string
  note?: string
}

/**
 * The page online, beside the page proposed. The incumbent is ALWAYS on the
 * left, so position itself carries which is which.
 *
 * The two sides are NOT told apart by their background: --surface-inset
 * against --surface-card measures 1.14:1 in light and 1.07:1 in dark, which is
 * a change of plane nobody can see. They are told apart by a rule on the left
 * edge, by a written eyebrow, and by their order.
 *
 * The grid is intrinsic — `repeat(auto-fit, minmax(280px, 1fr))` — and folds
 * on its own. It has to be: this project's Tailwind chain compiles no
 * breakpoint rules at all (globals.css uses the v3 `@tailwind` directives
 * while postcss loads @tailwindcss/postcss v4), so a responsive-variant class
 * would be silently inert at every width.
 */
export function ComparePanel({ left, right, title, risk, children }: {
  left: CompareSide
  right: CompareSide
  title?: string
  risk?: RiskLevel
  children: React.ReactNode
}) {
  return (
    <section className="panel">
      {(title || risk) && (
        <div className="panel__header">
          <h3 className="card-title" style={{ minWidth: 0 }}>{title ?? 'Comparaison'}</h3>
          {risk && <RiskBadge level={risk} />}
        </div>
      )}
      <div className="panel__body--flush">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <CompareColumn side={left} />
          <CompareColumn side={right} />
        </div>
        {children}
      </div>
    </section>
  )
}

/** The accent rule on the proposed side doubles as the column separator —
 *  two borders on one edge would just read as a thicker line. */
function CompareColumn({ side }: { side: CompareSide }) {
  const proposed = side.kind === 'proposee'
  return (
    <div style={{
      minWidth: 0,
      padding: 'var(--space-4) var(--space-5)',
      borderLeft: `2px solid ${proposed ? 'var(--accent)' : 'var(--line-strong)'}`,
    }}>
      <div className="eyebrow" style={proposed ? { color: 'var(--accent-text)' } : undefined}>
        {proposed ? 'Page proposée' : 'Page en ligne'}
      </div>
      <div style={{ marginTop: 'var(--space-2)' }}>
        <span className="chip">{side.path}</span>
      </div>
      {side.url && <div className="meta truncate" style={{ marginTop: 'var(--space-1)' }}>{side.url}</div>}
      {side.observedAt && <div className="meta" style={{ marginTop: 'var(--space-1)' }}>Observée le {formatDayLong(side.observedAt)}</div>}
      {side.note && (
        <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
          {side.note}
        </p>
      )}
    </div>
  )
}

/**
 * One field of the comparison, laid out on the same intrinsic grid as the
 * columns above so the values stay under their own side.
 *
 * No character-level diff: highlighting insertions in green and deletions in
 * red is colour alone, and a real diff would mean an npm dependency this wave
 * has committed not to take.
 */
export function CompareField({ label, before, after, similarity, threshold, partial }: {
  label: string
  before: string
  after: string
  similarity?: number
  threshold?: number
  partial?: boolean
}) {
  return (
    <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--line)' }}>
      <div className="field-label">{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
        <CompareValue kind="existante" value={before} />
        <CompareValue kind="proposee" value={after} />
      </div>
      {similarity !== undefined && threshold !== undefined && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <SimilarityScore value={similarity} threshold={threshold} label={label} partial={partial} />
        </div>
      )}
    </div>
  )
}

/** The written side name is `.sr-only`: on screen the left rule and the column
 *  order say it, but neither reaches a screen reader once the grid folds. */
function CompareValue({ kind, value }: { kind: CompareSide['kind']; value: string }) {
  const proposed = kind === 'proposee'
  return (
    <p style={{
      margin: 0,
      minWidth: 0,
      paddingLeft: 'var(--space-3)',
      borderLeft: `2px solid ${proposed ? 'var(--accent)' : 'var(--line-strong)'}`,
      fontSize: 'var(--fs-sm)',
      color: 'var(--ink-secondary)',
      lineHeight: 'var(--lh-snug)',
    }}>
      <span className="sr-only">{proposed ? 'Page proposée : ' : 'Page en ligne : '}</span>
      {value}
    </p>
  )
}

// ── Notice ──────────────────────────────────────────────────────────
export type NoticeTone = 'good' | 'warning' | 'serious' | 'critical' | 'info'

/** Same glyphs as `RiskBadge`, so one severity never wears two faces. */
const NOTICE_TONES: Record<NoticeTone, { mark: string; text: string; icon: LucideIcon }> = {
  good:     { mark: 'var(--status-good)',     text: 'var(--status-good-text)',     icon: CircleCheck },
  warning:  { mark: 'var(--status-warning)',  text: 'var(--status-warning-text)',  icon: Info },
  serious:  { mark: 'var(--status-serious)',  text: 'var(--status-serious-text)',  icon: TriangleAlert },
  critical: { mark: 'var(--status-critical)', text: 'var(--status-critical-text)', icon: OctagonAlert },
  info:     { mark: 'var(--accent)',          text: 'var(--accent-text)',          icon: Info },
}

/**
 * The banner three pages had each written for themselves.
 *
 * `inline` and `onDismiss` are part of the contract, not conveniences: the
 * Google page nests three of these inside a panel and needs `.inset` instead
 * of a second card frame, and the strategy page dismisses its transient
 * "cycle lancé" banner. A consolidation that drops two used props is a
 * regression wearing a design-system badge.
 *
 * Still server-renderable: it ATTACHES the handlers it is given and creates
 * none, so a server page can pass `action.href` and simply omit the rest.
 */
export function Notice({ tone, title, body, icon, action, onDismiss, inline, children }: {
  tone: NoticeTone
  title: string
  body?: React.ReactNode
  icon?: LucideIcon
  action?: { label: string; href?: string; onClick?: () => void }
  onDismiss?: () => void
  inline?: boolean
  children?: React.ReactNode
}) {
  const preset = NOTICE_TONES[tone]
  const Icon = icon ?? preset.icon

  return (
    <div
      className={inline ? 'inset' : 'glass-card'}
      style={{
        borderLeft: `3px solid ${preset.mark}`,
        marginBottom: inline ? 0 : 'var(--space-5)',
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
      }}
    >
      <Icon size={16} color={preset.mark} strokeWidth={2.2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: preset.text }}>{title}</strong>
        {body && (
          <p style={{
            fontSize: 'var(--fs-sm)',
            color: 'var(--ink-secondary)',
            margin: '0.25rem 0 0',
            lineHeight: 1.55,
            // Kept from the /sites/new copy this replaces: the bodies fed to a
            // Notice are error strings, and an unbroken URL or token in one of
            // them would otherwise push the card past the viewport.
            overflowWrap: 'anywhere',
          }}>{body}</p>
        )}
        {children}
      </div>
      {action && (
        action.href
          ? <Link href={action.href} className="btn-secondary btn-sm">{action.label}</Link>
          : <button type="button" className="btn-secondary btn-sm" onClick={action.onClick}>{action.label}</button>
      )}
      {onDismiss && (
        <button type="button" className="btn-icon" onClick={onDismiss} aria-label="Fermer">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

// ── ReasonList ──────────────────────────────────────────────────────
/**
 * Why something was refused — or, in the `info` tone, what the connector had
 * to say about a publication that went through.
 *
 * `tone` repairs a defect rather than freezing it: both copies this replaces
 * painted their heading in --status-critical-text with a ShieldAlert in every
 * case, including over "À savoir sur cette publication", whose entries are
 * informative notes. The colour was lying about the severity.
 *
 * An empty `reasons` renders no `<ul>` at all, which is the behaviour of the
 * /publish copy — an empty bulleted list is a promise of content that is not
 * coming.
 */
export function ReasonList({ title, reasons, tone = 'critical' }: {
  title: string
  reasons: string[]
  tone?: 'critical' | 'info'
}) {
  const critical = tone === 'critical'
  const Icon = critical ? ShieldAlert : Info

  return (
    <div className="inset">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          fontSize: 'var(--fs-2xs)',
          fontWeight: 650,
          textTransform: 'uppercase',
          letterSpacing: 'var(--ls-eyebrow)',
          color: critical ? 'var(--status-critical-text)' : 'var(--accent-text)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <Icon size={12} aria-hidden="true" />
        {title}
      </div>
      {reasons.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 1.7 }}>
          {reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * `error_message` is written as `Rejete par le pipeline : CODE: raison | CODE:
 * raison` (lib/pipeline/repository.ts). Split it back into the list it started
 * as, and drop the prefix — the badge already says the page was refused.
 */
export function splitReasons(message: string | null): string[] {
  if (!message) return []
  return message
    .replace(/^Rejete par le pipeline\s*:\s*/i, '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}

// ── GbpPostPreview ──────────────────────────────────────────────────
/**
 * What a Business Profile post will look like once it leaves.
 *
 * `maxChars` and `target` arrive as props with NO default. The limits are
 * declared "to be confirmed against the real API" and the first 400 response
 * will correct them; a default living in the design system would survive that
 * correction and keep counting against a number nobody believes any more. It
 * also keeps ui.tsx free of any dependency on lib/.
 *
 * No image slot and no "En savoir plus" fold: the LocalPostDraft invariant is
 * "no media in v1", and Google's truncation point is proven nowhere in this
 * repo. A preview that invents either is a preview that lies.
 */
export function GbpPostPreview({ businessName, summary, cta, maxChars, target, className }: {
  businessName: string
  summary: string
  cta?: { actionType: string; label: string; url?: string }
  maxChars: number
  target: { min: number; max: number }
  className?: string
}) {
  const overflow = summary.length > maxChars

  return (
    <section className={`panel ${className ?? ''}`.trim()} style={{ maxWidth: '22rem' }}>
      <div className="panel__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
          <IconBox icon={MapPin} color="var(--series-3)" boxSize={28} size={14} />
          <div style={{ minWidth: 0 }}>
            <div className="truncate" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--ink-primary)' }}>{businessName}</div>
            <div className="meta">Post sur la fiche</div>
          </div>
        </div>
      </div>

      <div className="panel__body">
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap', lineHeight: 'var(--lh-normal)' }}>
          {overflow ? summary.slice(0, maxChars) : summary}
          {overflow && (
            // The wavy underline is a SHAPE. A wash alone would leave the
            // overflow invisible in greyscale, which is where it matters most.
            <span style={{ background: 'var(--status-critical-wash)', textDecoration: 'underline wavy var(--status-critical)' }}>
              {summary.slice(maxChars)}
            </span>
          )}
        </p>

        {cta && (
          <>
            <hr className="divider" />
            {/* Google renders the call to action as a text link. A filled
                button here would promise a rendering that never happens. */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--accent-text)', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>
              {cta.label}
              <ArrowRight size={13} aria-hidden="true" />
            </span>
            {/* 'CALL' carries no url — showing one would invent a destination. */}
            {cta.actionType !== 'CALL' && cta.url && (
              <div className="meta truncate" style={{ marginTop: 'var(--space-1)' }}>{cta.url}</div>
            )}
          </>
        )}
      </div>

      <div className="panel__footer">
        <Meter
          value={summary.length}
          max={maxChars}
          tone="auto"
          thresholds={{ warning: target.max / maxChars, critical: 1 }}
          label="Longueur"
          valueLabel={`${summary.length} / ${maxChars} car. · cible ${target.min}–${target.max}`}
        />
        <p className="meta" style={{ marginTop: 'var(--space-2)' }}>Limites à confirmer contre l’API Google.</p>
      </div>
    </section>
  )
}

// ── Provenance ──────────────────────────────────────────────────────
/**
 * Where the figures above come from and over what period. A metric whose
 * origin is unknown is worth nothing.
 *
 * Promoted out of app/(dashboard)/dashboard/ui-bits.tsx, whose own header
 * declares it carries only "what the design system does NOT provide and only
 * the dashboard needs". Three route folders read it now.
 */
export function SourceNote({ source, period, note }: { source: string; period: string; note?: React.ReactNode }) {
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

/**
 * A bar that reads a value already printed beside it — never the only
 * encoding, and never a second colour: one series slot for the whole column,
 * because the bar length already carries the comparison.
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

// ── Dates & URLs ────────────────────────────────────────────────────
//
// `formatDay` was declared FOUR times across the route folders, each with its
// own idea of what a short French date looks like. It lives here now.
//
// `Intl.DateTimeFormat` is safe where `Intl.NumberFormat` was not: the month
// abbreviations are stable across the Node and browser ICU builds, whereas the
// NumberFormat grouping character has changed between Node releases — which is
// why `formatMetric` above does its grouping by hand.

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const DAY_LONG = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Noon UTC, deliberately: a bare date parsed as midnight lands on the day
 *  before in any negative offset, and the whole app runs on ISO days. */
export function formatDay(iso: string): string {
  return DAY.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
}

export function formatDayLong(iso: string): string {
  return DAY_LONG.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
}

/** `https://www.site.fr/taxi-troyes` → `/taxi-troyes`, so a table column stays readable. */
export function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '')
    return path === '' ? '/' : path
  } catch {
    return url
  }
}
