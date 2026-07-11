// ─────────────────────────────────────────────────────────────────────────────
// Google Context Module
// SEO Engine - Context Enrichment
// Integrates Google Search Console and Business Profile data into RAG context
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { getGoogleConnection, getAuthenticatedClient } from '@/lib/google/client'
import { fetchPerformance, type GscPerformanceRow } from '@/lib/google/gsc'
import { listLocations, fetchReviews, summarizeReviews } from '@/lib/google/gbp'

/**
 * Configuration du Google Context
 */
export interface GoogleContextConfig {
  siteId: string
  includeGsc?: boolean
  includeGbp?: boolean
  dateRange?: {
    start: string
    end: string
  }
  topPagesLimit?: number
  topQueriesLimit?: number
}

/**
 * Données GSC
 */
export interface GscData {
  // Performance globale
  totalImpressions: number
  totalClicks: number
  averageCtr: number
  averagePosition: number

  // Top queries
  topQueries: GscQuery[]

  // Top pages
  topPages: GscPage[]

  // Données par date
  dailyData: GscDailyData[]

  // Lacunes (queries avec impressions mais pas de clicks)
  opportunities: GscOpportunity[]
}

/**
 * Query GSC
 */
export interface GscQuery {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  trend?: 'up' | 'down' | 'stable'
}

/**
 * Page GSC
 */
export interface GscPage {
  page: string
  path: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/**
 * Données journalières
 */
export interface GscDailyData {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/**
 * Opportunité GSC
 */
export interface GscOpportunity {
  query: string
  impressions: number
  clicks: number
  ctr: number
  position: number
  potential: 'high' | 'medium' | 'low'
  recommendation: string
}

/**
 * Données GBP
 */
export interface GbpData {
  businessName: string
  address?: string
  phone?: string
  website?: string
  categories: string[]
  rating?: number
  reviewCount?: number

  // Avis
  recentReviews: GbpReview[]
  reviewsSummary: ReviewsSummary

  // Posts
  recentPosts: GbpPost[]

  // Q&A
  questionsAndAnswers: GbpQnA[]

  // Insights
  insights: GbpInsights
}

/**
 * Avis GBP
 */
export interface GbpReview {
  id: string
  authorName: string
  rating: number
  content: string
  publishedAt: string
  response?: {
    content: string
    publishedAt: string
  }
}

/**
 * Résumé des avis
 */
export interface ReviewsSummary {
  averageRating: number
  totalReviews: number
  distribution: {
    oneStar: number
    twoStars: number
    threeStars: number
    fourStars: number
    fiveStars: number
  }
  commonThemes: string[]
  sentiment: 'positive' | 'negative' | 'mixed' | 'neutral'
}

/**
 * Post GBP
 */
export interface GbpPost {
  id: string
  type: string
  summary?: string
  content?: string
  publishedAt: string
}

/**
 * Question/Réponse GBP
 */
export interface GbpQnA {
  question: string
  authorName: string
  publishedAt: string
  answer?: {
    content: string
    authorName: string
    publishedAt: string
  }
}

/**
 * Insights GBP
 */
export interface GbpInsights {
  photosViewCount?: number
  directionsRequests?: number
  calls?: number
  bookingLinks?: number
}

/**
 * Contexte Google complet
 */
export interface GoogleContext {
  gsc?: GscData
  gbp?: GbpData

  // Métriques combinées
  localSeoScore?: LocalSeoScore

  // Opportunités locales
  localOpportunities: LocalOpportunity[]

  // Recommandations
  recommendations: GoogleRecommendation[]

  // Contexte pour génération
  generationContext: GoogleGenerationContext

