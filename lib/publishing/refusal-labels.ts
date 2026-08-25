// ─────────────────────────────────────────────────────────────────────────────
// Le vocabulaire du refus, traduit UNE fois
// SEO Engine - Publication
// ─────────────────────────────────────────────────────────────────────────────
//
// Un code de refus devient une phrase francaise ici, et nulle part ailleurs.
//
// Jusqu'a ce fichier, la table vivait dans app/(dashboard)/generate/page.tsx
// (`REFUSAL_TITLE`, ligne 432), typee `Record<string, string>`. /publish affiche
// la meme file de generations et n'avait donc aucun moyen de nommer un refus
// sans recopier cette table — et une seconde copie derive au premier code
// ajoute. 'duplicat', que la migration 018 vient d'ajouter a
// `generations_refusal_kind_check`, est exactement ce code-la.
//
// `Record<RefusalKind, string>` et non `Record<string, string>` : le compilateur
// exige alors une ligne par membre de l'union. Le jour ou un cinquieme refus
// entre dans lib/types.ts, ce fichier cesse de compiler — c'est tout son role.
// La table `Record<string, string>` qu'il remplace, elle, se serait contentee de
// rendre `undefined` a l'ecran.
//
// Ce module ne connait ni la base, ni HTTP, ni le DOM : il traduit une union en
// francais et lit un verdict deja construit. Il se teste sans rien monter.

import type { FeedGeneration, FeedRefusalNotice } from '@/app/api/generate/feed-types'
import type { RefusalKind } from '@/lib/types'
import { summarizeVerdict } from '@/src/core/domain/existing/verdict'

/**
 * Le TITRE de chaque refus — la categorie, toujours vraie, jamais vide.
 *
 * A lire avec `describeRefusal` : le titre se prend ici via `notice.kind`, le
 * detail se prend dans `notice.message`. C'est la paire « titre + message » que
 * les deux ecrans rendent.
 */
export const REFUSAL_TITLES: Record<RefusalKind, string> = {
  occupe: 'Publication refusée — l’URL est déjà occupée',
  redirection: 'Publication refusée — l’URL redirige ailleurs',
  identifiants: 'Publication refusée — identifiants manquants',
  duplicat: 'Publication refusée — une page très proche existe déjà',
}

/**
 * Les clefs de la table, sans son prototype.
 *
 * `'toString' in REFUSAL_TITLES` vaut `true` : un litteral d'objet herite
 * d'Object.prototype, et une garde ecrite avec `in` accepterait donc n'importe
 * quel nom de methode comme un refus valide.
 */
const KNOWN_KINDS = new Set<string>(Object.keys(REFUSAL_TITLES))

/**
 * La garde de frontiere : la seule facon d'admettre un refus venu de la base.
 *
 * `generations.refusal_kind` a ete creee nue par la migration 016, et le CHECK
 * pose par 018 est NOT VALID — les lignes deja presentes n'ont jamais ete
 * verifiees. Sans cette garde, une valeur inattendue traverserait un type qui
 * jure le contraire et l'ecran afficherait `undefined` en guise de titre.
 */
export function isRefusalKind(value: unknown): value is RefusalKind {
  return typeof value === 'string' && KNOWN_KINDS.has(value)
}

/**
 * Ce qu'il faut dire a l'operateur d'une ligne refusee, ou rien.
 *
 * `null` des que `refusal_kind` est nul : une panne n'est pas un refus. Une
 * panne se rejoue au prochain tick, un refus attend une decision humaine, et
 * c'est cette colonne — et elle seule — qui les distingue.
 *
 * `message` porte la phrase que le moteur a REELLEMENT enregistree
 * (`error_message`, ecrite par publish.ts:120 et par refuseBeforeGenerating),
 * parce qu'elle nomme l'adresse en cause ; le libelle generique ne sert que de
 * repli quand rien n'a ete enregistre, pour qu'aucun refus ne s'affiche muet.
 *
 * `targetUrl` n'est renseigne que sur 'duplicat' : c'est le seul refus qui
 * designe une page existante, et `summarizeVerdict` sait laquelle des preuves
 * est la plus grave. La recopier ici ferait un second classement des codes.
 */
export function describeRefusal(
  g: Pick<FeedGeneration, 'refusal_kind' | 'duplicate_verdict' | 'error_message'>,
): FeedRefusalNotice | null {
  const kind = g.refusal_kind
  if (!kind) return null

  const recorded = g.error_message?.trim()
  const notice: FeedRefusalNotice = { kind, message: recorded || REFUSAL_TITLES[kind] }

  if (kind === 'duplicat' && g.duplicate_verdict) {
    const worst = summarizeVerdict(g.duplicate_verdict)
    if (worst?.targetUrl) notice.targetUrl = worst.targetUrl
  }

  return notice
}
