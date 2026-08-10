// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Detection
// SEO Engine - Validation Pipeline
// Detects duplicate and near-duplicate content
// ─────────────────────────────────────────────────────────────────────────────

import {
  contentTokens,
  cosineSimilarityOfTokens,
  jaccardIndex,
  normalizeForMatch,
  stripHtmlToText,
  wordShingles,
} from './text-utils'

/**
 * WHAT THIS DETECTOR ACTUALLY SEES — stated plainly, because the answer changes
 * how much you should trust it:
 *
 *   It compares LEXICAL overlap. Bag-of-words cosine catches "same vocabulary",
 *   word n-grams ("shingles") catch real copy-paste, title and intent overlap
 *   catch cannibalisation. It is NOT semantic: two pages that say the same thing
 *   with different words score low, and no amount of tuning here fixes that.
 *
 *   The semantic layer belongs to the vector store (embeddings + cosine on the
 *   `page_embeddings` index). When it exists, feed its neighbours in as
 *   `candidates` and this detector becomes the cheap, deterministic confirmation
 *   step on top of it.
 */

/**
 * Configuration de détection de duplicats
 */
export interface DuplicateDetectionConfig {
  /** Similarity at or above which a pair is reported. */
  similarityThreshold?: number
  /** Similarity classified as a near duplicate. Default 0.9. */
  nearDuplicateThreshold?: number
  /** Similarity classified as an exact duplicate. Default 0.98. */
  exactDuplicateThreshold?: number
  /** Title similarity that flags cannibalisation on its own. Default 0.9. */
  titleSimilarityThreshold?: number
  // Méthode de comparaison
  method?: 'cosine' | 'jaccard' | 'levenshtein' | 'shingle' | 'composite'
  /** Word n-gram size used by the shingle comparison. Default 4. */
  shingleSize?: number
  // Inclure les variantes (pluriel/singulier, etc.)
  normalizeText?: boolean
  // Longueur minimale pour comparer
  minLength?: number
  // Ignorer le contenu boilerplate
  ignoreBoilerplate?: boolean
  // Liste de patterns à ignorer
  boilerplatePatterns?: (string | RegExp)[]
  /** Upper bound on candidates compared against a target. Default 300. */
  maxCandidates?: number
}

/**
 * Résultat de détection de duplicats
 */
export interface DuplicateDetectionResult {
  hasDuplicates: boolean
  duplicates: DuplicateMatch[]
  stats: DuplicateStats
}

/** Individual similarity signals behind a match. */
export interface DuplicateSignals {
  /** Bag-of-words cosine over topical tokens. */
  content: number
  /** Jaccard over word n-grams: high means literal reuse. */
  shingle: number
  /** Cosine over title tokens. */
  title: number
  /** Overlap of detected search intents. */
  intent: number
}

/**
 * Correspondance de duplicat
 */
export interface DuplicateMatch {
  sourceId: string
  sourceTitle: string
  targetId: string
  targetTitle: string
  similarity: number
  matchType: 'exact' | 'near' | 'partial'
  sharedPhrases: string[]
  differences: string[]
  // ─── Added in wave 2 (optional: purely additive) ───
  signals?: DuplicateSignals
  /** Why the pair was reported: literal overlap, or same title/intent. */
  reason?: 'content' | 'cannibalization'
}

/**
 * Statistiques de détection
 */
export interface DuplicateStats {
  totalChecked: number
  exactDuplicates: number
  nearDuplicates: number
  partialMatches: number
  processingTimeMs: number
}

/**
 * Contenu à comparer
 */
export interface ContentToCheck {
  id: string
  title: string
  content: string
  url?: string
  publishedAt?: string
}

/** Internal, pre-tokenized view of a content item. */
interface PreparedContent extends ContentToCheck {
  normalizedContent: string
  normalizedTitle: string
  tokens: string[]
  shingles: Set<string>
  titleTokens: string[]
  intents: Set<string>
}

/**
 * Search-intent markers. Two pages that target the same intent with the same
 * title cannibalise each other even when their prose differs — which is exactly
 * the failure mode of a generator producing one page per city.
 */