  lastSyncedAt: string
}

/**
 * Score SEO local
 */
export interface LocalSeoScore {
  overall: number
  visibility: number
  engagement: number
  localPresence: number
  contentQuality: number
}

/**
 * Opportunité locale
 */
export interface LocalOpportunity {
  type: 'keyword' | 'content' | 'technical' | 'local'
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  potentialImpact: string
  effort: 'low' | 'medium' | 'high'
}

/**
 * Recommandation Google
 */
export interface GoogleRecommendation {
  source: 'gsc' | 'gbp' | 'combined'
  type: 'keyword' | 'content' | 'local' | 'review'
  title: string
  description: string
  action: string
  priority: 'high' | 'medium' | 'low'
}

/**
 * Contexte pour la génération
 */
export interface GoogleGenerationContext {
  // Mots-clés avec potentiel
  highPotentialKeywords: string[]

  // Thèmes pour avis clients
  reviewThemes: string[]

  // Sujets locaux à couvrir
  localTopics: string[]

  // Tendances
  trendingQueries: string[]

  // Contexte GBP
  businessContext?: {
    name: string
    rating: number
    keyStrengths: string[]
    areasForImprovement: string[]
  }

  // Instructions
  instructions: string
}

/**
 * Service de contexte Google
 */
export class GoogleContextBuilder {
  private supabase = createServiceClient()
  private config: GoogleContextConfig

