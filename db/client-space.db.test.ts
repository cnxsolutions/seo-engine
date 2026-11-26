// ─────────────────────────────────────────────────────────────────────────────
// QA-2 — the client space, against the LOCAL Supabase: sign-in, isolation,
// revocation, expiry. docs/cadrage.md ACC-1 to ACC-4, § 3.7.
//
// Real Supabase Auth, real codes (read back from Mailpit), real rows. Only
// the cookie store is an in-memory jar instead of a browser. Every row and
// account is created here under a unique stamp, and removed in afterAll: the
// demonstration data is never touched.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { connect } from '../scripts/db-connect.mjs'
import { inviteMember, loadSiteAccess, revokeMember } from '@/lib/client-space/access'
import { createAuthClient, readClientAuthEnv, type CookieJar, type SessionCookie } from '@/lib/client-space/auth-client'
import { findMemberSite, listMemberSites } from '@/lib/client-space/scope'
import { resolveClientSession, type ClientSession } from '@/lib/client-space/session'
import { requestSignInCode, verifySignInCode } from '@/lib/client-space/sign-in'

const STAMP = Date.now().toString(36)
const EMAIL_A = `a-${STAMP}@client-a.test`
const EMAIL_B = `b-${STAMP}@client-b.test`

let db: Client
const siteIds: Record<'a1' | 'a2' | 'b', string> = { a1: '', a2: '', b: '' }
let ipCounter = 0
/** Each verification from its own address: the in-memory limiter must not decide these tests. */
const nextIp = () => `test-ip-${STAMP}-${++ipCounter}`

// ── Helpers ─────────────────────────────────────────────────────────────

class MemoryJar implements CookieJar {
  readonly cookies = new Map<string, SessionCookie>()
  getAll() {
    return [...this.cookies.values()].map(({ name, value }) => ({ name, value }))
  }
  setAll(list: SessionCookie[]) {
    for (const cookie of list) {
      if (cookie.options.maxAge !== undefined && cookie.options.maxAge <= 0) this.cookies.delete(cookie.name)
      else this.cookies.set(cookie.name, cookie)
    }
  }
}

function authOn(jar: MemoryJar) {
  const env = readClientAuthEnv()
  if (!env) throw new Error('environnement Supabase local absent (db/env.db.ts)')
  return createAuthClient(env, jar)
}

