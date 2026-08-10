import { getOpenAiClient } from './openai'
import { DEFAULT_ANTHROPIC_MODEL, generateWithAnthropic } from './anthropic'

export type AiModel =
  | 'gpt-5.5'
  | 'gpt-5.4'
  | 'gpt-5.4-mini'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'claude-haiku'
  | 'claude-sonnet'
  | 'claude-opus'

/**
 * OpenAI models that reject `temperature`.
 *
 * Verified against the live API rather than assumed — the boundary is not the
 * generation: `gpt-5.4-mini` accepts 0.6 while `gpt-5.5` answers
 * "Only the default (1) value is supported". Since the rule cannot be derived
 * from the version number, the safe direction is to drop the parameter for the
 * whole GPT-5 family. Default sampling is fine here: creative writing does not
 * need a lowered temperature, and JSON structure is already constrained by
 * `response_format`.
 */
const OPENAI_SAMPLING_REJECTED = /^(gpt-5|o[1-9])/

/**
 * Models offered for page generation, in the order the UI shows them.
 *
 * Declared once and imported by every selector: the three dropdowns that used to
 * hard-code their own lists had already drifted apart, one of them still
 * offering a model no other screen knew about.
 *
 * `gpt-5.5` leads because length is the engine's current bottleneck — gpt-4o-mini
 * wrote 300-900 words whatever the brief asked for, which rejected six pages out
 * of seven at the quality gate.
 */
export const AI_MODEL_OPTIONS: Array<{ value: AiModel; label: string; hint: string }> = [
  { value: 'gpt-5.5', label: 'GPT-5.5', hint: 'Recommande — pages longues et structurees' },
  { value: 'gpt-5.4', label: 'GPT-5.4', hint: 'Equilibre qualite / cout' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', hint: 'Rapide, pour pages courtes' },
  { value: 'claude-sonnet', label: 'Claude Sonnet 5', hint: 'Alternative Anthropic' },
  { value: 'claude-opus', label: 'Claude Opus 5', hint: 'Le plus capable, le plus cher' },
  { value: 'claude-haiku', label: 'Claude Haiku 4.5', hint: 'Rapide et economique' },
  { value: 'gpt-4o', label: 'GPT-4o', hint: 'Generation precedente' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'Generation precedente, economique' },
]

/** Default for a new campaign, and the fallback when none is stored. */
export const DEFAULT_GENERATION_MODEL: AiModel = 'gpt-5.5'

/**
 * Model used to draft the editorial plan.
 *
 * A separate, cheaper tier on purpose: producing thirty JSON briefs is a
 * structured task, not a writing one, and it runs on every plan preview.
 */
export const DEFAULT_PLANNING_MODEL: AiModel = 'gpt-5.4-mini'

/**
 * Short names stored in `campaigns.ai_model` → real API identifiers.
 *
 * The previous `'claude-sonnet': 'claude-sonnet-4-6-20250514'` mixed a 4.6
 * version with the release date of Sonnet 4 and would have returned a 404. It
 * stayed latent only because no UI selector offered `claude-sonnet`.
 *
 * Claude 5 identifiers are used AS-IS: `claude-opus-5` and `claude-sonnet-5`
 * take no date suffix. `claude-haiku-4-5` is the alias of the 4.5 snapshot
 * (`claude-haiku-4-5-20251001`); both resolve to the same model.
 *
 * Canonical identifiers are also keys of the map so that a campaign storing a
 * real API id keeps working.
 */
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  'claude-haiku': 'claude-haiku-4-5',
  'claude-sonnet': 'claude-sonnet-5',
  'claude-opus': 'claude-opus-5',
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-sonnet-5': 'claude-sonnet-5',
  'claude-opus-5': 'claude-opus-5',
}

/**
 * Models that reject `temperature` / `top_p` / `top_k` with a 400.
 *
 * The whole Claude 5 generation (and Opus 4.7/4.8) dropped sampling
 * parameters. Sending one is not a degraded request, it is a failed one — so
 * the parameter is dropped for those models rather than passed through.
 */
const SAMPLING_PARAMS_REJECTED = /^claude-(opus-5|sonnet-5|fable-5|mythos-5|opus-4-[78])/

export function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-')
}

/**
 * Resolve a stored model name to the identifier the Anthropic API expects.
 *
 * Unknown `claude-*` values are passed through unchanged so a new model can be
 * used from the database without a deploy; only the aliases above are rewritten.
 */
export function resolveAnthropicModel(model: string): string {
  return ANTHROPIC_MODEL_MAP[model] || model || DEFAULT_ANTHROPIC_MODEL
}

export function supportsTemperature(apiModelId: string): boolean {
  return !SAMPLING_PARAMS_REJECTED.test(apiModelId)
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
    const anthropicModel = resolveAnthropicModel(model)
    const jsonSystemPrompt = `${systemPrompt}\n\nIMPORTANT: Reponds UNIQUEMENT en JSON valide. Pas de markdown, pas de backticks, pas de texte avant ou apres le JSON.`
    return generateWithAnthropic({
      systemPrompt: jsonSystemPrompt,
      userPrompt,
      model: anthropicModel,
      maxTokens,
      temperature: supportsTemperature(anthropicModel) ? temperature : undefined,
    })
  }

  // `max_completion_tokens`, never `max_tokens`.
  //
  // The GPT-5 family rejects `max_tokens` outright ("is not supported with this
  // model. Use 'max_completion_tokens' instead"), while gpt-4o and gpt-4o-mini
  // accept BOTH — verified by probing each of them. Sending the new name
  // unconditionally therefore removes a branch instead of adding one, and a
  // model swap in the campaign settings can no longer 400 on its first call.
  const response = await getOpenAiClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    ...(OPENAI_SAMPLING_REJECTED.test(model) ? {} : { temperature }),
    response_format: { type: 'json_object' },
    max_completion_tokens: maxTokens,
  })

  const choice = response.choices[0]

  // Same reasoning as the Anthropic path: a cut response must not travel as if
  // it were a complete one.
  if (choice?.finish_reason === 'length') {
    throw new Error(
      `Reponse OpenAI tronquee (${model}) : la limite de ${maxTokens} tokens de sortie a ete atteinte. ` +
        `Reduire la longueur cible ou augmenter maxTokens.`
    )
  }

  const content = choice?.message?.content?.trim()
  if (!content) {
    throw new Error(
      `Reponse OpenAI vide (${model}, finish_reason=${choice?.finish_reason ?? 'inconnu'}).`
    )
  }

  return content
}
