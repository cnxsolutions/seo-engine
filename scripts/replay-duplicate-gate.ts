// ─────────────────────────────────────────────────────────────────────────────
// Rejeu du gate anti-duplicat, en lecture seule
// SEO Engine - Le seul instrument qui autorise a fermer la barriere
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE SCRIPT EXISTE.
//
// Le gate anti-duplicat est livre en deux temps. Il observe d'abord : il
// calcule, il persiste, il affiche, et la page part quand meme. Le passage en
// mode bloquant (SEO_DUPLICATE_GATE=block) coupe la production d'un volume que
// personne ne connait tant qu'il n'a pas ete mesure — et le proprietaire de ce
// site a des pages qui rankent. Sans cette mesure, la bascule est un pari.
//
// Ce script rejoue EXACTEMENT le calcul du gate, en mode bloquant, sur les
// pages deja publiees, et repond a une seule question : combien auraient ete
// refusees ?
//
// CE QU'IL NE FAIT PAS.
//
//  - Il n'ecrit RIEN. Aucun UPDATE, aucun INSERT. Un outil de diagnostic qui
//    ecrit en base ne peut pas etre relance par un operateur inquiet.
//  - Il ne recopie AUCUN seuil, aucune comparaison, aucune tokenisation. Il
//    importe le pipeline. Un script de calibration qui reimplemente la logique
//    du gate mesure autre chose que le gate, et sa reponse ne vaut rien.
//  - Il ne mute pas process.env : le mode est passe en parametre
//    (`duplicateMode: 'block'`), sinon la mutation fuirait sur tout le reste.
//
// CE QU'IL COUTE, dit avant d'etre decouvert sur une facture. Le pipeline
// demande au magasin vectoriel les voisins du mot-cle de chaque page, et cet
// appel achete UN embedding OpenAI. Rejouer cent pages, c'est donc cent
// embeddings. C'est le prix de la seule chose qu'une comparaison lexicale ne
// voit pas — que « taxi conventionne CPAM » et « transport medical assis » sont
// la meme page. Le plafond est explicite et reglable.
//
//   npx tsx scripts/replay-duplicate-gate.ts --site <uuid>
//   npx tsx scripts/replay-duplicate-gate.ts --site <uuid> --limit 40
//
// Code de sortie : 0 sous le plafond de blocage, 1 au-dessus.

import { countHtmlWords, runPrePublishGate } from '../lib/pipeline'
import { loadSiteInventory } from '../lib/existing/inventory'
import { createServiceClient } from '../lib/supabase'
import { BLOCKING_DUPLICATE_CODES, isBlocking } from '../src/core/domain/existing/verdict'
import { normalizeInventoryPath, type SiteInventory } from '../src/core/domain/existing/inventory'
import type { GeneratedPage } from '../lib/ai/openai'
import type { Generation, PageType } from '../lib/types'

// ─── Le seuil de decision ────────────────────────────────────────────────────

/**
 * Au-dela de ce taux, fermer la barriere coute plus de production qu'elle ne
 * previent de duplication — le site est deja abime, et la reponse est
 * d'assainir avant de bloquer, pas de bloquer pour assainir.
 *
 * Ecrit UNE fois, ici. Ce chiffre est un arbitrage entre volume de production
 * et risque de duplication : il appartient au proprietaire du site, et le
 * modifier est une decision, pas un reglage.
 */
const BLOCK_RATE_CEILING = 0.15

const DEFAULT_LIMIT = 100

// ─── Arguments ───────────────────────────────────────────────────────────────

function readArgs(argv: string[]): { siteId: string; limit: number } {
  const siteId = valueOf(argv, '--site')
  if (!siteId) {
    console.error(
      'Usage : npx tsx scripts/replay-duplicate-gate.ts --site <uuid> [--limit 100]\n' +
        '\n' +
        '--site est obligatoire : l inventaire, les seuils et les voisins sont tous\n' +
        'propres a un site, et melanger deux sites rendrait un taux qui ne decrit aucun.'
    )
    process.exit(2)
  }

  const raw = Number(valueOf(argv, '--limit'))
  const limit = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_LIMIT

  return { siteId, limit }
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

type PublishedRow = Pick<
  Generation,
  'id' | 'slug' | 'title' | 'meta_description' | 'focus_keyword' | 'content' | 'page_type' | 'published_url'
> & { page_payload: GeneratedPage | null }

async function readPublished(siteId: string, limit: number): Promise<PublishedRow[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('generations')
    .select('id,slug,title,meta_description,focus_keyword,content,page_type,published_url,page_payload')
    .eq('site_id', siteId)
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`lecture des generations publiees : ${error.message}`)
  return (data ?? []) as PublishedRow[]
}

