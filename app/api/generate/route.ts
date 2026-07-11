import { NextRequest, NextResponse } from 'next/server'
import { generateLocalSeoPage } from '@/lib/ai/openai'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      city,
      department = 'Aube',
      businessType,
      businessName,
      keywords,
      siteUrl = '',
      targetLength = 700,
      model = 'gpt-4o',
      includeEntities = true,
      ctaText = 'Nous contacter',
    } = body

    // Input validation
    const missing = ['city', 'businessType', 'businessName'].filter(k => !body[k])
    if (missing.length > 0)
      return NextResponse.json({ error: `Champs requis manquants: ${missing.join(', ')}` }, { status: 400 })

    if (!process.env.OPENAI_API_KEY)
      return NextResponse.json({ error: 'OPENAI_API_KEY manquante dans .env.local' }, { status: 500 })

    const result = await generateLocalSeoPage({
      city,
      department,
      businessType,
      businessName,
      keywords: Array.isArray(keywords) ? keywords : String(keywords).split(',').map((k: string) => k.trim()).filter(Boolean),
      siteUrl,
      targetLength: Math.min(Math.max(Number(targetLength) || 700, 300), 2000),
      model,
      includeEntities,
      ctaText,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne'
    console.error('[POST /api/generate]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
