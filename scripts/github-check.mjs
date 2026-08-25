// ─────────────────────────────────────────────────────────────────────────────
// GitHub connection check
// SEO Engine - Prove a site can actually publish, before the first Day D.
// ─────────────────────────────────────────────────────────────────────────────
//
// "Connexion réussie" in the site form only proves the token can READ the
// repository. A read-only token passes that test, passes the repo analysis, and
// then fails on the first commit — days later, inside a scheduled job, where the
// failure is a line in a log nobody is watching.
//
// Nothing is written here: push rights are read from the repository object,
// which reports the authenticated user's permissions directly.
//
//   node scripts/github-check.mjs <site-id>

import { connect } from './db-connect.mjs'

const siteId = process.argv[2]
if (!siteId) {
  console.error('Usage: node scripts/github-check.mjs <site-id>')
  process.exit(1)
}

const client = await connect({ quiet: true })
const { rows } = await client.query(
  'select name, github_repo, github_token, github_branch from sites where id = $1',
  [siteId]
)
await client.end()

const site = rows[0]
if (!site) {
  console.error(`Aucun site avec l'id ${siteId}`)
  process.exit(1)
}
if (!site.github_repo || !site.github_token) {
  console.error('Ce site n\'a pas de repo ou de token GitHub.')
  process.exit(1)
}

const headers = {
  Authorization: `token ${site.github_token}`,
  Accept: 'application/vnd.github+json',
}

console.log(`\n${site.name} — ${site.github_repo}\n`)

// ─── 1. Repository access and push permission ───────────────────────────────

const repoRes = await fetch(`https://api.github.com/repos/${site.github_repo}`, { headers })

if (!repoRes.ok) {
  const body = await repoRes.json().catch(() => ({}))
  console.log(`  ✕ depot        ${repoRes.status} ${body.message || ''}`)
  console.log('\n  Le token ne voit pas ce depot. Verifie le nom (owner/repo) et, si le depot')
  console.log('  appartient a une organisation, que le token a bien ete APPROUVE par un admin.')
  process.exit(1)
}

const repo = await repoRes.json()
const canPush = repo.permissions?.push === true

console.log(`  ✓ depot        ${repo.full_name} (${repo.private ? 'prive' : 'public'})`)
console.log(`  ${canPush ? '✓' : '✕'} ecriture     push=${repo.permissions?.push} pull=${repo.permissions?.pull}`)
console.log(`  · defaut       ${repo.default_branch}`)

// ─── 2. Target branch ───────────────────────────────────────────────────────

const branch = site.github_branch
if (!branch) {
  console.log(`  ⚠ branche      AUCUNE — les pages iront sur "${repo.default_branch}" (production)`)
} else {
  const branchRes = await fetch(
    `https://api.github.com/repos/${site.github_repo}/branches/${encodeURIComponent(branch)}`,
    { headers }
  )
  if (branchRes.ok) {
    const data = await branchRes.json()
    console.log(`  ✓ branche      ${branch} @ ${data.commit?.sha?.slice(0, 7)}${data.protected ? ' (PROTEGEE)' : ''}`)
    if (data.protected) {
      console.log('    Une branche protegee peut refuser un commit direct de l\'API Contents.')
    }
  } else {
    console.log(`  ✕ branche      "${branch}" introuvable — GitHub renverra 422 a la publication`)
  }
}

// ─── Verdict ────────────────────────────────────────────────────────────────

console.log('')
if (!canPush) {
  console.log('  VERDICT : lecture seule. Le token committera JAMAIS.')
  console.log('  Corrige la permission Contents en "Read and write" et regenere-le.')
  process.exitCode = 1
} else if (!branch) {
  console.log('  VERDICT : publication possible, mais directement en production.')
} else {
  console.log('  VERDICT : pret a publier sur une branche relisable.')
}