const INTENT_MARKERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'question', pattern: /\b(comment|pourquoi|quand|quel|quelle|quels|quelles|combien)\b/ },
  { name: 'transactional', pattern: /\b(prix|tarif|tarifs|devis|cout|couts|acheter|commander|reserver|urgence|depannage|pas cher)\b/ },
  { name: 'comparison', pattern: /\b(comparatif|comparaison|meilleur|meilleure|meilleurs|top|versus|alternative|alternatives)\b/ },
  { name: 'local', pattern: /\b(pres de moi|a proximite|proximite|quartier|autour de moi|alentours)\b/ },
  { name: 'informational', pattern: /\b(guide|definition|etapes|conseils|astuces|tout savoir|checklist)\b/ },
]

/**
 * Détecteur de duplicats
 */
export class DuplicateDetector {
  private config: DuplicateDetectionConfig

  constructor(config: DuplicateDetectionConfig = {}) {
    this.config = {
      similarityThreshold: 0.85,
      nearDuplicateThreshold: 0.9,
      exactDuplicateThreshold: 0.98,
      titleSimilarityThreshold: 0.9,
      method: 'composite',
      shingleSize: 4,
      normalizeText: true,
      minLength: 100,
      ignoreBoilerplate: true,
      boilerplatePatterns: [
        /copyright\s*©?\s*\d{4}/gi,
        /all\s*rights\s*reserved/gi,
        /tous\s*droits\s*reserves/gi,
        /subscribe\s*to\s*our\s*newsletter/gi,
        /share\s*on\s*(facebook|twitter|linkedin)/gi,
        /read\s*more:/gi,
        /click\s*here/gi,
        /nous\s*contacter/gi,
        /demander\s*un\s*devis\s*gratuit/gi,
      ],
      maxCandidates: 300,
      ...config,
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Trouve les duplicats dans une liste de contenus.
   *
   * Compares every pair, so the cost is quadratic. Prefer `findDuplicatesFor`
   * when only one new page has to be cleared for publication: it is linear, and
   * it does not report duplicates BETWEEN two already-published pages — which
   * used to make `hasDuplicates` true and block a perfectly original article.
   */
  async findDuplicates(contents: ContentToCheck[]): Promise<DuplicateDetectionResult> {
    const startTime = Date.now()
    const prepared = contents.map(c => this.prepare(c))
    const duplicates: DuplicateMatch[] = []

    for (let i = 0; i < prepared.length; i++) {
      for (let j = i + 1; j < prepared.length; j++) {
        const match = this.compare(prepared[i], prepared[j])
        if (match) duplicates.push(match)
      }
    }

    return this.buildResult(duplicates, contents.length, startTime)
  }

  /**
   * Compares ONE target against a candidate list. This is the shape the
   * publication gate needs: "is this new page a duplicate of something we
   * already published?"
   */
  async findDuplicatesFor(
    target: ContentToCheck,
    candidates: ContentToCheck[]
  ): Promise<DuplicateDetectionResult> {
    const startTime = Date.now()
    const limit = this.config.maxCandidates ?? 300
    const shortlist = candidates.slice(0, limit)

    const preparedTarget = this.prepare(target)
    const duplicates: DuplicateMatch[] = []

    for (const candidate of shortlist) {
      if (candidate.id === target.id) continue
      const match = this.compare(preparedTarget, this.prepare(candidate))
      if (match) duplicates.push(match)
    }

    return this.buildResult(duplicates, shortlist.length + 1, startTime)
  }

  /**
   * Vérifie si un contenu est un duplicat d'un contenu existant
   */
  async isDuplicate(
    newContent: ContentToCheck,
    existingContents: ContentToCheck[]
  ): Promise<{ isDuplicate: boolean; match?: DuplicateMatch }> {
    const result = await this.findDuplicatesFor(newContent, existingContents)
    const match = result.duplicates[0]

    return {
      isDuplicate: !!match,
      match,
    }
  }

  /**
   * Calcule la similarité entre deux textes
   */
  calculateSimilarity(text1: string, text2: string): number {
    const tokens1 = contentTokens(this.normalizeText(text1))
    const tokens2 = contentTokens(this.normalizeText(text2))

    switch (this.config.method) {
      case 'cosine':
        return cosineSimilarityOfTokens(tokens1, tokens2)
      case 'jaccard':
        return jaccardIndex(new Set(tokens1), new Set(tokens2))
      case 'levenshtein':
        return this.levenshteinSimilarity(this.normalizeText(text1), this.normalizeText(text2))
      case 'shingle':
        return this.shingleSimilarity(tokens1, tokens2)
      case 'composite':
      default:
        return Math.max(
          cosineSimilarityOfTokens(tokens1, tokens2),
          this.shingleSimilarity(tokens1, tokens2)
        )
    }
  }

  // ─── Private Methods ────────────────────────────────────────────────

  private prepare(content: ContentToCheck): PreparedContent {
    const normalizedContent = this.normalizeText(content.content)
    const normalizedTitle = this.normalizeText(content.title)
    const tokens = contentTokens(normalizedContent)

    return {
      ...content,
      normalizedContent,
      normalizedTitle,
      tokens,
      shingles: wordShingles(tokens, this.config.shingleSize ?? 4),
      titleTokens: contentTokens(normalizedTitle),
      intents: detectIntents(`${normalizedTitle} ${normalizedContent.slice(0, 800)}`),
    }
  }

  /**
   * Compares a prepared pair and returns a match, or null when they are
   * distinct enough.
   */
  private compare(source: PreparedContent, target: PreparedContent): DuplicateMatch | null {
    const minLength = this.config.minLength ?? 100
    if (
      source.normalizedContent.length < minLength ||
      target.normalizedContent.length < minLength
    ) {
      return null
    }

    const signals: DuplicateSignals = {
      content: cosineSimilarityOfTokens(source.tokens, target.tokens),
      shingle: jaccardIndex(source.shingles, target.shingles),
      title: cosineSimilarityOfTokens(source.titleTokens, target.titleTokens),
      intent: jaccardIndex(source.intents, target.intents),
    }

    const similarity = this.similarityFromSignals(source, target, signals)
    const reportThreshold = this.config.similarityThreshold ?? 0.85
    const titleThreshold = this.config.titleSimilarityThreshold ?? 0.9

    const isContentDuplicate = similarity >= reportThreshold
    const isCannibalization =
      !isContentDuplicate &&
      signals.title >= titleThreshold &&
      signals.intent >= 0.5 &&
      signals.content >= 0.4

    if (!isContentDuplicate && !isCannibalization) return null

    const { sharedPhrases, differences } = this.analyzeContentDiff(source, target)

    let matchType: DuplicateMatch['matchType'] = 'partial'
    if (isContentDuplicate) {
      if (similarity >= (this.config.exactDuplicateThreshold ?? 0.98)) matchType = 'exact'
      else if (similarity >= (this.config.nearDuplicateThreshold ?? 0.9)) matchType = 'near'
    }

    return {
      sourceId: source.id,
      sourceTitle: source.title,
      targetId: target.id,
      targetTitle: target.title,
      similarity,
      matchType,
      sharedPhrases,
      differences,
      signals,
      reason: isContentDuplicate ? 'content' : 'cannibalization',
    }
  }

  private similarityFromSignals(
    source: PreparedContent,
    target: PreparedContent,
    signals: DuplicateSignals
  ): number {
    switch (this.config.method) {
      case 'cosine':
        return signals.content
      case 'jaccard':
        return jaccardIndex(new Set(source.tokens), new Set(target.tokens))
      case 'levenshtein':
        return this.levenshteinSimilarity(source.normalizedContent, target.normalizedContent)
      case 'shingle':
        return signals.shingle
      case 'composite':
      default:
        return Math.max(signals.content, signals.shingle)
    }
  }

  /**
   * Normalisation.
   *
   * Boilerplate is now stripped BEFORE punctuation, otherwise a pattern like
   * `/copyright\s*©?\s*\d{4}/` could never match: the © and the digits had
   * already been replaced by spaces.
   */
  private normalizeText(text: string): string {
    if (!this.config.normalizeText) return text || ''

    let normalized = stripHtmlToText(text || '')

    if (this.config.ignoreBoilerplate) {
      for (const pattern of this.config.boilerplatePatterns || []) {
        normalized = normalized.replace(pattern, ' ')
      }
    }

    return normalizeForMatch(normalized)
  }

  private shingleSimilarity(tokens1: string[], tokens2: string[]): number {
    const size = this.config.shingleSize ?? 4
    return jaccardIndex(wordShingles(tokens1, size), wordShingles(tokens2, size))
  }

  private levenshteinSimilarity(text1: string, text2: string): number {
    // Levenshtein is O(n*m); cap the comparison window on long documents.
    if (text1.length > 1000 || text2.length > 1000) {
      return this.levenshteinRatio(text1.substring(0, 1000), text2.substring(0, 1000))
    }

    return this.levenshteinRatio(text1, text2)
  }

  private levenshteinRatio(str1: string, str2: string): number {
    const distance = this.levenshteinDistance(str1, str2)
    const maxLength = Math.max(str1.length, str2.length)

    if (maxLength === 0) return 1

    return 1 - distance / maxLength
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length
    const n = str2.length

    // Two rolling rows instead of a full (m+1)x(n+1) matrix.
    let previous = new Array<number>(n + 1)
    let current = new Array<number>(n + 1)

    for (let j = 0; j <= n; j++) previous[j] = j

    for (let i = 1; i <= m; i++) {
      current[0] = i
      for (let j = 1; j <= n; j++) {
        current[j] = str1[i - 1] === str2[j - 1]
          ? previous[j - 1]
          : 1 + Math.min(previous[j], current[j - 1], previous[j - 1])
      }
      const swap = previous
      previous = current
      current = swap
    }

    return previous[n]
  }

  /**
   * Shared n-grams and distinctive vocabulary.
   *
   * The previous version compared bigrams AT THE SAME INDEX in both documents,
   * so shifting a single word made every subsequent phrase look different. It
   * now intersects the shingle sets, which is position independent.
   */
  private analyzeContentDiff(
    source: PreparedContent,
    target: PreparedContent
  ): { sharedPhrases: string[]; differences: string[] } {
    const shared: string[] = []
    for (const shingle of source.shingles) {
      if (target.shingles.has(shingle)) {
        shared.push(shingle)
        if (shared.length >= 5) break
      }
    }

    const sourceSet = new Set(source.tokens)
    const targetSet = new Set(target.tokens)
    const uniqueToSource = [...sourceSet].filter(w => !targetSet.has(w)).slice(0, 5)
    const uniqueToTarget = [...targetSet].filter(w => !sourceSet.has(w)).slice(0, 5)

    return {
      sharedPhrases: shared,
      differences: [
        ...uniqueToSource.map(w => `Only in source: "${w}"`),
        ...uniqueToTarget.map(w => `Only in target: "${w}"`),
      ],
    }
  }

  private buildResult(
    duplicates: DuplicateMatch[],
    totalChecked: number,
    startTime: number
  ): DuplicateDetectionResult {
    duplicates.sort((a, b) => b.similarity - a.similarity)

    return {
      hasDuplicates: duplicates.length > 0,
      duplicates,
      stats: {
        totalChecked,
        exactDuplicates: duplicates.filter(d => d.matchType === 'exact').length,
        nearDuplicates: duplicates.filter(d => d.matchType === 'near').length,
        partialMatches: duplicates.filter(d => d.matchType === 'partial').length,
        processingTimeMs: Date.now() - startTime,
      },
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Detects which search intents a normalized text targets. */
function detectIntents(normalizedText: string): Set<string> {
  const intents = new Set<string>()
  for (const marker of INTENT_MARKERS) {
    if (marker.pattern.test(normalizedText)) intents.add(marker.name)
  }
  return intents
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createDuplicateDetector(
  config?: DuplicateDetectionConfig
): DuplicateDetector {
  return new DuplicateDetector(config)
}
