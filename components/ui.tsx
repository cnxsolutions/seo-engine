import { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import React from 'react'

// ── PageHeader ──────────────────────────────────────────────
interface PageHeaderProps {
  icon: LucideIcon
  iconColor?: string
  badge: string
  title: string
  subtitle?: string
  action?: { label: string; href?: string; onClick?: () => void; icon?: LucideIcon }
}

export function PageHeader({ icon: Icon, iconColor = '#5347ce', badge, title, subtitle, action }: PageHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: `${iconColor}12`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={15} color={iconColor} strokeWidth={2.2} />
          </div>
          <span style={{ fontSize: '0.72rem', color: iconColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {badge}
          </span>
        </div>
        <h1 className="section-title">{title}</h1>
        {subtitle && <p className="section-subtitle">{subtitle}</p>}
      </div>
      {action && (
        action.href
          ? <Link href={action.href}><button className="btn-primary" style={{ gap: 6, display: 'flex', alignItems: 'center' }}>
            {action.icon && <action.icon size={15} />}{action.label}</button></Link>
          : <button className="btn-primary" onClick={action.onClick} style={{ gap: 6, display: 'flex', alignItems: 'center' }}>
            {action.icon && <action.icon size={15} />}{action.label}</button>
      )}
    </div>
  )
}

// ── FormField ───────────────────────────────────────────────
interface FormFieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

export function FormField({ label, hint, children }: FormFieldProps) {
  return (
    <div>
      <label style={{
        fontSize: '0.75rem',
        color: 'var(--text-secondary)',
        fontWeight: 600,
        display: 'block',
        marginBottom: '0.4rem',
      }}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: 'var(--accent)', marginLeft: 8 }}>{hint}</span>}
      </label>
      {children}
    </div>
  )
}

// ── EmptyState ──────────────────────────────────────────────
interface EmptyStateProps {
  icons?: React.ReactNode[]
  title: string
  description: string
  action?: { label: string; href: string }
}

