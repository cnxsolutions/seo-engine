import { NextRequest, NextResponse } from 'next/server'
import { createGeneration, getSiteById, updateGeneration } from '@/lib/db'
import { publishToNextJs } from '@/lib/publishers/nextjs'
import { publishToWordPress } from '@/lib/publishers/wordpress'
import { submitForIndexing } from '@/lib/seo/indexing'
import type { GeneratedPage } from '@/lib/ai/openai'

export async function POST(req: NextRequest) {
  try {
    const { page, siteId, publishStatus = 'draft', generationId } = await req.json()

    if (!page || !siteId) {
      return NextResponse.json({ error: 'page et siteId sont requis' }, { status: 400 })
    }

    const site = await getSiteById(siteId)
    if (!site) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }

    const trackedGeneration = generationId
      ? null
      : await createGeneration({
          campaign_id: undefined,
          site_id: site.id,
          city: page.focusKeyword,
          slug: page.slug,
          title: page.title,
          meta_description: page.metaDescription,
          focus_keyword: page.focusKeyword,
          content: page.htmlContent,
          status: 'publishing',
          ai_model: 'manual',
        })

    const currentGenerationId = generationId || trackedGeneration?.id
    const currentPage = page as GeneratedPage

    if (site.type === 'nextjs') {
      const result = await publishToNextJs({
        githubRepo: site.github_repo || '',
        githubToken: site.github_token || '',
        page: currentPage,
        siteUrl: site.url,
        repoProfile: site.repo_profile as import('@/lib/publishers/nextjs-analyzer').RepoProfile | undefined,
      })

      if (!result.success) {
        if (currentGenerationId) {
          await updateGeneration(currentGenerationId, { status: 'failed', error_message: result.error })
        }
        return NextResponse.json({ error: result.error || 'Erreur de publication' }, { status: 422 })
      }

      if (currentGenerationId) {
        await updateGeneration(currentGenerationId, {
          status: 'published',
          published_url: result.fileUrl,
        })
      }

      const pageUrl = result.fileUrl || `${site.url.replace(/\/$/, '')}/${currentPage.slug}`
      const indexing = await submitForIndexing({ pageUrl, siteUrl: site.url }).catch(() => null)

      return NextResponse.json({
        success: true,
        pageUrl: result.fileUrl,
        commitSha: result.commitSha,
        indexing,
      })
    }

    const result = await publishToWordPress({
      siteUrl: site.url,
      appUsername: site.wp_username || '',
      appPassword: site.wp_app_password || '',
      page: currentPage,
      publishStatus,
      pageTemplate: site.wp_page_template || undefined,
    })

    if (!result.success) {
      if (currentGenerationId) {
        await updateGeneration(currentGenerationId, { status: 'failed', error_message: result.error })
      }
      return NextResponse.json({ error: result.error || 'Erreur de publication' }, { status: 422 })
    }

    if (currentGenerationId) {
      await updateGeneration(currentGenerationId, {
        status: 'published',
        published_url: result.pageUrl,
      })
    }

    const indexing = result.pageUrl
      ? await submitForIndexing({ pageUrl: result.pageUrl, siteUrl: site.url }).catch(() => null)
      : null

    return NextResponse.json({
      success: true,
      pageUrl: result.pageUrl,
      pageId: result.pageId,
      indexing,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
