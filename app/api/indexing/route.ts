import { NextRequest, NextResponse } from 'next/server'
import { submitForIndexing, submitBatchForIndexing, generateIndexNowKey, getIndexNowSetupInstructions } from '@/lib/seo/indexing'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'submit_url': {
        const { pageUrl, siteUrl } = body
        if (!pageUrl || !siteUrl) {
          return NextResponse.json({ error: 'pageUrl et siteUrl requis' }, { status: 400 })
        }
        const result = await submitForIndexing({ pageUrl, siteUrl })
        return NextResponse.json({ success: true, result })
      }

      case 'submit_batch': {
        const { urls, siteUrl } = body
        if (!urls?.length || !siteUrl) {
          return NextResponse.json({ error: 'urls[] et siteUrl requis' }, { status: 400 })
        }
        const result = await submitBatchForIndexing(urls, siteUrl)
        return NextResponse.json({ success: true, ...result })
      }

      case 'generate_key': {
        const { siteUrl } = body
        if (!siteUrl) {
          return NextResponse.json({ error: 'siteUrl requis' }, { status: 400 })
        }
        const key = generateIndexNowKey()
        const instructions = getIndexNowSetupInstructions(siteUrl, key)
        return NextResponse.json({ success: true, key, instructions })
      }

      default:
        return NextResponse.json({ error: 'Action inconnue. Actions: submit_url, submit_batch, generate_key' }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur serveur' },
      { status: 500 }
    )
  }
}
