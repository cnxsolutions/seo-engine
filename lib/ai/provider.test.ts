// ─────────────────────────────────────────────────────────────────────────────
// Provider Tests
// SEO Engine - Model mapping and per-model capabilities
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { isAnthropicModel, resolveAnthropicModel, supportsTemperature } from './provider'
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
