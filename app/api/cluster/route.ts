import { NextRequest, NextResponse } from 'next/server'
import { generateCluster } from '@/lib/ai/cluster'
import { createGeneration } from '@/lib/db'
import { loadSiteInventory, nearestExistingEntries } from '@/lib/existing/inventory'
import { MAX_PROMPT_NEIGHBOURS } from '@/lib/existing/prompt-block'
import { resolveFreeSlug, type SlugInput } from '@/lib/seo/slug'
import { blindInventory, type SiteInventory } from '@/src/core/domain/existing/inventory'

/**
 * Ce chemin n'utilise PAS lib/existing/reservation.ts, et c'est mecanique et non
 * philosophique : `reserveSlug` ecrit dans une ligne `generations` existante, or
 * cette route appelle generateCluster (qui produit TOUTES les pages d'un bloc)
 * PUIS cree les lignes une par une. Il n'y a rien a mettre a jour avant la
 * generation.
 *
 * Elle se sert donc de la fonction PURE, `resolveFreeSlug`, contre un Set qu'elle
 * fait grandir a chaque adresse retenue — et l'index unique partiel
 * (site_id, slug) reste l'arbitre final si deux requetes courent en meme temps :
 * sa violation atterrit dans `skipped`, jamais en exception.
 *
 * Ce qui disparait ici : la seule detection de collision POST-generation du
 * depot, qui comparait le slug rendu par le modele a une liste de slugs connus
 * et, quand il collidait, jetait une page deja payee. Une collision se decide
 * maintenant avant la depense.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      mainKeyword,
      satelliteKeywords,
      businessType,
      businessName,
      city,
      department = 'Aube',
      siteUrl,
      siteId,
      campaignId,
      model = 'gpt-4o',
      targetLength = 800,
      enableAlternatives = true,
      enableComparatives = true,
      enableLocalPack = true,
      competitorNames = [],
      alternativeNames = [],
    } = body

    if (!mainKeyword || !Array.isArray(satelliteKeywords) || satelliteKeywords.length === 0 || !businessType || !businessName || !city || !siteUrl) {
      return NextResponse.json({ error: 'Parametres cluster incomplets.' }, { status: 400 })
    }

    // Une seule lecture de l'existant pour tout le cluster. Sans siteId il n'y a
    // rien a lire : l'inventaire aveugle dit « je ne sais pas » plutot que
    // « le site est vide », et aucune adresse n'est alors declaree occupee.
    const inventory: SiteInventory = siteId
      ? await loadSiteInventory(siteId)
      : blindInventory('', 'jamais-analyse')

    // Un embedding pour le cluster entier, pas un par page : les pages d'un
    // cluster traitent le meme sujet et ont donc les memes voisines.
    const inventoryNeighbours = siteId
      ? await nearestExistingEntries(siteId, mainKeyword, inventory, MAX_PROMPT_NEIGHBOURS)
      : []

    // Le Set grandit page apres page : deux pages soeurs du MEME cluster
    // collident bien plus souvent qu'une page avec l'existant, et un Set fige a
    // la lecture attraperait le cas rare en manquant le cas courant.
    const taken = new Set(inventory.takenPaths)
    const skipped: string[] = []

    /** Rend le slug retenu, ou null quand l'adresse ne peut pas etre liberee. */
    const reserve = (input: SlugInput, label: string): string | null => {
      const resolution = resolveFreeSlug(input, taken, [city, department, businessType])

      if (resolution.status === 'collision') {
        skipped.push(`${label} (adresse ${resolution.occupiedBy} deja occupee — page NON generee)`)
        return null
      }

      taken.add(`/${resolution.slug}`)
      return resolution.slug
    }

    const slugInputFor = (focusKeyword: string): SlugInput => ({
      focusKeyword,
      city,
      businessType,
    })

    const pillarSlug = reserve(slugInputFor(mainKeyword), `pilier "${mainKeyword}"`)
    if (!pillarSlug) {
      // Le pilier porte le maillage de tout le cluster : sans lui, les pages
      // filles n'ont pas de parent. On refuse le cluster entier plutot que d'en
      // produire une moitie orpheline — et rien n'a encore ete demande au modele.
      return NextResponse.json(
        { error: `Cluster non genere : ${skipped[0]}`, progress: { total: 0, saved: 0, skipped: skipped.length, skippedDetails: skipped, generationIds: [] } },
        { status: 409 }
      )
    }

    // Les satellites gardes et leurs adresses restent alignes par construction :
    // generateCluster lit `satellites[index]` en parcourant `satelliteKeywords`.
    const keptSatelliteKeywords: string[] = []
    const satelliteSlugs: string[] = []
    for (const keyword of satelliteKeywords as string[]) {
      const slug = reserve(slugInputFor(keyword), `satellite "${keyword}"`)
      if (!slug) continue
      keptSatelliteKeywords.push(keyword)
      satelliteSlugs.push(slug)
    }

    const alternativeSlug = enableAlternatives
      ? reserve(slugInputFor(`alternative ${businessType} ${city}`), `alternative ${city}`)
      : null
    const comparativeSlug = enableComparatives
      ? reserve(slugInputFor(`meilleur ${businessType} ${city}`), `comparatif ${city}`)
      : null
    const localPackSlug = enableLocalPack
      ? reserve(slugInputFor(`${businessType} pres de moi ${city}`), `local pack ${city}`)
      : null

    const cluster = await generateCluster({
      mainKeyword,
      satelliteKeywords: keptSatelliteKeywords,
      businessType,
      businessName,
      city,
      department,
      siteUrl,
      model,
      targetLength,
      enableAlternatives,
      enableComparatives,
      enableLocalPack,
      competitorNames,
      alternativeNames,
      reservedSlugs: {
        pillar: pillarSlug,
        satellites: satelliteSlugs,
        alternatives: alternativeSlug ? [alternativeSlug] : [],
        comparatives: comparativeSlug ? [comparativeSlug] : [],
        localPack: localPackSlug ?? undefined,
      },
      inventoryNeighbours,
      inventoryFreshness: inventory.freshness,
    })

    // Save all pages to database
    const allPages = [
      { page: cluster.pillarPage, type: 'pillar', model: 'gpt-4o' },
      ...cluster.satellitePages.map(p => ({ page: p, type: 'child', model: 'gpt-4o-mini' })),
      ...cluster.alternativePages.map(p => ({ page: p, type: 'alternative', model: 'gpt-4o-mini' })),
      ...cluster.comparativePages.map(p => ({ page: p, type: 'comparative', model: 'gpt-4o-mini' })),
      ...(cluster.localPackPage ? [{ page: cluster.localPackPage, type: 'local_pack', model: 'gpt-4o-mini' }] : []),
    ]

    const records = []

    for (const { page, type, model: aiModel } of allPages) {
      try {
        const record = await createGeneration({
          campaign_id: campaignId || null,
          site_id: siteId || null,
          city,
          // Deja prouve libre plus haut. La page n'est plus jamais jetee pour
          // son adresse : elle a ete ecartee avant d'etre ecrite, ou elle
          // s'ecrit a une adresse qui lui appartient.
          slug: page.slug,
          title: page.title,
          meta_description: page.metaDescription,
          focus_keyword: page.focusKeyword,
          content: page.htmlContent,
          page_type: type as 'pillar' | 'child' | 'alternative' | 'comparative' | 'local_pack',
          status: 'generated',
          ai_model: aiModel,
        })
        records.push(record)
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        // L'index unique a arbitre une course entre deux requetes concurrentes :
        // c'est une decision de la base, pas une panne. La page est perdue, ce
        // qui est le prix d'une course — mais elle ne fait pas echouer les
        // autres pages du cluster.
        if (msg.includes('unique') || msg.includes('duplicate')) {
          skipped.push(`${page.slug} (adresse prise par une generation concurrente)`)
        } else {
          throw e
        }
      }
    }

    return NextResponse.json({
      success: true,
      cluster,
      progress: {
        total: allPages.length + skipped.length,
        saved: records.length,
        skipped: skipped.length,
        skippedDetails: skipped,
        generationIds: records.map((record) => record.id),
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
