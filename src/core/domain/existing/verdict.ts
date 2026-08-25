// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Verdict
// SEO Engine - Domain
// Le vocabulaire du duplicat, ecrit UNE fois
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce module dit CE QU'EST un verdict de duplicat. Il ne le calcule pas :
// identity.ts dit si deux pages se ressemblent, le gate dit ce qu'on en fait.
// Trois questions, trois fichiers.
//
// La liste des codes bloquants vivait dans lib/pipeline/gate.ts pendant que la
// forme du jsonb vivait dans le modele de donnees. Deux endroits pour la meme
// liste garantit qu'un sixieme code bloquant sera ajoute a l'un sans l'autre :
// le gate IMPORTE BLOCKING_DUPLICATE_CODES et isBlocking(), il ne les redeclare
// pas a cote de ses trois listes existantes.
//
// Aucun import : ni Supabase, ni le detecteur, ni le gate. Un verdict editorial
// est une regle de domaine, pas une regle de pipeline — le placer dans
// lib/pipeline obligerait la route d'API et l'ecran a importer tout le pipeline
// pour afficher un badge de refus.

// ─── Le vocabulaire ─────────────────────────────────────────────────────────

/**
 * Les codes, DANS L'ORDRE DE GRAVITE.
 *
 * Cet ordre n'est pas decoratif : summarizeVerdict() s'en sert pour designer la
 * ligne a montrer a l'operateur. Il n'existe aucun second classement ailleurs,
 * et il ne doit pas en naitre un — reordonner ce tableau reordonne l'interface.
 */
export const DUPLICATE_CODES = [
  'DUPLICATE_EXACT',
  'DUPLICATE_NEAR',
  'TITLE_NEAR_DUPLICATE',
  'META_NEAR_DUPLICATE',
  'SLUG_COLLISION',
  'CANNIBALIZATION',
] as const

export type DuplicateCode = (typeof DUPLICATE_CODES)[number]

/**
 * Ceux qui retiennent une page.
 *
 * CANNIBALIZATION en est exclue par construction : deux pages qui se disputent
 * une requete est un fait a corriger editorialement, pas une raison de refuser
 * la publication. Le `satisfies` interdit d'ecrire ici un code qui n'existe pas
 * dans DUPLICATE_CODES.
 */
export const BLOCKING_DUPLICATE_CODES = [
  'DUPLICATE_EXACT',
  'DUPLICATE_NEAR',
  'TITLE_NEAR_DUPLICATE',
  'META_NEAR_DUPLICATE',
  'SLUG_COLLISION',
] as const satisfies readonly DuplicateCode[]

/** Une page existante contre laquelle la page en cours d'ecriture a ete pesee. */
export interface DuplicateMatchEvidence {
  /**
   * La cle DOCUMENTAIRE : `page:<path>` ou `generation:<id>`. Jamais l'uuid
   * d'une ligne d'embedding — c'est la seule cle qui traverse a la fois le
   * vectoriel et le lexical.
   */
  entryKey: string
  entryPath: string
  entryUrl?: string
  code: DuplicateCode
  /** 0..1. Vaut 1 par convention sur SLUG_COLLISION, qui ne se mesure pas. */
  similarity: number
  /**
   * Vrai des qu'une des deux entrees comparees n'est qu'un extrait. Le verdict
   * avoue son asymetrie : un operateur qui lit « 0.82 » sur une comparaison
   * partielle ne doit pas croire avoir vu les deux pages entieres.
   */
  partial: boolean
}

/**
 * Ce qui est persiste dans generations.duplicate_verdict.
 *
 * Les preuves ET la trace de decision dans UN champ jsonb plutot que dans quatre
 * colonnes : un refus sans objet est inexploitable par l'operateur, qui doit
 * pouvoir lire CONTRE QUOI sa page a ete refusee, par qui, et quand.
 */
export interface DuplicateVerdict {
  decidedBy: 'policy' | 'operator'
  decidedAt: string
  /**
   * Sans ce champ, un verdict ecrit pendant la periode d'observation est
   * indiscernable d'un blocage reel : le rejeu qui doit mesurer le taux de
   * blocage retroactif avant la bascule ne mesurerait rien.
   */
  mode: 'observe' | 'block'
  reasons: string[]
  matches: DuplicateMatchEvidence[]
}

// ─── Lecture ────────────────────────────────────────────────────────────────

/**
 * Le gate DOIT appeler ceci plutot que de re-tester l'appartenance a la liste.
 * Sinon BLOCKING_DUPLICATE_CODES est lue a deux endroits et cette fonction est
 * du code mort — exactement ce que ce fichier existe pour empecher.
 *
 * Pure, sans horloge, et indifferente au mode : elle dit si les preuves
 * SUFFIRAIENT a bloquer. C'est le mode, decide ailleurs, qui dit si on bloque.
 */
export function isBlocking(verdict: DuplicateVerdict): boolean {
  return verdict.matches.some(match => BLOCKING_CODE_SET.has(match.code))
}

