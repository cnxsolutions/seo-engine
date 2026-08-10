// ─────────────────────────────────────────────────────────────────────────────
// SERP evidence — public API
// SEO Engine - What the planner calls to stop guessing.
// ─────────────────────────────────────────────────────────────────────────────
//
// Everything here degrades to null rather than throwing: reading the SERP is
// enrichment, and a plan must still be produced when it cannot be read.

export { buildSerpEvidence, findCommonSections, median, MEASURED_RESULTS } from './evidence'
export { getSerpSnapshot, pruneSerpSnapshots, normalizeQuery, SERP_FRESHNESS_DAYS, SERP_RETENTION_DAYS } from './cache'
export { SerpUnavailableError } from './fetch'
export type {
  SerpEvidence,
  SerpOrganicResult,
  SerpParseResult,
  SerpSnapshot,
  RankingPageMeasurement,
} from './types'
