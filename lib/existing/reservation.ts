// ─────────────────────────────────────────────────────────────────────────────
// Reservation de slug
// SEO Engine - L'adresse est decidee AVANT le premier token, et ecrite seule.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le slug etait une SORTIE du modele. Il devient une ENTREE, ecrite en base
// avant qu'une seule ligne de HTML ne soit payee. Deux bugs verifies meurent
// avec ce renversement.
//
// 1. LE HTML PERDU. lib/scheduler/cron.ts (~ligne 1111) ecrit slug, title,
//    content et page_payload dans un MEME updateGeneration, et updateGeneration
//    JETTE sur erreur Supabase (lib/db.ts:263-266). Une collision de slug fait
//    donc echouer l'UPDATE ENTIER : la page generee, facturee au token, n'est
//    jamais persistee. Le remede n'est pas d'attraper l'erreur plus haut, c'est
//    de ne plus melanger dans une meme ecriture une adresse qui peut etre
//    refusee et un contenu qui ne peut pas l'etre.
//
// 2. DEUX TICKS CONCURRENTS. Rien n'empechait deux runs de choisir le meme
//    slug : chacun lisait un inventaire ou l'adresse etait libre, chacun
//    generait, et le second ecrasait ou dupliquait. En posant le slug SEUL et
//    TOT, l'index unique partiel idx_generations_unique_slug_site
//    (db/000_baseline.sql:840, UNIQUE (site_id, slug) WHERE slug IS NOT NULL
//    AND status <> 'failed') devient l'arbitre : le perdant apprend qu'il a
//    perdu avant d'avoir depense un centime. Aucun verrou distribue, aucune
//    dependance npm — la base sait deja faire ca.
//
// C'est pourquoi la violation 23505 est TRADUITE en refus et jamais propagee :
// une exception ferait de l'arbitrage une panne, alors que c'est une decision.
//
// PRECONDITION. `generationId` designe une ligne generations DEJA EXISTANTE.
// Sur le chemin planifie, openGeneration ouvre la ligne avant le run ; sur le
// chemin manuel, runCampaignNow appelle createGeneration avant d'arriver ici.
// Le chemin cluster (app/api/cluster/route.ts) n'utilise PAS ce module : il
// genere toutes les pages d'un bloc PUIS cree les lignes, il n'a donc rien a
// reserver et se sert de resolveFreeSlug directement, contre un Set mutable.
//
// RESERVE SUR generations_refresh_needs_target (migration 018). Ce CHECK est
// NOT VALID, ce qui dispense la migration des lignes historiques mais PAS les
// ecritures suivantes : CHECK (intent = 'create' OR refresh_target_path IS NOT
// NULL) est evalue a chaque UPDATE. Poser `intent = 'refresh'` et
// `refresh_target_path` dans DEUX appels separes fait echouer le premier. Ce
// module n'ecrit ni l'un ni l'autre — il n'ecrit que `slug` — mais l'appelant
// qui enchaine une reservation et un passage en refresh doit les grouper.

import { resolveFreeSlug, type SlugInput } from '@/lib/seo/slug'
import { createServiceClient } from '@/lib/supabase'
import {
  normalizeInventoryPath,
  type SiteInventory,
} from '@/src/core/domain/existing/inventory'

/**
 * `city` ne sert pas a construire le slug — `slugInput.city` s'en charge deja,
 * et deux sources pour la meme ville produiraient deux adresses. Elle sert a
 * ce que le refus NOMME la page qu'on a renonce a ecrire : « /taxi-troyes est
 * occupee » n'apprend rien a un operateur qui pilote quarante communes.
 */
export interface ReserveSlugInput {
  siteId: string
  generationId: string
  city: string
  slugInput: SlugInput
  inventory: SiteInventory
  disambiguators: readonly string[]
}

