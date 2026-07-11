import { generateLocalSeoPage, getOpenAiClient } from '@/lib/ai/openai'

export async function optimizeTitle(currentTitle: string, currentCTR: number, keyword: string) {
  const response = await getOpenAiClient().chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Tu es un expert SEO CTR. Reponds en JSON valide avec un tableau "titles".',
      },
      {
        role: 'user',
        content: `Titre actuel: ${currentTitle}\nCTR: ${currentCTR}\nMot-cle: ${keyword}\nGenere 5 variantes de title plus cliquables.`,
      },
    ],
  })

  const raw = response.choices[0].message.content || '{"titles":[]}'
  const parsed = JSON.parse(raw) as { titles?: string[] }
  return parsed.titles ?? []
}

export async function enrichContent(htmlContent: string, keyword: string) {
  const response = await getOpenAiClient().chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Tu enrichis un contenu SEO et reponds en JSON.' },
      {
        role: 'user',
        content: `Mot-cle: ${keyword}\nContenu source:\n${htmlContent}\nRetourne {"faqHtml":"...","structuredDataSuggestions":["..."],"freshnessSuggestions":["..."]}`,
      },
    ],
  })

  const raw = response.choices[0].message.content || '{}'
  const parsed = JSON.parse(raw) as {
    faqHtml?: string
    structuredDataSuggestions?: string[]
    freshnessSuggestions?: string[]
  }

  return {
    faqHtml: parsed.faqHtml ?? '',
    structuredDataSuggestions: parsed.structuredDataSuggestions ?? [],
    freshnessSuggestions: parsed.freshnessSuggestions ?? [],
  }
}

export async function generateExpertContent(topic: string, existingPages: string[], siteUrl: string) {
  return generateLocalSeoPage({
    city: 'France',
    department: 'National',
    businessType: topic,
    businessName: 'SEO Engine',
    keywords: [topic, ...existingPages],
    siteUrl,
    targetLength: 2500,
    model: 'gpt-4o',
    includeEntities: true,
    ctaText: 'Parler a un expert',
  })
}
