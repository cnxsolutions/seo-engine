import { Sidebar } from '@/components/Sidebar'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'SEO Engine – Dashboard',
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      {/* Every keyboard pass through the app had to walk the whole rail — five
          workflow rungs plus the tools — before reaching the page. `.sr-only`
          hides it until it takes focus. */}
      <a href="#contenu" className="sr-only skip-link">Aller au contenu</a>
      <Sidebar />
      <main id="contenu" className="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
