// ─────────────────────────────────────────────────────────────────────────────
// End-to-end reproduction of the publish-template generation
// SEO Engine - Reads the real site, the real sample page, the real prompt.
// ─────────────────────────────────────────────────────────────────────────────
//
// The analyzer catches every failure and returns null, so the UI can only say
// "aucun gabarit". This runs the same steps with nothing swallowed.
//
//   node scripts/probe-analyzer.mjs [maxTokens]

import { readEnvLocal } from './db-connect.mjs'

const env = readEnvLocal()
const maxTokens = Number(process.argv[2] || 3000)

// ─── 1. The site ─────────────────────────────────────────────────────────────
const siteRes = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.nextjs&select=name,github_repo,github_token,repo_profile&limit=1`,
  { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
)
const [site] = await siteRes.json()
if (!site) { console.log('aucun site Next.js en base'); process.exit(1) }
console.log('site           :', site.name, '·', site.github_repo)

const profile = site.repo_profile || {}
console.log('gabarit stocke :', profile.publishTemplate ? `${profile.publishTemplate.length} car.` : 'AUCUN')
console.log('erreur stockee :', profile.templateError ?? '—')
console.log('page exemple   :', profile.samplePagePath ?? '—')
console.log('composants     :', (profile.sharedComponents || []).length)

// ─── 2. The sample page, at full size ────────────────────────────────────────
const gh = { Authorization: `token ${site.github_token}`, Accept: 'application/vnd.github+json' }
let samplePage = profile.samplePageContent || ''
if (profile.samplePagePath) {
  const r = await fetch(`https://api.github.com/repos/${site.github_repo}/contents/${profile.samplePagePath}`, { headers: gh })
  if (r.ok) samplePage = Buffer.from((await r.json()).content, 'base64').toString('utf-8')
}
console.log('taille exemple :', samplePage.length, 'car. (tronque a 2500 dans le prompt)')

// ─── 3. The exact prompt the analyzer sends ──────────────────────────────────
const prompt = `Analyse cette page Next.js existante et genere un TEMPLATE reutilisable pour publier de nouvelles pages SEO dans le meme style.

## PAGE EXISTANTE:
\`\`\`tsx
${samplePage.slice(0, 2500)}
\`\`\`

## COMPOSANTS DISPONIBLES:
${(profile.sharedComponents || []).slice(0, 20).join(', ')}

## CONSIGNES:
Genere un template TSX avec des placeholders. Le template doit respecter EXACTEMENT le meme pattern d'imports, metadata export et structure JSX que la page existante, utiliser les memes composants, et n'utiliser QUE ces placeholders :
{{TITLE}}, {{META_DESCRIPTION}}, {{SLUG}}, {{COMPONENT_NAME}}, {{OG_TITLE}}, {{OG_DESCRIPTION}}, {{HTML_CONTENT}}, {{FAQ_ITEMS_JSON}}, {{SCHEMA_JSON}}, {{PAGE_URL}}, {{SITE_URL}}
Nommer l'export par defaut avec {{COMPONENT_NAME}}. Etre un fichier page.tsx complet et valide.

Reponds en JSON: { "template": "le code TSX complet avec placeholders", "sitemapEntry": "le format d'entree sitemap a ajouter" }`

console.log('taille prompt  :', prompt.length, 'car.')

// ─── 4. The call ─────────────────────────────────────────────────────────────
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-5.5',
    messages: [
      { role: 'system', content: "Tu es un expert Next.js. Tu generes des templates de pages en respectant exactement l'architecture existante. Reponds uniquement en JSON valide." },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: maxTokens,
  }),
})

const data = await res.json()
if (!res.ok) { console.log(`\nHTTP ${res.status} :`, data.error?.message); process.exit(1) }

const c = data.choices[0]
console.log('\n─── reponse ───')
console.log('finish_reason  :', c.finish_reason)
console.log('tokens sortie  :', data.usage.completion_tokens, '/', maxTokens)
console.log('  raisonnement :', data.usage.completion_tokens_details?.reasoning_tokens)
console.log('contenu        :', (c.message.content || '').length, 'car.')

if (c.finish_reason === 'length') {
  console.log('\n>>> TRONQUE. Le budget est consomme par le raisonnement avant la sortie.')
  process.exit(0)
}
try {
  const parsed = JSON.parse(c.message.content)
  console.log('template       :', parsed.template ? `${parsed.template.length} car.` : 'CHAMP ABSENT')
  if (parsed.template) console.log('\n─── extrait ───\n' + parsed.template.slice(0, 600))
} catch (e) {
  console.log('JSON invalide  :', e.message)
}
