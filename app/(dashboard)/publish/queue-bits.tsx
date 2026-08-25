// ─────────────────────────────────────────────────────────────────────────────
// Les pièces communes aux deux files de publication — étapes 4 et 5
// ─────────────────────────────────────────────────────────────────────────────
//
// Même rôle que app/(dashboard)/dashboard/ui-bits.tsx : ce que le système de
// design ne fournit pas et que SEULES les deux files de publication ont besoin
// de rendre. Il vit sous /publish parce que c'est là que la file est née, et il
// est importé par /generate — jamais l'inverse, et jamais l'une des deux pages
// depuis l'autre : deux pages qui s'importent mutuellement forment un cycle ESM
// dès que la seconde a besoin d'une pièce de la première.
//
// POURQUOI CE FICHIER EXISTE. La preuve d'un quasi-doublon doit s'afficher LÀ OÙ
// LA DÉCISION SE PREND — dans la ligne de la génération, sur les deux écrans qui
// la montrent. Écrite deux fois, elle divergerait au premier correctif : c'est
// exactement ainsi que le dépôt s'est retrouvé avec deux `ReasonList`, quatre
// `formatDay` et cinq `PAGE_TYPE_LABELS`.
//
// PAS DE 'use client', DÉLIBÉRÉMENT. Rien ici ne porte d'état, n'écoute le
// clavier ni ne fait de fetch : ces pièces se rendent aussi bien depuis un
// composant serveur. La convention est celle de ui-bits.tsx, qui n'a pas la
// directive non plus. Le jour où /publish devient une coquille serveur, ce
// module la traverse sans être touché.
//
// AUCUNE FABRICATION D'URL. La règle tient en une phrase et gouverne tout le
// fichier : on affiche l'adresse que la donnée porte, ou on dit qu'on ne l'a
// pas. `DuplicateEvidence` ne reçoit même pas l'URL du site, précisément pour
// qu'aucune main future ne puisse écrire `siteUrl + entryPath` — une adresse
// devinée envoie le propriétaire sur un 404 et lui fait conclure à un faux
// positif du moteur.

import { ExternalLink } from 'lucide-react'
import {
  ReasonList,
  RiskBadge,
  formatDayLong,
  formatMetric,
  shortenUrl,
  type NoticeTone,
  type RiskLevel,
} from '@/components/ui'
import { REFUSAL_TITLES } from '@/lib/publishing/refusal-labels'
import {
  BLOCKING_DUPLICATE_CODES,
  isBlocking,
  type DuplicateCode,
  type DuplicateMatchEvidence,
  type DuplicateVerdict,
} from '@/src/core/domain/existing/verdict'
import type { FeedGeneration } from '@/app/api/generate/feed-types'
import type { InventorySummary } from '@/app/api/sites/[id]/inventory/types'

// ─── Mise en page d'une file ────────────────────────────────────────────────
//
// Déplacés depuis publish/page.tsx, sans changement de rendu. Ils ont un second
// lecteur depuis que /generate rend la même ligne : la page en gardait une copie
// écrite à la main, aux mêmes champs et au même ordre.

export function Panel({
  title,
  count,
  hint,
  children,
}: {
  title: string
  count: number
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="panel" style={{ marginBottom: 'var(--space-6)' }}>
      <div className="panel__header">
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title">{title}</h2>
          {hint && <p className="meta" style={{ marginTop: 2 }}>{hint}</p>}
        </div>
        <span className="badge badge-muted">{count}</span>
      </div>
      {children}
    </div>
  )
}

export function rowStyle(last: boolean, gap: boolean): React.CSSProperties {
  return {
    padding: 'var(--space-4) var(--space-5)',
    borderBottom: last ? undefined : '1px solid var(--line)',
    display: 'flex',
    flexDirection: 'column',
    gap: gap ? 'var(--space-3)' : 0,
  }
}

/**
 * Le titre d'une ligne et sa ligne de contexte.
 *
 * Le badge « Mise à jour » est rendu ICI plutôt qu'à côté du StatusBadge de
 * chaque appelant : `intent` est une propriété de la ligne, pas de l'écran, et
 * une mise à jour qui ressemblerait à une création dans la file ferait valider
 * un remplacement de page en croyant publier une page neuve.
 */
