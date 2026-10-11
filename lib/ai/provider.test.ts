// ─────────────────────────────────────────────────────────────────────────────
// Provider Tests
// SEO Engine - Model mapping and per-model capabilities
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, describe, it, expect, vi } from 'vitest'
import { generateJson, isAnthropicModel, openAiTokenSettings, resolveAnthropicModel, supportsTemperature } from './provider'
import * as openai from './openai'
import { DEFAULT_ANTHROPIC_MODEL } from './anthropic'

describe('isAnthropicModel()', () => {
  it('recognises claude models only', () => {
    expect(isAnthropicModel('claude-haiku')).toBe(true)
    expect(isAnthropicModel('claude-opus-5')).toBe(true)
    expect(isAnthropicModel('gpt-4o')).toBe(false)
    expect(isAnthropicModel('gpt-4o-mini')).toBe(false)
  })
})

describe('resolveAnthropicModel()', () => {
  it('maps the UI aliases to valid 2026 identifiers', () => {
    expect(resolveAnthropicModel('claude-haiku')).toBe('claude-haiku-4-5')
    expect(resolveAnthropicModel('claude-sonnet')).toBe('claude-sonnet-5')
    expect(resolveAnthropicModel('claude-opus')).toBe('claude-opus-5')
  })

  it('never produces a date suffix on a Claude 5 identifier', () => {
    // `claude-sonnet-4-6-20250514` mixed a 4.6 version with the Sonnet 4 release
    // date and would have returned a 404.
    for (const alias of ['claude-sonnet', 'claude-opus', 'claude-sonnet-5', 'claude-opus-5']) {
      expect(resolveAnthropicModel(alias)).not.toMatch(/-\d{8}$/)
    }
  })

  it('passes canonical identifiers through unchanged', () => {
    expect(resolveAnthropicModel('claude-opus-5')).toBe('claude-opus-5')
    expect(resolveAnthropicModel('claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(resolveAnthropicModel('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })

  it('lets an unknown claude identifier reach the API as-is', () => {
    expect(resolveAnthropicModel('claude-future-9')).toBe('claude-future-9')
  })

  it('falls back to the default model on an empty value', () => {
    expect(resolveAnthropicModel('')).toBe(DEFAULT_ANTHROPIC_MODEL)
  })
})

describe('supportsTemperature()', () => {
  it('rejects sampling parameters for the Claude 5 generation', () => {
    expect(supportsTemperature('claude-opus-5')).toBe(false)
    expect(supportsTemperature('claude-sonnet-5')).toBe(false)
  })

  it('keeps sampling parameters for models that still accept them', () => {
    expect(supportsTemperature('claude-haiku-4-5')).toBe(true)
    expect(supportsTemperature('claude-haiku-4-5-20251001')).toBe(true)
  })
})

// ─── Reasoning models and the output budget ──────────────────────────────────
//
// The GPT-5 family takes its hidden reasoning out of `max_completion_tokens`.
// Sized for the page alone, the budget was eaten before the page was written:
// "Reponse OpenAI tronquee (gpt-5.5) : la limite de 6000 tokens", on every slot.

describe('openAiTokenSettings()', () => {
  it('adds reasoning headroom and lowers the effort for the GPT-5 family', () => {
    const settings = openAiTokenSettings('gpt-5.5', 6000)
    expect(settings.max_completion_tokens).toBeGreaterThan(6000)
    expect(settings.reasoning_effort).toBe('low')
    expect(openAiTokenSettings('gpt-5.4-mini', 7000).reasoning_effort).toBe('low')
  })

  it('leaves non-reasoning models exactly as asked', () => {
    // gpt-4o-mini rejects `reasoning_effort`: sending it would 400 the gap analysis.
    expect(openAiTokenSettings('gpt-4o-mini', 2000)).toEqual({ max_completion_tokens: 2000 })
  })
})

describe('generateJson() — OpenAI request', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function stubCompletion(response: unknown) {
    const create = vi.fn(async () => response)
    vi.spyOn(openai, 'getOpenAiClient').mockReturnValue({ chat: { completions: { create } } } as never)
    return create
  }

  it('sends the reasoning settings with the call', async () => {
    const create = stubCompletion({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] })

    await generateJson({ systemPrompt: 's', userPrompt: 'u', model: 'gpt-5.5', maxTokens: 6000 })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.5',
      reasoning_effort: 'low',
      max_completion_tokens: openAiTokenSettings('gpt-5.5', 6000).max_completion_tokens,
    }))
  })

  it('names the reasoning share when the answer is still cut', async () => {
    stubCompletion({
      choices: [{ finish_reason: 'length', message: { content: '{"tit' } }],
      usage: { completion_tokens_details: { reasoning_tokens: 9000 } },
    })

    await expect(generateJson({ systemPrompt: 's', userPrompt: 'u', model: 'gpt-5.5', maxTokens: 6000 }))
      .rejects.toThrow(/tronquee.*dont 9000 de raisonnement/)
  })
})
