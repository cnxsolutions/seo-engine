// ─────────────────────────────────────────────────────────────────────────────
// Extractors Index
// Exports all schema extractor adapters
// ─────────────────────────────────────────────────────────────────────────────

// WordPress Extractors
export {
  WordPressExtractor,
  WordPressRestExtractor,
  AcfExtractor,
  SeoMetaExtractor,
  createWordPressExtractor,
} from './wordpress/WordPressExtractor'

// Sanity Extractors
export {
  SanityExtractor,
  SanityClient,
  SanityTypeAnalyzer,
  createSanityExtractor,
} from './sanity/SanityExtractor'