export function RowHead({ generation: g, extra }: { generation: FeedGeneration; extra?: string }) {
  const refresh = g.intent === 'refresh'

  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>
          {g.title || g.slug || g.focus_keyword || g.city}
        </span>
        {refresh && <span className="badge badge-info">Mise à jour</span>}
      </div>
      <div className="meta" style={{ marginTop: 2 }}>
        {[g.page_type, g.city, g.ai_model, g.campaign?.name, g.site?.name, extra].filter(Boolean).join(' • ')}
      </div>
      {refresh && g.refresh_target_path && (
        <div className="meta mono truncate" style={{ marginTop: 2 }}>{g.refresh_target_path}</div>
      )}
    </div>
  )
}

// ─── La preuve du quasi-doublon ─────────────────────────────────────────────

/**
 * Un code technique du gate n'atteint JAMAIS l'écran : il devient une phrase
 * ici, et nulle part ailleurs.
 *
 * `Record<DuplicateCode, …>` et non `Record<string, …>` : le jour où un septième
 * code entre dans le domaine, ce fichier cesse de compiler. Une table indexée
 * par `string` se serait contentée d'afficher `undefined` à la place du motif.
 */
const DUPLICATE_CODE_LABELS: Record<DuplicateCode, string> = {
  DUPLICATE_EXACT: 'Contenu identique à cette page.',
  DUPLICATE_NEAR: 'Contenu très proche de cette page.',
  TITLE_NEAR_DUPLICATE: 'Titre presque identique à celui de cette page.',
  META_NEAR_DUPLICATE: 'Description presque identique à celle de cette page.',
  SLUG_COLLISION: 'Cette adresse est déjà prise par cette page.',
  CANNIBALIZATION: 'Cette page vise la même requête que celle-ci, qui est déjà positionnée.',
}

/**
 * La liste du domaine, LUE — jamais recopiée.
 *
 * `isBlocking()` répond sur un verdict entier ; l'écran doit peindre chaque
 * correspondance séparément, et une seconde table « ces cinq codes sont graves »
 * écrite ici divergerait le jour où un sixième code bloquant serait ajouté au
 * domaine. C'est le même Set, construit à partir de la même source.
 */
const BLOCKING_CODES = new Set<DuplicateCode>(BLOCKING_DUPLICATE_CODES)

/**
 * Y a-t-il quelque chose à montrer ? Écrit une fois, pour que la ligne qui
 * réserve l'espace vertical et le composant qui rend la preuve ne puissent pas
 * répondre différemment.
 *
 * Un verdict SANS correspondance et SANS motif n'est pas un vide à afficher :
 * c'est le cas normal, « le moteur a comparé et n'a rien trouvé ». Un cadre vide
 * sous chaque page propre ferait passer une absence de conflit pour un incident.
 */
export function hasDuplicateEvidence(verdict: DuplicateVerdict | null): verdict is DuplicateVerdict {
  return verdict !== null && (verdict.matches.length > 0 || verdict.reasons.length > 0)
}

/**
 * Les preuves SUFFIRAIENT-elles à retenir la page ?
 *
 * Le conditionnel est le sujet même de ce lot : le contrôle tourne en
 * observation, il mesure et laisse passer. `isBlocking()` est indifférente au
 * mode par construction — c'est `verdict.mode` qui dit ce qui s'est réellement
 * produit, et les deux faits sont rendus séparément.
 */
export function duplicateHoldsPage(verdict: DuplicateVerdict | null): verdict is DuplicateVerdict {
  return verdict !== null && isBlocking(verdict)
}

/**
 * Le badge de ligne. `null` tant que rien ne retient la page : une requête
 * disputée est un sujet éditorial, pas un drapeau à planter dans une file.
 */