/**
 * La ligne la plus grave, pour l'UI et pour le targetUrl d'un refus.
 *
 * Fait confiance a son entree : parseDuplicateVerdict() est la seule frontiere
 * par ou du jsonb non type peut entrer, et elle rejette deja tout code inconnu.
 */
export function summarizeVerdict(
  verdict: DuplicateVerdict,
): { code: DuplicateCode; targetUrl?: string } | null {
  let worst: DuplicateMatchEvidence | null = null
  let worstRank = Number.POSITIVE_INFINITY

  for (const match of verdict.matches) {
    const rank = DUPLICATE_CODES.indexOf(match.code)
    if (rank < worstRank) {
      worstRank = rank
      worst = match
    }
  }

  if (!worst) return null
  return worst.entryUrl ? { code: worst.code, targetUrl: worst.entryUrl } : { code: worst.code }
}

// ─── Construction ───────────────────────────────────────────────────────────

/** Ce que le producteur du verdict connait ; la date, elle, lui est donnee. */
export interface DuplicateVerdictDraft {
  decidedBy: DuplicateVerdict['decidedBy']
  mode: DuplicateVerdict['mode']
  reasons: readonly string[]
  matches: readonly DuplicateMatchEvidence[]
}

/**
 * `decidedAt` est un parametre, pas un Date.now() cache : le script de rejeu
 * doit pouvoir dater ses verdicts de la generation qu'il rejoue, et un test ne
 * doit pas avoir a geler l'horloge du processus.
 *
 * Les tableaux sont RECOPIES : le verdict part vers un UPDATE et vers un ecran,
 * et une mutation ulterieure du tableau de l'appelant reecrirait apres coup une
 * preuve deja affichee.
 */
export function buildDuplicateVerdict(
  draft: DuplicateVerdictDraft,
  decidedAt: Date,
): DuplicateVerdict {
  return {
    decidedBy: draft.decidedBy,
    decidedAt: decidedAt.toISOString(),
    mode: draft.mode,
    reasons: [...draft.reasons],
    matches: draft.matches.map(match => ({ ...match })),
  }
}

/**
 * Relit un verdict depuis du jsonb non type, et NE JETTE JAMAIS.
 *
 * Ce que la colonne contient a ete ecrit par une version anterieure du code,
 * eventuellement a la main : la feuille de route du feed ne peut pas dependre
 * de la bonne foi de la base. Tout ce qui n'est pas reconnu est ecarte, jamais
 * devine.
 *
 * Rendre null sur une absence de `decidedAt` n'est pas une severite gratuite :
 * la colonne existe pour porter la TRACE d'une decision. Un objet sans date
 * n'en est pas une, et l'afficher comme un verdict ferait croire a un refus
 * date qu'on serait incapable de situer.
 */
export function parseDuplicateVerdict(raw: unknown): DuplicateVerdict | null {
  if (!isRecord(raw)) return null

  const decidedAt = raw.decidedAt
  if (typeof decidedAt !== 'string' || decidedAt === '') return null

  const matches: DuplicateMatchEvidence[] = []
  if (Array.isArray(raw.matches)) {
    for (const row of raw.matches) {
      const match = parseMatch(row)
      if (match) matches.push(match)
    }
  }

  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter((reason): reason is string => typeof reason === 'string')
    : []

  return {
    // Meme regle defensive que le drapeau d'exploitation : seule la valeur
    // exacte durcit le comportement. Une chaine mal orthographiee relue depuis
    // la base ne doit jamais faire compter une observation comme un blocage.
    decidedBy: raw.decidedBy === 'operator' ? 'operator' : 'policy',
    decidedAt,
    mode: raw.mode === 'block' ? 'block' : 'observe',
    reasons,
    matches,
  }
}

/** Garde de frontiere : la seule facon d'admettre un code venu du jsonb. */
export function isDuplicateCode(value: unknown): value is DuplicateCode {
  return typeof value === 'string' && KNOWN_CODE_SET.has(value)
}

// ─── Interne ────────────────────────────────────────────────────────────────

const BLOCKING_CODE_SET = new Set<DuplicateCode>(BLOCKING_DUPLICATE_CODES)
const KNOWN_CODE_SET = new Set<string>(DUPLICATE_CODES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Une ligne sans cle documentaire, sans chemin ou sans code connu ne designe
 * rien : la jeter vaut mieux que de montrer a l'operateur une preuve vide.
 */
function parseMatch(raw: unknown): DuplicateMatchEvidence | null {
  if (!isRecord(raw)) return null

  const { entryKey, entryPath, entryUrl, code } = raw
  if (typeof entryKey !== 'string' || entryKey === '') return null
  if (typeof entryPath !== 'string' || entryPath === '') return null
  if (!isDuplicateCode(code)) return null

  const evidence: DuplicateMatchEvidence = {
    entryKey,
    entryPath,
    code,
    similarity: clamp01(raw.similarity),
    partial: raw.partial === true,
  }
  if (typeof entryUrl === 'string' && entryUrl !== '') evidence.entryUrl = entryUrl

  return evidence
}

/** Un score hors bornes est une mesure fausse, pas une certitude de duplicat. */
function clamp01(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
