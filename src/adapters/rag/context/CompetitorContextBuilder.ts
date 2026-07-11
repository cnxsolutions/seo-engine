// ─────────────────────────────────────────────────────────────────────────────
// Competitor Context Module
// SEO Engine - Context Enrichment
// Integrates competitor analysis data into RAG context
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { analyzeCompetitors } from '@/lib/analyzer/competitive'

/**
 * Configuration du Competitor Context
 */
export interface CompetitorContextConfig {
  siteId: string
  targetKeywords: string[]
  maxCompetitors?: number
  includeGaps?: boolean
  includeOpportunities?: boolean
}

/**
 * Analyse concurrent
 */
export interface CompetitorAnalysis {
  domain: string
  domainAuthority?: number
  pageCount?: number
  topKeywords: KeywordAnalysis[]
  contentTypes: ContentTypeAnalysis[]
  weaknesses: ContentWeakness[]
  strengths: ContentStrength[]
}

/**
 * Analyse de keyword
 */
export interface KeywordAnalysis {
  keyword: string
  position?: number
  volume?: number
  difficulty?: number
  competitorUrls: string[]
  gapOpportunity: 'high' | 'medium' | 'low'
}

/**
 * Analyse de type de contenu
 */
export interface ContentTypeAnalysis {
  type: string
  count: number
  averageWordCount: number
  averagePosition?: number
  coverage: 'high' | 'medium' | 'low'
}

/**
 * Faiblesse de contenu concurrent
 */
export interface ContentWeakness {
  topic: string
  description: string
  opportunity: string
  severity: 'high' | 'medium' | 'low'
}

/**
 * Force de contenu concurrent
 */
export interface ContentStrength {
  topic: string
  description: string
  whatTheyDoWell: string[]
}

/**
 * Lacune de contenu (keywords sans contenu)
 */
export interface ContentGap {
  keyword: string
  competitorCoverage: CompetitorCoverage[]
  recommendedApproach: string
  priority: 'high' | 'medium' | 'low'
  estimatedEffort: 'low' | 'medium' | 'high'
}

/**
 * Couverture par concurrent
 */
export interface CompetitorCoverage {
  domain: string
  hasContent: boolean
  position?: number
  contentQuality?: 'excellent' | 'good' | 'average' | 'poor'
}

/**
 * Opportunité de contenu
 */
export interface ContentOpportunity {
  keyword: string
  intent: 'informational' | 'transactional' | 'navigational'
  competition: 'low' | 'medium' | 'high'
  suggestedFormat: 'article' | 'guide' | 'list' | 'comparison' | 'tutorial'
  competitorsToBeat: string[]
  keyDifferentiators: string[]
}

/**
 * Contexte concurrent complet
 */
export interface CompetitorContext {
  targetKeywords: string[]
  competitors: CompetitorAnalysis[]
  gaps: ContentGap[]
  opportunities: ContentOpportunity[]
  strengths: ContentStrength[]
  weaknesses: ContentWeakness[]
  recommendations: ContentRecommendation[]
  lastUpdated: string
}

/**
 * Recommandation de contenu
 */
export interface ContentRecommendation {
  type: 'new' | 'improve' | 'expand'
  keyword: string
  title?: string
  suggestedOutline?: string[]
  priority: 'high' | 'medium' | 'low'
  reasoning: string
}

/**
 * Service de contexte concurrent
 */
export class CompetitorContextBuilder {
  private supabase = createServiceClient()
  private config: CompetitorContextConfig