export function DuplicateFlag({ verdict }: { verdict: DuplicateVerdict | null }) {
  if (!duplicateHoldsPage(verdict)) return null

  return verdict.mode === 'observe' ? (
    <span
      className="badge badge-warning"
      title="Le contrôle des doublons tourne en observation : cette page est partie malgré la ressemblance."
    >
      doublon signalé
    </span>
  ) : (
    <span className="badge badge-danger" title="Une page déjà en ligne couvre le même terrain.">
      quasi-doublon
    </span>
  )
}

/**
 * CONTRE QUOI cette page a été pesée, et ce qui en a été conclu.
 *
 * L'UNIQUE rendu de la preuve dans tout le produit : /generate et /publish
 * l'importent tous deux, et une seconde implémentation aurait divergé au premier
 * correctif de formulation.
 *
 * TROIS CADRAGES, ET LA DIFFÉRENCE EST TOUT LE SUJET :
 *  · `mode === 'observe'` et les preuves retiendraient la page → la page EST
 *    PARTIE. L'écran le dit. Présenter une observation comme un blocage ferait
 *    croire au propriétaire que sa production est arrêtée alors qu'elle tourne,
 *    et le passage en mode bloquant (piloté par SEO_DUPLICATE_GATE) n'aurait
 *    plus rien à annoncer.
 *  · `mode === 'block'` et les preuves retiennent → c'est un refus.
 *  · rien ne retient → un avertissement, jamais peint comme un blocage.
 *
 * Le composant ne reçoit QUE le verdict : le mode et la gravité y sont déjà, et
 * `refusal_kind` ne peut pas servir à les déduire — `persistDuplicateVerdict`
 * (lib/pipeline/repository.ts) pose `refusal_kind = 'duplicat'` dès que les
 * preuves bloqueraient, MÊME EN OBSERVATION, sur une page qui part quand même.
 */
