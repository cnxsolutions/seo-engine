// ─────────────────────────────────────────────────────────────────────────────
// Taxonomy Context Builder
// SEO Engine - Context Enrichment
// Builds taxonomy context for RAG with WordPress/Sanity mapping
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'

/**
 * Configuration du Taxonomy Context Builder
 */
export interface TaxonomyContextConfig {
  siteId: string
  includeHierarchy?: boolean
  includeCounts?: boolean
  maxTerms?: number
}

/**
 * Info de taxonomie
 */
export interface TaxonomyInfo {
  key: string
  label: string
  hierarchical: boolean
  source: 'wordpress' | 'sanity'
  termCount: number
}

/**
 * Terme de taxonomie
 */
export interface TermInfo {
  name: string
  slug: string
  description?: string
  level: number
  parentSlug?: string
  childSlugs?: string[]
  postCount?: number
  relevanceScore?: number
}

/**
 * Suggestion de terme
 */
export interface TermSuggestion {
  name: string
  slug: string
  taxonomyKey: string
  relevanceScore: number
  source: 'existing' | 'generated' | 'competitor'
}

/**
 * Contexte taxonomique complet
 */
export interface TaxonomyContext {
  taxonomies: TaxonomyInfo[]
  terms: Record<string, TermInfo[]>
  suggestions: TermSuggestion[]
  hierarchy: TermHierarchy[]
  mapping: TaxonomyMapping[]
}

/**
 * Hiérarchie de termes
 */
export interface TermHierarchy {
  taxonomyKey: string
  rootTerms: HierarchyNode[]
}

/**
 * Noeud de hiérarchie
 */
export interface HierarchyNode {
  term: TermInfo
  children: HierarchyNode[]
  depth: number
}

/**
 * Mapping entre taxonomies
 */
export interface TaxonomyMapping {
  source: {
    key: string
    platform: 'wordpress' | 'sanity'
  }
  target: {
    key: string
    platform: 'wordpress' | 'sanity'
  }
  transformation: 'direct' | 'hierarchical' | 'custom'
  termMappings: Record<string, string>
}

/**
 * Contexte pour la génération
 */
export interface TaxonomyGenerationContext {
  primaryTerm?: TermSuggestion
  secondaryTerms: TermSuggestion[]
  categories: string[]
  tags: string[]
  suggestedTerms: string[]
  exclusionTerms: string[]
  instructions: string
}

/**
 * Service de contexte taxonomique
 */
export class TaxonomyContextBuilder {
  private supabase = createServiceClient()
  private config: TaxonomyContextConfig

