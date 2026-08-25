// ─────────────────────────────────────────────────────────────────────────────
// Sonde d'occupation
// SEO Engine - Une question posee au site, quand notre memoire ne suffit plus.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'inventaire repond a « cette adresse est-elle prise ? » sans reseau, et c'est
// la bonne reponse tant qu'il est FRAIS. Passe ce delai, il decrit un site qui
// n'existe plus : le proprietaire a publie, renomme, redirige, et le moteur
// reserverait une adresse deja occupee par une page qui ranke.
//
// Cette sonde n'existe donc que pour ce cas, et l'appelant DOIT la reserver aux
// inventaires dont freshness.state !== 'fresh'. L'appeler systematiquement
// remplacerait une lecture locale par un aller-retour reseau a chaque page, ce
// que la conscience de l'existant est justement la pour eviter.
//
// CE QU'ELLE COUTE, DECLARE PLUTOT QUE DECOUVERT.
//   WordPress : jusqu'a TROIS requetes. findBySlug interroge /wp/v2/pages PUIS
//               /wp/v2/posts — un post peut tenir le slug — et quand aucun des
//               deux ne rend rien, redirectedAway demande l'URL elle-meme en
//               redirect: 'manual'.
//   Next.js   : la lecture du fichier de page via l'API Contents de GitHub,
//               PLUS un detectProfileLite complet quand sites.repo_profile est
//               vide, parce qu'on ne connait pas le dossier des pages sans lui.
// Ce n'est pas « une requete ». C'est deux a trois, et c'est trois ordres de
// grandeur sous le prix d'une page generee puis jetee.
//
// UNE SONDE QUI ECHOUE REND { free: true }. L'absence de preuve n'est pas une
// preuve d'occupation : un depot injoignable, un jeton expire, une URL non
// HTTPS ne disent rien de l'adresse. Bloquer la-dessus arreterait le moteur
// parce qu'une source externe manque — exactement ce que ce chantier supprime.
// La raison 'inconnu' existe pour que l'appelant sache qu'il n'a rien appris,
// et non pour qu'il en conclue quelque chose.

import { probeNextJsPath } from '@/lib/publishers/nextjs'
import type { RepoProfile } from '@/lib/publishers/nextjs-analyzer'
import { createWpClient } from '@/lib/publishing/wordpress/rest'
import { decideTarget, refusalKindFor } from '@/lib/publishing/wordpress/target'
import type { Site } from '@/lib/types'

/**
 * 'occupe' et 'redirection' appellent la meme action de l'operateur — changer
 * le slug — mais pas la meme phrase : une page qui existe se regarde, une
 * redirection se defait. 'inconnu' n'est pas un refus, c'est un aveu.
 */
export type ProbeReason = 'occupe' | 'redirection' | 'inconnu'

export interface ProbeResult {
  free: boolean
  reason?: ProbeReason
  /** La phrase du connecteur, telle quelle : elle nomme deja la page trouvee. */
  message?: string
}

/** Ce qu'on rend des qu'on n'a rien appris, quelle qu'en soit la cause. */
const INCONNU: ProbeResult = { free: true, reason: 'inconnu' }

/**
 * L'adresse `slug` est-elle libre sur le site distant ?
 *
 * `signal` est propage au client WordPress, qui le compose avec son propre
 * delai (rest.ts:115). Cote Next.js il ne peut pas l'etre : lib/publishers
 * ne connait pas AbortSignal et il n'appartient pas a ce lot de lui apprendre.
 * Une annulation deja survenue est donc verifiee AVANT de depenser les
 * requetes — c'est le seul point ou l'annulation change quelque chose sur ce
 * chemin, et le taire aurait laisse croire le contraire.
 */
export async function probeSlugFree(
  site: Site,
  slug: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  if (signal?.aborted) return INCONNU

  try {
    if (site.type === 'wordpress') return await probeWordPress(site, slug, signal)
    if (site.type === 'nextjs') return await probeNextJs(site, slug)
  } catch {
    // createWpClient JETTE WpError('url_non_https') des la construction
    // (rest.ts:99-101), le reseau jette, un jeton revoque jette. Aucun de ces
    // faits ne dit que l'adresse est prise.
    return INCONNU
  }

  // sites_type_check n'autorise que 'wordpress' et 'nextjs'. Un troisieme type
  // ne peut venir que d'une base en avance sur ce code : on ne devine pas.
  return INCONNU
}

