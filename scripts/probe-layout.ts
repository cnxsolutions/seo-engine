import { readFileSync } from 'node:fs'
import { analyzeNextJsRepo } from '../lib/publishers/nextjs-analyzer'

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
    const m = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

async function main() {
  const env = readEnv()
  const r = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.nextjs&select=github_repo,github_token,github_branch&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  )
  const [s] = await r.json()
  const p = await analyzeNextJsRepo(s.github_repo, s.github_token, s.github_branch || undefined)

  console.log(`pages comparees : ${p.chrome?.sampleCount ?? 0}
`)
  console.log('composant'.padEnd(42), 'partage', 'presence')
  for (const c of p.chrome?.layout ?? []) {
    console.log(c.name.padEnd(42), String(c.shared).padEnd(7), `${c.presentIn}/${p.chrome?.sampleCount}`)
  }
  console.log('\nprops lues :')
  for (const [name, props] of Object.entries(p.componentProps ?? {})) {
    console.log(`  ${name} : ${props.map((x) => x.name + (x.optional ? '?' : '')).join(', ') || '(aucune)'}`)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
