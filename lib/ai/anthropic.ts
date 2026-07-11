import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

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
  temperature?: number
}): Promise<string> {
  const {
    systemPrompt,
    userPrompt,
    model = 'claude-haiku-4-5-20251001',
    maxTokens = 4096,
    temperature = 0.6,
  } = opts

  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  return textBlock?.text ?? '{}'
}