export function DuplicateEvidence({ verdict }: { verdict: DuplicateVerdict }) {
  if (!hasDuplicateEvidence(verdict)) return null

  const holds = isBlocking(verdict)
  const observing = verdict.mode === 'observe'

  const heading = !holds
    ? 'À savoir — une page du site est sur le même terrain'
    : observing
      ? 'Doublon détecté, page laissée passer'
      : REFUSAL_TITLES.duplicat

  const lede = !holds
    ? 'Ces ressemblances sont notées, pas retenues : le moteur ne refuse une page ni pour une requête disputée, ni pour un simple recoupement de texte.'
    : observing
      ? 'Le contrôle des doublons tourne en observation : il note ce qu’il trouve sans arrêter la publication. Cette page est bien partie, et elle ressemble à :'
      : 'Cette page n’est pas partie. Elle ressemble à :'

  return (
    <div className="inset" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div>
        {/* Le titre porte la couleur du ton, jamais la couleur seule : le mot
            dit déjà s'il s'agit d'un refus, d'une observation ou d'une note. */}
        <div
          className="eyebrow"
          style={{ color: holds && !observing ? 'var(--status-critical-text)' : 'var(--ink-secondary)' }}
        >
          {heading}
        </div>
        {/* --ink-secondary et non `.meta` : --ink-muted sur --surface-inset
            mesure 4,42:1, sous AA, et cette phrase porte une décision. */}
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
          {lede}
        </p>
      </div>

      {verdict.matches.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
          {verdict.matches.map((match, index) => (
            <li key={`${match.entryKey}-${match.code}-${index}`}>
              <MatchLine match={match} observing={observing} />
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* Un refus dont on ne peut plus nommer l'objet est une énigme. On le
              dit, au lieu de rendre un bloc vide sous un titre d'alerte. */}
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
            Le moteur n’a pas conservé la page en cause.
          </p>
          <ReasonList title="Ce qui a été relevé" reasons={verdict.reasons} />
        </>
      )}

      {/* Une décision prise à la main est TRACÉE, jamais silencieuse. */}
      <p className="meta" style={{ margin: 0 }}>
        {verdict.decidedBy === 'operator'
          ? `Décision prise à la main le ${formatDayLong(verdict.decidedAt)}.`
          : `Verdict automatique du ${formatDayLong(verdict.decidedAt)}.`}
      </p>
    </div>
  )
}

/** Une page en cause : sa gravité, le motif en français, son adresse, son score. */
function MatchLine({ match, observing }: { match: DuplicateMatchEvidence; observing: boolean }) {
  const blocking = BLOCKING_CODES.has(match.code)

  // `partial` ÉCRASE le niveau : un cosinus calculé contre un extrait ne prouve
  // rien, et peindre « Aucun conflit » sur une page à moitié lue serait un feu
  // vert sur exactement les pages qu'il faut protéger.
  const level: RiskLevel = match.partial ? 'inconnu' : blocking ? 'bloquant' : 'avertissement'

  // Le mot du badge suit ce qui s'est RÉELLEMENT passé. « Bloquant » sur une
  // page publiée serait le mensonge que ce lot existe pour éviter.
  const label = !match.partial && blocking && observing ? 'Retiendrait la page' : undefined

  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <RiskBadge level={level} label={label} size="sm" />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
          {DUPLICATE_CODE_LABELS[match.code]}
        </span>
      </div>

      <MatchTarget match={match} />
      <MatchScore match={match} />

      {match.partial && (
        <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
          Comparaison partielle : le moteur ne connaît que les 2 000 premiers caractères de cette page.
          Une différence sur le reste du texte ne serait pas visible ici.
        </p>
      )}
    </div>
  )
}

/**
 * L'adresse de la page en cause — CELLE QUE LA DONNÉE PORTE.
 *
 * `entryUrl` est optionnel dans le domaine : une entrée d'inventaire amorcée par
 * la migration 018 connaît son chemin sans connaître l'URL servie. On l'avoue.
 * Recomposer `https://site.fr` + `/taxi-troyes` produirait un lien plausible et
 * parfois faux — sous-domaine, préfixe de langue, page dépubliée — et un
 * propriétaire qui tombe sur un 404 conclut que le moteur a inventé le conflit.
 */
function MatchTarget({ match }: { match: DuplicateMatchEvidence }) {
  if (match.entryUrl) {
    return (
      <a
        href={match.entryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-link truncate"
        title={match.entryUrl}
      >
        {shortenUrl(match.entryUrl)}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <span className="chip">{match.entryPath}</span>
      <span className="meta">Adresse en ligne inconnue — le moteur n’a pas retenu d’URL pour cette page.</span>
    </div>
  )
}

/**
 * Le score, SANS seuil affiché, et c'est une contrainte de la donnée.
 *
 * `SimilarityScore` de components/ui.tsx exige `threshold` — le seuil QUI A
 * DÉCIDÉ — et `DuplicateMatchEvidence` ne le transporte pas : le jsonb persiste
 * `similarity` seule. Écrire ici 0,80 serait afficher « seuil 80 » en face d'un
 * constat qui, sur un inventaire tronqué, s'est déclenché à 0,72 (voir
 * TITLE_NEAR_DUPLICATE_TRUNCATED). Un chiffre nu et vrai vaut mieux qu'une
 * paire dont la moitié est inventée. Le jour où le verdict porte son seuil, ces
 * quelques lignes redeviennent un `<SimilarityScore>`.
 *
 * Jamais un pourcentage : un cosinus de 0,82 n'est pas « 82 % du texte copié ».
 */
function MatchScore({ match }: { match: DuplicateMatchEvidence }) {
  // Une adresse ne se mesure pas. `DuplicateMatchEvidence` fixe sa similarité à
  // 1 par convention ; afficher « 100 / 100 » ferait lire un fait binaire comme
  // une estimation fragile.
  if (match.code === 'SLUG_COLLISION') {
    return <span className="meta">Une adresse est prise ou libre : rien à mesurer.</span>
  }

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <span className="meta">Ressemblance</span>
      <span className="num" style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: match.partial ? 'var(--ink-muted)' : 'var(--ink-secondary)' }}>
        {formatMetric(match.similarity * 100, 'number', { decimals: 0 })}
      </span>
      <span className="num" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)' }}>/ 100</span>
    </div>
  )
}

// ─── Le régime de connaissance ──────────────────────────────────────────────

export interface FreshnessNotice {
  tone: NoticeTone
  title: string
  body: string
}

