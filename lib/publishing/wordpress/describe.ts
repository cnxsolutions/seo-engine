// ─────────────────────────────────────────────────────────────────────────────
// Diagnosing a WordPress connection
// SEO Engine - Say what is wrong, and check the thing that actually matters.
// ─────────────────────────────────────────────────────────────────────────────
//
// The test this replaces called `GET /wp/v2/users/me` and reported success on
// any 200. A Subscriber account passes that check and cannot create a page: the
// connection went green, the site was saved, and the first publication failed
// weeks later for a reason nobody could connect to the setup screen.
//
// So the question is not "can you log in". It is "can you publish here, and who
// will read the SEO metadata once you do".

import { detectDialect, dialectNote, type SeoDialect } from './dialect'
import { createWpClient, looksLikeApplicationPassword, WpError, type WpClient } from './rest'

export interface WpDiagnosis {
  ok: boolean
  message: string
  siteName?: string
  dialect?: SeoDialect
  /** Everything true but worth saying. */
  notes: string[]
}

interface Discovery {
  name?: string
  namespaces?: string[]
}

interface CurrentUser {
  name?: string
  capabilities?: Record<string, boolean>
}

export async function diagnose(options: {
  siteUrl: string
  username: string
  appPassword: string
  signal?: AbortSignal
}): Promise<WpDiagnosis> {
  let client: WpClient
  try {
    client = createWpClient(options)
  } catch (error) {
    return { ok: false, message: describeError(error), notes: [] }
  }

  // The discovery document is public and answers two questions at once: is the
  // REST API alive at all, and which SEO plugin registered a namespace.
  let discovery: Discovery
  try {
    discovery = await client.anonymous<Discovery>('/')
  } catch (error) {
    return { ok: false, message: describeError(error), notes: [] }
  }

  let user: CurrentUser
  try {
    user = await client.get<CurrentUser>('/wp/v2/users/me', { context: 'edit' })
  } catch (error) {
    // Name the likeliest cause instead of the symptom. A 401 on a password that
    // is not an application password means the field holds the wrong KIND of
    // secret, not a wrong one — and "identifiant refuse" sends the operator to
    // check a username that was never the problem.
    const wrongKind =
      error instanceof WpError &&
      error.failure === 'auth_refusee' &&
      !looksLikeApplicationPassword(options.appPassword)

    return {
      ok: false,
      siteName: discovery.name,
      message: wrongKind
        ? "Ce n'est pas un mot de passe d'application. WordPress en genere un de 24 caracteres " +
          '(lettres et chiffres, en six groupes de quatre) dans Utilisateurs → Profil → ' +
          "Application Passwords. Le mot de passe du compte n'est jamais accepte par l'API REST."
        : describeError(error),
      notes: [],
    }
  }

  const notes: string[] = []
  const dialect = detectDialect(discovery.namespaces)
  const plugin = dialectNote(dialect)
  if (plugin) notes.push(plugin)

  // `publish_pages` is the capability that decides whether this account can do
  // the one thing the engine needs. `edit_pages` alone produces a page stuck in
  // "pending review" that the owner will never notice.
  const capabilities = user.capabilities ?? {}
  const canPublish = capabilities.publish_pages === true
  const canEdit = capabilities.edit_pages === true

  if (!canEdit) {
    return {
      ok: false,
      siteName: discovery.name,
      dialect,
      message:
        `Le compte « ${user.name ?? options.username} » ne peut pas creer de page sur ce site. ` +
        `Un role Editeur ou Administrateur est requis.`,
      notes,
    }
  }
  if (!canPublish) {
    notes.push(
      `Le compte « ${user.name ?? options.username} » peut rediger mais pas publier : ` +
        `les pages resteront en attente de relecture.`
    )
  }

  return {
    ok: true,
    siteName: discovery.name,
    dialect,
    message:
      `${discovery.name ?? client.origin} · compte ${user.name ?? options.username} · ` +
      `SEO : ${dialect === 'aucun' ? 'aucune extension' : dialect}`,
    notes,
  }
}

function describeError(error: unknown): string {
  if (error instanceof WpError) return error.message
  return error instanceof Error ? error.message : 'Site injoignable'
}
