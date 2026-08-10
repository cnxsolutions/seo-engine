// ─────────────────────────────────────────────────────────────────────────────
// Publish-template probe
// SEO Engine - Why the analyzer returned "aucun gabarit".
// ─────────────────────────────────────────────────────────────────────────────
//
// The analyzer swallows the real error and reports null. This reproduces the
// same call and prints the token accounting, which is where reasoning models
// silently spend a budget sized for a non-reasoning one.
//
//   node scripts/probe-template.mjs gpt-5.5 3000

import { readEnvLocal } from './db-connect.mjs'

const model = process.argv[2] || 'gpt-5.5'
const maxTokens = Number(process.argv[3] || 3000)
const env = readEnvLocal()

const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    messages: [
      { role: 'system', content: 'Tu es un expert Next.js. Reponds uniquement en JSON valide.' },
      {
        role: 'user',
        content:
          'Genere un template page.tsx Next.js App Router complet avec metadata export et les ' +
          'placeholders {{COMPONENT_NAME}}, {{TITLE}}, {{META_DESCRIPTION}}, {{HTML_CONTENT}}. ' +
          'Reponds en JSON: { "template": "...", "sitemapEntry": "..." }',
      },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: maxTokens,
  }),
})

const data = await res.json()
if (!res.ok) {
  console.log(`HTTP ${res.status} :`, data.error?.message)
  process.exit(1)
}

const c = data.choices?.[0]
console.log('modele            :', model)
console.log('budget demande    :', maxTokens)
console.log('finish_reason     :', c?.finish_reason)
console.log('tokens de sortie  :', data.usage?.completion_tokens)
console.log('  dont raisonnement:', data.usage?.completion_tokens_details?.reasoning_tokens)
console.log('longueur contenu  :', (c?.message?.content || '').length)
