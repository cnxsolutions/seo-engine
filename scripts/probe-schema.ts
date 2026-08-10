// Probe the WordPress schema extractor against the connected site, in-process.
import { readFileSync } from 'node:fs'
import { createWordPressExtractor } from '../src/adapters/extractors'
import { createFederatedSite } from '../src/core/domain/entities'

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
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.wordpress&select=id,name,url,wp_username,wp_app_password,is_active,created_at,updated_at&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  )
  const [site] = await res.json()

  const federated = createFederatedSite({
    id: site.id,
    name: site.name,
    type: 'wordpress',
    url: site.url,
    credentials: { wpUsername: site.wp_username, wpAppPassword: site.wp_app_password },
    isActive: true,
    createdAt: new Date(site.created_at),
    updatedAt: new Date(site.updated_at),
  })

  const schema = await createWordPressExtractor(federated).extract(federated)
  console.log('types :', schema.contentTypes.length)
  for (const ct of schema.contentTypes.slice(0, 6)) {
    console.log('  ' + ct.key.padEnd(18), 'label=' + JSON.stringify(ct.label), '· champs=' + ct.fields.length)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
