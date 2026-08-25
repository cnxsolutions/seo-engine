// ─────────────────────────────────────────────────────────────────────────────
// Read a file (or list a directory) from the connected site's GitHub repo
// SEO Engine - The token lives in the database, never on the command line.
// ─────────────────────────────────────────────────────────────────────────────
//
//   node scripts/gh-read.mjs                          # list the tree
//   node scripts/gh-read.mjs src/components/Hero.tsx  # print a file
//   node scripts/gh-read.mjs --grep components/       # filter the tree
//   SITE=renovation gh-read.mjs …                     # target a site by name or repo

import { readEnvLocal } from './db-connect.mjs'

const env = readEnvLocal()
const arg = process.argv[2]

const res = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.nextjs&select=name,github_repo,github_token,github_branch`,
  { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
)
const sites = await res.json()

// More than one site is connected now, so "the first one" is no longer an
// answer. SITE matches on name or repository, case-insensitively.
const wanted = (process.env.SITE || '').toLowerCase()
const site = wanted
  ? sites.find((s) => `${s.name} ${s.github_repo}`.toLowerCase().includes(wanted))
  : sites[0]

if (!site) {
  console.error(wanted ? `aucun site ne correspond a « ${wanted} »` : 'aucun site Next.js en base')
  console.error('sites connus :', sites.map((s) => `${s.name} (${s.github_repo})`).join(', '))
  process.exit(1)
}

const headers = { Authorization: `token ${site.github_token}`, Accept: 'application/vnd.github+json' }
const repo = `https://api.github.com/repos/${site.github_repo}`
const ref = site.github_branch || 'main'

if (!arg || arg === '--grep') {
  const t = await fetch(`${repo}/git/trees/${ref}?recursive=1`, { headers })
  if (!t.ok) { console.error(`GitHub ${t.status}`); process.exit(1) }
  const filter = process.argv[3]
  const files = (await t.json()).tree.filter(f => f.type === 'blob').map(f => f.path)
  console.log(files.filter(f => !filter || f.includes(filter)).join('\n'))
} else {
  const f = await fetch(`${repo}/contents/${arg}?ref=${encodeURIComponent(ref)}`, { headers })
  if (!f.ok) { console.error(`GitHub ${f.status} sur ${arg}`); process.exit(1) }
  console.log(Buffer.from((await f.json()).content, 'base64').toString('utf-8'))
}
