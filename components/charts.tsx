'use client'

import { Check, ChevronsUpDown, Globe, Table2, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, formatMetric, type ValueFormat } from './ui'

/* ═══════════════════════════════════════════════════════════════════════════
   Charts & interactive chrome — dependency-free SVG.

   Everything a page needs that requires state, a pointer or the keyboard
   lives here ('use client'). Pure, server-renderable pieces stay in ui.tsx.

   The rules these components hold to, so pages do not have to:
     · The FORM is chosen before the colour. A single number is a StatTile
       (ui.tsx), never a one-bar chart.
     · Never two Y scales on one plot. `series` is one list against one scale;
       two units means two charts.
     · Nominal categories get ONE hue for every bar — bar length already
       encodes the value. Ordered categories get the one-hue ordinal ramp.
     · Series colour follows the entity (pin it with `slot`), never its rank,
       so filtering never repaints the survivors.
     · Marks are thin, grid and axes are recessive solid hairlines, values are
       labelled selectively.
     · Text wears ink tokens. A series hue is only ever on a mark.
     · Every chart ships a table twin: the values are always reachable without
       hovering, which is also what licenses the lighter hues in light mode.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Public data shapes ──────────────────────────────────────────────
export interface ChartPoint {
  /** Category or time bucket. Rendered as text — never as HTML. */
  label: string
  value: number
}

export interface ChartSeries {
  id: string
  name: string
  points: ChartPoint[]
  /**
   * Pin this entity to a palette slot. Without it the hue comes from the
   * position in the `series` array — which repaints the survivors as soon as
   * the caller filters the list. Pin it whenever the list can be filtered.
   */
  slot?: SeriesSlot
}

/** 1-8. The slot follows the entity, never its rank. */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export type ValueLabelMode = 'auto' | 'all' | 'extremes' | 'none'

const SERIES_TOKENS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
] as const

const RAMP_TOKENS = ['var(--ramp-1)', 'var(--ramp-2)', 'var(--ramp-3)', 'var(--ramp-4)', 'var(--ramp-5)'] as const

/**
 * Past slot 8 the palette stops. Cycling would hand a 9th entity a hue that is
 * indistinguishable from an existing one under CVD, so the last slot is reused
 * loudly instead of quietly: fold the tail into "Autres" or facet.
 */
function seriesColor(index: number): string {
  if (index >= SERIES_TOKENS.length && process.env.NODE_ENV !== 'production') {
    console.warn(`[charts] ${index + 1} séries demandées : la palette en compte 8. Regroupez la queue dans « Autres ».`)
  }
  return SERIES_TOKENS[Math.min(index, SERIES_TOKENS.length - 1)]
}

/** A pinned slot wins over the array position, so filtering never recolours. */
function slotColor(series: { slot?: SeriesSlot }, index: number): string {
  return series.slot ? SERIES_TOKENS[series.slot - 1] : seriesColor(index)
}

function ordinalColor(index: number, total: number): string {
  if (total <= 1) return RAMP_TOKENS[3]
  const step = Math.round((index / (total - 1)) * (RAMP_TOKENS.length - 1))
  return RAMP_TOKENS[step]
}

// ── Geometry ────────────────────────────────────────────────────────
const TICK_FONT = 11
const TICK_CHAR_W = 6.4
const MAX_BAR_THICKNESS = 24
const BAR_GAP = 2
const MARK_RADIUS = 4

interface Scale {
  min: number
  max: number
  ticks: number[]
}

/** Round a raw range out to clean tick numbers (0 / 1 000 / 2 000). */
function niceScale(min: number, max: number, count: number): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const base = Number.isFinite(max) ? max : 0
    const pad = Math.abs(base) > 0 ? Math.abs(base) * 0.5 : 1
    min = base - pad
    max = base + pad
  }
  const raw = (max - min) / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  const norm = raw / mag
  const stepMul = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  const step = stepMul * mag
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toFixed(10)))
  }
  return { min: niceMin, max: niceMax, ticks }
}

/** Rounded on the data end, square at the baseline — never a full pill. */
function columnPath(x: number, w: number, yBase: number, yValue: number): string {
  const up = yValue <= yBase
  const h = Math.abs(yBase - yValue)
  const r = Math.max(0, Math.min(MARK_RADIUS, w / 2, h))
  if (h < 0.5) return `M${x},${yBase}h${w}`
  return up
    ? `M${x},${yBase}L${x},${yValue + r}Q${x},${yValue} ${x + r},${yValue}L${x + w - r},${yValue}Q${x + w},${yValue} ${x + w},${yValue + r}L${x + w},${yBase}Z`
    : `M${x},${yBase}L${x},${yValue - r}Q${x},${yValue} ${x + r},${yValue}L${x + w - r},${yValue}Q${x + w},${yValue} ${x + w},${yValue - r}L${x + w},${yBase}Z`
}

function barPath(y: number, h: number, xBase: number, xValue: number): string {
  const right = xValue >= xBase
  const w = Math.abs(xValue - xBase)
  const r = Math.max(0, Math.min(MARK_RADIUS, h / 2, w))
  if (w < 0.5) return `M${xBase},${y}v${h}`
  return right
    ? `M${xBase},${y}L${xValue - r},${y}Q${xValue},${y} ${xValue},${y + r}L${xValue},${y + h - r}Q${xValue},${y + h} ${xValue - r},${y + h}L${xBase},${y + h}Z`
    : `M${xBase},${y}L${xValue + r},${y}Q${xValue},${y} ${xValue},${y + r}L${xValue},${y + h - r}Q${xValue},${y + h} ${xValue + r},${y + h}L${xBase},${y + h}Z`
}