  constructor(config: GoogleContextConfig) {
    this.config = {
      includeGsc: true,
      includeGbp: true,
      topPagesLimit: 20,
      topQueriesLimit: 50,
      dateRange: {
        start: this.getDateDaysAgo(28),
        end: this.getDateDaysAgo(1),
      },
      ...config,
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Construit le contexte Google complet
   */
  async buildContext(): Promise<GoogleContext> {
    let gscData: GscData | undefined
    let gbpData: GbpData | undefined

    // 1. Récupérer les données GSC
    if (this.config.includeGsc) {
      try {
        gscData = await this.buildGscContext()
      } catch (error) {
        console.warn('Failed to build GSC context:', error)
      }
    }

    // 2. Récupérer les données GBP
    if (this.config.includeGbp) {
      try {
        gbpData = await this.buildGbpContext()
      } catch (error) {
        console.warn('Failed to build GBP context:', error)
      }
    }

    // 3. Calculer le score SEO local
    const localSeoScore = this.calculateLocalSeoScore(gscData, gbpData)

    // 4. Identifier les opportunités locales
    const localOpportunities = this.identifyLocalOpportunities(gscData, gbpData)

    // 5. Générer des recommandations
    const recommendations = this.generateRecommendations(gscData, gbpData)

    // 6. Construire le contexte pour la génération
    const generationContext = this.buildGenerationContext(gscData, gbpData)

    return {
      gsc: gscData,
      gbp: gbpData,
      localSeoScore,
      localOpportunities,
      recommendations,
      generationContext,
      lastSyncedAt: new Date().toISOString(),
    }
  }

  /**
   * Récupère les données pour un keyword spécifique
   */
  async getContextForKeyword(keyword: string): Promise<{
    gscData?: GscQuery | GscOpportunity
    contentGap?: string
    recommendations: GoogleRecommendation[]
  }> {
    const context = await this.buildContext()

    // Trouver les données GSC pour ce keyword
    const query = context.gsc?.topQueries.find(
      q => q.query.toLowerCase().includes(keyword.toLowerCase())
    )

    const opportunity = context.gsc?.opportunities.find(
      o => o.query.toLowerCase().includes(keyword.toLowerCase())
    )

    // Générer des recommandations
    const recommendations: GoogleRecommendation[] = []

    if (query && query.position > 10) {
      recommendations.push({
        source: 'gsc',
        type: 'keyword',
        title: `Améliorer le ranking pour "${keyword}"`,
        description: `Position actuelle: ${query.position.toFixed(1)}. Potentiel de ${this.estimateClickPotential(query)} clics supplémentaires/mois.`,
        action: `Créer ou optimiser le contenu pour "${keyword}"`,
        priority: query.position > 20 ? 'high' : 'medium',
      })
    }

    if (opportunity) {
      recommendations.push({
        source: 'gsc',
        type: 'content',
        title: `Exploiter l'opportunité "${keyword}"`,
        description: `${opportunity.impressions} impressions mais ${opportunity.clicks} clics. CTR actuel: ${(opportunity.ctr * 100).toFixed(2)}%.`,
        action: opportunity.recommendation,
        priority: opportunity.potential === 'high' ? 'high' : 'medium',
      })
    }

    return {
      gscData: query || opportunity,
      contentGap: query ? undefined : 'Aucun contenu trouvé pour ce keyword.',
      recommendations,
    }
  }

  /**
   * Récupère le contexte pour la génération de contenu local
   */
  async getLocalContentContext(): Promise<{
    businessContext: GoogleGenerationContext['businessContext']
    localKeywords: string[]
    trendingTopics: string[]
    reviewThemes: string[]
    instructions: string
  }> {
    const context = await this.buildContext()

    return {
      businessContext: context.generationContext.businessContext,
      localKeywords: context.generationContext.highPotentialKeywords,
      trendingTopics: context.generationContext.trendingQueries,
      reviewThemes: context.generationContext.reviewThemes,
      instructions: context.generationContext.instructions,
    }
  }

  // ─── Private Methods ───────────────────────────────────────────────────

  private async buildGscContext(): Promise<GscData> {
    // Récupérer la connexion Google
    const connection = await getGoogleConnection(this.config.siteId)
    if (!connection) {
      throw new Error('No Google connection found')
    }

    const client = await getAuthenticatedClient(connection.id)
    if (!client) {
      throw new Error('Failed to authenticate with Google')
    }

    // Récupérer les données de performance
    const data = await fetchPerformance(
      client.fetch,
      this.config.siteId,
      {
        startDate: this.config.dateRange!.start,
        endDate: this.config.dateRange!.end,
      }
    )

    // Parser et structurer les données
    return this.processGscData(data)
  }

  private processGscData(data: GscPerformanceRow[]): GscData {
    const queries = new Map<string, GscQuery>()
    const pages = new Map<string, GscPage>()
    const dailyData = new Map<string, GscDailyData>()

    let totalImpressions = 0
    let totalClicks = 0
    let totalCtrSum = 0
    let totalPositionSum = 0
    let count = 0

    for (const row of data) {
      // Aggregats
      totalImpressions += row.impressions
      totalClicks += row.clicks
      totalCtrSum += row.ctr
      totalPositionSum += row.position
      count++

      // Queries
      const existingQuery = queries.get(row.query)
      if (existingQuery) {
        existingQuery.impressions += row.impressions
        existingQuery.clicks += row.clicks
        existingQuery.ctr = existingQuery.clicks / existingQuery.impressions
        existingQuery.position = (existingQuery.position + row.position) / 2
      } else {
        queries.set(row.query, {
          query: row.query,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
          position: row.position,
        })
      }

      // Pages
      const pageKey = this.extractPath(row.page_url)
      const existingPage = pages.get(pageKey)
      if (existingPage) {
        existingPage.impressions += row.impressions
        existingPage.clicks += row.clicks
      } else {
        pages.set(pageKey, {
          page: row.page_url,
          path: pageKey,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
          position: row.position,
        })
      }

      // Daily
      const date = row.date.split('T')[0]
      const existingDaily = dailyData.get(date)
      if (existingDaily) {
        existingDaily.impressions += row.impressions
        existingDaily.clicks += row.clicks
      } else {
        dailyData.set(date, {
          date,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: 0,
          position: 0,
        })
      }
    }

    // Trier et limiter
    const topQueries = Array.from(queries.values())
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, this.config.topQueriesLimit)

    const topPages = Array.from(pages.values())
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, this.config.topPagesLimit)

    // Identifier les opportunités
    const opportunities = this.identifyGscOpportunities(topQueries)

    return {
      totalImpressions,
      totalClicks,
      averageCtr: count > 0 ? totalCtrSum / count : 0,
      averagePosition: count > 0 ? totalPositionSum / count : 0,
      topQueries,
      topPages,
      dailyData: Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date)),
      opportunities,
    }
  }