/**
 * La page telle qu'elle a ete publiee.
 *
 * `page_payload` porte les schemas, la FAQ et les liens internes qu'aucune
 * colonne scalaire ne peut contenir. Sans lui on rejoue une version appauvrie
 * de la page, ce qui fausse la mesure vers le bas — on le DIT plutot que de
 * laisser croire le contraire.
 */
function pageOf(row: PublishedRow): { page: GeneratedPage; degraded: boolean } {
  if (row.page_payload) return { page: row.page_payload, degraded: false }

  const content = row.content ?? ''
  return {
    degraded: true,
    page: {
      title: row.title ?? '',
      metaDescription: row.meta_description ?? '',
      slug: row.slug ?? '',
      focusKeyword: row.focus_keyword ?? '',
      htmlContent: content,
      estimatedWordCount: countHtmlWords(content),
    } as GeneratedPage,
  }
}

/**
 * L'inventaire prive de la page qu'on est en train de juger.
 *
 * SANS CE FILTRE LE TAUX VAUT 100 %. Une page publiee figure dans son propre
 * inventaire — le crawl l'a vue, ou la migration 018 l'y a inscrite — et
 * `isComparable` ne l'ecarte d'elle-meme qu'en mode 'refresh'. Rejouee en
 * 'create', chaque page serait donc son propre duplicat exact, et le script
 * rendrait un chiffre parfaitement inutile avec un aplomb parfait.
 */
function inventoryWithout(inventory: SiteInventory, path: string): SiteInventory {
  const target = normalizeInventoryPath(path)
  const entries = inventory.entries.filter(entry => entry.path !== target)
  const takenPaths = new Set(inventory.takenPaths)
  takenPaths.delete(target)

  return { ...inventory, entries, takenPaths }
}

// ─── Rejeu ───────────────────────────────────────────────────────────────────

interface Hit {
  code: string
  path: string
  url: string | null
  against: string
  againstUrl?: string
  similarity: number
  partial: boolean
}

async function main() {
  const { siteId, limit } = readArgs(process.argv.slice(2))

  console.log(`\nRejeu du gate anti-duplicat en mode BLOQUANT — site ${siteId}`)
  console.log('Lecture seule : ce script n ecrit rien en base.\n')

  const inventory = await loadSiteInventory(siteId)
  const rows = await readPublished(siteId, limit)

  if (rows.length === 0) {
    console.log('Aucune page publiee sur ce site : il n y a rien a mesurer.')
    console.log('Un taux ne se deduit pas d un echantillon vide — ne basculez pas la barriere sur ce resultat.')
    process.exit(0)
  }

  console.log(
    `Inventaire : ${inventory.entries.length} page(s) connue(s), fraicheur « ${inventory.freshness.state} »` +
      `${inventory.truncated ? ', ECHANTILLON TRONQUE (seuils durcis)' : ''}`
  )
  console.log(`Pages a rejouer : ${rows.length}\n`)

  const hits: Hit[] = []
  let blocked = 0
  let degradedPayloads = 0

  for (const row of rows) {
    const { page, degraded } = pageOf(row)
    if (degraded) degradedPayloads++

    const verdict = await runPrePublishGate({
      page,
      generationId: row.id,
      pageType: (row.page_type ?? 'child') as PageType,
      siteId,
      siteUrl: '',
      // Le mode force, sans toucher a l environnement du processus.
      duplicateMode: 'block',
      inventory: inventoryWithout(inventory, row.slug ?? ''),
    })

    // Les PREUVES structurees, pas les phrases du rapport. Le verdict porte
    // deja code, similarite, chemin vise et aveu de comparaison partielle ;
    // relire des messages destines a un humain serait une dependance a un
    // format que rien ne garantit.
    const evidence = verdict.duplicateVerdict
    if (!evidence || !isBlocking(evidence)) continue

    blocked++

    for (const match of evidence.matches) {
      if (!(BLOCKING_DUPLICATE_CODES as readonly string[]).includes(match.code)) continue
      hits.push({
        code: match.code,
        path: row.slug ?? row.id,
        url: row.published_url ?? null,
        against: match.entryPath,
        againstUrl: match.entryUrl,
        similarity: match.similarity,
        partial: match.partial,
      })
    }
  }

  report({ total: rows.length, blocked, hits, degradedPayloads })

  const rate = blocked / rows.length
  process.exit(rate > BLOCK_RATE_CEILING ? 1 : 0)
}