/**
 * `refusal` est une union a un seul membre aujourd'hui, et c'est volontaire :
 * un appelant qui teste `refusal === 'collision'` continuera de compiler le
 * jour ou un second motif de refus apparait, la ou un booleen l'aurait laisse
 * traiter deux faits comme un seul.
 */
export type ReserveSlugResult =
  | { ok: true; slug: string; disambiguatedFrom?: string; token?: string }
  | { ok: false; refusal: 'collision'; occupiedBy: string; message: string }

/**
 * Le code que PostgreSQL rend quand un index unique refuse la ligne.
 *
 * `generations` ne porte qu'un seul index unique en dehors de sa cle primaire,
 * idx_generations_unique_slug_site, et un UPDATE qui ne touche que `slug` ne
 * peut violer que celui-la : la cle primaire n'est pas modifiee. Traduire tout
 * 23505 en collision de slug est donc exact ici, et le resterait faux dans un
 * module qui ecrirait d'autres colonnes.
 */
const UNIQUE_VIOLATION = '23505'

/**
 * Choisir une adresse libre, puis la poser en base — dans cet ordre, et sans
 * rien d'autre.
 *
 * Le seul appel reseau est l'UPDATE. La resolution, elle, est pure et deja
 * testee sans base (lib/seo/slug.test.ts) : ce module ne teste pas a nouveau la
 * politique de desambiguation, il teste ce que la politique ne peut pas savoir
 * — qu'une autre generation a gagne la course entre la lecture et l'ecriture.
 */
export async function reserveSlug(input: ReserveSlugInput): Promise<ReserveSlugResult> {
  const resolution = resolveFreeSlug(
    input.slugInput,
    input.inventory.takenPaths,
    input.disambiguators,
  )

  // Refus AVANT toute ecriture et avant tout appel au modele. Une page qui n'a
  // pas d'adresse libre n'a rien de neuf a dire : la renommer jusqu'a ce
  // qu'elle rentre est precisement ce que resolveFreeSlug refuse de faire.
  if (resolution.status === 'collision') {
    return {
      ok: false,
      refusal: 'collision',
      occupiedBy: resolution.occupiedBy,
      message:
        `L'adresse ${resolution.occupiedBy} est deja occupee sur ce site et aucun ` +
        `desambiguateur n'en libere d'autre pour ${input.city}. Rien n'a ete demande ` +
        `au modele : la page n'est pas generee.`,
    }
  }

  const supabase = createServiceClient()

  // UNE SEULE COLONNE. C'est tout le correctif.
  //
  // Pas de `updated_at` : le trigger trigger_generations_updated_at
  // (BEFORE UPDATE, db/000_baseline.sql:912) le pose deja, et l'ecrire ici
  // ferait croire au relecteur que cette charge utile peut accueillir un
  // second champ. Elle ne le peut pas — toute colonne ajoutee ici retombe
  // sous le meme UPDATE que le slug, donc sous le meme refus possible, et
  // reintroduit le bug du HTML perdu.
  const { error } = await supabase
    .from('generations')
    .update({ slug: resolution.slug })
    .eq('id', input.generationId)

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // L'index a arbitre : une autre generation a pose ce slug entre notre
      // lecture de l'inventaire et notre ecriture. Ce n'est PAS une panne, et
      // le laisser remonter en exception ferait echouer un tick entier pour un
      // fait parfaitement normal en concurrence.
      const occupiedBy = normalizeInventoryPath(resolution.slug)
      return {
        ok: false,
        refusal: 'collision',
        occupiedBy,
        message:
          `L'adresse ${occupiedBy} vient d'etre reservee par une autre generation ` +
          `pour ${input.city}. Rien n'a ete demande au modele : la page n'est pas generee.`,
      }
    }
    throw new Error(error.message)
  }

  return resolution.status === 'disambiguated'
    ? {
        ok: true,
        slug: resolution.slug,
        disambiguatedFrom: resolution.from,
        token: resolution.token,
      }
    : { ok: true, slug: resolution.slug }
}