  constructor(config: CompetitorContextConfig) {
    this.config = {
      maxCompetitors: 5,
      includeGaps: true,
      includeOpportunities: true,
      ...config,
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Construit le contexte concurrent complet
   */
  async buildContext(): Promise<CompetitorContext> {
    // 1. Récupérer les données existantes
    const existingAnalysis = await this.getExistingAnalysis()

    // 2. Récupérer les concurrents
    const competitors = await this.getCompetitors()

    // 3. Analyser les keywords cibles
    const keywordAnalysis = await this.analyzeTargetKeywords(competitors)

    // 4. Identifier les lacunes
    const gaps = this.config.includeGaps
      ? await this.identifyContentGaps(competitors, keywordAnalysis)
      : []

    // 5. Identifier les opportunités
    const opportunities = this.config.includeOpportunities
      ? await this.identifyOpportunities(competitors, keywordAnalysis)
      : []

    // 6. Analyser les forces et faiblesses
    const { strengths, weaknesses } = this.analyzeStrengthsAndWeaknesses(competitors)

    // 7. Générer des recommandations
    const recommendations = this.generateRecommendations(
      gaps,
      opportunities,
      strengths,
      weaknesses
    )

    return {
      targetKeywords: this.config.targetKeywords,
      competitors,
      gaps,
      opportunities,
      strengths,
      weaknesses,
      recommendations,
      lastUpdated: new Date().toISOString(),
    }
  }

  /**
   * Récupère le contexte pour un keyword spécifique
   */
  async getContextForKeyword(keyword: string): Promise<{
    competitorsRanking: CompetitorCoverage[]
    gapAnalysis: ContentGap | null
    opportunity: ContentOpportunity | null
    recommendations: ContentRecommendation[]
  }> {
    const context = await this.buildContext()

    // Trouver l'analyse du keyword
    const keywordAnalysis = context.competitors
      .flatMap(c => c.topKeywords)
      .find(k => k.keyword.toLowerCase() === keyword.toLowerCase())

    // Trouver le gap
    const gap = context.gaps.find(g => g.keyword.toLowerCase() === keyword.toLowerCase())

    // Trouver l'opportunité
    const opportunity = context.opportunities.find(
      o => o.keyword.toLowerCase() === keyword.toLowerCase()
    )

    // Filtrer les recommandations
    const recommendations = context.recommendations.filter(
      r => r.keyword.toLowerCase() === keyword.toLowerCase()
    )

    return {
      competitorsRanking: keywordAnalysis?.competitorUrls.map((url, i) => ({
        domain: new URL(url).hostname,
        hasContent: true,
        position: i + 1,
      })) || [],
      gapAnalysis: gap || null,
      opportunity: opportunity || null,
      recommendations,
    }
  }

  /**
   * Met à jour l'analyse des concurrents
   */
  async refreshAnalysis(): Promise<void> {
    // Récupérer les URLs des concurrents depuis l'analyse existante
    const { data } = await this.supabase
      .from('analysis_runs')
      .select('input, analysis_data')
      .eq('site_id', this.config.siteId)
      .order('created_at', { ascending: false })
      .limit(1)

    const competitors = (data?.[0]?.input as { competitors?: string[] })?.competitors || []

    if (competitors.length === 0) {
      return
    }

    // Lancer une nouvelle analyse
    // Note: En production, cela devrait être une tâche asynchrone
    // await analyzeCompetitors(...)
  }

  // ─── Private Methods ───────────────────────────────────────────────────

  private async getExistingAnalysis(): Promise<{
    competitors: string[]
    analysisData?: Record<string, unknown>
  }> {
    const { data } = await this.supabase
      .from('analysis_runs')
      .select('input, analysis_data')
      .eq('site_id', this.config.siteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!data) {
      return { competitors: [] }
    }

    return {
      competitors: ((data.input as { competitors?: string[] })?.competitors) || [],
      analysisData: data.analysis_data as Record<string, unknown>,
    }
  }

  private async getCompetitors(): Promise<CompetitorAnalysis[]> {
    const { competitors: existingCompetitors } = await this.getExistingAnalysis()

    // Enrichir avec des données complémentaires
    const competitors: CompetitorAnalysis[] = []

    for (const domain of existingCompetitors.slice(0, this.config.maxCompetitors)) {
      try {
        const analysis = await this.analyzeCompetitor(domain)
        if (analysis) {
          competitors.push(analysis)
        }
      } catch (error) {
        console.warn(`Failed to analyze competitor ${domain}:`, error)
      }
    }

    return competitors
  }

  private async analyzeCompetitor(domain: string): Promise<CompetitorAnalysis | null> {
    try {
      // Analyser la page d'accueil pour les stats basiques
      const url = domain.startsWith('http') ? domain : `https://${domain}`
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) })

      if (!response.ok) {
        return null
      }

      const html = await response.text()

      // Parser les keywords (simplifié - en prod utiliser l'API Google)
      const topKeywords: KeywordAnalysis[] = this.config.targetKeywords.map(keyword => ({
        keyword,
        competitorUrls: [],
        gapOpportunity: 'medium',
      }))

      return {
        domain: new URL(url).hostname,
        topKeywords,
        contentTypes: [],
        weaknesses: [],
        strengths: [],
      }
    } catch {
      return null
    }
  }

  private async analyzeTargetKeywords(
    competitors: CompetitorAnalysis[]
  ): Promise<KeywordAnalysis[]> {
    const allKeywords = this.config.targetKeywords

    return allKeywords.map(keyword => {
      // Compter combien de concurrents couvrent ce keyword
      const coveringCompetitors = competitors.filter(
        c => c.topKeywords.some(k => k.keyword === keyword)
      )

      // Calculer le niveau d'opportunité
      let gapOpportunity: 'high' | 'medium' | 'low' = 'medium'

      if (coveringCompetitors.length === 0) {
        gapOpportunity = 'high'
      } else if (coveringCompetitors.length >= 3) {
        gapOpportunity = 'low'
      }

      return {
        keyword,
        competitorUrls: coveringCompetitors.map(c => c.domain),
        gapOpportunity,
      }
    })
  }

  private async identifyContentGaps(
    competitors: CompetitorAnalysis[],
    keywordAnalysis: KeywordAnalysis[]
  ): Promise<ContentGap[]> {
    const gaps: ContentGap[] = []

    for (const keyword of keywordAnalysis) {
      if (keyword.gapOpportunity === 'high') {
        gaps.push({
          keyword: keyword.keyword,
          competitorCoverage: keyword.competitorUrls.map(url => ({
            domain: url,
            hasContent: false,
          })),
          recommendedApproach: this.suggestApproachForKeyword(keyword.keyword),
          priority: 'high',
          estimatedEffort: this.estimateEffort(keyword.keyword),
        })
      }
    }

    return gaps
  }

  private identifyOpportunities(
    competitors: CompetitorAnalysis[],
    keywordAnalysis: KeywordAnalysis[]
  ): ContentOpportunity[] {
    const opportunities: ContentOpportunity[] = []

    for (const keyword of keywordAnalysis) {
      if (keyword.gapOpportunity === 'high') {
        const intent = this.detectIntent(keyword.keyword)
        const format = this.suggestFormat(keyword.keyword)

        opportunities.push({
          keyword: keyword.keyword,
          intent,
          competition: keyword.gapOpportunity === 'high' ? 'low' : 'medium',
          suggestedFormat: format,
          competitorsToBeat: keyword.competitorUrls,
          keyDifferentiators: this.suggestDifferentiators(keyword.keyword),
        })
      }
    }

    return opportunities
  }

  private analyzeStrengthsAndWeaknesses(competitors: CompetitorAnalysis[]): {
    strengths: ContentStrength[]
    weaknesses: ContentWeakness[]
  } {
    const strengths: ContentStrength[] = []
    const weaknesses: ContentWeakness[] = []

    // Analyser les patterns communs
    const commonTopics = this.analyzeCommonTopics(competitors)

    for (const topic of commonTopics) {
      if (topic.avgQuality > 0.7) {
        strengths.push({
          topic: topic.name,
          description: `Les concurrents excellent dans ${topic.name}`,
          whatTheyDoWell: topic.successFactors,
        })
      } else if (topic.avgQuality < 0.4) {
        weaknesses.push({
          topic: topic.name,
          description: `Les concurrents couvrent mal ${topic.name}`,
          opportunity: `Opportunité de dominer avec un contenu complet sur ${topic.name}`,
          severity: topic.avgQuality < 0.2 ? 'high' : 'medium',
        })
      }
    }

    return { strengths, weaknesses }
  }

  private generateRecommendations(
    gaps: ContentGap[],
    opportunities: ContentOpportunity[],
    strengths: ContentStrength[],
    weaknesses: ContentWeakness[]
  ): ContentRecommendation[] {
    const recommendations: ContentRecommendation[] = []

    // Recommandations basées sur les gaps
    for (const gap of gaps.slice(0, 5)) {
      recommendations.push({
        type: 'new',
        keyword: gap.keyword,
        suggestedOutline: this.suggestOutline(gap.keyword),
        priority: gap.priority,
        reasoning: `Les concurrents ne couvrent pas bien "${gap.keyword}". ${gap.recommendedApproach}`,
      })
    }

    // Recommandations basées sur les opportunités
    for (const opp of opportunities.slice(0, 3)) {
      recommendations.push({
        type: 'new',
        keyword: opp.keyword,
        title: `Comment ${opp.keyword} - Guide complet`,
        priority: 'high',
        reasoning: `Format ${opp.suggestedFormat} optimal pour "${opp.keyword}". Faible concurrence.`,
      })
    }

    // Recommandations basées sur les faiblesses
    for (const weakness of weaknesses.slice(0, 3)) {
      recommendations.push({
        type: 'improve',
        keyword: weakness.topic,
        suggestedOutline: this.suggestOutline(weakness.topic),
        priority: weakness.severity,
        reasoning: `Améliorer le contenu sur "${weakness.topic}" pour capitaliser sur l'opportunité: ${weakness.opportunity}`,
      })
    }

    return recommendations
  }

  // ─── Helper Methods ───────────────────────────────────────────────────

  private analyzeCommonTopics(competitors: CompetitorAnalysis[]): Array<{
    name: string
    avgQuality: number
    successFactors: string[]
  }> {
    // Simplifié - en prod analyser réellement le contenu
    return []
  }

  private detectIntent(keyword: string): 'informational' | 'transactional' | 'navigational' {
    const transactional = ['acheter', 'prix', 'commander', 'location', 'devis', 'gratuit']
    const navigational = ['site officiel', 'login', 'compte', 'accès']

    const lower = keyword.toLowerCase()

    if (transactional.some(t => lower.includes(t))) {
      return 'transactional'
    }
    if (navigational.some(t => lower.includes(t))) {
      return 'navigational'
    }
    return 'informational'
  }

  private suggestFormat(keyword: string): ContentOpportunity['suggestedFormat'] {
    const lower = keyword.toLowerCase()

    if (lower.includes('comparer') || lower.includes('vs')) {
      return 'comparison'
    }
    if (lower.includes('comment') || lower.includes('tutoriel')) {
      return 'tutorial'
    }
    if (lower.includes('meilleur') || lower.includes('top')) {
      return 'list'
    }
    if (lower.includes('guide') || lower.includes('tout savoir')) {
      return 'guide'
    }

    return 'article'
  }

  private suggestDifferentiators(keyword: string): string[] {
    return [
      'Contenu plus complet et détaillé',
      'Exemples pratiques et cas concrets',
      'Données et statistiques à jour',
      'Structure claire et navigation facile',
    ]
  }

  private suggestApproachForKeyword(keyword: string): string {
    const format = this.suggestFormat(keyword)
    const intent = this.detectIntent(keyword)

    if (format === 'tutorial') {
      return 'Créer un guide paso a paso détaillé avec captures d\'écran.'
    }
    if (format === 'list') {
      return 'Liste complète des meilleures options avec avis et comparatifs.'
    }
    if (format === 'comparison') {
      return 'Comparaison détaillée avec tableau comparatif.'
    }
    if (intent === 'transactional') {
      return 'Page optimisée pour la conversion avec CTA clair.'
    }

    return `Article approfondi sur "${keyword}" avec données originales.`
  }

  private estimateEffort(keyword: string): 'low' | 'medium' | 'high' {
    // Simplifié - en prod utiliser des heuristiques plus sophistiquées
    const longTail = keyword.split(/\s+/).length > 5
    const technical = ['comment', 'pourquoi', 'différence'].some(t => keyword.includes(t))

    if (longTail && technical) return 'medium'
    if (longTail) return 'low'
    return 'high'
  }

  private suggestOutline(keyword: string): string[] {
    return [
      `Introduction: why ${keyword} matters`,
      `Definition and key concepts`,
      `Main benefits/advantages`,
      `Step-by-step guide / examples`,
      `Common mistakes to avoid`,
      `FAQ section`,
      `Conclusion with CTA`,
    ]
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createCompetitorContextBuilder(
  config: CompetitorContextConfig
): CompetitorContextBuilder {
  return new CompetitorContextBuilder(config)
}
