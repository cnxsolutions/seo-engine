// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sites/[id]/inventory — ce que le moteur sait deja du site
// ─────────────────────────────────────────────────────────────────────────────
//
// Cette route LIT et DELEGUE. Elle ne filtre pas, ne trie pas, ne pagine pas :
// tout cela vit dans ./project, la fonction pure que l'ecran serveur
// /sites/[id]/existing appelle directement. Une seconde implementation du meme
// filtre finirait par diverger, et la premiere divergence visible serait une
// page N+1 qui reaffiche des lignes de la page N.
//
// Elle n'appelle AUCUNE politique — ni decision d'action editoriale, ni
// resolution de slug. Lire l'inventaire et decider quoi en faire sont deux
// gestes, et les melanger dans un GET est comment un endpoint de lecture se met
// a ecrire.
//
// UNE SEULE LECTURE : loadSiteInventory. Interroger Supabase ici en plus serait
// la seconde lecture de l'existant que ce chantier vient precisement de
// supprimer.
//
// PAS DE 404 SUR UN SITE INCONNU, ET C'EST DELIBERE. loadSiteInventory ne jette
// jamais : un site jamais analyse, un site injoignable ou un identifiant
// inconnu rendent un inventaire AVEUGLE et vide, dont `blindReason` dit
// laquelle des trois situations on vit. Une interface qui recoit ce corps
// affiche un bandeau et une invitation ; une interface qui recoit 404 affiche
// une page d'erreur, et un site neuf n'est pas une erreur. Le controle
// d'existence appartient a l'ecran, qui lit deja `sites` pour son titre.
//
// AUCUN POST, AUCUN PATCH : demander un rafraichissement a sa propre route.

import { NextResponse, type NextRequest } from 'next/server'
import { loadSiteInventory } from '@/lib/existing/inventory'
import type { InventoryOrigin } from '@/src/core/domain/existing/inventory'
import { projectInventory } from './project'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: siteId } = await params
    const query = req.nextUrl.searchParams

    const inventory = await loadSiteInventory(siteId)

    return NextResponse.json(
      projectInventory(inventory, {
        page: intParam(query.get('page')),
        pageSize: intParam(query.get('pageSize')),
        q: query.get('q') ?? undefined,
        origin: originParam(query.get('origin')),
        fields: query.get('fields') === 'paths' ? 'paths' : undefined,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[GET /api/sites/[id]/inventory]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * Un entier, ou NaN — jamais un defaut.
 *
 * Le defaut et les bornes appartiennent a projectInventory, qui les applique
 * aussi pour l'ecran serveur. Rendre 50 ici en poserait une seconde definition,
 * et `Number(null)` comme `Number('')` valent 0, ce qui ferait tomber une taille
 * de page absente sur le plancher au lieu du defaut.
 */
function intParam(value: string | null): number {
  return Number.parseInt((value ?? '').trim(), 10)
}

/** Une valeur inconnue ne filtre RIEN : elle ne vide pas la liste en silence. */
function originParam(value: string | null): InventoryOrigin | undefined {
  if (value === 'crawl' || value === 'engine') return value
  return undefined
}