/**
 * Ce que le moteur NE VOIT PAS, dit une seule fois pour tout le produit.
 *
 * `null` sur deux faits différents, et aucun n'est un défaut à signaler :
 *  · `summary === null` — l'inventaire n'a pas été lu (aucun site sélectionné,
 *    ou lecture en échec). On ne décrit pas une cécité qu'on n'a pas mesurée.
 *  · `freshness === 'fresh'` — il n'y a rien à dire.
 *
 * AUCUN RÉGIME N'EST PEINT EN CRITIQUE et le vocabulaire de la panne est banni
 * des quatre formulations : un site jamais analysé n'est pas une défaillance, et
 * le moteur ne s'arrête jamais — il vérifie chaque adresse directement sur le
 * site avant d'écrire. Le seul ton qui monte est celui d'un inventaire trop
 * vieux, où des pages réelles existent et où le moteur décide sans les voir.
 * L'appelant ne désactive AUCUN bouton sur la foi de ce retour.
 *
 * « Jamais analysé » et « analysé, aucune page trouvée » portent des textes
 * DIFFÉRENTS : la première situation attend un premier crawl, la seconde a déjà
 * reçu sa réponse — plan de site injoignable, site rendu côté client, deux
 * problèmes que seul le propriétaire peut trancher. Les confondre enverrait
 * relancer une analyse qui rendra le même vide.
 *
 * DETTE CONNUE : app/(dashboard)/sites/[id]/existing/page.tsx porte encore son
 * `freshnessBanner()` local, plus riche (il nomme aussi le régime 'fresh' et
 * l'adresse enregistrée du site). Son propre commentaire désigne CE fichier
 * comme sa destination. La migration est une suppression suivie d'un import,
 * pas une réécriture — mais ce fichier-là n'est pas dans le périmètre de ce lot.
 */
export function freshnessNotice(summary: InventorySummary | null): FreshnessNotice | null {
  if (!summary || summary.freshness === 'fresh') return null

  const day = summary.lastCrawledAt ? formatDayLong(summary.lastCrawledAt) : null

  if (summary.freshness === 'stale') {
    return {
      tone: 'warning',
      // `ageDays` est renseigné par construction sur un régime décidé sur l'âge,
      // mais le type l'autorise à manquer : un titre « vieux de null jours »
      // vaut moins qu'un titre sans chiffre.
      title: summary.ageDays === null ? 'Inventaire vieilli' : `Inventaire vieux de ${summary.ageDays} jours`,
      body: `Le moteur travaille sur un inventaire${day ? ` du ${day}` : ' ancien'}. Les pages mises en ligne depuis — par vous, par un autre outil — ne lui sont pas connues : il vérifiera chaque adresse directement sur le site avant d’écrire.`,
    }
  }

  if (summary.blindReason === 'crawl-trop-vieux') {
    return {
      tone: 'serious',
      title: 'Inventaire trop vieux pour être utilisé',
      body: `Dernière analyse${day ? ` le ${day}` : ''}${summary.ageDays === null ? '' : `, il y a ${summary.ageDays} jours`}. Le moteur ne s’en sert plus pour décider : il vérifie chaque adresse directement sur le site, mais il ne compare plus aucun titre et ne propose aucune mise à jour.`,
    }
  }

  if (summary.blindReason === 'aucune-page-trouvee') {
    return {
      tone: 'warning',
      title: 'L’analyse n’a trouvé aucune page',
      body: `Le site a bien été analysé${day ? ` le ${day}` : ''}, mais aucune page n’en est ressortie. Deux explications possibles : le site est neuf, ou l’analyse n’a pas pu le lire (plan du site introuvable, accès bloqué). Tant que ce point n’est pas tranché, le moteur produit sans comparer ces pages à quoi que ce soit.`,
    }
  }

  return {
    tone: 'info',
    title: 'Le moteur n’a jamais regardé ce site',
    body: 'Aucune analyse n’a été menée. Il ne sait donc pas quelles pages existent déjà, ni quels titres sont pris. Il continue de produire — il vérifie chaque adresse directement sur le site avant d’écrire — mais il ne peut ni comparer les titres, ni proposer la mise à jour d’une page existante.',
  }
}
