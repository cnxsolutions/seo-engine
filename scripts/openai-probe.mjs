// ─────────────────────────────────────────────────────────────────────────────
// OpenAI request-shape probe
// SEO Engine - Find out what a model actually accepts, instead of assuming.
// ─────────────────────────────────────────────────────────────────────────────
//
// Newer OpenAI models renamed `max_tokens` to `max_completion_tokens` and pin
// `temperature` to its default. The generator still sends the old shape, so this
// makes a real (tiny) call per variant and reports which one the API accepts.
//
//   node scripts/openai-probe.mjs gpt-5.5

import { readEnvLocal } from './db-connect.mjs'

const model = process.argv[2] || 'gpt-5.5'
const env = readEnvLocal()

const BASE = {
  model,
  messages: [{ role: 'user', content: 'Reponds en JSON: {"ok":true}' }],
  response_format: { type: 'json_object' },
}

const variants = [
  { label: 'max_tokens + temperature (forme actuelle du code)', body: { ...BASE, max_tokens: 64, temperature: 0.6 } },
  { label: 'max_tokens seul', body: { ...BASE, max_tokens: 64 } },
  { label: 'max_completion_tokens + temperature', body: { ...BASE, max_completion_tokens: 2048, temperature: 0.6 } },
  { label: 'max_completion_tokens seul', body: { ...BASE, max_completion_tokens: 2048 } },
]

for (const { label, body } of variants) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (response.ok) {
    const data = await response.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    const finish = data.choices?.[0]?.finish_reason
    console.log(`OK   ${label}`)
    console.log(`     finish=${finish} content=${JSON.stringify(text).slice(0, 60)}`)
  } else {
    const error = await response.json().catch(() => ({}))
    console.log(`KO   ${label}`)
    console.log(`     ${response.status} ${error.error?.message?.slice(0, 140) ?? ''}`)
  }
}
