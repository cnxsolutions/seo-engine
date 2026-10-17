import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { Sidebar, type SidebarEnvironment, type SidebarSite } from '@/components/Sidebar'
import { createServiceClient } from '@/lib/supabase'

export const metadata: Metadata = {
  title: 'SEO Engine – Dashboard',
}

/**
 * The active sites, for the rail. Two columns, nothing else: the rail needs a
 * name to print and an id to link, and `sites` carries secrets a `*` would
 * walk into the HTML of every page.
 *
 * A failed read renders an empty list, never an error: the rail is the way to
 * every other screen, and a database hiccup must not take the navigation down
 * with it. The client re-reads `/api/sites` on its own afterwards.
 */
async function readSidebarSites(): Promise<SidebarSite[]> {
  try {
    const { data, error } = await createServiceClient()
      .from('sites')
      .select('id,name')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map((site) => ({ id: site.id as string, name: site.name as string }))
  } catch (error) {
    console.warn('[layout] liste des sites indisponible :', error instanceof Error ? error.message : error)
    return []
  }
}

/**
 * Where this tab is pointed. `NODE_ENV` says which build is running, the host
 * header says which address served it — the pair is what tells a local
 * `npm run dev` against a staging base apart from the production VPS, where a
 * click on « Publier » reaches the client's site.
 *
 * `x-forwarded-host` first: behind nginx, `host` is the upstream's own name.
 */
async function readEnvironment(): Promise<SidebarEnvironment> {
  const headerList = await headers()
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host')
  return {
    label: process.env.NODE_ENV === 'production' ? 'Production' : 'Développement',
    host: host ? host.split(',')[0].trim() : null,
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sites, environment] = await Promise.all([readSidebarSites(), readEnvironment()])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      {/* Every keyboard pass through the app had to walk the whole rail before
          reaching the page. `.sr-only` hides it until it takes focus. */}
      <a href="#contenu" className="sr-only skip-link">Aller au contenu</a>
      {/* The rail reads `useSearchParams()` to light « Analytics » on the
          performance tab; the boundary is what that hook asks for. The layout
          is dynamic (it reads headers), so the fallback never actually shows. */}
      <Suspense fallback={<aside className="sidebar" aria-hidden="true" />}>
        <Sidebar sites={sites} environment={environment} />
      </Suspense>
      <main id="contenu" className="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
