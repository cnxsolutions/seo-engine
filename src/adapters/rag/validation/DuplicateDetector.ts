// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Detection
// SEO Engine - Validation Pipeline
// Detects duplicate and near-duplicate content
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration de détection de duplicats
 */
export interface DuplicateDetectionConfig {
  // Seuil de similarité (0-1)
  similarityThreshold?: number
  // Méthode de comparaison
  method?: 'cosine' | 'jaccard' | 'levenshtein'
  // Inclure les variantes (pluriel/singulier, etc.)
  normalizeText?: boolean
  // Longueur minimale pour comparer
  minLength?: number
  // Ignorer le contenu boilerplate
  ignoreBoilerplate?: boolean
  // Liste de patterns à ignorer
  boilerplatePatterns?: (string | RegExp)[]
}

/**
 * Résultat de détection de duplicats
 */
export interface DuplicateDetectionResult {
  hasDuplicates: boolean
  duplicates: DuplicateMatch[]
  stats: DuplicateStats
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

/**
 * Détecteur de duplicats
 */
export class DuplicateDetector {
  private config: DuplicateDetectionConfig

  constructor(config: DuplicateDetectionConfig = {}) {
    this.config = {
      similarityThreshold: 0.85,
      method: 'cosine',
      normalizeText: true,
      minLength: 100,
      ignoreBoilerplate: true,
      boilerplatePatterns: [
        /copyright\s*©?\s*\d{4}/gi,
        /all\s*rights\s*reserved/gi,
        /subscribe\s*to\s*our\s*newsletter/gi,
        /share\s*on\s*(facebook|twitter|linkedin)/gi,
        /read\s*more:/gi,
        /click\s*here/gi,
      ],
      ...config,
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Trouve les duplicats dans une liste de contenus
   */
  async findDuplicates(
    contents: ContentToCheck[]
  ): Promise<DuplicateDetectionResult> {
    const startTime = Date.now()
    const duplicates: DuplicateMatch[] = []
    let exactCount = 0
    let nearCount = 0
    let partialCount = 0

    // Préparer les contenus
    const prepared = contents.map(c => ({
      ...c,
      normalizedContent: this.normalizeText(c.content),
      normalizedTitle: this.normalizeText(c.title),
    }))

    // Comparer chaque paire
    for (let i = 0; i < prepared.length; i++) {
      for (let j = i + 1; j < prepared.length; j++) {
        const source = prepared[i]
        const target = prepared[j]

        // Ignorer si trop court
        if (source.normalizedContent.length < (this.config.minLength || 100)) {
          continue
        }

        const similarity = this.calculateSimilarity(
          source.normalizedContent,
          target.normalizedContent
        )

        if (similarity >= (this.config.similarityThreshold || 0.85)) {
          const { sharedPhrases, differences } = this.analyzeContentDiff(
            source.normalizedContent,
            target.normalizedContent
          )

          let matchType: DuplicateMatch['matchType'] = 'partial'
          if (similarity >= 0.98) {
            matchType = 'exact'
            exactCount++
          } else if (similarity >= 0.9) {
            matchType = 'near'
            nearCount++
          } else {
            partialCount++
          }

          duplicates.push({
            sourceId: source.id,
            sourceTitle: source.title,
            targetId: target.id,
            targetTitle: target.title,
            similarity,
            matchType,
            sharedPhrases,
            differences,
          })
        }
      }
    }

    // Trier par similarité décroissante
    duplicates.sort((a, b) => b.similarity - a.similarity)

    return {
      hasDuplicates: duplicates.length > 0,
      duplicates,
      stats: {
        totalChecked: contents.length,
        exactDuplicates: exactCount,
        nearDuplicates: nearCount,
        partialMatches: partialCount,
        processingTimeMs: Date.now() - startTime,
      },
    }
  }

  /**
   * Vérifie si un contenu est un duplicat d'un contenu existant
   */
  async isDuplicate(
    newContent: ContentToCheck,
    existingContents: ContentToCheck[]
  ): Promise<{ isDuplicate: boolean; match?: DuplicateMatch }> {
    const result = await this.findDuplicates([newContent, ...existingContents])

    const match = result.duplicates.find(
      d => d.sourceId === newContent.id || d.targetId === newContent.id
    )

    return {
      isDuplicate: !!match,
      match,
    }
  }

  /**
   * Calcule la similarité entre deux textes
   */
  calculateSimilarity(text1: string, text2: string): number {
    switch (this.config.method) {
      case 'cosine':
        return this.cosineSimilarity(text1, text2)
      case 'jaccard':
        return this.jaccardSimilarity(text1, text2)
      case 'levenshtein':
        return this.levenshteinSimilarity(text1, text2)
      default:
        return this.cosineSimilarity(text1, text2)
    }
  }

  // ─── Private Methods ────────────────────────────────────────────────

  private normalizeText(text: string): string {
    if (!this.config.normalizeText) return text

    let normalized = text.toLowerCase()

    // Supprimer le HTML
    normalized = normalized.replace(/<[^>]*>/g, ' ')
    normalized = normalized.replace(/\s+/g, ' ')

    // Supprimer la ponctuation excessive
    normalized = normalized.replace(/[^\w\s]/g, ' ')

    // Supprimer les boilerplates
    if (this.config.ignoreBoilerplate) {
      for (const pattern of this.config.boilerplatePatterns || []) {
        normalized = normalized.replace(pattern, ' ')
      }
    }

    // Normaliser les espaces
    normalized = normalized.replace(/\s+/g, ' ').trim()

    return normalized
  }

  private cosineSimilarity(text1: string, text2: string): number {
    const words1 = text1.split(' ').filter(w => w.length > 2)
    const words2 = text2.split(' ').filter(w => w.length > 2)

    if (words1.length === 0 || words2.length === 0) return 0

    // Créer les vecteurs
    const allWords = new Set([...words1, ...words2])
    const vector1 = this.createVector(words1, allWords)
    const vector2 = this.createVector(words2, allWords)

    // Calculer la similarité cosinus
    const dotProduct = vector1.reduce((sum, v, i) => sum + v * vector2[i], 0)
    const magnitude1 = Math.sqrt(vector1.reduce((sum, v) => sum + v * v, 0))
    const magnitude2 = Math.sqrt(vector2.reduce((sum, v) => sum + v * v, 0))

    if (magnitude1 === 0 || magnitude2 === 0) return 0

    return dotProduct / (magnitude1 * magnitude2)
  }

  private createVector(words: string[], vocabulary: Set<string>): number[] {
    const wordCount = new Map<string, number>()
    for (const word of words) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1)
    }

    return Array.from(vocabulary).map(word => wordCount.get(word) || 0)
  }