// ─── WordPress ──────────────────────────────────────────────────────────────

/**
 * decideTarget fait deja ce travail, et le fait mieux : il cherche dans les
 * pages ET les posts, il tient compte du statut, et il distingue une
 * redirection d'une occupation. Le redupliquer ici aurait produit une seconde
 * definition d'« occupe » qui aurait derive de la premiere.
 *
 * Aucun knownRemoteId, aucun force, aucun recovering : on demande ce que voit
 * un visiteur, pas ce que le moteur a le droit d'ecraser.
 */
async function probeWordPress(
  site: Site,
  slug: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  if (!site.wp_username || !site.wp_app_password) return INCONNU

  const client = createWpClient({
    siteUrl: site.url,
    username: site.wp_username,
    appPassword: site.wp_app_password,
    signal,
  })

  const target = await decideTarget(client, { slug })

  if (target.action === 'creer') return { free: true }

  if (target.action === 'refuser') {
    // La variante 'refuser' ne porte qu'une phrase, sans discriminant. C'est
    // refusalKindFor qui la qualifie, et c'est la MEME fonction que le
    // connecteur appelle : une seule definition de « pourquoi c'est refuse ».
    return { free: false, reason: refusalKindFor(target.reason), message: target.reason }
  }

  // 'mettre-a-jour' sans knownRemoteId ne peut sortir de decideTarget que par
  // les branches force/recovering, qu'on ne passe pas. Le cas est donc mort ici
  // — mais le rendre libre « puisqu'il est inatteignable » serait la mauvaise
  // valeur par defaut le jour ou il cesse de l'etre : une page qu'on peut
  // mettre a jour est une page qui existe, donc une adresse prise.
  return { free: false, reason: 'occupe', message: target.reason }
}

// ─── Next.js ────────────────────────────────────────────────────────────────

/**
 * La traduction Site -> options de connecteur vit ICI.
 *
 * lib/publishers/nextjs.ts ne connait ni `Site` ni Supabase : ses primitives
 * sont un depot, un jeton, une branche et un profil. Lui faire accepter un
 * `Site` aurait fait remonter le modele de donnees dans un module qui n'a
 * jamais eu besoin de le connaitre.
 */
async function probeNextJs(site: Site, slug: string): Promise<ProbeResult> {
  if (!site.github_repo || !site.github_token) return INCONNU

  const probe = await probeNextJsPath({
    githubRepo: site.github_repo,
    githubToken: site.github_token,
    branch: site.github_branch ?? undefined,
    // `repo_profile` est un jsonb, donc `unknown` cote types. Absent, la sonde
    // paye un detectProfileLite pour retrouver le dossier des pages.
    repoProfile: (site.repo_profile as RepoProfile | null) ?? null,
    slug,
  })

  if (probe.redirected) {
    return {
      free: false,
      reason: 'redirection',
      message:
        `/${slug} est une source de redirection dans ${site.github_repo} : ` +
        `la page publiee serait inatteignable.`,
    }
  }

  if (probe.occupied) {
    // `ours` n'est PAS lu ici, et c'est delibere : la question posee est celle
    // de l'ADRESSE, pas celle du droit d'ecrire. Une page que le moteur a
    // ecrite occupe son URL aussi fermement qu'une page ecrite a la main.
    // L'appelant qui veut remplacer sa propre page passe par `replaces`, qui
    // nomme un chemin ; il ne passe pas par une sonde qui dirait « libre ».
    return {
      free: false,
      reason: 'occupe',
      message:
        `/${slug} existe deja dans ${site.github_repo}` +
        (probe.ours ? ' (page publiee par le moteur).' : " et n'a pas ete ecrite par le moteur."),
    }
  }

  return { free: true }
}