/** Container width, so stroke widths stay true instead of being scaled by a viewBox. */
function useMeasuredWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const apply = () => setWidth(node.clientWidth || fallback)
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(apply)
    ro.observe(node)
    return () => ro.disconnect()
  }, [fallback])
  return { ref, width: width ?? fallback, measured: width !== null }
}

// ── Shared chart chrome ─────────────────────────────────────────────
interface FrameProps {
  title?: string
  description?: string
  legend?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}

function ChartFrame({ title, description, legend, footer, children, className }: FrameProps) {
  return (
    <figure className={`chart ${className ?? ''}`.trim()} style={{ margin: 0 }}>
      {(title || description || legend) && (
        <figcaption className="chart__head">
          <div style={{ minWidth: 0 }}>
            {title && <div className="card-title">{title}</div>}
            {description && <div className="meta" style={{ marginTop: 2 }}>{description}</div>}
          </div>
          {legend}
        </figcaption>
      )}
      {children}
      {footer && <div className="chart__foot">{footer}</div>}
    </figure>
  )
}

/**
 * The table twin. Always in the DOM: hidden from sight but not from a screen
 * reader, and revealable so no value is gated behind a hover.
 */
function ChartTable({
  visible, caption, columns, rows,
}: {
  visible: boolean
  caption: string
  columns: string[]
  rows: Array<{ label: string; values: string[] }>
}) {
  return (
    <div className={visible ? 'scroll-x' : 'sr-only'} style={visible ? { marginTop: 'var(--space-3)' } : undefined}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Catégorie</th>
            {columns.map((c) => <th key={c} scope="col" className="cell-num">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((v, i) => <td key={i} className="cell-num">{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableToggle({ open, onToggle, id }: { open: boolean; onToggle: () => void; id: string }) {
  return (
    <button type="button" className="btn-link" onClick={onToggle} aria-expanded={open} aria-controls={id}>
      <Table2 size={12} />
      {open ? 'Masquer le tableau' : 'Voir le tableau'}
    </button>
  )
}

interface TooltipState {
  x: number
  y: number
  heading: string
  rows: Array<{ name: string; value: string; color?: string }>
}

function ChartTooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null
  return (
    <div className="chart-tooltip" style={{ left: state.x, top: state.y }} role="presentation">
      <div className="chart-tooltip__x">{state.heading}</div>
      {state.rows.map((row, i) => (
        <div key={i} className="chart-tooltip__row">
          {row.color && <span className="chart-legend__rule" style={{ background: row.color }} aria-hidden="true" />}
          <span className="chart-tooltip__name">{row.name}</span>
          <span className="chart-tooltip__value">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

function EmptyChart({ height, message }: { height: number; message: string }) {
  return <div className="chart-empty" style={{ height }}>{message}</div>
}

// ═══ Sparkline ═══════════════════════════════════════════════════════
export interface SparklineProps {
  /** Ordered oldest → newest. About 12 points reads best. */
  values: number[]
  width?: number
  height?: number
  variant?: 'line' | 'area' | 'bars'
  /**
   * `quiet` is the stat-tile default: recessive trend, accent on the last
   * point. `good` / `critical` borrow the reserved status hues and are only
   * legitimate when the series itself MEANS good or bad (error rate, uptime) —
   * never as decoration for "series number 3".
   */
  tone?: 'quiet' | 'accent' | 'good' | 'critical'
  emphasizeLast?: boolean
  ariaLabel?: string
  className?: string
}

export function Sparkline({
  values,
  width = 104,
  height = 30,
  variant = 'line',
  tone = 'quiet',
  emphasizeLast = true,
  ariaLabel,
  className,
}: SparklineProps) {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 2) return null

  const stroke =
    tone === 'accent' ? 'var(--series-1)'
      : tone === 'good' ? 'var(--status-good)'
        : tone === 'critical' ? 'var(--status-critical)'
          : 'var(--chart-quiet)'

  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const span = max - min || 1
  const pad = 3
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const px = (i: number) => pad + (i / (clean.length - 1)) * innerW
  const py = (v: number) => pad + innerH - ((v - min) / span) * innerH

  const line = clean.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(2)},${py(v).toFixed(2)}`).join('')
  const lastX = px(clean.length - 1)
  const lastY = py(clean[clean.length - 1])

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `Tendance sur ${clean.length} points`}
      style={{ overflow: 'visible' }}
    >
      {variant === 'bars' ? (
        clean.map((v, i) => {
          const w = Math.max(1.5, innerW / clean.length - BAR_GAP)
          const x = pad + (i / clean.length) * innerW
          const y = py(v)
          return <rect key={i} x={x} y={y} width={w} height={Math.max(1, height - pad - y)} rx={1} fill={i === clean.length - 1 && emphasizeLast ? 'var(--series-1)' : stroke} />
        })
      ) : (
        <>
          {variant === 'area' && (
            <path d={`${line}L${lastX},${height - pad}L${px(0)},${height - pad}Z`} fill={stroke} opacity={0.1} />
          )}
          <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {emphasizeLast && (
            <circle cx={lastX} cy={lastY} r={3} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} />
          )}
        </>
      )}
    </svg>
  )
}

// ═══ BarChart ════════════════════════════════════════════════════════
export interface BarChartProps {
  data: ChartPoint[]
  /** Go horizontal for many categories or long names. */
  orientation?: 'vertical' | 'horizontal'
  height?: number
  format?: ValueFormat
  unit?: string
  decimals?: number
  /** Label of the one bar the story is about: it keeps the hue, the rest go grey. */
  emphasis?: string | null
  /** Only for categories with a natural order (stages, tiers) — one-hue ramp. */
  ordinal?: boolean
  /** Nominal categories all share one slot; override it to match a sibling chart. */
  slot?: SeriesSlot
  valueLabels?: ValueLabelMode
  gridLines?: number
  title?: string
  description?: string
  tableView?: boolean
  showTableToggle?: boolean
  emptyMessage?: string
  className?: string
}

export function BarChart({
  data,
  orientation = 'vertical',
  height,
  format = 'number',
  unit,
  decimals,
  emphasis = null,
  ordinal = false,
  slot = 1,
  valueLabels = 'auto',
  gridLines = 4,
  title,
  description,
  tableView = false,
  showTableToggle = true,
  emptyMessage = 'Aucune donnée sur cette période.',
  className,
}: BarChartProps) {
  const uid = useId()
  const tableId = `${uid}-table`
  const [tableOpen, setTableOpen] = useState(tableView)
  const [hover, setHover] = useState<number | null>(null)
  const { ref, width } = useMeasuredWidth()

  const fmt = useCallback(
    (v: number) => formatMetric(v, format, { decimals, unit }),
    [format, decimals, unit],
  )

  const horizontal = orientation === 'horizontal'
  const plotH = height ?? (horizontal ? Math.max(120, data.length * 30 + 24) : 220)

  const geometry = useMemo(() => {
    if (data.length === 0) return null
    const values = data.map((d) => d.value)
    const scale = niceScale(Math.min(0, ...values), Math.max(0, ...values), gridLines)
    const tickTexts = scale.ticks.map((t) => formatMetric(t, format === 'compact' ? 'compact' : format, { decimals, unit }))
    const widest = Math.max(...tickTexts.map((t) => t.length))
    const catWidest = Math.max(...data.map((d) => d.label.length))

    const padLeft = horizontal ? Math.min(180, Math.max(56, catWidest * TICK_CHAR_W + 12)) : Math.max(34, widest * TICK_CHAR_W + 10)
    const padRight = 14
    const padTop = 14
    const padBottom = horizontal ? 26 : 30

    const innerW = Math.max(40, width - padLeft - padRight)
    const innerH = Math.max(40, plotH - padTop - padBottom)
    const span = scale.max - scale.min || 1

    const toX = (v: number) => padLeft + ((v - scale.min) / span) * innerW
    const toY = (v: number) => padTop + innerH - ((v - scale.min) / span) * innerH

    // Cap the thickness rather than filling the band: the leftover is air, and
    // neighbours are separated by a 2px gap in the surface colour, not a stroke.
    const slotSize = (horizontal ? innerH : innerW) / data.length
    const thickness = Math.max(3, Math.min(MAX_BAR_THICKNESS, slotSize - BAR_GAP))

    return { scale, tickTexts, padLeft, padRight, padTop, padBottom, innerW, innerH, toX, toY, slotSize, thickness }
  }, [data, gridLines, width, plotH, horizontal, format, decimals, unit])

  const labelMode: ValueLabelMode = valueLabels === 'auto' ? (data.length <= 8 ? 'all' : 'extremes') : valueLabels
  const extremes = useMemo(() => {
    if (data.length === 0) return { hi: -1, lo: -1 }
    let hi = 0, lo = 0
    data.forEach((d, i) => {
      if (d.value > data[hi].value) hi = i
      if (d.value < data[lo].value) lo = i
    })
    return { hi, lo }
  }, [data])

  const emphasised = emphasis != null && data.some((d) => d.label === emphasis)

  const colorFor = (index: number) => {
    if (emphasised) return data[index].label === emphasis ? seriesColor(slot - 1) : 'var(--chart-quiet)'
    if (ordinal) return ordinalColor(index, data.length)
    return seriesColor(slot - 1)
  }

  const showLabel = (index: number) =>
    labelMode === 'all' || (labelMode === 'extremes' && (index === extremes.hi || index === extremes.lo))

  const tooltip: TooltipState | null = useMemo(() => {
    if (hover == null || !geometry || !data[hover]) return null
    const d = data[hover]
    const centre = geometry.padTop + geometry.slotSize * (hover + 0.5)
    return horizontal
      ? { x: geometry.padLeft + geometry.innerW / 2, y: centre, heading: d.label, rows: [{ name: 'Valeur', value: fmt(d.value) }] }
      : {
        x: geometry.padLeft + geometry.slotSize * (hover + 0.5),
        y: geometry.toY(d.value),
        heading: d.label,
        rows: [{ name: 'Valeur', value: fmt(d.value) }],
      }
  }, [hover, geometry, data, horizontal, fmt])

  if (data.length === 0 || !geometry) {
    return (
      <ChartFrame title={title} description={description} className={className}>
        <EmptyChart height={plotH} message={emptyMessage} />
      </ChartFrame>
    )
  }

  const g = geometry
  const baseline = horizontal ? g.toX(Math.max(0, g.scale.min)) : g.toY(Math.max(0, g.scale.min))

  return (
    <ChartFrame
      title={title}
      description={description}
      footer={showTableToggle ? <TableToggle open={tableOpen} onToggle={() => setTableOpen((v) => !v)} id={tableId} /> : undefined}
      className={className}
    >
      <div ref={ref} style={{ position: 'relative' }}>
        <svg className="chart__svg" width={width} height={plotH} role="img" aria-label={title ?? 'Graphique en barres'}>
          {/* Grid — solid hairlines, one step off the surface, behind the marks. */}
          {g.scale.ticks.map((t, i) => {
            const p = horizontal ? g.toX(t) : g.toY(t)
            return horizontal
              ? <line key={i} x1={p} x2={p} y1={g.padTop} y2={g.padTop + g.innerH} stroke="var(--chart-grid)" strokeWidth={1} />
              : <line key={i} x1={g.padLeft} x2={g.padLeft + g.innerW} y1={p} y2={p} stroke="var(--chart-grid)" strokeWidth={1} />
          })}

          {/* Ticks */}
          {g.scale.ticks.map((t, i) => {
            const p = horizontal ? g.toX(t) : g.toY(t)
            return (
              <text
                key={`t${i}`}
                x={horizontal ? p : g.padLeft - 8}
                y={horizontal ? g.padTop + g.innerH + 16 : p + 3.5}
                textAnchor={horizontal ? 'middle' : 'end'}
                fontSize={TICK_FONT}
                fill="var(--chart-label)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {g.tickTexts[i]}
              </text>
            )
          })}

          {/* Baseline */}
          {horizontal
            ? <line x1={baseline} x2={baseline} y1={g.padTop} y2={g.padTop + g.innerH} stroke="var(--chart-axis)" strokeWidth={1} />
            : <line x1={g.padLeft} x2={g.padLeft + g.innerW} y1={baseline} y2={baseline} stroke="var(--chart-axis)" strokeWidth={1} />}

          {data.map((d, i) => {
            const centre = (horizontal ? g.padTop : g.padLeft) + g.slotSize * (i + 0.5)
            const start = centre - g.thickness / 2
            const isHover = hover === i
            const path = horizontal
              ? barPath(start, g.thickness, baseline, g.toX(d.value))
              : columnPath(start, g.thickness, baseline, g.toY(d.value))
            const valueText = fmt(d.value)
            const labelX = horizontal ? g.toX(d.value) + 6 : centre
            const labelY = horizontal ? centre + 4 : g.toY(d.value) - 7

            return (
              <g key={d.label + i}>
                <path d={path} fill={colorFor(i)} opacity={isHover ? 0.82 : 1} />
                {showLabel(i) && (
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor={horizontal ? 'start' : 'middle'}
                    fontSize={TICK_FONT}
                    fontWeight={600}
                    fill="var(--ink-secondary)"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {valueText}
                  </text>
                )}
                {/* Category name: on the left rail when horizontal, under the column otherwise. */}
                <text
                  x={horizontal ? g.padLeft - 10 : centre}
                  y={horizontal ? centre + 4 : g.padTop + g.innerH + 18}
                  textAnchor={horizontal ? 'end' : 'middle'}
                  fontSize={TICK_FONT}
                  fill="var(--chart-label)"
                >
                  {d.label.length > (horizontal ? 24 : 12) ? `${d.label.slice(0, horizontal ? 23 : 11)}…` : d.label}
                </text>
                {/* The hit target is the whole slot, not the painted pixels. */}
                <rect
                  x={horizontal ? g.padLeft : centre - g.slotSize / 2}
                  y={horizontal ? centre - g.slotSize / 2 : g.padTop}
                  width={horizontal ? g.innerW : g.slotSize}
                  height={horizontal ? g.slotSize : g.innerH}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                />
              </g>
            )
          })}
        </svg>
        <ChartTooltip state={tooltip} />
      </div>
      <div id={tableId}>
        <ChartTable
          visible={tableOpen}
          caption={title ?? 'Valeurs du graphique'}
          columns={['Valeur']}
          rows={data.map((d) => ({ label: d.label, values: [fmt(d.value)] }))}
        />
      </div>
    </ChartFrame>
  )
}

// ═══ LineChart ═══════════════════════════════════════════════════════
export interface LineChartProps {
  /** One list, one Y scale. Two units means two charts — never a second axis. */
  series: ChartSeries[]
  height?: number
  format?: ValueFormat
  unit?: string
  decimals?: number
  /** Area wash under the line. Honoured for a single series only. */
  area?: boolean
  /** For rank-like metrics where 1 is best (Search Console position). */
  invertY?: boolean
  gridLines?: number
  legend?: boolean
  directLabels?: boolean
  title?: string
  description?: string
  tableView?: boolean
  showTableToggle?: boolean
  emptyMessage?: string
  className?: string
}

export function LineChart({
  series,
  height = 240,
  format = 'number',
  unit,
  decimals,
  area = false,
  invertY = false,
  gridLines = 4,
  legend,
  directLabels = true,
  title,
  description,
  tableView = false,
  showTableToggle = true,
  emptyMessage = 'Aucune donnée sur cette période.',
  className,
}: LineChartProps) {
  const uid = useId()
  const tableId = `${uid}-table`
  const [tableOpen, setTableOpen] = useState(tableView)
  const [cursor, setCursor] = useState<number | null>(null)
  const { ref, width } = useMeasuredWidth()

  const fmt = useCallback(
    (v: number) => formatMetric(v, format, { decimals, unit }),
    [format, decimals, unit],
  )

  const live = useMemo(() => series.filter((s) => s.points.length > 0), [series])
  // Memoised so the tooltip's useMemo below does not see a fresh array on every
  // render — the x labels change only when the series do.
  const xLabels = useMemo(() => live[0]?.points.map((p) => p.label) ?? [], [live])
  const pointCount = xLabels.length

  const geometry = useMemo(() => {
    if (pointCount === 0) return null
    const values = live.flatMap((s) => s.points.map((p) => p.value)).filter(Number.isFinite)
    if (values.length === 0) return null
    const scale = niceScale(Math.min(...values), Math.max(...values), gridLines)
    const tickTexts = scale.ticks.map((t) => formatMetric(t, format, { decimals, unit }))
    const widest = Math.max(...tickTexts.map((t) => t.length))

    const padLeft = Math.max(34, widest * TICK_CHAR_W + 10)
    const padRight = directLabels && live.length <= 4 ? 56 : 16
    const padTop = 14
    const padBottom = 26
    const innerW = Math.max(40, width - padLeft - padRight)
    const innerH = Math.max(40, height - padTop - padBottom)
    const span = scale.max - scale.min || 1

    const toX = (i: number) => padLeft + (pointCount === 1 ? innerW / 2 : (i / (pointCount - 1)) * innerW)
    const toY = (v: number) => {
      const t = (v - scale.min) / span
      return padTop + (invertY ? t * innerH : innerH - t * innerH)
    }
    return { scale, tickTexts, padLeft, padRight, padTop, padBottom, innerW, innerH, toX, toY }
  }, [live, pointCount, gridLines, width, height, invertY, directLabels, format, decimals, unit])

  const showLegend = legend ?? live.length > 1

  // Direct end-labels only when they will not collide; otherwise the legend carries it.
  const endLabels = useMemo(() => {
    if (!geometry || !directLabels || live.length > 4) return null
    const ys = live.map((s) => {
      const last = s.points[s.points.length - 1]
      return last ? geometry.toY(last.value) : null
    })
    if (ys.some((y) => y === null)) return null
    const sorted = [...(ys as number[])].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] < 14) return null
    return ys as number[]
  }, [geometry, directLabels, live])

  const onPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!geometry || pointCount === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const ratio = (x - geometry.padLeft) / (geometry.innerW || 1)
    const index = Math.round(ratio * Math.max(1, pointCount - 1))
    setCursor(Math.max(0, Math.min(pointCount - 1, index)))
  }, [geometry, pointCount])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (pointCount === 0) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setCursor((c) => {
        const next = (c ?? 0) + (event.key === 'ArrowRight' ? 1 : -1)
        return Math.max(0, Math.min(pointCount - 1, next))
      })
    } else if (event.key === 'Home') { event.preventDefault(); setCursor(0) }
    else if (event.key === 'End') { event.preventDefault(); setCursor(pointCount - 1) }
    else if (event.key === 'Escape') setCursor(null)
  }, [pointCount])

  const tooltip: TooltipState | null = useMemo(() => {
    if (cursor == null || !geometry) return null
    const rows = live.map((s, i) => {
      const p = s.points[cursor]
      return { name: s.name, value: p ? fmt(p.value) : '—', color: slotColor(s, i) }
    })
    const anchor = live
      .map((s) => s.points[cursor])
      .filter(Boolean)
      .map((p) => geometry.toY(p.value))
    return {
      x: geometry.toX(cursor),
      y: anchor.length > 0 ? Math.min(...anchor) : geometry.padTop,
      heading: xLabels[cursor] ?? '',
      rows,
    }
  }, [cursor, geometry, live, xLabels, fmt])

  if (pointCount === 0 || !geometry) {
    return (
      <ChartFrame title={title} description={description} className={className}>
        <EmptyChart height={height} message={emptyMessage} />
      </ChartFrame>
    )
  }

  const g = geometry
  const xTickEvery = Math.max(1, Math.ceil(pointCount / Math.max(2, Math.floor(g.innerW / 72))))

  return (
    <ChartFrame
      title={title}
      description={description}
      legend={showLegend ? (
        <div className="chart-legend">
          {live.map((s, i) => (
            <span key={s.id} className="chart-legend__item">
              <span className="chart-legend__rule" style={{ background: slotColor(s, i) }} aria-hidden="true" />
              {s.name}
            </span>
          ))}
        </div>
      ) : undefined}
      footer={showTableToggle ? <TableToggle open={tableOpen} onToggle={() => setTableOpen((v) => !v)} id={tableId} /> : undefined}
      className={className}
    >
      <div ref={ref} style={{ position: 'relative' }}>
        <svg
          className="chart__svg"
          width={width}
          height={height}
          role="img"
          aria-label={title ?? 'Graphique en courbes'}
          tabIndex={0}
          onPointerMove={onPointer}
          onPointerLeave={() => setCursor(null)}
          onKeyDown={onKeyDown}
        >
          {g.scale.ticks.map((t, i) => (
            <g key={i}>
              <line x1={g.padLeft} x2={g.padLeft + g.innerW} y1={g.toY(t)} y2={g.toY(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={g.padLeft - 8} y={g.toY(t) + 3.5} textAnchor="end" fontSize={TICK_FONT} fill="var(--chart-label)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {g.tickTexts[i]}
              </text>
            </g>
          ))}

          <line x1={g.padLeft} x2={g.padLeft + g.innerW} y1={g.padTop + g.innerH} y2={g.padTop + g.innerH} stroke="var(--chart-axis)" strokeWidth={1} />

          {xLabels.map((label, i) => (i % xTickEvery === 0 || i === pointCount - 1) && (
            <text key={i} x={g.toX(i)} y={g.padTop + g.innerH + 17} textAnchor={i === pointCount - 1 ? 'end' : i === 0 ? 'start' : 'middle'} fontSize={TICK_FONT} fill="var(--chart-label)">
              {label}
            </text>
          ))}

          {/* The crosshair finds the X: the reader aims at a date, not at a 2px line. */}
          {cursor != null && (
            <line x1={g.toX(cursor)} x2={g.toX(cursor)} y1={g.padTop} y2={g.padTop + g.innerH} stroke="var(--line-strong)" strokeWidth={1} />
          )}

          {live.map((s, i) => {
            const colour = slotColor(s, i)
            const d = s.points
              .map((p, j) => `${j === 0 ? 'M' : 'L'}${g.toX(j).toFixed(2)},${g.toY(p.value).toFixed(2)}`)
              .join('')
            const last = s.points[s.points.length - 1]
            return (
              <g key={s.id}>
                {area && live.length === 1 && (
                  <path
                    d={`${d}L${g.toX(s.points.length - 1)},${g.padTop + g.innerH}L${g.toX(0)},${g.padTop + g.innerH}Z`}
                    fill={colour}
                    opacity={0.1}
                  />
                )}
                <path d={d} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {cursor != null && s.points[cursor] && (
                  <circle cx={g.toX(cursor)} cy={g.toY(s.points[cursor].value)} r={4} fill={colour} stroke="var(--chart-surface)" strokeWidth={2} />
                )}
                {endLabels && last && (
                  <text x={g.toX(s.points.length - 1) + 8} y={endLabels[i] + 4} fontSize={TICK_FONT} fontWeight={600} fill="var(--ink-secondary)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(last.value)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <ChartTooltip state={tooltip} />
      </div>
      <div id={tableId}>
        <ChartTable
          visible={tableOpen}
          caption={title ?? 'Valeurs du graphique'}
          columns={live.map((s) => s.name)}
          rows={xLabels.map((label, i) => ({
            label,
            values: live.map((s) => (s.points[i] ? fmt(s.points[i].value) : '—')),
          }))}
        />
      </div>
    </ChartFrame>
  )
}

// ═══ Tabs ════════════════════════════════════════════════════════════
export interface TabItem {
  id: string
  label: string
  /** Shown as a pill after the label — e.g. how many rows the tab holds. */
  count?: number
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  /** `underline` for page sections, `segmented` for switching a view mode. */
  variant?: 'underline' | 'segmented'
  /** Required for assistive tech when the tablist has no visible heading. */
  ariaLabel?: string
  /** When given, it is wrapped in the tabpanel and wired to the active tab. */
  children?: ReactNode
  className?: string
}

export function Tabs({ items, value, onChange, variant = 'underline', ariaLabel, children, className }: TabsProps) {
  const uid = useId()
  const listRef = useRef<HTMLDivElement | null>(null)
  const enabled = items.filter((i) => !i.disabled)

  const move = (delta: number) => {
    if (enabled.length === 0) return
    const current = enabled.findIndex((i) => i.id === value)
    const next = enabled[(current + delta + enabled.length) % enabled.length]
    onChange(next.id)
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(next.id)}"]`)?.focus()
    })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': event.preventDefault(); move(1); break
      case 'ArrowLeft': case 'ArrowUp': event.preventDefault(); move(-1); break
      case 'Home': event.preventDefault(); if (enabled[0]) onChange(enabled[0].id); break
      case 'End': event.preventDefault(); if (enabled.length) onChange(enabled[enabled.length - 1].id); break
      default: break
    }
  }

  const segmented = variant === 'segmented'

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        className={segmented ? 'segmented' : 'tabs__list'}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => {
          const selected = item.id === value
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${uid}-tab-${item.id}`}
              data-tab-id={item.id}
              aria-selected={selected}
              aria-controls={children ? `${uid}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={segmented ? 'segmented__tab' : 'tabs__tab'}
              onClick={() => !item.disabled && onChange(item.id)}
            >
              {item.label}
              {item.count !== undefined && <span className="tabs__count">{item.count}</span>}
            </button>
          )
        })}
      </div>
      {children && (
        <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${value}`} tabIndex={0}>
          {children}
        </div>
      )}
    </div>
  )
}

// ═══ SiteSwitcher ════════════════════════════════════════════════════
export interface SiteOption {
  id: string
  name: string
  url?: string
  /** Free-form connector label ("wordpress", "nextjs") shown as a chip. */
  type?: string
}

export interface SiteSwitcherProps {
  sites: SiteOption[]
  /** `null` (or absent) means the "all sites" row is selected. */
  value?: string | null
  /** Given: the caller owns the state. Absent: the switcher navigates itself. */
  onChange?: (siteId: string | null) => void
  /** Navigation fallback — used only when `onChange` is not supplied. */
  basePath?: string
  paramName?: string
  /** Set to `null` to force a site to always be selected. */
  allLabel?: string | null
  label?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

export function SiteSwitcher({
  sites,
  value = null,
  onChange,
  basePath,
  paramName = 'site',
  allLabel = 'Tous les sites',
  label = 'Site',
  size = 'md',
  disabled = false,
  className,
}: SiteSwitcherProps) {
  const uid = useId()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const options = useMemo(
    () => (allLabel === null ? sites.map((s) => ({ ...s })) : [{ id: '', name: allLabel } as SiteOption, ...sites]),
    [sites, allLabel],
  )
  const selectedIndex = Math.max(0, options.findIndex((o) => (o.id || null) === (value || null)))
  const selected = options[selectedIndex]

  /**
   * Opening the list highlights the current row. Done here, at the moment of
   * the gesture, rather than inside the effect below: setting state in an
   * effect body schedules a second render for something already known when the
   * click happened, and React Compiler (enabled in next.config.ts) flags it.
   */
  const openList = () => {
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  // The effect now does one thing only: subscribe to the outside click.
  useEffect(() => {
    if (!open) return
    const onDocDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const commit = (option: SiteOption) => {
    const next = option.id === '' ? null : option.id
    setOpen(false)
    buttonRef.current?.focus()
    if (onChange) { onChange(next); return }
    if (!basePath) return
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
    if (next) params.set(paramName, next)
    else params.delete(paramName)
    const query = params.toString()
    router.push(query ? `${basePath}?${query}` : basePath)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openList() }
      return
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActiveIndex((i) => Math.min(options.length - 1, i + 1)); break
      case 'ArrowUp': event.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); break
      case 'Home': event.preventDefault(); setActiveIndex(0); break
      case 'End': event.preventDefault(); setActiveIndex(options.length - 1); break
      case 'Escape': event.preventDefault(); setOpen(false); buttonRef.current?.focus(); break
      case 'Enter': case ' ': event.preventDefault(); if (options[activeIndex]) commit(options[activeIndex]); break
      default: break
    }
  }

  if (options.length === 0) return null

  return (
    <div ref={rootRef} className={className} style={{ position: 'relative', minWidth: size === 'sm' ? 180 : 232 }} onKeyDown={onKeyDown}>
      <span id={`${uid}-label`} className="sr-only">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className={`btn-secondary ${size === 'sm' ? 'btn-sm' : ''}`.trim()}
        style={{ width: '100%', justifyContent: 'space-between', fontWeight: 500 }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${uid}-label ${uid}-button`}
        id={`${uid}-button`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
          <Globe size={14} color="var(--ink-muted)" />
          <span className="truncate">{selected?.name ?? label}</span>
        </span>
        <ChevronsUpDown size={13} color="var(--ink-muted)" />
      </button>

      {open && (
        <ul className="popover" role="listbox" aria-labelledby={`${uid}-label`} tabIndex={-1}>
          {options.map((option, index) => {
            const isSelected = (option.id || null) === (value || null)
            return (
              <li
                key={option.id || '__all__'}
                role="option"
                aria-selected={isSelected}
                data-active={index === activeIndex}
                className="popover__option"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(option)}
              >
                <Check size={13} style={{ opacity: isSelected ? 1 : 0 }} color="var(--accent-text)" />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="truncate" style={{ display: 'block' }}>{option.name}</span>
                  {option.url && <span className="meta truncate" style={{ display: 'block' }}>{option.url}</span>}
                </span>
                {option.type && <span className="chip">{option.type}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ═══ Modal ═══════════════════════════════════════════════════════════
/**
 * The one dialog. Three hand-written boxes preceded it — the slot detail of
 * /calendar, the cycle plan of /strategy, the extractor wizard of ui.tsx —
 * each with its own Escape listener, its own z-index constant and its own idea
 * of where the focus goes. It lives here and not in ui.tsx for the reason that
 * file's header states: ui.tsx has no 'use client' so server pages can pass
 * `icon={Globe}` straight in, and a dialog needs state, the keyboard and focus.
 *
 * No portal: nothing in this repo uses react-dom/createPortal, and the scrim is
 * already `position: fixed` at the modal layer, so a portal would buy nothing.
 */

/**
 * The scrim pads itself by --space-6 on each side and --space-12 is exactly
 * twice that, so the panel can never claim more room than the scrim leaves it.
 */
const MODAL_MAX_HEIGHT = 'calc(100vh - var(--space-12))'

/** `md` is the slot detail of /calendar; `lg` the cycle plan, whose body is a table. */
const MODAL_SIZES = { md: 580, lg: 1000 } as const

/** When the caller names no width at all. */
const MODAL_DEFAULT_WIDTH = 720

/**
 * Tab order inside the panel. `:not([disabled])` earns its place: while a
 * confirmation is in flight both footer buttons are disabled, and the trap must
 * cycle past them instead of parking the focus on a dead control.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  /** Absent means open: a caller that mounts the dialog conditionally already said so. */
  open?: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  /** Stays put while the body scrolls — this is where a confirming button belongs. */
  footer?: ReactNode
  size?: 'md' | 'lg'
  /**
   * One-off width in pixels. `maxWidth` is the same knob under the name the
   * call sites of this lot were written against; a shared dialog that fails to
   * compile at one of them is worse than one alias.
   */
  width?: number
  maxWidth?: number
  /**
   * Unpadded on purpose: wrap in `.panel__body` for the standard padding, or
   * pad your own regions when the body holds a `.scroll-x` that must reach the
   * panel edges, as the cycle plan does.
   */
  children: ReactNode
}

export function Modal({ open = true, onClose, title, subtitle, footer, size, width, maxWidth, children }: ModalProps) {
  const uid = useId()
  const titleId = `${uid}-title`
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  /**
   * Focus in, then focus back out to whatever opened the dialog. Without the
   * second half the keyboard user lands back at the top of the document, which
   * is how a "close" gesture turns into losing your place in a long table.
   */
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => opener?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // The page behind must not scroll under the scrim: a wheel gesture that
    // moves the page while a dialog is up reads as a broken dialog.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (stops.length === 0) return
    const first = stops[0]
    const last = stops[stops.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        // The token itself, not a copy of its value: the two `MODAL_Z = 100`
        // constants this replaces were justified by a comment claiming csstype
        // refuses a custom property here. The installed version does not — its
        // ZIndex union carries `(string & {})`, verified against node_modules.
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        background: 'var(--surface-scrim)', padding: 'var(--space-6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        ref={panelRef}
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onPanelKeyDown}
        style={{
          width: '100%',
          maxWidth: width ?? maxWidth ?? (size ? MODAL_SIZES[size] : MODAL_DEFAULT_WIDTH),
          // Flex column with the body as the ONLY scroller. An overflow on the
          // panel itself would carry the header and the confirming button out
          // of sight on a short screen, and cancel the body's own .scroll-x.
          maxHeight: MODAL_MAX_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div className="panel__header" style={{ flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title" id={titleId}>{title}</h2>
            {subtitle && <div className="meta">{subtitle}</div>}
          </div>
          <button ref={closeRef} type="button" className="btn-icon" onClick={onClose} aria-label="Fermer">
            <X size={15} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>{children}</div>

        {footer && <div className="panel__footer" style={{ flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  )
}

// ═══ ConfirmModal ════════════════════════════════════════════════════
/** A label that does not say what is about to happen. Refused in development. */
const GENERIC_CONFIRM_LABELS = ['confirmer', 'ok', 'valider', 'oui']

export interface ConfirmModalProps {
  open?: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  body: ReactNode
  /**
   * Repeats the VERB of the act — « Remplacer le contenu de cette page ».
   * « Confirmer », « OK », « Valider » and « Oui » are refused: a generic verb
   * in front of an irreversible write is how a page nobody meant to lose is lost.
   */
  confirmLabel: string
  cancelLabel?: string
  /**
   * `danger` means something the owner already has is about to be overwritten.
   * It is the tone that has to name what gets replaced, in `title` and `body`.
   */
  tone?: 'neutral' | 'danger'
  /** The caller's own in-flight flag. Disables both buttons. */
  busy?: boolean
  /** Controls that qualify the act — a scope choice, for instance. */
  children?: ReactNode
}

export function ConfirmModal({
  open = true, onClose, onConfirm, title, body,
  confirmLabel, cancelLabel = 'Annuler', tone = 'neutral', busy = false, children,
}: ConfirmModalProps) {
  const [pending, setPending] = useState(false)
  const danger = tone === 'danger'
  const inFlight = busy || pending

  // Same idea as seriesColor above: the rule is stated where it is broken,
  // in development, rather than discovered on a screenshot after release.
  useEffect(() => {
    if (!open || process.env.NODE_ENV === 'production') return
    if (GENERIC_CONFIRM_LABELS.includes(confirmLabel.trim().toLowerCase())) {
      console.warn(`[ConfirmModal] « ${confirmLabel} » ne dit pas ce qui va se passer. Reprenez le verbe de l'acte, par exemple « Remplacer le contenu de cette page ».`)
    }
  }, [open, confirmLabel])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={onClose} disabled={inFlight}>{cancelLabel}</Button>
          {/* The destructive act carries a glyph as well as the red: colour
              alone is not a warning for a reader who cannot see it. */}
          <Button
            variant={danger ? 'danger' : 'primary'}
            icon={danger ? TriangleAlert : undefined}
            loading={inFlight}
            onClick={async () => {
              setPending(true)
              try { await onConfirm() } finally { setPending(false) }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {danger ? (
          <div
            className="inset"
            style={{ borderLeft: '3px solid var(--status-critical)', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}
          >
            <TriangleAlert size={16} color="var(--status-critical)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            {/* --ink-secondary, not .meta: --ink-muted on --surface-inset is
                4,42:1, under AA, and this is the text the decision rests on. */}
            <div style={{ color: 'var(--ink-secondary)' }}>{body}</div>
          </div>
        ) : (
          <div style={{ color: 'var(--ink-secondary)' }}>{body}</div>
        )}
        {children}
      </div>
    </Modal>
  )
}