// ─── Rapport ─────────────────────────────────────────────────────────────────

function report(input: { total: number; blocked: number; hits: Hit[]; degradedPayloads: number }) {
  const rate = input.blocked / input.total

  console.log('───────────────────────────────────────────────────────────────')
  console.log('1. CE QUE LA BARRIERE REFUSERAIT')
  console.log('───────────────────────────────────────────────────────────────')
  console.log(`   Pages examinees        : ${input.total}`)
  console.log(`   Pages qui SERAIENT refusees : ${input.blocked}  (${(rate * 100).toFixed(1)} %)`)
  console.log(`   Plafond de decision    : ${(BLOCK_RATE_CEILING * 100).toFixed(0)} %`)

  if (input.degradedPayloads > 0) {
    console.log(
      `\n   ATTENTION : ${input.degradedPayloads} page(s) sans page_payload ont ete rejouees\n` +
        '   sans leurs schemas ni leurs liens internes. Leur mesure est donc\n' +
        '   approximative, et plutot optimiste.'
    )
  }

  console.log('\n───────────────────────────────────────────────────────────────')
  console.log('2. VENTILATION PAR MOTIF')
  console.log('───────────────────────────────────────────────────────────────')
  // La boucle porte sur la constante du domaine, jamais sur une liste ecrite a
  // la main : un sixieme code bloquant apparaitra ici tout seul le jour ou il
  // sera ajoute, au lieu d etre silencieusement absent du rapport.
  for (const code of BLOCKING_DUPLICATE_CODES) {
    const count = input.hits.filter(hit => hit.code === code).length
    console.log(`   ${code.padEnd(22)} ${String(count).padStart(4)}`)
  }

  console.log('\n───────────────────────────────────────────────────────────────')
  console.log('3. LES DIX COUPLES LES PLUS PROCHES')
  console.log('───────────────────────────────────────────────────────────────')

  const worst = [...input.hits].sort((a, b) => b.similarity - a.similarity).slice(0, 10)

  if (worst.length === 0) {
    console.log('   Aucun.')
  } else {
    for (const hit of worst) {
      // L aveu de comparaison partielle voyage avec le chiffre : un operateur
      // qui lit « 82 % » sur un extrait ne doit pas croire avoir vu les deux
      // pages entieres.
      const caveat = hit.partial ? '  (comparaison partielle — extrait seul)' : ''
      console.log(`   [${hit.code}] ${Math.round(hit.similarity * 100)} %${caveat}`)
      console.log(`      page   : ${hit.url ?? `/${hit.path}`}`)
      console.log(`      contre : ${hit.againstUrl ?? hit.against}`)
    }
  }

  console.log('\n───────────────────────────────────────────────────────────────')
  if (rate > BLOCK_RATE_CEILING) {
    console.log(
      `VERDICT : ${(rate * 100).toFixed(1)} % depasse le plafond de ${(BLOCK_RATE_CEILING * 100).toFixed(0)} %.\n` +
        '\n' +
        'Fermer la barriere maintenant couperait cette part de la production. Le\n' +
        'site porte deja trop de pages qui se ressemblent : la reponse est de les\n' +
        'assainir (fusionner, elaguer, reecrire les titres et les metas) AVANT de\n' +
        'bloquer, pas de bloquer pour les assainir.'
    )
  } else {
    console.log(
      `VERDICT : ${(rate * 100).toFixed(1)} % reste sous le plafond de ${(BLOCK_RATE_CEILING * 100).toFixed(0)} %.\n` +
        '\n' +
        'La bascule est tenable. Pour la faire :  SEO_DUPLICATE_GATE=block\n' +
        'Elle s annule en retirant la variable et en redemarrant.'
    )
  }
  console.log('───────────────────────────────────────────────────────────────\n')
}

main().catch((error) => {
  console.error('\nEchec du rejeu :', error instanceof Error ? error.message : error)
  console.error('Aucune donnee n a ete modifiee.')
  process.exit(2)
})