  constructor(config: TaxonomyContextConfig) {
    this.config = {
      includeHierarchy: true,
      includeCounts: true,
      maxTerms: 100,
      ...config,
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Construit le contexte taxonomique complet
   */
  async buildContext(): Promise<TaxonomyContext> {
    // 1. Récupérer les taxonomies
    const taxonomies = await this.getTaxonomies()

    // 2. Récupérer les termes
    const terms = await this.getTerms(taxonomies)

    // 3. Construire la hiérarchie
    const hierarchy = this.buildHierarchy(taxonomies, terms)

    // 4. Générer des suggestions
    const suggestions = await this.generateSuggestions(terms)

    // 5. Mapper si nécessaire (cross-platform)
    const mapping = await this.getMappings()

    return {
      taxonomies,
      terms,
      suggestions,
      hierarchy,
      mapping,
    }
  }

  /**
   * Génère le contexte pour la génération de contenu
   */
  async buildGenerationContext(
    topic: string,
    keywords: string[]
  ): Promise<TaxonomyGenerationContext> {
    const context = await this.buildContext()

    // Trouver les termes pertinents
    const relevantTerms = this.findRelevantTerms(context, topic, keywords)

    // Séparer catégories et tags
    const categories = relevantTerms
      .filter(t => {
        const tax = context.taxonomies.find(tax => tax.key === t.taxonomyKey)
        return tax?.hierarchical
      })
      .map(t => t.name)

    const tags = relevantTerms
      .filter(t => {
        const tax = context.taxonomies.find(tax => tax.key === t.taxonomyKey)
        return !tax?.hierarchical
      })
      .map(t => t.name)

    // Générer les instructions
    const instructions = this.buildInstructions(context, relevantTerms)

    return {
      primaryTerm: relevantTerms[0],
      secondaryTerms: relevantTerms.slice(1, 5),
      categories: [...new Set(categories)].slice(0, 3),
      tags: [...new Set(tags)].slice(0, 10),
      suggestedTerms: relevantTerms.slice(0, 10).map(t => t.name),
      exclusionTerms: [], // Terms à éviter
      instructions,
    }
  }

  /**
   * Suggère des termes pour un topic
   */
  async suggestTermsForTopic(
    topic: string,
    limit = 5
  ): Promise<TermSuggestion[]> {
    const context = await this.buildContext()
    const relevant = this.findRelevantTerms(context, topic, [])

    return relevant.slice(0, limit)
  }

  /**
   * Valide les termes proposés
   */
  async validateTerms(
    proposedTerms: string[]
  ): Promise<{ valid: string[]; invalid: string[]; existing: string[] }> {
    const context = await this.buildContext()

    const allTerms = Object.values(context.terms).flat()
    const valid: string[] = []
    const invalid: string[] = []
    const existing: string[] = []

    for (const term of proposedTerms) {
      const normalizedTerm = term.toLowerCase().trim()
      const found = allTerms.find(
        t => t.name.toLowerCase() === normalizedTerm ||
             t.slug.toLowerCase() === normalizedTerm.replace(/\s+/g, '-')
      )

      if (found) {
        valid.push(term)
        existing.push(found.name)
      } else {
        invalid.push(term)
      }
    }

    return { valid, invalid, existing }
  }

  // ─── Private Methods ───────────────────────────────────────────────────

  private async getTaxonomies(): Promise<TaxonomyInfo[]> {
    // Try taxonomies table first
    const { data: firstData, error: firstError } = await this.supabase
      .from('taxonomies')
      .select(`
        key,
        label,
        is_hierarchical,
        content_types (
          key
        )
      `)
      .eq('content_type_id', this.config.siteId)

    // Use first query result if successful
    let data = firstData ?? null
    let error = firstError

    // Fall back to getting all taxonomies if site-specific query fails
    if (error || !data || data.length === 0) {
      const result = await this.supabase
        .from('taxonomies')
        .select(`
          key,
          label,
          is_hierarchical
        `)
        .limit(this.config.maxTerms ?? 50)

      data = result.data as typeof firstData
      error = result.error
    }

    if (error || !data || data.length === 0) {
      return []
    }

    // Compter les termes par taxonomie
    const taxonomiesWithCounts = await Promise.all(
      (data || []).map(async (tax) => {
        let count: number | null = null
        try {
          const result = await this.supabase
            .from('taxonomy_terms')
            .select('id', { count: 'exact', head: true })
            .eq('taxonomy_id', (tax as unknown as { id: string }).id)
          count = result.count
        } catch {
          count = null
        }

        return {
          key: tax.key,
          label: tax.label,
          hierarchical: tax.is_hierarchical || false,
          source: 'wordpress' as const,
          termCount: count || 0,
        }
      })
    )

    return taxonomiesWithCounts
  }

  private async getTerms(taxonomies: TaxonomyInfo[]): Promise<Record<string, TermInfo[]>> {
    const terms: Record<string, TermInfo[]> = {}

    for (const taxonomy of taxonomies) {
      const { data, error } = await this.supabase
        .from('taxonomy_terms')
        .select('*')
        .eq('taxonomy_id', taxonomy.key) // Note: devrait utiliser l'ID réel
        .order('level', { ascending: true })
        .limit(this.config.maxTerms ?? 50)

      if (error || !data) {
        continue
      }

      terms[taxonomy.key] = (data || []).map(term => ({
        name: term.name,
        slug: term.slug,
        description: term.description,
        level: term.level,
        parentSlug: term.parent_remote_id
          ? this.getParentSlug(term.parent_remote_id, data)
          : undefined,
        postCount: term.count,
      }))
    }

    return terms
  }

  private buildHierarchy(
    taxonomies: TaxonomyInfo[],
    terms: Record<string, TermInfo[]>
  ): TermHierarchy[] {
    const hierarchies: TermHierarchy[] = []

    for (const taxonomy of taxonomies) {
      if (!taxonomy.hierarchical || !terms[taxonomy.key]) {
        continue
      }

      const taxonomyTerms = terms[taxonomy.key]
      const rootTerms = taxonomyTerms.filter(t => t.level === 0)

      const buildNode = (term: TermInfo): HierarchyNode => {
        const children = taxonomyTerms.filter(t => t.parentSlug === term.slug)
        return {
          term,
          children: children.map(buildNode),
          depth: term.level,
        }
      }

      hierarchies.push({
        taxonomyKey: taxonomy.key,
        rootTerms: rootTerms.map(buildNode),
      })
    }

    return hierarchies
  }

  private async generateSuggestions(
    terms: Record<string, TermInfo[]>
  ): Promise<TermSuggestion[]> {
    const suggestions: TermSuggestion[] = []
    const allTerms = Object.values(terms).flat()

    // Trier par count (les plus populaires en premier)
    const sorted = allTerms.sort((a, b) => (b.postCount || 0) - (a.postCount || 0))

    for (const term of sorted.slice(0, 20)) {
      // Trouver la taxonomie
      let taxonomyKey = ''
      for (const [key, termList] of Object.entries(terms)) {
        if (termList.some(t => t.slug === term.slug)) {
          taxonomyKey = key
          break
        }
      }

      suggestions.push({
        name: term.name,
        slug: term.slug,
        taxonomyKey,
        relevanceScore: (term.postCount || 0) / 100, // Normaliser
        source: 'existing',
      })
    }

    return suggestions
  }

  private findRelevantTerms(
    context: TaxonomyContext,
    topic: string,
    keywords: string[]
  ): TermSuggestion[] {
    const allTerms = context.suggestions
    const topicLower = topic.toLowerCase()
    const keywordFilters = keywords.map(k => k.toLowerCase())

    // Scoring
    const scored = allTerms.map(term => {
      let score = term.relevanceScore

      // Bonus si le nom contient le topic
      if (term.name.toLowerCase().includes(topicLower)) {
        score += 0.5
      }

      // Bonus si contient un keyword
      for (const keyword of keywordFilters) {
        if (term.name.toLowerCase().includes(keyword)) {
          score += 0.3
        }
      }

      return { ...term, score }
    })

    // Trier par score
    scored.sort((a, b) => b.score - a.score)

    return scored.map(({ score, ...rest }) => ({
      ...rest,
      relevanceScore: score,
    }))
  }

  private buildInstructions(
    context: TaxonomyContext,
    relevantTerms: TermSuggestion[]
  ): string {
    const parts: string[] = []

    if (relevantTerms.length > 0) {
      const primary = relevantTerms[0]
      parts.push(`Terme principal suggéré: ${primary.name}`)

      if (relevantTerms.length > 1) {
        const secondary = relevantTerms.slice(1, 4).map(t => t.name).join(', ')
        parts.push(`Termes secondaires suggérés: ${secondary}`)
      }
    }

    // Ajouter la hiérarchie si pertinent
    const hierarchicalTerms = relevantTerms.filter(t => {
      const tax = context.taxonomies.find(tax => tax.key === t.taxonomyKey)
      return tax?.hierarchical
    })

    if (hierarchicalTerms.length > 0) {
      parts.push('Catégories hiérarchiques à considérer pour la structure.')
    }

    return parts.join('\n')
  }

  private getParentSlug(parentId: number, terms: Array<{ remote_id: number; slug: string }>): string | undefined {
    const parent = terms.find(t => t.remote_id === parentId)
    return parent?.slug
  }

  private async getMappings(): Promise<TaxonomyMapping[]> {
    // TODO: Implémenter la logique de mapping cross-platform
    return []
  }
}

// ─── Universal Taxonomy Mapper ────────────────────────────────────────────────

/**
 * Mapper pour convertir entre taxonomies WordPress et Sanity
 */
export class UniversalTaxonomyMapper {
  /**
   * Convertit des termes WordPress vers le format Sanity
   */
  static async wordpressToSanity(
    wordpressTerms: Array<{ id: number; name: string; slug: string }>,
    mapping: TaxonomyMapping[]
  ): Promise<Array<{ _type: 'reference'; _ref: string }>> {
    // TODO: Implémenter la logique de conversion
    return wordpressTerms.map(term => ({
      _type: 'reference',
      _ref: `sanity-term-${term.slug}`,
    }))
  }

  /**
   * Génère un mapping automatique basé sur les similitudes
   */
  static async generateMapping(
    sourceTaxonomies: TaxonomyInfo[],
    targetTaxonomies: TaxonomyInfo[]
  ): Promise<TaxonomyMapping[]> {
    const mappings: TaxonomyMapping[] = []

    // Match par similarité de nom
    for (const source of sourceTaxonomies) {
      for (const target of targetTaxonomies) {
        const similarity = this.calculateSimilarity(source.label, target.label)
        if (similarity > 0.5) {
          mappings.push({
            source: { key: source.key, platform: source.source },
            target: { key: target.key, platform: target.source },
            transformation: similarity > 0.8 ? 'direct' : 'custom',
            termMappings: {},
          })
        }
      }
    }

    return mappings
  }

  private static calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase()
    const s2 = str2.toLowerCase()

    if (s1 === s2) return 1
    if (s1.includes(s2) || s2.includes(s1)) return 0.8

    // Jaccard similarity sur les mots
    const words1 = new Set(s1.split(/\s+/))
    const words2 = new Set(s2.split(/\s+/))
    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])

    return intersection.size / union.size
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createTaxonomyContextBuilder(config: TaxonomyContextConfig): TaxonomyContextBuilder {
  return new TaxonomyContextBuilder(config)
}
