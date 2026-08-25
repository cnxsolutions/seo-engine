// ─────────────────────────────────────────────────────────────────────────────
// Enregistrer une intention de mise a jour
// POST /api/generations/refresh — « mets a jour cette page plutot que d'en
// ajouter une »
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CETTE ROUTE EXISTE, ET POURQUOI IL N'Y EN A QU'UNE
//
// Deux ecrans demandent la meme chose : le bouton « Mettre a jour » de
// /sites/[id]/existing, et l'issue « Basculer en mise a jour » d'une generation
// refusee pour duplicat sur /generate. Deux routes auraient produit deux
// politiques de refus divergentes ; celle-ci est la SEULE surface HTTP par
// laquelle une ligne prend `intent = 'refresh'`.
//
// CE QU'ELLE NE FAIT PAS. Aucune ecriture distante, aucun appel modele, aucun
// jeton depense, et surtout AUCUNE PUBLICATION. Elle enregistre une intention ;
// la ligne produite attend ensuite un clic humain dans un panneau qui nomme la
// page visee. C'est `listPendingPublishGenerations`, avec son `.eq('intent',
// 'create')`, qui garantit que le job differe ne la ramassera jamais tout seul.
//
// LA CONVERSION, ET CE QU'ELLE EPARGNE. Quand la demande part d'une generation
// deja payee et refusee pour duplicat, cette ligne est CONVERTIE : son contenu
// est conserve tel quel. Le regenerer reviendrait a payer deux fois le meme
// texte pour arriver au meme endroit.
//
// LE CHECK QU'IL FAUT DEVANCER. `generations_refresh_needs_target` impose
// `refresh_target_path IS NOT NULL` des que `intent = 'refresh'`, et il est
// evalue a CHAQUE ecriture. Une demande sans cible doit donc etre refusee ici,
// en 400 et en francais, plutot que d'atteindre la base pour y produire une
// 23514 que personne ne sait lire. C'est aussi pourquoi l'intention et la cible
// voyagent toujours dans la MEME ecriture.

import { NextRequest, NextResponse } from 'next/server'
import { createGeneration, updateGeneration } from '@/lib/db'
import { loadSiteInventory } from '@/lib/existing/inventory'
import { createServiceClient } from '@/lib/supabase'
import { normalizeInventoryPath } from '@/src/core/domain/existing/inventory'
import type { RefreshScope } from '@/src/core/domain/existing/action'
import type { GenerationStatus } from '@/lib/types'

/**
 * Les statuts depuis lesquels une generation peut encore devenir une mise a jour.
 *
 * Une page publiee n'en fait pas partie : la convertir la ferait republier par
 * dessus une autre page, et la ligne perdrait la trace de ce qu'elle a mis en
 * ligne. On ne convertit qu'une generation qui n'est allee nulle part.
 */
const REVERSIBLE_STATUSES: readonly GenerationStatus[] = ['rejected', 'failed']

/**
 * La portee par defaut quand l'appelant n'en nomme aucune.
 *
 * 'content' et non 'metadata' : le seul appelant qui omet la portee est la
 * bascule d'une generation refusee pour duplicat, dont le corps est deja ecrit
 * et paye et n'attend que d'etre publie ailleurs. Les ecrans qui proposent un
 * choix, eux, envoient toujours une valeur explicite — et preselectionnent
 * 'metadata', la moins destructrice.
 */
const DEFAULT_SCOPE: RefreshScope = 'content'

interface RefreshBody {
  siteId?: unknown
  targetPath?: unknown
  scope?: unknown
  sourceGenerationId?: unknown
}

/** La ligne `generations` telle que cette route la lit, colonne par colonne. */
interface GenerationContextRow {
  status: string | null
  site_id: string | null
  city: string | null
  campaign_id: string | null
  ai_model: string | null
  content: string | null
  page_payload: unknown
}