  private identifyGscOpportunities(queries: GscQuery[]): GscOpportunity[] {
    const opportunities: GscOpportunity[] = []

    for (const query of queries) {
      // Opportunité: haute impression, bas CTR, moyenne position
      if (
        query.impressions > 100 &&
        query.ctr < 0.05 &&
        query.position > 5 &&
        query.position < 20
      ) {
        opportunities.push({
          query: query.query,
          impressions: query.impressions,
          clicks: query.clicks,
          ctr: query.ctr,
          position: query.position,
          potential: query.impressions > 1000 ? 'high' : 'medium',
          recommendation: `Améliorer le title et la meta description pour "${query.query}" pour augmenter le CTR.`,
        })
      }
    }

    return opportunities
      .sort((a, b) => b.potential.localeCompare(a.potential))
      .slice(0, 10)
  }

  private async buildGbpContext(): Promise<GbpData> {
    // Récupérer la connexion Google
    const connection = await getGoogleConnection(this.config.siteId)
    if (!connection?.gbp_location_id) {
      throw new Error('No GBP connection found')
    }

    const client = await getAuthenticatedClient(this.config.siteId)
    if (!client) {
      throw new Error('Failed to authenticate with Google')
    }

    // Récupérer les informations du lieu
    const locations = await listLocations(client.fetch, connection.id)
    const location = locations.find(l => l.name === connection.gbp_location_id)

    if (!location) {
      throw new Error('GBP location not found')
    }

    // Récupérer les avis
    const reviews = await fetchReviews(client.fetch, connection.id, connection.gbp_location_id)
    const reviewsSummary = await summarizeReviews(reviews)

    return {
      businessName: location.title || 'Business',
      address: location.storefrontAddress?.addressLines?.join(', '),
      phone: location.phoneNumbers?.primaryPhone,
      website: location.websiteUri,
      categories: [],
      rating: reviewsSummary.average_rating,
      reviewCount: reviewsSummary.total_count,

      recentReviews: reviews.slice(0, 5).map(r => ({
        id: '',
        authorName: r.reviewer?.displayName || 'Anonymous',
        rating: parseInt(r.starRating) || 0,
        content: r.comment || '',
        publishedAt: r.createTime || '',
        response: r.reviewReply ? {
          content: r.reviewReply.comment || '',
          publishedAt: '',
        } : undefined,
      })),

      reviewsSummary: {
        averageRating: reviewsSummary.average_rating,
        totalReviews: reviewsSummary.total_count,
        distribution: { oneStar: 0, twoStars: 0, threeStars: 0, fourStars: 0, fiveStars: 0 },
        commonThemes: [],
        sentiment: 'neutral' as const,
      },
      recentPosts: [],
      questionsAndAnswers: [],
      insights: {},
    }
  }

  private calculateLocalSeoScore(
    gscData?: GscData,
    gbpData?: GbpData
  ): LocalSeoScore {
    // Score de visibilité (basé sur GSC)
    let visibility = 50
    if (gscData) {
      const impressionsScore = Math.min(gscData.totalImpressions / 10000, 1) * 50
      const positionScore = Math.max(0, (50 - gscData.averagePosition / 2))
      visibility = impressionsScore + positionScore
    }

    // Score d'engagement (basé sur GSC et GBP)
    let engagement = 50
    if (gscData) {
      const ctrScore = gscData.averageCtr * 500 // CTR de 10% = 50 points
      engagement = Math.min(ctrScore, 50)
    }
    if (gbpData?.rating) {
      engagement += (gbpData.rating / 5) * 30
    }

    // Score de présence locale (basé sur GBP)
    let localPresence = 50
    if (gbpData) {
      if (gbpData.rating && gbpData.rating >= 4.5) localPresence += 20
      if (gbpData.reviewCount && gbpData.reviewCount >= 50) localPresence += 15
      if (gbpData.recentPosts && gbpData.recentPosts.length > 0) localPresence += 10
    }

    // Score de qualité de contenu (heuristique)
    let contentQuality = 50
    if (gscData) {
      const highImpressions = gscData.topQueries.filter(q => q.impressions > 100).length
      contentQuality = Math.min(highImpressions * 5, 50)
    }

    return {
      overall: Math.round((visibility + engagement + localPresence + contentQuality) / 4),
      visibility: Math.round(visibility),
      engagement: Math.round(engagement),
      localPresence: Math.round(localPresence),
      contentQuality: Math.round(contentQuality),
    }
  }