export function EmptyState({ icons, title, description, action }: EmptyStateProps) {
  return (
    <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
      {icons && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          {icons}
        </div>
      )}
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>{title}</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', maxWidth: 400, margin: '0 auto 1.5rem' }}>
        {description}
      </p>
      {action && (
        <Link href={action.href}>
          <button className="btn-primary">{action.label}</button>
        </Link>
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

export function IconBox({ icon: Icon, color, size = 20, boxSize = 40 }: IconBoxProps) {
  return (
    <div style={{
      width: boxSize, height: boxSize, minWidth: boxSize,
      background: `${color}12`,
      borderRadius: Math.round(boxSize * 0.25),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={size} color={color} strokeWidth={2} />
    </div>
  )
}

// ── StatusBadge ─────────────────────────────────────────────
const STATUS_STYLES: Record<string, { cls: string; label: string }> = {
  published:   { cls: 'badge badge-success', label: 'Publié' },
  generated:   { cls: 'badge badge-info',    label: 'Généré' },
  pending:     { cls: 'badge badge-warning',  label: 'En attente' },
  generating:  { cls: 'badge badge-warning',  label: 'En cours...' },
  publishing:  { cls: 'badge badge-info',     label: 'Publication...' },
  failed:      { cls: 'badge badge-danger',   label: 'Erreur' },
  rejected:    { cls: 'badge badge-muted',    label: 'Rejeté' },
  draft:       { cls: 'badge badge-muted',    label: 'Brouillon' },
  active:      { cls: 'badge badge-success',  label: 'Actif' },
  inactive:    { cls: 'badge badge-muted',    label: 'Inactif' },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { cls: 'badge badge-muted', label: status }
  return <span className={s.cls}>{s.label}</span>
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
}: ButtonProps) {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  }

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`${variants[variant]} ${className}`}
    >
      {loading ? '...' : children}
    </button>
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

export function SchemaField({ name, type, required, description, children }: SchemaFieldProps) {
  const typeColors: Record<string, string> = {
    'text': '#6366f1',
    'html': '#8b5cf6',
    'rich-text': '#8b5cf6',
    'number': '#f59e0b',
    'boolean': '#10b981',
    'image': '#ec4899',
    'gallery': '#ec4899',
    'file': '#6b7280',
    'url': '#3b82f6',
    'email': '#3b82f6',
    'slug': '#14b8a6',
    'select': '#f97316',
    'reference': '#8b5cf6',
    'block-content': '#06b6d4',
    'group': '#71717a',
    'repeater': '#a855f7',
    'meta': '#22c55e',
    'array': '#a855f7',
  }

  const color = typeColors[type] || '#6366f1'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.75rem',
      padding: '0.75rem',
      background: 'var(--bg-card)',
      borderRadius: 8,
      border: '1px solid var(--border)',
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        marginTop: 6,
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <code style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{name}</code>
          <span style={{
            fontSize: '0.65rem',
            padding: '0.15rem 0.4rem',
            borderRadius: 4,
            background: `${color}15`,
            color: color,
            fontWeight: 600,
          }}>
            {type}
          </span>
          {required && (
            <span style={{
              fontSize: '0.65rem',
              padding: '0.15rem 0.4rem',
              borderRadius: 4,
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
              fontWeight: 600,
            }}>
              REQUIS
            </span>
          )}
        </div>
        {description && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{description}</p>
        )}
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
    <div style={{
      borderRadius: 12,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      background: 'var(--bg-card)',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
        className="hover:bg-white/5 transition-colors"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'var(--accent-lighter)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{ fontSize: '1.1rem' }}>📋</span>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{name}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <span style={{
              fontSize: '0.7rem',
              padding: '0.2rem 0.5rem',
              borderRadius: 4,
              background: 'rgba(99, 102, 241, 0.15)',
              color: '#818cf8',
              fontWeight: 600,
            }}>
              {fieldCount} champs
            </span>
            {requiredCount > 0 && (
              <span style={{
                fontSize: '0.7rem',
                padding: '0.2rem 0.5rem',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                fontWeight: 600,
              }}>
                {requiredCount} requis
              </span>
            )}
          </div>
          <span style={{
            color: 'var(--text-muted)',
            transition: 'transform 0.2s',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>
            ▼
          </span>
        </div>
      </button>
      {isExpanded && children && (
        <div style={{
          padding: '0 1.25rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}>
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

export function SeoConfigBadge({ plugin, schemaTypes = [] }: SeoConfigBadgeProps) {
  const pluginLabels: Record<string, { label: string; color: string }> = {
    rankmath: { label: 'RankMath', color: '#16a34a' },
    yoast: { label: 'Yoast SEO', color: '#16a34a' },
    'all-in-one': { label: 'All in One', color: '#16a34a' },
    custom: { label: 'SEO Custom', color: '#f59e0b' },
  }

  const pluginInfo = plugin ? pluginLabels[plugin] : null

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.5rem',
      alignItems: 'center',
    }}>
      {pluginInfo && (
        <span style={{
          fontSize: '0.7rem',
          padding: '0.25rem 0.6rem',
          borderRadius: 6,
          background: `${pluginInfo.color}15`,
          color: pluginInfo.color,
          fontWeight: 600,
        }}>
          ✓ {pluginInfo.label}
        </span>
      )}
      {!pluginInfo && (
        <span style={{
          fontSize: '0.7rem',
          padding: '0.25rem 0.6rem',
          borderRadius: 6,
          background: 'rgba(239, 68, 68, 0.15)',
          color: '#ef4444',
          fontWeight: 600,
        }}>
          ⚠ Sans SEO
        </span>
      )}
      {schemaTypes.length > 0 && (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
          {schemaTypes.slice(0, 3).map((type) => (
            <span key={type} style={{
              fontSize: '0.65rem',
              padding: '0.15rem 0.4rem',
              borderRadius: 4,
              background: 'rgba(34, 197, 94, 0.15)',
              color: '#4ade80',
              fontWeight: 500,
            }}>
              {type}
            </span>
          ))}
          {schemaTypes.length > 3 && (
            <span style={{
              fontSize: '0.65rem',
              padding: '0.15rem 0.4rem',
              borderRadius: 4,
              background: 'var(--bg-secondary)',
              color: 'var(--text-muted)',
            }}>
              +{schemaTypes.length - 3}
            </span>
          )}
        </div>
      )}
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
      {/* Progress Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '2rem',
      }}>
        {steps.map((step, index) => (
          <div key={step.id} style={{ flex: index < steps.length - 1 ? 1 : 'none' }}>
            <button
              onClick={() => index < currentStep && onStepChange(index)}
              disabled={index > currentStep}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 8,
                border: 'none',
                background: index <= currentStep ? 'var(--accent-lighter)' : 'transparent',
                color: index <= currentStep ? 'var(--accent)' : 'var(--text-muted)',
                cursor: index <= currentStep ? 'pointer' : 'default',
                fontSize: '0.8rem',
                fontWeight: 600,
                transition: 'all 0.2s',
              }}
            >
              <span style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: index < currentStep ? 'var(--accent)' : index === currentStep ? 'var(--accent)' : 'var(--border)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 700,
              }}>
                {index < currentStep ? '✓' : index + 1}
              </span>
              <span className="hidden sm:inline">{step.title}</span>
            </button>
            {index < steps.length - 1 && (
              <div style={{
                height: 2,
                background: index < currentStep ? 'var(--accent)' : 'var(--border)',
                marginTop: -16,
                marginLeft: 40,
                marginRight: 8,
              }} />
            )}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="glass-card" style={{ padding: '1.5rem' }}>
        {children}
      </div>
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

export function SiteCard({ name, url, type, schemaStatus, lastSync, contentTypesCount, onExtract, onViewSchema, onEdit }: SiteCardProps) {
  const typeColors = {
    wordpress: '#21759b',
    sanity: '#FF6B6B',
  }

  const statusConfig = {
    not_extracted: { label: 'Non extrait', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)' },
    extracting: { label: 'Extraction...', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
    extracted: { label: 'Extrait', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
    error: { label: 'Erreur', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  }

  const status = statusConfig[schemaStatus]
  const typeColor = typeColors[type]

  return (
    <div style={{
      borderRadius: 12,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      background: 'var(--bg-card)',
    }}>
      <div style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: `${typeColor}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {type === 'wordpress' ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill={typeColor}>
                  <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zM4.635 12c0-2.587 1.09-4.932 2.836-6.492L5.12 9.94a4.77 4.77 0 0 1-.485 2.06zm7.365 7.365c-2.587 0-4.932-1.09-6.492-2.836l4.432-2.348a4.77 4.77 0 0 1 2.06-.485zm7.365-7.365a10.002 10.002 0 0 1-6.492 2.836l-2.348-4.432a4.77 4.77 0 0 1 .485-2.06zm-2.06-2.485L9.94 5.12a10.002 10.002 0 0 1 2.836-6.492l4.432 2.348a4.77 4.77 0 0 1 .485 2.06zm-2.485 2.06l-4.432 2.348a10.002 10.002 0 0 1 2.836 6.492l2.348-4.432a4.77 4.77 0 0 1-.485-2.06z"/>
                </svg>
              ) : (
                <span style={{ fontSize: '1.5rem' }}>🔥</span>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{url}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <span style={{
              fontSize: '0.7rem',
              padding: '0.25rem 0.6rem',
              borderRadius: 6,
              background: status.bg,
              color: status.color,
              fontWeight: 600,
            }}>
              {status.label}
            </span>
          </div>
        </div>

        {schemaStatus === 'extracted' && (
          <div style={{
            display: 'flex',
            gap: '1rem',
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            marginBottom: '1rem',
          }}>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {contentTypesCount ?? 0}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Types de contenu</div>
            </div>
            {lastSync && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Dernière sync</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lastSync}</div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {schemaStatus !== 'extracted' && (
            <button className="btn-primary" onClick={onExtract} style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}>
              {schemaStatus === 'extracting' ? 'Extraction...' : 'Extraire le schéma'}
            </button>
          )}
          {schemaStatus === 'extracted' && (
            <button className="btn-secondary" onClick={onViewSchema} style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}>
              📋 Voir le schéma
            </button>
          )}
          <button className="btn-ghost" onClick={onEdit} style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}>
            ✏️ Modifier
          </button>
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
  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${isValid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
      background: isValid ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1rem',
        borderBottom: errors.length > 0 || warnings.length > 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
        background: isValid ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
      }}>
        <span style={{ fontSize: '1.1rem' }}>{isValid ? '✅' : '❌'}</span>
        <span style={{ fontWeight: 600, color: isValid ? '#10b981' : '#ef4444' }}>
          {isValid ? 'Contenu valide' : 'Contenu avec erreurs'}
        </span>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div style={{ padding: '1rem' }}>
          {errors.map((error, i) => (
            <div key={`err-${i}`} style={{
              display: 'flex',
              gap: '0.5rem',
              padding: '0.5rem',
              marginBottom: i < errors.length - 1 ? '0.5rem' : 0,
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: 6,
            }}>
              <span style={{ color: '#ef4444' }}>●</span>
              <div>
                <code style={{ fontSize: '0.75rem', color: '#f87171' }}>{error.field}</code>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{error.message}</p>
              </div>
            </div>
          ))}
          {warnings.map((warning, i) => (
            <div key={`warn-${i}`} style={{
              display: 'flex',
              gap: '0.5rem',
              padding: '0.5rem',
              marginTop: errors.length > 0 && i === 0 ? '0.75rem' : (i > 0 ? '0.5rem' : 0),
              background: 'rgba(245, 158, 11, 0.1)',
              borderRadius: 6,
            }}>
              <span style={{ color: '#f59e0b' }}>⚠</span>
              <div>
                <code style={{ fontSize: '0.75rem', color: '#fbbf24' }}>{warning.field}</code>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{warning.message}</p>
              </div>
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

export function ExtractorWizard({ siteName, siteType, steps, onClose }: ExtractorWizardProps) {
  const typeColors = {
    wordpress: '#21759b',
    sanity: '#FF6B6B',
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: '1rem',
    }}>
      <div style={{
        background: 'var(--bg-primary)',
        borderRadius: 16,
        border: '1px solid var(--border)',
        width: '100%',
        maxWidth: 500,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: `${typeColors[siteType]}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{ fontSize: '1.2rem' }}>{siteType === 'wordpress' ? 'W' : '🔥'}</span>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Extraction du schéma</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{siteName}</div>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1.25rem',
              padding: '0.5rem',
            }}>
              ✕
            </button>
          )}
        </div>

        {/* Steps */}
        <div style={{ padding: '1.5rem' }}>
          {steps.map((step, index) => {
            const statusIcons = {
              pending: '○',
              running: '◐',
              completed: '✓',
              error: '✕',
            }
            const statusColors = {
              pending: '#6b7280',
              running: '#f59e0b',
              completed: '#10b981',
              error: '#ef4444',
            }

            return (
              <div key={step.id} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '1rem',
                marginBottom: index < steps.length - 1 ? '1.25rem' : 0,
                paddingBottom: index < steps.length - 1 ? '1.25rem' : 0,
                borderBottom: index < steps.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: `${statusColors[step.status]}20`,
                  color: statusColors[step.status],
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  flexShrink: 0,
                  animation: step.status === 'running' ? 'pulse 1.5s infinite' : 'none',
                }}>
                  {statusIcons[step.status]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{step.title}</div>
                  {step.details && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      {step.details}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Overall Progress */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
          }}>
            <span>Progression</span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
              {steps.filter(s => s.status === 'completed').length} / {steps.length}
            </span>
          </div>
          <div style={{
            height: 4,
            background: 'var(--border)',
            borderRadius: 2,
            marginTop: '0.5rem',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${(steps.filter(s => s.status === 'completed').length / steps.length) * 100}%`,
              background: 'var(--accent)',
              borderRadius: 2,
              transition: 'width 0.3s',
            }} />
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
}

export function MetricCard({ icon: Icon, label, value, change, changeType }: MetricCardProps) {
  return (
    <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'var(--accent-lighter)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={18} color="var(--accent)" strokeWidth={2} />
        </div>
        {change && (
          <span style={{
            fontSize: '0.72rem', fontWeight: 600,
            color: changeType === 'up' ? 'var(--success)' : changeType === 'down' ? 'var(--danger)' : 'var(--text-muted)',
          }}>
            {change}
          </span>
        )}
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}