const GENERATION_CONTEXT_COLUMNS = 'status,site_id,city,campaign_id,ai_model,content,page_payload'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as RefreshBody

    const siteId = text(body.siteId)
    const targetPathInput = text(body.targetPath)
    const sourceGenerationId = text(body.sourceGenerationId)

    if (!siteId) {
      return NextResponse.json({ error: 'siteId est requis' }, { status: 400 })
    }
    if (!targetPathInput) {
      return NextResponse.json(
        { error: 'targetPath est requis : une mise à jour sans page visée n’est pas une mise à jour.' },
        { status: 400 }
      )
    }

    const scope = parseScope(body.scope)
    if (!scope) {
      return NextResponse.json(
        { error: 'scope doit valoir « metadata » ou « content ».' },
        { status: 400 }
      )
    }

    // La MEME normalisation que celle qui a ecrit les chemins de l'inventaire.
    // Comparer un chemin brut a un chemin normalise ferait echouer la resolution
    // sur une simple majuscule et renverrait « cette page ne figure pas dans
    // l'inventaire » a propos d'une page parfaitement presente.
    const targetPath = normalizeInventoryPath(targetPathInput)
    if (!targetPath) {
      return NextResponse.json(
        { error: `« ${targetPathInput} » n’est pas un chemin de page exploitable.` },
        { status: 400 }
      )
    }

    const inventory = await loadSiteInventory(siteId)

    // L'invariant de la politique, honore ici plutot que decouvert plus tard :
    // rafraichir suppose de savoir ce qu'on remplace.
    if (inventory.freshness.state === 'blind') {
      return NextResponse.json(
        {
          error:
            "Le site n’a jamais été analysé : on ne rafraîchit pas une page qu’on n’a jamais vue.",
          freshness: 'blind',
        },
        { status: 409 }
      )
    }

    const entry = inventory.entries.find((candidate) => candidate.path === targetPath)
    if (!entry) {
      return NextResponse.json(
        { error: "Cette page ne figure pas dans l’inventaire du site." },
        { status: 404 }
      )
    }

    // Portee ET trace de decision dans le meme jsonb, comme le verdict de
    // duplicat : une intention dont on ignore qui l'a prise et quand ne se
    // relit pas.
    const refreshPlan = {
      scope,
      decidedBy: 'operator' as const,
      decidedAt: new Date().toISOString(),
    }

    if (sourceGenerationId) {
      return await convertGeneration({
        sourceGenerationId,
        siteId,
        targetPath,
        targetGenerationId: entry.generationId ?? null,
        refreshPlan,
      })
    }

    return await openRefreshGeneration({
      siteId,
      targetPath,
      targetGenerationId: entry.generationId ?? null,
      refreshPlan,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[POST /api/generations/refresh]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Branche 1 : convertir une generation deja payee ─────────────────────────

/**
 * Bascule une generation existante en mise a jour, SANS toucher a son contenu.
 *
 * C'est tout l'interet de l'operation : la page a ete redigee, mesuree et
 * refusee pour duplicat ; ce qui etait faux, c'est la destination, pas le texte.
 * La ligne repart en 'generated', c'est-a-dire dans la file des mises a jour a
 * valider — pas en publication, que le filtre d'intention lui interdit.
 */
async function convertGeneration(args: {
  sourceGenerationId: string
  siteId: string
  targetPath: string
  targetGenerationId: string | null
  refreshPlan: Record<string, unknown>
}) {
  const source = await readGenerationContext(args.sourceGenerationId)

  if (!source) {
    return NextResponse.json({ error: 'Génération introuvable' }, { status: 404 })
  }
  if (source.site_id !== args.siteId) {
    return NextResponse.json(
      { error: "Cette génération n’appartient pas à ce site." },
      { status: 409 }
    )
  }
  if (!REVERSIBLE_STATUSES.includes(source.status as GenerationStatus)) {
    return NextResponse.json(
      {
        error:
          `Conversion impossible depuis le statut « ${source.status ?? 'inconnu'} ». `
          + 'Seule une génération refusée ou en échec peut devenir une mise à jour ; '
          + 'une page déjà publiée en écraserait une autre.',
      },
      { status: 409 }
    )
  }
  // Convertir une ligne vide ne conserve rien : elle arriverait dans la file des
  // mises a jour a valider en promettant un contenu qu'elle n'a pas, et le clic
  // humain se heurterait au refus de /api/publish/generation une etape plus loin.
  if (!source.content && !source.page_payload) {
    return NextResponse.json(
      {
        error:
          "Cette génération ne porte aucun contenu : il n’y a rien à reprendre. "
          + 'Une mise à jour part d’un texte déjà écrit.',
      },
      { status: 409 }
    )
  }
  // Une page ne se rafraichit pas elle-meme. Le cas arrive des que l'operateur
  // designe le slug que cette generation avait justement reserve.
  if (args.targetGenerationId === args.sourceGenerationId) {
    return NextResponse.json(
      { error: "Cette génération vise sa propre page : il n’y a rien à mettre à jour." },
      { status: 409 }
    )
  }

  // UNE SEULE ecriture : `generations_refresh_needs_target` est evalue a chaque
  // UPDATE, donc separer l'intention de sa cible ferait echouer le premier des
  // deux appels. `error_message` est laisse en place — c'est la trace de ce qui
  // a mene ici — mais `refusal_kind` est efface : le refus ne tient plus.
  await updateGeneration(args.sourceGenerationId, {
    status: 'generated',
    intent: 'refresh',
    refresh_target_path: args.targetPath,
    refresh_target_generation_id: args.targetGenerationId,
    refresh_plan: args.refreshPlan,
    refusal_kind: null,
  })

  return accepted(args.sourceGenerationId, args.targetPath)
}

// ─── Branche 2 : ouvrir une mise a jour a partir de rien ─────────────────────

/**
 * Cree la ligne d'une mise a jour qui n'a pas encore de texte.
 *
 * AUCUN SLUG N'EST ECRIT. Une mise a jour n'a pas d'adresse a reserver : elle en
 * occupe une deja prise, celle de `refresh_target_path`. Poser un slug ici
 * inscrirait l'intention a l'inventaire comme si une seconde page existait.
 */
async function openRefreshGeneration(args: {
  siteId: string
  targetPath: string
  targetGenerationId: string | null
  refreshPlan: Record<string, unknown>
}) {
  // La ville et le modele ne se devinent pas : ils se lisent sur la generation
  // qui a produit la page visee quand c'est le moteur qui l'a ecrite, et sur la
  // campagne active sinon. `city` est NOT NULL en base et reste VIDE plutot que
  // devine — une ville fausse ferait rediger la mauvaise page le jour ou cette
  // ligne sera generee.
  const [target, campaign] = await Promise.all([
    args.targetGenerationId ? readGenerationContext(args.targetGenerationId) : null,
    readActiveCampaign(args.siteId),
  ])

  const created = await createGeneration({
    site_id: args.siteId,
    campaign_id: target?.campaign_id ?? campaign?.id ?? undefined,
    city: target?.city ?? '',
    status: 'pending',
    intent: 'refresh',
    refresh_target_path: args.targetPath,
    refresh_target_generation_id: args.targetGenerationId,
    refresh_plan: args.refreshPlan,
    ai_model: target?.ai_model ?? campaign?.ai_model ?? '',
  })

  return accepted(created.id, args.targetPath)
}

// ─── Lectures ────────────────────────────────────────────────────────────────

async function readGenerationContext(id: string): Promise<GenerationContextRow | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('generations')
    .select(GENERATION_CONTEXT_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as GenerationContextRow | null
}

/**
 * La campagne qui porte le contexte editorial du site, la plus recente d'abord.
 *
 * Sans elle la ligne creee n'a pas de campagne, donc pas de metier, pas de
 * mots-cles et pas de longueur cible : rien de ce qu'il faudra pour rediger la
 * mise a jour le jour venu.
 */
async function readActiveCampaign(siteId: string): Promise<{ id: string; ai_model: string | null } | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('id,ai_model')
    .eq('site_id', siteId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ id: string; ai_model: string | null }>)[0] ?? null
}

// ─── Formes ──────────────────────────────────────────────────────────────────

function accepted(generationId: string, targetPath: string) {
  return NextResponse.json({ success: true, generationId, intent: 'refresh', targetPath })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** `null` quand la valeur est presente mais n'est pas une portee connue. */
function parseScope(value: unknown): RefreshScope | null {
  if (value === undefined || value === null || value === '') return DEFAULT_SCOPE
  return value === 'metadata' || value === 'content' ? value : null
}
