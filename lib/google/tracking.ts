// ─────────────────────────────────────────────────────────────────────────────
// Publication tracking — each published page, from the day it went live
// SEO Engine - What Google did with it, what that means, what to do.
// ─────────────────────────────────────────────────────────────────────────────
//
// `measurePublishedPages` judges a page on its first 30 days, and only once
// they are over: the planner needs a settled verdict. The owner needs the
// opposite — on 2026-11-08 every page the engine had published was younger
// than three weeks, so the measure returned nothing at all while Search
// Console already held their first impressions.
//
// This module follows a page from day one. Its verdicts are honest about age:
// « too early » and « still being ranked » exist precisely so that a page of
// five days is never called dead, and a page of ten days at position 40 is
// never called buried.
//
// Two dates matter and are never confused: how long the page has been live
// (`daysLive`, against today), and how many of those days Search Console has
// reported on (`dataDays`, against the last day it holds — two to three days
// behind). A page published yesterday has no data, and that is not a verdict.

import {
  aggregateRows,
  detectCannibalization,
  DEFAULT_PLANNING_WINDOW_DAYS,
  EMERGING_MIN_IMPRESSIONS,
  fetchGscRows,
  fetchPublishedGenerations,
  getGscCoverage,
  normalizePageUrl,
  publicationDate,
  DEFAULT_MEASUREMENT_WINDOW_DAYS,
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
  type GscRawRow,
} from './performance'
import { brandForms, claimOf, classifyQuery, foldQuery, pageClaim, queryTokens, type PageClaim, type QueryKind } from './query-match'

// ─── Tunables ────────────────────────────────────────────────────────────────

/** The most recent publications followed. */
export const TRACKING_PAGE_LIMIT = 60

/** Older pages are the planner's business (measurePublishedPages), not this view's. */
export const TRACKING_LOOKBACK_DAYS = 180

/** Below a week of data, absence of impressions means nothing. */
export const TOO_EARLY_DAYS = 7

/** Within four weeks, a deep position is Google testing the page, not a verdict. */
export const SETTLING_DAYS = 28

/** The trend compares the last seven days of data to the seven before. */
export const TREND_DAYS = 7

// ─── Types ───────────────────────────────────────────────────────────────────

export type TrackingVerdict =
  | 'too_early'          // under a week of data, nothing shown yet
  | 'unseen'             // a week to a month of data, never shown: indexing?
  | 'no_demand'          // a month of data, never shown: nobody searches this
  | 'brand_only'         // shown only to people typing the site's name
  | 'climbing'           // shown deep, but the page is young
  | 'buried'             // shown deep, and no longer young
  | 'striking_distance'  // positions 5-20: the cheapest traffic on the site
  | 'low_ctr'            // ranked well, shown often, rarely clicked
  | 'winning'            // top 5

export type TrackingTone = 'good' | 'info' | 'warning' | 'critical' | 'muted'

