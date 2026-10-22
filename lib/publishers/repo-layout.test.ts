// ─────────────────────────────────────────────────────────────────────────────
// Repository layout
// SEO Engine - A site and an app in one repository.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { aliasCandidates, detectAppRoot, missingPublicAssets, pickPageFolder, toAliasImport } from './repo-layout'

// Trimmed from cnxsolutions/foodflow: the web part under `nextjs/`, a Flutter
// app beside it, and an `(auth)` group with more dashed slugs than `(public)`.
const FOODFLOW = [
  'flutter/package.json',
  'flutter/lib/main.dart',
  'nextjs/next.config.ts',
  'nextjs/package.json',
  'nextjs/src/app/(auth)/auth/email-confirmed/page.tsx',
  'nextjs/src/app/(auth)/auth/reset-password/page.tsx',
  'nextjs/src/app/(auth)/auth/verify-email/page.tsx',
  'nextjs/src/app/(auth)/vendor/agenda/page.tsx',
  'nextjs/src/app/(public)/[cityPage]/page.tsx',
  'nextjs/src/app/(public)/blog/page.tsx',
  'nextjs/src/app/(public)/boutique-vente/page.tsx',
  'nextjs/src/app/(public)/layout.tsx',
  'nextjs/src/app/(public)/mentions-legales/page.tsx',
  'nextjs/src/app/(public)/page.tsx',
  'nextjs/src/app/(vendor)/v/[slug]/page.tsx',
  'nextjs/src/app/layout.tsx',
  'nextjs/src/app/sitemap.ts',
]

describe('detectAppRoot', () => {
  it('trouve l application Next.js dans un sous-dossier', () => {
    expect(detectAppRoot(FOODFLOW)).toBe('nextjs/')
  })

  it('reste a la racine pour un site classique', () => {
    expect(detectAppRoot(['next.config.ts', 'src/app/page.tsx'])).toBe('')
  })

  it('reste a la racine quand rien ne signale Next.js', () => {
    expect(detectAppRoot(['src/app/page.tsx'])).toBe('')
  })

  it('choisit l application qui a le plus de pages', () => {
    const files = [
      'apps/admin/next.config.js',
      'apps/admin/app/page.tsx',
      'apps/web/next.config.mjs',
      'apps/web/app/page.tsx',
      'apps/web/app/tarifs/page.tsx',
    ]
    expect(detectAppRoot(files)).toBe('apps/web/')
  })

  it('ignore les dependances', () => {
    expect(detectAppRoot(['node_modules/x/next.config.js', 'next.config.ts'])).toBe('')
  })
})

describe('pickPageFolder', () => {
  it('prend le groupe public, jamais celui derriere la connexion', () => {
    expect(pickPageFolder(FOODFLOW, 'nextjs/src/app/')).toBe('nextjs/src/app/(public)')
  })

  it('garde le groupe (seo) quand il existe', () => {
    const files = ['src/app/(seo)/taxi-troyes/page.tsx', 'src/app/(other)/a-b/page.tsx', 'src/app/(other)/c-d/page.tsx']
    expect(pickPageFolder(files, 'src/app/')).toBe('src/app/(seo)')
  })

  it('prend la racine quand les pages y sont', () => {
    const files = ['app/taxi-troyes/page.tsx', 'app/(admin)/tableau-bord/page.tsx']
    expect(pickPageFolder(files, 'app/')).toBe('app')
  })

  it('retombe sur la racine sans aucune page candidate', () => {
    expect(pickPageFolder(['app/page.tsx'], 'app/')).toBe('app')
  })
})

describe('alias @/', () => {
  it('se resout depuis l application, pas depuis le depot', () => {
    expect(aliasCandidates('@/components/Hero', 'nextjs/')).toEqual([
      'nextjs/src/components/Hero',
      'nextjs/components/Hero',
    ])
  })

  it('reconstruit l import depuis un chemin du depot', () => {
    expect(toAliasImport('nextjs/src/components/seo-engine/SeoEnginePage', 'nextjs/src/'))
      .toBe('@/components/seo-engine/SeoEnginePage')
    expect(toAliasImport('src/components/X', 'src/')).toBe('@/components/X')
    expect(toAliasImport('@/components/X', 'nextjs/src/')).toBe('@/components/X')
  })
})

describe('missingPublicAssets', () => {
  // Flowyne's stored template, 2026-10-22: every page opened on a broken image.
  const TEMPLATE = `
import Image from 'next/image'
export default function Page() {
  return (<>
    <Image src="/images/blog/default.jpg" alt="" fill />
    <img src='/images/pricing/restaurant-qr.svg' alt="QR" />
    <img src="//cdn.example.com/a.png" alt="" />
    <img src="/blog/{{SLUG}}.jpg" alt="" />
  </>)
}`

  it('names the local images the repository does not have', () => {
    const files = ['nextjs/public/images/pricing/restaurant-qr.svg']
    expect(missingPublicAssets(TEMPLATE, files, 'nextjs/')).toEqual(['/images/blog/default.jpg'])
  })

  it('looks under the application root, not the repository root', () => {
    expect(missingPublicAssets(`<img src="/logo.png" />`, ['public/logo.png'], 'nextjs/')).toEqual(['/logo.png'])
    expect(missingPublicAssets(`<img src="/logo.png" />`, ['public/logo.png'], '')).toEqual([])
  })
})
