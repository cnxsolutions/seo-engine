'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  BookOpen,
  ScanSearch,
  Target,
  PenTool,
  Send,
  BarChart3,
  Globe,
  Settings,
  Zap,
  ChevronRight,
  Database,
  Library,
} from 'lucide-react'

const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/methodology', icon: BookOpen, label: 'Méthodologie' },
    ],
  },
  {
    label: 'WORKFLOW',
    items: [
      { href: '/strategy/new', icon: ScanSearch, label: '1. Analyser', step: true },
      { href: '/strategy', icon: Target, label: '2. Stratégie', step: true },
      { href: '/produce', icon: PenTool, label: '3. Générer', step: true },
      { href: '/produce/schema', icon: Database, label: '3b. Schema-Aware', step: false },
      { href: '/publish', icon: Send, label: '4. Publier', step: true },
      { href: '/monitor', icon: BarChart3, label: '5. Suivre', step: true },
    ],
  },
  {
    label: 'CONFIG',
    items: [
      { href: '/sites', icon: Globe, label: 'Sites' },
      { href: '/sites/federated', icon: Database, label: 'Sites CMS' },
      { href: '/analytics', icon: BarChart3, label: 'Analytics' },
      { href: '/library', icon: Library, label: 'Bibliothèque' },
      { href: '/settings', icon: Settings, label: 'Paramètres' },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div style={{
          width: 36, height: 36,
          background: 'linear-gradient(135deg, #5347ce, #887cfd)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(83, 71, 206, 0.3)',
        }}>
          <Zap size={18} color="white" />
        </div>
        <div>
          <div className="gradient-text" style={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.2 }}>SEO Engine</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 500 }}>AI Content Platform</div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '0.5rem 0', overflowY: 'auto' }}>
        {NAV_SECTIONS.map((section, si) => (
          <div key={si}>
            {section.label && <div className="nav-section-label">{section.label}</div>}
            {!section.label && <div style={{ height: 8 }} />}
            {section.items.map(({ href, icon: Icon, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link key={href} href={href} className={`nav-item ${active ? 'active' : ''}`}>
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                  <span style={{ flex: 1 }}>{label}</span>
                  {active && <ChevronRight size={14} style={{ opacity: 0.5 }} />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)' }}>
        <div className="team-badge">
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #5347ce, #16c8c7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 700, color: 'white',
          }}>
            SE
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Admin</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Mode local</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
