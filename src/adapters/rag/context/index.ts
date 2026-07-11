// ─────────────────────────────────────────────────────────────────────────────
// Context Module Index
// SEO Engine - Context Enrichment
// ─────────────────────────────────────────────────────────────────────────────

// Taxonomy Context
export {
  TaxonomyContextBuilder,
  UniversalTaxonomyMapper,
  createTaxonomyContextBuilder,
  type TaxonomyContextConfig,
  type TaxonomyInfo,
  type TermInfo,
  type TermSuggestion,
  type TaxonomyContext,
  type TermHierarchy,
  type HierarchyNode,
  type TaxonomyMapping,
  type TaxonomyGenerationContext,
} from './TaxonomyContextBuilder'

// Competitor Context
export {
  CompetitorContextBuilder,
  createCompetitorContextBuilder,
  type CompetitorContextConfig,
  type CompetitorAnalysis,
  type KeywordAnalysis,
  type ContentTypeAnalysis,
  type ContentWeakness,
  type ContentStrength,
  type ContentGap,
  type CompetitorCoverage,
  type ContentOpportunity,
  type CompetitorContext,
  type ContentRecommendation,
} from './CompetitorContextBuilder'

// Google Context
export {
  GoogleContextBuilder,
  createGoogleContextBuilder,
  type GoogleContextConfig,
  type GscData,
  type GscQuery,
  type GscPage,
  type GscDailyData,
  type GscOpportunity,
  type GbpData,
  type GbpReview,
  type ReviewsSummary,
  type GbpPost,
  type GbpQnA,
  type GbpInsights,
  type GoogleContext,
  type LocalSeoScore,
  type LocalOpportunity,
  type GoogleRecommendation,
  type GoogleGenerationContext,
} from './GoogleContextBuilder'

// Unified Context Aggregator
export {
  UnifiedContextAggregator,
  createUnifiedContextAggregator,
  type UnifiedContextConfig,
  type ContextSourcesConfig,
  type UnifiedContext,
  type SiteContext,
  type TaxonomyContextData,
  type CompetitorContextData,
  type ContentGapSummary,
  type OpportunitySummary,
  type GoogleContextData,
  type RagContextData,
  type SimilarExample,
  type InternalLinkSuggestion,
  type AggregatedKeywords,
  type KeywordOpportunity,
  type AggregatedTopics,
  type FullGenerationContext,
  type ContextMetadata,
  type ContextSource,
} from './UnifiedContextAggregator'
