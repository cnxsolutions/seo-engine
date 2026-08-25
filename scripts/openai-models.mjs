// ─────────────────────────────────────────────────────────────────────────────
// OpenAI model catalogue
// SEO Engine - Ask the API which models this key can actually use.
// ─────────────────────────────────────────────────────────────────────────────
//
// Guessing a model id is how `claude-sonnet-4-6-20250514` ended up in this
// codebase: a plausible string that 404s on first call. The catalogue is
// discoverable, so it gets discovered.
//
//   node scripts/openai-models.mjs            # chat-capable models
//   node scripts/openai-models.mjs embedding  # filter by substring

import { readEnvLocal } from './db-connect.mjs'

const filter = process.argv[2]
const env = readEnvLocal()

if (!env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is missing from .env.local')
  process.exit(1)
}

const response = await fetch('https://api.openai.com/v1/models', {
  headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
})

if (!response.ok) {
  console.error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`)
  process.exit(1)
}

const { data } = await response.json()

const ids = data
  .map((model) => model.id)
  .filter((id) => (filter ? id.includes(filter) : /^(gpt|o[0-9]|chatgpt)/.test(id)))
  .sort()

console.log(`${ids.length} models\n`)
for (const id of ids) console.log(`  ${id}`)
