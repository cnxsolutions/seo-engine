'use client'

import { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'
import Link from 'next/link'

// ─── Badge ─────────────────────────────────────────────────────────────────────

interface BadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'wordpress' | 'sanity'
  size?: 'sm' | 'md'
}

export function Badge({ children, variant = 'default', size = 'sm' }: BadgeProps) {
  const variants = {
    default: 'bg-white/10 text-white/80',
    success: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    warning: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    error: 'bg-red-500/20 text-red-400 border border-red-500/30',
    wordpress: 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30',
    sanity: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  }

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${variants[variant]} ${sizes[size]}`}>
      {children}
    </span>
  )
}

// ─── PageHeader ─────────────────────────────────────────────────────────────────

interface PageHeaderProps {
  icon: LucideIcon
  iconColor?: string
  badge: string
  title: string
  subtitle?: string
  action?: { label: string; href?: string; onClick?: () => void }
}

export function PageHeader({ icon: Icon, iconColor = '#5347ce', badge, title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${iconColor}12` }}>
            <Icon size={15} color={iconColor} strokeWidth={2.2} />
          </div>
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: iconColor }}>
            {badge}
          </span>
        </div>
        <h1 className="section-title">{title}</h1>
        {subtitle && <p className="section-subtitle">{subtitle}</p>}
      </div>
      {action && (
        action.href
          ? <Link href={action.href}><button className="btn-primary">{action.label}</button></Link>
          : <button className="btn-primary" onClick={action.onClick}>{action.label}</button>
      )}
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
}

export function Card({ children, className = '', hover = false }: CardProps) {
  return (
    <div
      className={`
        rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm
        ${hover ? 'hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  )
}

// ─── Card Header ──────────────────────────────────────────────────────────────

interface CardHeaderProps {
  title: string
  subtitle?: string
  icon?: LucideIcon
  iconColor?: string
  action?: ReactNode
}

export function CardHeader({ title, subtitle, icon: Icon, iconColor = '#6366f1', action }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between p-5 border-b border-white/5">
      <div className="flex items-center gap-3">
        {Icon && (
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${iconColor}20` }}
          >
            <Icon size={20} style={{ color: iconColor }} />
          </div>
        )}
        <div>
          <h3 className="font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-sm text-white/50 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────

interface ButtonProps {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  className?: string
  type?: 'button' | 'submit'
  icon?: LucideIcon
  iconPosition?: 'left' | 'right'
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
  className = '',
  type = 'button',
  icon: Icon,
  iconPosition = 'left',
}: ButtonProps) {
  const variants = {
    primary: 'bg-indigo-500 hover:bg-indigo-600 text-white border border-indigo-400/30',
    secondary: 'bg-white/10 hover:bg-white/15 text-white border border-white/20',
    ghost: 'bg-transparent hover:bg-white/10 text-white/80 border border-transparent',
    danger: 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-sm gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-2',
  }

  const iconSizes = { sm: 14, md: 16, lg: 18 }

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`
        inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]} ${className}
      `}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <>
          {Icon && iconPosition === 'left' && <Icon size={iconSizes[size]} />}
          {children}
          {Icon && iconPosition === 'right' && <Icon size={iconSizes[size]} />}
        </>
      )}
    </button>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────

