import { FACTUAL_INTEGRITY_RULES, generateLocalSeoPage, parseAiJsonObject } from '@/lib/ai/openai'
import { generateJson } from '@/lib/ai/provider'

export async function optimizeTitle(currentTitle: string, currentCTR: number, keyword: string) {
  const raw = await generateJson({
    systemPrompt: [
      'Tu es un expert SEO CTR. Reponds en JSON valide avec un tableau "titles".',
      "N'invente aucun chiffre, aucun prix, aucune note et aucune promesse ('n°1', 'meilleur prix', '-50%')",
      'dans les titres proposes : un title doit tenir la promesse de la page.',
    ].join('\n'),
    userPrompt: `Titre actuel: ${currentTitle}\nCTR: ${currentCTR}\nMot-cle: ${keyword}\nGenere 5 variantes de title plus cliquables (max 65 caracteres, mot-cle inclus).`,
    model: 'gpt-4o-mini',
    maxTokens: 800,
  })

  // Parsed through the shared helper so a fenced or truncated answer raises a
  // named error instead of a bare SyntaxError from JSON.parse.
  const parsed = parseAiJsonObject<{ titles?: string[] }>(raw, `variantes de title pour "${keyword}"`)
  return parsed.titles ?? []
}

export async function enrichContent(htmlContent: string, keyword: string) {
  const raw = await generateJson({
    systemPrompt: `Tu enrichis un contenu SEO existant et reponds en JSON.\n\n${FACTUAL_INTEGRITY_RULES}`,
    userPrompt: [
      `Mot-cle: ${keyword}`,
      'Contenu source:',
      htmlContent,
      '',
      'Retourne {"faqHtml":"...","structuredDataSuggestions":["..."],"freshnessSuggestions":["..."]}',
      "Les reponses de la FAQ ne s'appuient que sur le contenu source ci-dessus : aucune donnee,",
      'aucun chiffre et aucun avis qui ne figure pas deja dans ce contenu.',
    ].join('\n'),
    model: 'gpt-4o-mini',
    maxTokens: 3000,
  })

  const parsed = parseAiJsonObject<{
    faqHtml?: string
    structuredDataSuggestions?: string[]
    freshnessSuggestions?: string[]
  }>(raw, `enrichissement de contenu pour "${keyword}"`)

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
