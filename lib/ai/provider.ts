import { getOpenAiClient } from './openai'
import { generateWithAnthropic } from './anthropic'

export type AiModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'claude-haiku'
  | 'claude-sonnet'

const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  'claude-haiku': 'claude-haiku-4-5-20251001',
  'claude-sonnet': 'claude-sonnet-4-6-20250514',
}

export function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-')
}

export async function generateJson(opts: {
  systemPrompt: string
  userPrompt: string
  model: string
  maxTokens?: number
  temperature?: number
}): Promise<string> {
  const { systemPrompt, userPrompt, model, maxTokens = 4096, temperature = 0.65 } = opts

  if (isAnthropicModel(model)) {
    const anthropicModel = ANTHROPIC_MODEL_MAP[model] || model
    const jsonSystemPrompt = `${systemPrompt}\n\nIMPORTANT: Reponds UNIQUEMENT en JSON valide. Pas de markdown, pas de backticks, pas de texte avant ou apres le JSON.`
    return generateWithAnthropic({
      systemPrompt: jsonSystemPrompt,
      userPrompt,
      model: anthropicModel,
      maxTokens,
      temperature,
    })
  }

  const response = await getOpenAiClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
  })

  return response.choices[0].message.content || '{}'
}
