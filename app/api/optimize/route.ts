import { NextRequest, NextResponse } from 'next/server'
import { enrichContent, generateExpertContent, optimizeTitle } from '@/lib/ai/optimizer'

export async function POST(req: NextRequest) {
  try {
    const { action, currentTitle, currentCTR, keyword, htmlContent, topic, existingPages = [], siteUrl = '' } = await req.json()

    if (action === 'title') {
      const titles = await optimizeTitle(currentTitle, Number(currentCTR) || 0, keyword)
      return NextResponse.json({ success: true, titles })
    }

    if (action === 'enrich') {
      const result = await enrichContent(htmlContent, keyword)
      return NextResponse.json({ success: true, ...result })
    }

    if (action === 'expert') {
      const page = await generateExpertContent(topic, existingPages, siteUrl)
      return NextResponse.json({ success: true, page })
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