export interface TrackedQuery {
  query: string
  kind: QueryKind
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface TrackingPeriod {
  impressions: number
  clicks: number
  /** Excluding brand queries; null when the page was not shown on any other. */
  position: number | null
}

export interface TrackingInterpretation {
  label: string
  tone: TrackingTone
  /** What the numbers say, in a sentence. */
  explanation: string
  /** What to do about it — or that nothing needs doing. */
  action: string
  /** Facts worth a line of their own: the query Google actually picked, the trend. */
  insights: string[]
}

export interface TrackedPage {
  generationId: string
  pageUrl: string
  title: string | null
  focusKeyword: string | null
  publishedAt: string
  daysLive: number
  /** Days between publication and the last day Search Console reports on. */
  dataDays: number
  firstImpressionOn: string | null
  clicks: number
  impressions: number
  ctr: number
  /** Brand queries left out: « cnx solutions » at position 2 says nothing about the subject. */
  position: number | null
  brandImpressions: number
  /** Position on the focus keyword itself, when Google ever showed the page for it. */
  targetPosition: number | null
  /** Null under two full trend windows of data. */
  recent: TrackingPeriod | null
  previous: TrackingPeriod | null
  queries: TrackedQuery[]
  verdict: TrackingVerdict
  interpretation: TrackingInterpretation
}

/**
 * What the planner will do with an unexpected query — the rule of
 * `selectEmergingQueries`, applied here so that the screen and the plan agree.
 *
 *   carried    a page of the site ranks 20 or better on it: reinforce, never double
 *   disputed   several pages of the site already compete on it (cannibalized)
 *   covered    another page of the site claims it (keyword, title or address)
 *   rare       under EMERGING_MIN_IMPRESSIONS: one person's search, not a demand
 *   candidate  proposed to the next plans as the subject of a new page
 */
export type UnexpectedFate = 'carried' | 'disputed' | 'covered' | 'rare' | 'candidate'

export interface UnexpectedQuery {
  query: string
  /** Every published page together: « agence seo troyes » shown on three pages is one fact, not three. */
  impressions: number
  clicks: number
  /** The best position any of those pages reached. */
  position: number
  pages: Array<{ pageUrl: string; title: string | null; impressions: number; position: number }>
  fate: UnexpectedFate
  /** The page that carries it, wins it or claims it — null for 'rare' and 'candidate'. */
  heldBy: { url: string; position: number | null } | null
}

/**
 * The whole site as the planner sees it, over the planner's own window: every
 * page's claim, every query's best page, the queries already disputed.
 */
export interface SiteQueryContext {
  best: Map<string, { url: string; position: number }>
  disputed: Map<string, string>
  claims: Array<{ url: string; claim: PageClaim }>
}

export interface PublicationTracking {
  state: 'ok' | 'no_publication' | 'no_data' | 'unreadable'
  /** The last day Search Console reports on. */
  lastDataDate: string | null
  pages: TrackedPage[]
  /** Queries the published pages are shown on without having chosen them, every page together. */
  unexpected: UnexpectedQuery[]
}

export interface TrackedGeneration {
  id: string
  title: string | null
  focusKeyword: string | null
  pageUrl: string
  publishedAt: Date
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Every page the engine published on this site in the last six months, joined
 * to what Search Console reported on it since its publication.
 */
export async function trackPublishedPages(
  site: { id: string; name?: string | null; url?: string | null },
  now: Date = new Date()
): Promise<PublicationTracking> {
  const empty = (state: PublicationTracking['state'], lastDataDate: string | null = null): PublicationTracking => ({
    state,
    lastDataDate,
    pages: [],
    unexpected: [],
  })

  const horizon = new Date(now.getTime() - TRACKING_LOOKBACK_DAYS * 86_400_000)
  const generations: TrackedGeneration[] = (await fetchPublishedGenerations(site.id, TRACKING_PAGE_LIMIT))
    .map((generation) => ({
      id: generation.id,
      title: generation.title ?? null,
      focusKeyword: generation.focus_keyword ?? null,
      pageUrl: generation.published_url,
      publishedAt: publicationDate(generation),
    }))
    .filter((entry): entry is TrackedGeneration => entry.publishedAt !== null && entry.publishedAt >= horizon)

  if (generations.length === 0) return empty('no_publication')

  const coverage = await getGscCoverage(site.id)
  if (!coverage.readable) return empty('unreadable')
  if (!coverage.lastDate) return empty('no_data')

  // From the oldest publication, and at least over the planner's window: the
  // fate of each unexpected query is read on the same 90 days the next plan reads.
  const planningStart = new Date(now.getTime() - DEFAULT_PLANNING_WINDOW_DAYS * 86_400_000)
  const oldest = generations.reduce((min, entry) => (entry.publishedAt < min ? entry.publishedAt : min), planningStart)
  const rows = await fetchGscRows(site.id, dayOf(oldest), coverage.lastDate)
  if (rows === null) return empty('unreadable', coverage.lastDate)

  return buildTracking({ generations, rows, lastDataDate: coverage.lastDate, now, brands: brandForms(site) })
}

// ─── Pure derivations (exported for tests) ───────────────────────────────────

export function buildTracking(input: {
  generations: readonly TrackedGeneration[]
  rows: readonly GscRawRow[]
  lastDataDate: string
  now: Date
  brands: readonly string[]
}): PublicationTracking {
  const rowsByPage = new Map<string, GscRawRow[]>()
  for (const row of input.rows) {
    const key = normalizePageUrl(row.page_url)
    const list = rowsByPage.get(key) ?? []
    list.push(row)
    rowsByPage.set(key, list)
  }

  const pages = [...input.generations]
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .map((generation) =>
      trackPage({
        generation,
        rows: rowsByPage.get(normalizePageUrl(generation.pageUrl)) ?? [],
        lastDataDate: input.lastDataDate,
        now: input.now,
        brands: input.brands,
      })
    )

  return {
    state: 'ok',
    lastDataDate: input.lastDataDate,
    pages,
    unexpected: collectUnexpected(pages, siteQueryContext(input.rows, input.generations, input.now)),
  }
}

/**
 * Every page of the site, claimed by its address — and by its keyword and
 * title when the engine wrote it — over the planner's window (getGscPlanningSignals).
 */
export function siteQueryContext(rows: readonly GscRawRow[], generations: readonly TrackedGeneration[], now: Date): SiteQueryContext {
  const windowStart = dayOf(new Date(now.getTime() - DEFAULT_PLANNING_WINDOW_DAYS * 86_400_000))
  const stats = aggregateRows(rows.filter((row) => row.date >= windowStart))

  const best = new Map<string, { url: string; position: number }>()
  const known = new Map<string, { url: string; focusKeyword?: string | null; title?: string | null }>()

  for (const stat of stats) {
    const key = foldQuery(stat.query)
    const current = best.get(key)
    if (stat.impressions > 0 && (!current || stat.position < current.position)) best.set(key, { url: stat.pageUrl, position: stat.position })
    known.set(normalizePageUrl(stat.pageUrl), { url: stat.pageUrl })
  }
  for (const generation of generations) {
    known.set(normalizePageUrl(generation.pageUrl), { url: generation.pageUrl, focusKeyword: generation.focusKeyword, title: generation.title })
  }

  return {
    best,
    disputed: new Map(detectCannibalization(stats).map((entry) => [foldQuery(entry.query), entry.winner])),
    claims: [...known.values()].map((page) => ({ url: page.url, claim: pageClaim(page) })),
  }
}

/** The unexpected queries of every page, merged by query, each with what the planner will make of it. */
export function collectUnexpected(pages: readonly TrackedPage[], site?: SiteQueryContext): UnexpectedQuery[] {
  const byQuery = new Map<string, Omit<UnexpectedQuery, 'fate' | 'heldBy'>>()

  for (const page of pages) {
    for (const query of page.queries) {
      if (query.kind !== 'unexpected') continue
      const key = foldQuery(query.query)
      const entry = byQuery.get(key) ?? { query: query.query, impressions: 0, clicks: 0, position: query.position, pages: [] }
      entry.impressions += query.impressions
      entry.clicks += query.clicks
      entry.position = Math.min(entry.position, query.position)
      entry.pages.push({ pageUrl: page.pageUrl, title: page.title, impressions: query.impressions, position: query.position })
      byQuery.set(key, entry)
    }
  }

  return [...byQuery.entries()]
    .map(([key, entry]): UnexpectedQuery => {
      const pages = entry.pages.sort((a, b) => b.impressions - a.impressions)
      const ownBest = pages.reduce((min, page) => (page.position < min.position ? page : min), pages[0])
      const siteBest = site?.best.get(key)
      const best = siteBest && siteBest.position < ownBest.position ? siteBest : { url: ownBest.pageUrl, position: ownBest.position }

      if (best.position <= STRIKING_DISTANCE_MAX_POSITION) return { ...entry, pages, fate: 'carried', heldBy: best }

      const disputedBy = site?.disputed.get(key)
      if (disputedBy) return { ...entry, pages, fate: 'disputed', heldBy: { url: disputedBy, position: null } }

      const tokens = queryTokens(entry.query)
      const cover = site?.claims.find((candidate) => claimOf(tokens, candidate.claim) !== 'unexpected')
      if (cover) return { ...entry, pages, fate: 'covered', heldBy: { url: cover.url, position: site?.best.get(key)?.url === cover.url ? best.position : null } }

      return { ...entry, pages, fate: entry.impressions < EMERGING_MIN_IMPRESSIONS ? 'rare' : 'candidate', heldBy: null }
    })
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    .slice(0, 25)
}

export function trackPage(input: {
  generation: TrackedGeneration
  rows: readonly GscRawRow[]
  lastDataDate: string
  now: Date
  brands: readonly string[]
}): TrackedPage {
  const { generation, lastDataDate, brands } = input
  const publishedDay = dayOf(generation.publishedAt)

  // A URL can have lived before the engine published on it (a slug reused
  // after a deletion): only what follows this publication belongs to this page.
  const rows = input.rows.filter((row) => row.date >= publishedDay && row.date <= lastDataDate)

  const page = { focusKeyword: generation.focusKeyword, title: generation.title, url: generation.pageUrl }
  const kindOf = new Map<string, QueryKind>()
  const kind = (query: string) => {
    let value = kindOf.get(query)
    if (!value) {
      value = classifyQuery(query, page, brands)
      kindOf.set(query, value)
    }
    return value
  }

  const queries = aggregateQueries(rows, kind)
  const nonBrandRows = rows.filter((row) => kind(row.query) !== 'brand')

  const clicks = sum(rows, (row) => row.clicks)
  const impressions = sum(rows, (row) => row.impressions)
  const brandImpressions = impressions - sum(nonBrandRows, (row) => row.impressions)
  const dataDays = lastDataDate >= publishedDay ? daysBetweenDays(publishedDay, lastDataDate) + 1 : 0
  const daysLive = Math.max(0, Math.floor((input.now.getTime() - generation.publishedAt.getTime()) / 86_400_000))

  const shown = rows.filter((row) => row.impressions > 0).map((row) => row.date).sort()
  const targetRows = rows.filter((row) => kind(row.query) === 'target')

  const trend = dataDays >= TREND_DAYS * 2
  const recentStart = shiftDay(lastDataDate, -(TREND_DAYS - 1))
  const previousStart = shiftDay(lastDataDate, -(TREND_DAYS * 2 - 1))

  const tracked: Omit<TrackedPage, 'verdict' | 'interpretation'> = {
    generationId: generation.id,
    pageUrl: generation.pageUrl,
    title: generation.title,
    focusKeyword: generation.focusKeyword,
    publishedAt: generation.publishedAt.toISOString(),
    daysLive,
    dataDays,
    firstImpressionOn: shown[0] ?? null,
    clicks,
    impressions,
    ctr: impressions > 0 ? round(clicks / impressions, 4) : 0,
    position: weightedPosition(nonBrandRows),
    brandImpressions,
    targetPosition: weightedPosition(targetRows),
    recent: trend ? periodOf(nonBrandRows, rows, recentStart, lastDataDate) : null,
    previous: trend ? periodOf(nonBrandRows, rows, previousStart, shiftDay(recentStart, -1)) : null,
    queries: queries.slice(0, 15),
  }

  const verdict = trackingVerdictFor(tracked)
  return { ...tracked, verdict, interpretation: interpret({ ...tracked, verdict, allQueries: queries }) }
}

/**
 * The verdict, from the most basic question up: was the page shown at all,
 * on what, and where.
 *
 * Position and CTR are read WITHOUT brand queries. A page shown four times at
 * position 2 on « cnx solutions » and once at 57 on its subject has an average
 * of 13 — « à portée de la première page » — when its subject sits at 57.
 */
export function trackingVerdictFor(page: {
  dataDays: number
  impressions: number
  brandImpressions: number
  clicks: number
  position: number | null
  queries: readonly TrackedQuery[]
}): TrackingVerdict {
  if (page.impressions <= 0) {
    if (page.dataDays < TOO_EARLY_DAYS) return 'too_early'
    if (page.dataDays < DEFAULT_MEASUREMENT_WINDOW_DAYS) return 'unseen'
    return 'no_demand'
  }

  const subjectImpressions = page.impressions - page.brandImpressions
  if (subjectImpressions <= 0 || page.position === null) return 'brand_only'

  const subjectClicks = page.queries.filter((query) => query.kind !== 'brand').reduce((total, query) => total + query.clicks, 0)
  if (page.position <= 10 && subjectImpressions >= 100 && subjectClicks / subjectImpressions < 0.02) return 'low_ctr'
  if (page.position < STRIKING_DISTANCE_MIN_POSITION) return 'winning'
  if (page.position <= STRIKING_DISTANCE_MAX_POSITION) return 'striking_distance'
  return page.dataDays < SETTLING_DAYS ? 'climbing' : 'buried'
}

/** The verdict put into words — and into one thing to do. */
export function interpret(
  page: Omit<TrackedPage, 'interpretation'> & { allQueries?: readonly TrackedQuery[] }
): TrackingInterpretation {
  const subject = (page.allQueries ?? page.queries).filter((query) => query.kind !== 'brand')
  const top = subject[0] ?? null
  const position = page.position === null ? null : formatPosition(page.position)
  const days = plural(page.dataDays, 'jour')

  const insights: string[] = []

  if (top && top.kind === 'unexpected' && page.focusKeyword) {
    insights.push(
      `Google l’associe d’abord à « ${top.query} » (${formatPosition(top.position)}ᵉ position)` +
        (page.targetPosition !== null
          ? `, son mot-clé visé « ${page.focusKeyword} » n’arrivant qu’en ${formatPosition(page.targetPosition)}ᵉ position.`
          : `, jamais à son mot-clé visé exact « ${page.focusKeyword} ».`)
    )
  } else if (page.targetPosition !== null && page.focusKeyword) {
    insights.push(`Sur son mot-clé visé « ${page.focusKeyword} » : ${formatPosition(page.targetPosition)}ᵉ position.`)
  }

  if (page.recent && page.previous && (page.recent.impressions > 0 || page.previous.impressions > 0)) {
    const positions =
      page.recent.position !== null && page.previous.position !== null
        ? `, position ${formatPosition(page.recent.position)} (contre ${formatPosition(page.previous.position)})`
        : ''
    insights.push(
      `${TREND_DAYS} derniers jours de données : ${plural(page.recent.impressions, 'impression')}` +
        ` (contre ${page.previous.impressions} la semaine d’avant)${positions}.`
    )
  }

  if (page.brandImpressions > 0 && page.verdict !== 'brand_only') {
    insights.push(`${plural(page.brandImpressions, 'impression')} sur le nom du site, laissées hors de la position moyenne.`)
  }

  const base = { insights }

  switch (page.verdict) {
    case 'too_early':
      return {
        ...base,
        label: 'Trop tôt',
        tone: 'muted',
        explanation:
          page.dataDays === 0
            ? `Publiée ${page.daysLive === 0 ? 'aujourd’hui' : `il y a ${plural(page.daysLive, 'jour')}`} : Search Console ne rapporte encore rien sur ces jours-là (ses chiffres arrivent avec deux à trois jours de retard).`
            : `Search Console ne couvre encore que ${days} de cette page, sans impression.`,
        action: 'Rien à faire : une page neuve met en général une à deux semaines à apparaître dans les résultats.',
      }
    case 'unseen':
      return {
        ...base,
        label: 'Pas encore affichée',
        tone: 'warning',
        explanation: `${capitalize(days)} de données, aucune impression : Google ne l’a montrée sur aucune recherche.`,
        action:
          'Vérifier qu’elle est indexée : Search Console → Inspection de l’URL, puis « Demander l’indexation » si elle ne l’est pas. ' +
          'Un lien depuis une page du site déjà visitée accélère sa découverte.',
      }
    case 'no_demand':
      return {
        ...base,
        label: 'Aucune demande',
        tone: 'critical',
        explanation: `Aucune impression en ${days}.`,
        action:
          'Si l’Inspection de l’URL la dit indexée, personne ne cherche ce sujet sous cette forme : les prochains plans évitent ce sujet et ses variantes.',
      }
    case 'brand_only':
      return {
        ...base,
        label: 'Vue sur la marque seulement',
        tone: 'warning',
        explanation: `Google la montre quand on cherche le nom du site (${plural(page.brandImpressions, 'impression')}), sur aucune requête de son sujet.`,
        action:
          'Elle est indexée mais pas encore associée à son sujet : la lier depuis les pages du même thème, avec un texte de lien qui décrit ce sujet.',
      }
    case 'climbing':
      return {
        ...base,
        label: 'En cours de classement',
        tone: 'info',
        explanation: `Affichée ${plural(page.impressions, 'fois', 'fois')}, position moyenne ${position} : au-delà de la deuxième page, ce qui est normal ${page.daysLive} jours après la publication.`,
        action: 'Laisser Google tester la page et revoir dans deux semaines. Ses requêtes, ci-dessous, disent sur quoi il la teste.',
      }
    case 'buried':
      return {
        ...base,
        label: 'Enfouie',
        tone: 'warning',
        explanation: `Position moyenne ${position} après ${days} de données : au-delà de la deuxième page, presque personne ne la voit.`,
        action:
          'Le sujet est disputé. La renforcer à la main (exemples concrets, preuves, liens depuis les pages fortes du site) ou accepter qu’elle ne capte que de la longue traîne.',
      }
    case 'striking_distance':
      return {
        ...base,
        label: 'À portée de la première page',
        tone: 'info',
        explanation: `Position moyenne ${position} : la page est entre la ${STRIKING_DISTANCE_MIN_POSITION}ᵉ et la ${STRIKING_DISTANCE_MAX_POSITION}ᵉ place.`,
        action:
          `Le levier le moins cher du site : des liens vers elle depuis les pages les plus visitées${top ? `, avec « ${top.query} » comme texte de lien` : ''}. ` +
          'Aucune page concurrente sur cette requête : les plans l’interdisent déjà.',
      }
    case 'low_ctr':
      return {
        ...base,
        label: 'Vue, peu cliquée',
        tone: 'warning',
        explanation: `${plural(page.impressions, 'impression')} en position ${position}, pour ${formatPercent(page.ctr)} de clics.`,
        action: `Le classement est bon, la promesse ne l’est pas : réécrire à la main le titre et la méta-description${top ? ` pour qu’ils répondent à « ${top.query} »` : ''}.`,
      }
    case 'winning':
      return {
        ...base,
        label: 'Gagnante',
        tone: 'good',
        explanation: `Position moyenne ${position}, ${plural(page.clicks, 'clic')}.`,
        action: 'Le format fonctionne : reproduire sa structure et son angle sur des sujets voisins.',
      }
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function aggregateQueries(rows: readonly GscRawRow[], kind: (query: string) => QueryKind): TrackedQuery[] {
  const buckets = new Map<string, { clicks: number; impressions: number; weighted: number }>()
  for (const row of rows) {
    const bucket = buckets.get(row.query) ?? { clicks: 0, impressions: 0, weighted: 0 }
    bucket.clicks += row.clicks || 0
    bucket.impressions += row.impressions || 0
    bucket.weighted += (row.position || 0) * (row.impressions || 0)
    buckets.set(row.query, bucket)
  }

  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.impressions > 0)
    .map(([query, bucket]) => ({
      query,
      kind: kind(query),
      clicks: bucket.clicks,
      impressions: bucket.impressions,
      ctr: round(bucket.clicks / bucket.impressions, 4),
      position: round(bucket.weighted / bucket.impressions, 1),
    }))
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
}

function periodOf(subjectRows: readonly GscRawRow[], allRows: readonly GscRawRow[], from: string, to: string): TrackingPeriod {
  const inside = (row: GscRawRow) => row.date >= from && row.date <= to
  const all = allRows.filter(inside)
  return {
    impressions: sum(all, (row) => row.impressions),
    clicks: sum(all, (row) => row.clicks),
    position: weightedPosition(subjectRows.filter(inside)),
  }
}

function weightedPosition(rows: readonly GscRawRow[]): number | null {
  const impressions = sum(rows, (row) => row.impressions)
  if (impressions <= 0) return null
  return round(sum(rows, (row) => (row.position || 0) * (row.impressions || 0)) / impressions, 1)
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + (value(item) || 0), 0)
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return dayOf(date)
}

function daysBetweenDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function formatPosition(position: number): string {
  return position.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm : singular}`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