  private jaccardSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(' ').filter(w => w.length > 2))
    const words2 = new Set(text2.split(' ').filter(w => w.length > 2))

    if (words1.size === 0 || words2.size === 0) return 0

    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])

    return intersection.size / union.size
  }

  private levenshteinSimilarity(text1: string, text2: string): number {
    // Pour les textes longs, utiliser une version simplifiée
    if (text1.length > 1000 || text2.length > 1000) {
      // Échantillonner les premiers 1000 caractères
      return this.levenshteinRatio(
        text1.substring(0, 1000),
        text2.substring(0, 1000)
      )
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
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0))

    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1]
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
        }
      }
    }

    return dp[m][n]
  }

  private analyzeContentDiff(
    text1: string,
    text2: string
  ): { sharedPhrases: string[]; differences: string[] } {
    const words1 = text1.split(' ').filter(w => w.length > 4)
    const words2 = text2.split(' ').filter(w => w.length > 4)

    const set1 = new Set(words1)
    const set2 = new Set(words2)

    // Phrases partagées (basées sur les mots)
    const sharedWords = [...set1].filter(w => set2.has(w))
    const sharedPhrases = this.extractSharedPhrases(sharedWords, words1, words2)

    // Différences
    const uniqueTo1 = [...set1].filter(w => !set2.has(w)).slice(0, 5)
    const uniqueTo2 = [...set2].filter(w => !set1.has(w)).slice(0, 5)

    const differences = [
      ...uniqueTo1.map(w => `Only in source: "${w}"`),
      ...uniqueTo2.map(w => `Only in target: "${w}"`),
    ]

    return { sharedPhrases, differences }
  }

  private extractSharedPhrases(
    sharedWords: string[],
    words1: string[],
    words2: string[]
  ): string[] {
    const phrases: string[] = []

    // Trouver des bigrams partagés
    for (let i = 0; i < words1.length - 1; i++) {
      const bigram1 = words1.slice(i, i + 2).join(' ')
      const bigram2 = words2.slice(i, i + 2).join(' ')

      if (bigram1 === bigram2 && sharedWords.some(w => bigram1.includes(w))) {
        phrases.push(bigram1)
      }
    }

    // Retourner les 5 plus significatives
    return [...new Set(phrases)].slice(0, 5)
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createDuplicateDetector(
  config?: DuplicateDetectionConfig
): DuplicateDetector {
  return new DuplicateDetector(config)
}