  private identifyLocalOpportunities(
    gscData?: GscData,
    gbpData?: GbpData
  ): LocalOpportunity[] {
    const opportunities: LocalOpportunity[] = []

    // Opportunités basées sur GSC
    if (gscData) {
      // Keywords locaux non couverts
      const localKeywords = ['proche', 'près', 'quartier', 'arrondissement', 'ville']
      for (const query of gscData.topQueries) {
        if (localKeywords.some(lk => query.query.toLowerCase().includes(lk))) {
          opportunities.push({
            type: 'keyword',
            title: `Opportunité locale: "${query.query}"`,
            description: `${query.impressions} impressions, ${query.clicks} clics. Position: ${query.position.toFixed(1)}`,
            priority: query.impressions > 500 ? 'high' : 'medium',
            potentialImpact: `${this.estimateClickPotential(query)} clics potentiels/mois`,
            effort: 'medium',
          })
        }
      }

      // Opportunités d'amélioration CTR
      for (const opp of gscData.opportunities.slice(0, 3)) {
        opportunities.push({
          type: 'content',
          title: `Améliorer CTR pour "${opp.query}"`,
          description: `CTR actuel: ${(opp.ctr * 100).toFixed(2)}% sur ${opp.impressions} impressions`,
          priority: opp.potential === 'high' ? 'high' : 'medium',
          potentialImpact: `${this.estimateClickPotential(opp)} clics supplémentaires/mois`,
          effort: 'low',
        })
      }
    }

    // Opportunités basées sur GBP
    if (gbpData) {
      if (gbpData.rating && gbpData.rating < 4.5) {
        opportunities.push({
          type: 'local',
          title: 'Améliorer la note GBP',
          description: `Note actuelle: ${gbpData.rating}/5 (${gbpData.reviewCount} avis)`,
          priority: 'high',
          potentialImpact: 'Impact direct sur la visibilité locale',
          effort: 'medium',
        })
      }

      if (!gbpData.recentPosts || gbpData.recentPosts.length < 2) {
        opportunities.push({
          type: 'local',
          title: 'Publier plus de posts Google Business',
          description: 'Les posts réguliers améliorent la visibilité locale',
          priority: 'medium',
          potentialImpact: '+10-20% engagement local',
          effort: 'low',
        })
      }
    }

    return opportunities
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 }
        return priorityOrder[a.priority] - priorityOrder[b.priority]
      })
      .slice(0, 10)
  }

  private generateRecommendations(
    gscData?: GscData,
    gbpData?: GbpData
  ): GoogleRecommendation[] {
    const recommendations: GoogleRecommendation[] = []

    // Recommandations GSC
    if (gscData) {
      // Top keywords avec position > 10
      for (const query of gscData.topQueries.filter(q => q.position > 10).slice(0, 3)) {
        recommendations.push({
          source: 'gsc',
          type: 'keyword',
          title: `Optimiser pour "${query.query}"`,
          description: `Position actuelle: ${query.position.toFixed(1)}. Potentiel: ${this.estimateClickPotential(query)} clics/mois.`,
          action: `Créer ou optimiser le contenu pour cibler "${query.query}"`,
          priority: query.position > 20 ? 'high' : 'medium',
        })
      }

      // Opportunités CTR
      for (const opp of gscData.opportunities.slice(0, 2)) {
        recommendations.push({
          source: 'gsc',
          type: 'content',
          title: `Améliorer le CTR pour "${opp.query}"`,
          description: `CTR actuel: ${(opp.ctr * 100).toFixed(1)}%. Potentiel d'amélioration: ${this.estimateClickPotential(opp)} clics/mois.`,
          action: opp.recommendation,
          priority: opp.potential === 'high' ? 'high' : 'medium',
        })
      }
    }

    // Recommandations GBP
    if (gbpData) {
      if (gbpData.reviewsSummary.sentiment === 'negative') {
        recommendations.push({
          source: 'gbp',
          type: 'review',
          title: 'Gérer les avis négatifs',
          description: `Themes récurrents: ${gbpData.reviewsSummary.commonThemes.slice(0, 3).join(', ')}`,
          action: 'Répondre aux avis négatifs et améliorer les points identifiés',
          priority: 'high',
        })
      }

      if (gbpData.reviewsSummary.averageRating < 4.5) {
        recommendations.push({
          source: 'gbp',
          type: 'review',
          title: 'Augmenter la note Google',
          description: `Note actuelle: ${gbpData.reviewsSummary.averageRating.toFixed(1)}/5`,
          action: 'Encourager les clients satisfaits à laisser un avis',
          priority: 'medium',
        })
      }
    }

    return recommendations
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 }
        return priorityOrder[a.priority] - priorityOrder[b.priority]
      })
  }

  private buildGenerationContext(
    gscData?: GscData,
    gbpData?: GbpData
  ): GoogleGenerationContext {
    const instructions: string[] = []

    // High potential keywords
    const highPotentialKeywords = gscData
      ? gscData.topQueries
          .filter(q => q.position > 5 && q.position < 20 && q.impressions > 100)
          .map(q => q.query)
          .slice(0, 10)
      : []

    // Trending queries
    const trendingQueries = gscData
      ? gscData.topQueries
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 5)
          .map(q => q.query)
      : []

    // Review themes
    const reviewThemes = gbpData?.reviewsSummary.commonThemes || []

    // Business context
    let businessContext: GoogleGenerationContext['businessContext'] | undefined
    if (gbpData) {
      const positiveReviews = gbpData.recentReviews.filter(r => r.rating >= 4)
      const negativeReviews = gbpData.recentReviews.filter(r => r.rating <= 2)

      businessContext = {
        name: gbpData.businessName,
        rating: gbpData.rating || 0,
        keyStrengths: positiveReviews.map(r => r.content.slice(0, 50)).slice(0, 3),
        areasForImprovement: negativeReviews.map(r => r.content.slice(0, 50)).slice(0, 3),
      }

      instructions.push(`Contexte Business: ${gbpData.businessName}`)
      if (gbpData.rating) {
        instructions.push(`Note Google: ${gbpData.rating}/5`)
      }
    }

    if (highPotentialKeywords.length > 0) {
      instructions.push(`Keywords prioritaires: ${highPotentialKeywords.slice(0, 3).join(', ')}`)
    }

    return {
      highPotentialKeywords,
      reviewThemes,
      localTopics: highPotentialKeywords,
      trendingQueries,
      businessContext,
      instructions: instructions.join('\n'),
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private getDateDaysAgo(days: number): string {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date.toISOString().split('T')[0]
  }

  private extractPath(url: string): string {
    try {
      const u = new URL(url)
      return u.pathname
    } catch {
      return url
    }
  }

  private estimateClickPotential(query: GscQuery | GscOpportunity): number {
    // Estimation: si CTR doublait
    const currentCtr = query.ctr || 0.05
    const potentialCtr = Math.min(currentCtr * 2, 0.2) // Max 20% CTR
    return Math.round((potentialCtr - currentCtr) * query.impressions)
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createGoogleContextBuilder(
  config: GoogleContextConfig
): GoogleContextBuilder {
  return new GoogleContextBuilder(config)
}
