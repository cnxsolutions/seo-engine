// ─────────────────────────────────────────────────────────────────────────────
// Diagnose a WordPress connection, against a real site
// SEO Engine - Credentials come from a file, never from the command line.
// ─────────────────────────────────────────────────────────────────────────────
//
//   npx tsx scripts/probe-wp.ts <chemin-du-json>

import { readFileSync } from 'node:fs'
import { diagnose } from '../lib/publishing/wordpress/describe'
import { looksLikeApplicationPassword } from '../lib/publishing/wordpress/rest'

async function main() {
  const path = process.argv[2]
  if (!path) throw new Error('usage: npx tsx scripts/probe-wp.ts <fichier.json>')

  const creds = JSON.parse(readFileSync(path, 'utf-8')) as {
    siteUrl: string
    username: string
    appPassword: string
  }

  console.log('site              :', creds.siteUrl)
  console.log('utilisateur       :', creds.username)
  console.log('forme du mot de passe :', looksLikeApplicationPassword(creds.appPassword)
    ? 'compatible mot de passe d application'
    : `INCOMPATIBLE — ${creds.appPassword.replace(/\s+/g, '').length} caracteres, dont des symboles`)
  console.log('')

  const result = await diagnose(creds)
  console.log('connexion         :', result.ok ? 'OK' : 'REFUSEE')
  console.log('nom du site       :', result.siteName ?? '—')
  console.log('extension SEO     :', result.dialect ?? '—')
  console.log('diagnostic        :', result.message)
  for (const note of result.notes) console.log('  note            :', note)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
