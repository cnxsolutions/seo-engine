// ─────────────────────────────────────────────────────────────────────────────
// Ce qu'un crawl inscrit dans site_pages
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE MODULE EXISTE.
//
// Deux chemins de crawl tournent en production — POST /api/analysis-runs, que
// l'interface appelle, et le renouvellement de cycle (cycle-manager) — et
// chacun portait SA copie de ce mapping. Les deux copies avaient deja diverge :
// celle de la route ignorait `canonical_path`, `robots_noindex` et `origin`,
// c'est-a-dire les trois colonnes que la migration 018 a ajoutees pour que
// l'inventaire puisse distinguer « cette URL est occupee » de « ce sujet est
// couvert ».
//
// La consequence n'etait pas theorique : le chemin de crawl PRINCIPAL laissait
// ces colonnes vides, donc une page canonisee ailleurs ou desindexee comptait
// comme une concurrente a part entiere, et une page publiee par le moteur puis
// revue par le crawl restait marquee 'engine' pour toujours — hors du compte de
// pages crawlees et hors du repli de fraicheur.
//
// Un seul mapping, un seul endroit ou une colonne s'ajoute.

import type { CrawlResult } from './crawler'
import type { CreateSitePagePayload } from '@/lib/types'

/** Bornes de ce qu'on recopie d'une page : le reste ne sert a personne en aval. */
const MAX_INTERNAL_LINKS = 20
const MAX_EXTERNAL_LINKS = 10

/**
 * Les lignes `site_pages` que ce crawl vient de prouver.
 *
 * `origin: 'crawl'` est ECRIT et non omis : cette ligne vient d'etre visitee,
 * donc `crawled_at` est bien une date de crawl. Laissee a sa valeur precedente,
 * une page que le moteur a publiee et que le crawler a depuis vue resterait
 * eternellement 'engine'.
 */
export function toSitePagePayloads(
  siteId: string,
  crawlResult: CrawlResult,
): CreateSitePagePayload[] {
  // UN SEUL PAYLOAD PAR CHEMIN, et ce n'est pas de la prudence decorative.
  //
  // `upsertSitePages` remonte sur le conflit (site_id, path). PostgreSQL REFUSE
  // qu'un meme ON CONFLICT DO UPDATE touche deux fois la meme ligne dans un seul
  // ordre : le lot entier echoue avec « ON CONFLICT DO UPDATE command cannot
  // affect row a second time ». Une seule page en double suffit a perdre les
  // quarante autres.
  //
  // Le crawler en produit : il memorise les URL VISITEES avant redirection et
  // rapporte celles d'ARRIVEE, si bien qu'une page d'accueil atteinte par
  // https://exemple.fr/ puis par https://www.exemple.fr/ ressort deux fois sous
  // le meme chemin.
  //
  // Constate en production sur les trois sites connectes, et jamais vu : les
  // deux chemins de crawl avalent l'echec avec `.catch(() => null)`, donc
  // l'inventaire restait vide SANS QU'AUCUNE ERREUR N'APPARAISSE. C'est
  // exactement le mode de panne que ce chantier existe pour supprimer.
  //
  // La derniere occurrence gagne : les pages arrivent dans l'ordre du crawl, et
  // la plus recente est celle dont on vient de lire le contenu.
  const byPath = new Map<string, CreateSitePagePayload>()
  for (const payload of buildAll(siteId, crawlResult)) byPath.set(payload.path, payload)
  return [...byPath.values()]
}

function buildAll(siteId: string, crawlResult: CrawlResult): CreateSitePagePayload[] {
  return crawlResult.pages.map((page) => ({
    site_id: siteId,
    url: page.url,
    path: page.path,
    title: page.title || null,
    meta_description: page.metaDescription || null,
    h1: page.h1 || null,
    h2s: page.h2s,
    word_count: page.wordCount,
    focus_keyword: page.keywords[0] || null,
    keywords: page.keywords,
    internal_links: page.internalLinks.slice(0, MAX_INTERNAL_LINKS),
    external_links: page.externalLinks.slice(0, MAX_EXTERNAL_LINKS),
    has_schema: page.hasSchema,
    schema_types: page.schemaTypes,
    has_faq: page.hasFaq,
    has_local_business: page.hasLocalBusiness,
    geo_signals: page.geoSignals,
    // Le corps de la page, pas seulement ses titres. Sans lui l'embedding se
    // construit sur le titre et les H2 — un sommaire, pas une page.
    content_excerpt: page.textExcerpt || null,
    // Migration 018. Une page canonisee ailleurs occupe son URL sans etre celle
    // que Google indexe ; une page noindex l'occupe sans etre indexee du tout.
    // Toutes deux occupent une adresse, aucune n'est une concurrente, et
    // l'inventaire ne peut les distinguer que si le crawl le dit.
    canonical_path: page.canonicalPath,
    robots_noindex: page.robotsNoindex,
    origin: 'crawl' as const,
    crawled_at: crawlResult.crawledAt,
  })) as CreateSitePagePayload[]
}
