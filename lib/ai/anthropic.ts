import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

/**
 * Default Anthropic model.
 *
 * `claude-haiku-4-5` is the alias of the 4.5 snapshot; both forms are valid.
 * Claude 5 identifiers (`claude-opus-5`, `claude-sonnet-5`) carry NO date
 * suffix — appending one produces a 404. See ANTHROPIC_MODEL_MAP in provider.ts.
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'

export function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY manquante dans .env.local')
  }

  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  return client
}

export async function generateWithAnthropic(opts: {
  systemPrompt: string
  userPrompt: string
  model?: string
  maxTokens?: number
  /**
   * Omitted from the request when undefined, on purpose: the Claude 5
   * generation rejects sampling parameters with a 400. The caller
   * (provider.ts) decides whether the target model accepts one.
   */
  temperature?: number
}): Promise<string> {
  const {
    systemPrompt,
    userPrompt,
    model = DEFAULT_ANTHROPIC_MODEL,
    maxTokens = 4096,
    temperature,
  } = opts

  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: maxTokens,
    ...(temperature === undefined ? {} : { temperature }),
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Every text block, not just the first: a model that thinks answers after a
  // thinking block, and a long answer can arrive split across several blocks.
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()

  // A response cut at max_tokens is truncated JSON. It is reported here, where
  // the cause is known, instead of surfacing downstream as "JSON malforme" —
  // the two need opposite fixes (raise the budget vs. retry the generation).
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `Reponse Anthropic tronquee (${model}) : la limite de ${maxTokens} tokens de sortie a ete atteinte. ` +
        `Reduire la longueur cible ou augmenter maxTokens.`
    )
  }

  // Returning '{}' here used to turn "the model said nothing" into an empty
  // page that looked valid to every caller.
  if (!text) {
    throw new Error(
      `Reponse Anthropic vide (${model}, stop_reason=${response.stop_reason ?? 'inconnu'}) : aucun bloc texte exploitable.`
    )
  }

  return text
}