interface InputProps {
  label?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password' | 'url' | 'number'
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

export function Input({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
  error,
  hint,
  required = false,
  disabled = false,
  className = '',
}: InputProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-white/80">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`
          w-full px-3 py-2 rounded-lg bg-white/5 border text-white placeholder-white/30
          focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? 'border-red-500/50' : 'border-white/10'}
          transition-all duration-200
        `}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-white/40">{hint}</p>}
    </div>
  )
}

// ─── Select ───────────────────────────────────────────────────────────────────

interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  label?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  error?: string
  disabled?: boolean
  className?: string
}

export function Select({
  label,
  placeholder = 'Sélectionner...',
  value,
  onChange,
  options,
  error,
  disabled = false,
  className = '',
}: SelectProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && <label className="block text-sm font-medium text-white/80">{label}</label>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`
          w-full px-3 py-2 rounded-lg bg-white/5 border text-white appearance-none cursor-pointer
          focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? 'border-red-500/50' : 'border-white/10'}
          transition-all duration-200
        `}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.75rem center',
          backgroundSize: '1rem',
        }}
      >
        <option value="" disabled className="bg-slate-900">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-slate-900">
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

// ─── Textarea ─────────────────────────────────────────────────────────────────

interface TextareaProps {
  label?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  rows?: number
  error?: string
  disabled?: boolean
  className?: string
}

export function Textarea({
  label,
  placeholder,
  value,
  onChange,
  rows = 4,
  error,
  disabled = false,
  className = '',
}: TextareaProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && <label className="block text-sm font-medium text-white/80">{label}</label>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={`
          w-full px-3 py-2 rounded-lg bg-white/5 border text-white placeholder-white/30
          focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50
          disabled:opacity-50 disabled:cursor-not-allowed resize-none
          ${error ? 'border-red-500/50' : 'border-white/10'}
          transition-all duration-200
        `}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

// ─── Progress ──────────────────────────────────────────────────────────────────

interface ProgressProps {
  value: number
  max?: number
  label?: string
  showValue?: boolean
  color?: string
}

export function Progress({
  value,
  max = 100,
  label,
  showValue = true,
  color = '#6366f1',
}: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div className="space-y-1.5">
      {(label || showValue) && (
        <div className="flex items-center justify-between text-sm">
          {label && <span className="text-white/60">{label}</span>}
          {showValue && <span className="text-white/80 font-mono">{percentage.toFixed(0)}%</span>}
        </div>
      )}
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

interface ToggleProps {
  label?: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: ToggleProps) {
  return (
    <label className={`flex items-start gap-3 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`
          relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 mt-0.5
          ${checked ? 'bg-indigo-500' : 'bg-white/20'}
        `}
      >
        <span
          className={`
            absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200
            ${checked ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </button>
      {(label || description) && (
        <div className="flex flex-col">
          {label && <span className="text-sm font-medium text-white">{label}</span>}
          {description && <span className="text-xs text-white/50">{description}</span>}
        </div>
      )}
    </label>
  )
}

// ─── Spinner ───────────────────────────────────────────────────────────────────

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }

  return (
    <div className={`${sizes[size]} border-2 border-current border-t-transparent rounded-full animate-spin ${className}`} />
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
        <Icon size={32} className="text-white/30" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-white/50 max-w-sm mb-6">{description}</p>
      {action}
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

interface Tab {
  id: string
  label: string
  icon?: LucideIcon
  badge?: string | number
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onChange: (tabId: string) => void
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 p-1 bg-white/5 rounded-lg border border-white/10">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab
        const Icon = tab.icon

        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200
              ${isActive
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-white/60 hover:text-white hover:bg-white/5'
              }
            `}
          >
            {Icon && <Icon size={16} />}
            {tab.label}
            {tab.badge !== undefined && (
              <span className={`
                px-1.5 py-0.5 rounded text-xs
                ${isActive ? 'bg-indigo-500/30 text-indigo-300' : 'bg-white/10 text-white/50'}
              `}>
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Divider ──────────────────────────────────────────────────────────────────

interface DividerProps {
  label?: string
}

export function Divider({ label }: DividerProps) {
  if (!label) {
    return <div className="h-px bg-white/10" />
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 h-px bg-white/10" />
      <span className="text-xs text-white/40 uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color?: string
  trend?: { value: number; positive: boolean }
}

export function StatCard({ label, value, icon: Icon, color = '#6366f1', trend }: StatCardProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-white/50">{label}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {trend && (
            <p className={`text-xs mt-1 ${trend.positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {trend.positive ? '↑' : '↓'} {Math.abs(trend.value)}%
            </p>
          )}
        </div>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon size={20} style={{ color }} />
        </div>
      </div>
    </div>
  )
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipProps {
  content: string
  children: ReactNode
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <div className="relative group inline-block">
      {children}
      <div className="
        absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5
        bg-slate-800 text-white text-xs rounded-lg shadow-xl
        opacity-0 invisible group-hover:opacity-100 group-hover:visible
        transition-all duration-200 whitespace-nowrap z-50
        before:content-[''] before:absolute before:top-full before:left-1/2 before:-translate-x-1/2
        before:border-4 before:border-transparent before:border-t-slate-800
      ">
        {content}
      </div>
    </div>
  )
}

// ─── Alert ─────────────────────────────────────────────────────────────────────

interface AlertProps {
  type?: 'info' | 'success' | 'warning' | 'error'
  title?: string
  children: ReactNode
  onDismiss?: () => void
}

export function Alert({ type = 'info', title, children, onDismiss }: AlertProps) {
  const styles = {
    info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: 'text-blue-400', title: 'text-blue-300' },
    success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'text-emerald-400', title: 'text-emerald-300' },
    warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'text-amber-400', title: 'text-amber-300' },
    error: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: 'text-red-400', title: 'text-red-300' },
  }

  const style = styles[type]

  return (
    <div className={`${style.bg} border ${style.border} rounded-lg p-4 ${onDismiss ? 'pr-10' : ''} relative`}>
      {title && <h4 className={`font-medium ${style.title} mb-1`}>{title}</h4>}
      <div className="text-sm text-white/70">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 text-white/40 hover:text-white transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ─── Code Block ───────────────────────────────────────────────────────────────

interface CodeBlockProps {
  code: string
  language?: string
  maxHeight?: string
}

export function CodeBlock({ code, language = 'json', maxHeight = '400px' }: CodeBlockProps) {
  return (
    <div className="relative rounded-lg border border-white/10 bg-slate-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/60" />
            <span className="w-3 h-3 rounded-full bg-amber-500/60" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/60" />
          </div>
          <span className="text-xs text-white/40 ml-2">{language.toUpperCase()}</span>
        </div>
      </div>
      <pre
        className="p-4 text-sm text-emerald-400 overflow-auto font-mono"
        style={{ maxHeight }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}