/** The six digits of the latest e-mail sent to `email`, waiting for Mailpit if needed. */
async function latestCode(email: string, after: number): Promise<string> {
  const mailpit = inject('mailpitUrl')
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    const { messages } = (await search.json()) as { messages: Array<{ ID: string; Created: string }> }
    const fresh = messages.find((message) => Date.parse(message.Created) >= after - 1000)
    if (fresh) {
      const message = (await (await fetch(`${mailpit}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string }
      const code = message.HTML.match(/>\s*(\d{6})\s*</)?.[1]
      if (code) return code
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`aucun code recu pour ${email}`)
}

/** Invites (or re-sends to) `email` on `siteId`, then signs in with the code it received. */
async function signIn(email: string): Promise<MemoryJar> {
  const jar = new MemoryJar()
  const sentAfter = Date.now()
  // The code was sent by the invitation just before; ask for a fresh one only if none is there.
  const code = await latestCode(email, sentAfter - 60_000)
  const result = await verifySignInCode({ email, code, ip: nextIp(), auth: authOn(jar) })
  expect(result).toEqual({ status: 'signed_in' })
  return jar
}

async function activeSession(jar: MemoryJar): Promise<ClientSession> {
  const result = await resolveClientSession(authOn(jar))
  if (result.status !== 'active') throw new Error(`session attendue active, obtenue : ${result.status}`)
  return result.session
}

/** Supabase lets one e-mail per address per second locally (max_frequency) : spacing invitations. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── Fixtures ────────────────────────────────────────────────────────────

beforeAll(async () => {
  db = await connect({ allow: ['local'], argv: [], quiet: true })
  const { rows } = await db.query<{ key: string; id: string }>(
    `insert into public.sites (name, type, url, is_active, wp_app_password, github_token)
     values ($1, 'wordpress', $2, true, 'secret-wp', 'secret-gh'),
            ($3, 'nextjs',    $4, true, null, null),
            ($5, 'wordpress', $6, true, 'secret-wp-b', null)
     returning id, case name when $1 then 'a1' when $3 then 'a2' else 'b' end as key`,
    [`A1 ${STAMP}`, `https://a1-${STAMP}.test`, `A2 ${STAMP}`, `https://a2-${STAMP}.test`, `B ${STAMP}`, `https://b-${STAMP}.test`],
  )
  for (const row of rows) siteIds[row.key as keyof typeof siteIds] = row.id
})

afterAll(async () => {
  if (!db) return
  const { rows } = await db.query<{ user_id: string }>(
    `select user_id from public.client_members where email in ($1, $2)`, [EMAIL_A, EMAIL_B],
  )
  await db.query(
    `delete from public.clients where id in (select client_id from public.sites where id = any($1::uuid[]))`,
    [Object.values(siteIds).filter(Boolean)],
  )
  await db.query(`delete from public.sites where id = any($1::uuid[])`, [Object.values(siteIds).filter(Boolean)])
  const admin = createClient(inject('supabaseApiUrl'), inject('supabaseServiceKey'), { auth: { persistSession: false } }).auth.admin
  for (const { user_id } of rows) await admin.deleteUser(user_id)
  await db.end()
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('espace client — invitation et connexion', () => {
  it('l operateur ouvre l acces : client cree, site rattache, membre cree, code envoye', async () => {
    expect(await inviteMember({ siteId: siteIds.a1, email: EMAIL_A, client: { kind: 'new', name: `Client A ${STAMP}` } })).toEqual({ status: 'invited' })
    await pause(1100)
    expect(await inviteMember({ siteId: siteIds.b, email: EMAIL_B, client: { kind: 'new', name: `Client B ${STAMP}` } })).toEqual({ status: 'invited' })

    // A second site joins client A through the picker.
    const accessA = await loadSiteAccess(siteIds.a1)
    const clientA = accessA?.client
    expect(clientA?.name).toBe(`Client A ${STAMP}`)
    const { rows } = await db.query(`update public.sites set client_id = $1 where id = $2 returning id`, [clientA?.id, siteIds.a2])
    expect(rows).toHaveLength(1)

    expect(accessA?.members.map((member) => [member.email, member.state])).toEqual([[EMAIL_A, 'pending']])
  })

  it('le code recu ouvre une session en cookies HttpOnly, et date la connexion', async () => {
    const jar = await signIn(EMAIL_A)
    const cookies = [...jar.cookies.values()]
    expect(cookies.length).toBeGreaterThan(0)
    for (const cookie of cookies) {
      expect(cookie.options.httpOnly).toBe(true)
      expect(cookie.options.sameSite).toBe('lax')
    }

    const session = await activeSession(jar)
    expect(session.email).toBe(EMAIL_A)
    const access = await loadSiteAccess(siteIds.a1)
    expect(access?.members[0]).toMatchObject({ email: EMAIL_A, state: 'active' })
    expect(access?.members[0]?.lastLoginAt).toBeTruthy()
  })

  it('un code faux ne connecte personne', async () => {
    const result = await verifySignInCode({ email: EMAIL_B, code: '000000', ip: nextIp(), auth: authOn(new MemoryJar()) })
    expect(result).toEqual({ status: 'invalid' })
  })

  it('demander un code repond pareil pour un inconnu, et n envoie rien', async () => {
    const deferred: Array<() => Promise<void>> = []
    const result = await requestSignInCode({ email: `inconnu-${STAMP}@nulle-part.test`, ip: nextIp(), defer: (task) => deferred.push(task) })
    expect(result).toEqual({ status: 'accepted' })
    expect(deferred).toHaveLength(0)
  })
})

describe('espace client — cloisonnement (QA-2)', () => {
  it('un membre ne liste que les sites de son client', async () => {
    const sessionA = await activeSession(await signInFresh(EMAIL_A))
    const sitesA = await listMemberSites(sessionA)
    expect(sitesA.map((site) => site.id).sort()).toEqual([siteIds.a1, siteIds.a2].sort())

    const sessionB = await activeSession(await signInFresh(EMAIL_B))
    expect((await listMemberSites(sessionB)).map((site) => site.id)).toEqual([siteIds.b])
  })

  it('le site d un autre client est introuvable, comme un identifiant invente', async () => {
    const sessionA = await activeSession(await signInFresh(EMAIL_A))
    expect(await findMemberSite(sessionA, siteIds.b)).toBeNull()
    expect(await findMemberSite(sessionA, '00000000-0000-0000-0000-000000000000')).toBeNull()
    expect(await findMemberSite(sessionA, "' or 1=1 --")).toBeNull()
  })

  it('ce qu un membre recoit d un site ne porte aucun secret', async () => {
    const sessionA = await activeSession(await signInFresh(EMAIL_A))
    const site = await findMemberSite(sessionA, siteIds.a1)
    expect(site && Object.keys(site).sort()).toEqual(['id', 'name', 'url'])
    expect(JSON.stringify(await listMemberSites(sessionA))).not.toMatch(/secret-/)
  })

  it('une adresse deja cliente ailleurs ne peut pas etre invitee sur un autre client', async () => {
    const result = await inviteMember({ siteId: siteIds.b, email: EMAIL_A, client: null })
    expect(result).toMatchObject({ status: 'refused', code: 'other_client' })
  })
})

describe('espace client — revocation et expiration (ACC-4)', () => {
  /** A session of B opened BEFORE the revocation, to check it never comes back. */
  let jarBeforeRevocation: MemoryJar

  it('un acces retire ferme la session tout de suite, et plus aucun code ne part', async () => {
    const jar = await signInFresh(EMAIL_B)
    jarBeforeRevocation = jar
    const session = await activeSession(jar)

    expect(await revokeMember(siteIds.a1, session.memberId)).toBe('not_found')
    expect(await revokeMember(siteIds.b, session.memberId)).toBe('revoked')
    expect((await resolveClientSession(authOn(jar))).status).toBe('revoked')

    const deferred: Array<() => Promise<void>> = []
    await requestSignInCode({ email: EMAIL_B, ip: nextIp(), defer: (task) => deferred.push(task) })
    expect(deferred).toHaveLength(0)
  })

  it('une nouvelle invitation rouvre l acces, avec un nouveau code seulement', async () => {
    // Two seconds, not one: the sign-in time comes from Supabase Auth's clock,
    // to the second, and the reopening from this process's. Under Docker
    // Desktop the VM runs some 0.6 s ahead of Windows, and with the rounding a
    // 1.1 s pause sometimes left the old phone inside the same second.
    await pause(2100)
    expect(await inviteMember({ siteId: siteIds.b, email: EMAIL_B, client: null })).toEqual({ status: 'reopened' })
    const session = await activeSession(await signIn(EMAIL_B))
    expect(session.email).toBe(EMAIL_B)

    // The phone that was signed in before the revocation stays out.
    expect((await resolveClientSession(authOn(jarBeforeRevocation))).status).toBe('expired')
  })

  it('une session ouverte avant la borne du membre est refusee, meme rafraichie', async () => {
    const jar = await signInFresh(EMAIL_A)
    await pause(1100)
    await db.query(`update public.client_members set sessions_valid_after = now() where email = $1`, [EMAIL_A])
    await authOn(jar).auth.refreshSession()
    expect((await resolveClientSession(authOn(jar))).status).toBe('expired')
  })
})

/** A fresh code for an existing member (the e-mail is sent through the same deferred path as the sign-in page). */
async function signInFresh(email: string): Promise<MemoryJar> {
  await pause(1100)
  const sentAfter = Date.now()
  const deferred: Array<() => Promise<void>> = []
  await requestSignInCode({ email, ip: nextIp(), defer: (task) => deferred.push(task) })
  expect(deferred).toHaveLength(1)
  await deferred[0]()
  const jar = new MemoryJar()
  const code = await latestCode(email, sentAfter)
  expect(await verifySignInCode({ email, code, ip: nextIp(), auth: authOn(jar) })).toEqual({ status: 'signed_in' })
  return jar
}
