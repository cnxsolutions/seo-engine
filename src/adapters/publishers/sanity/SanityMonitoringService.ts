// ─────────────────────────────────────────────────────────────────────────────
// Sanity Health & Monitoring Service
// SEO Engine - Publishing Infrastructure
// Health checks, rate limiting, and monitoring for Sanity publishing
// ─────────────────────────────────────────────────────────────────────────────

import { SanityClient, type SanityClientConfig } from './SanityClient'

/**
 * Configuration du monitoring
 */
export interface SanityMonitoringConfig {
  // Rate limiting
  maxRequestsPerMinute?: number
  maxRequestsPerHour?: number
  backoffMultiplier?: number
  maxBackoffMs?: number

  // Health checks
  healthCheckIntervalMs?: number
  healthCheckTimeoutMs?: number

  // Alerts
  alertOnFailure?: boolean
  alertThreshold?: number

  // Cache
  cacheHealthResults?: boolean
  cacheTtlMs?: number
}

/**
 * Status de santé
 */
export interface HealthStatus {
  healthy: boolean
  latencyMs: number
  timestamp: string
  checks: HealthCheck[]
  overallStatus: 'healthy' | 'degraded' | 'unhealthy'
  recommendations?: string[]
}

/**
 * Check de santé
 */
export interface HealthCheck {
  name: string
  status: 'pass' | 'fail' | 'warn'
  latencyMs?: number
  message?: string
  details?: Record<string, unknown>
}

/**
 * Métriques de performance
 */
export interface PerformanceMetrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  averageLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  rateLimitHits: number
  quotaUsage?: QuotaUsage
}

/**
 * Usage des quotas
 */
export interface QuotaUsage {
  operationsUsed: number
  operationsLimit: number
  operationsRemaining: number
  percentUsed: number
  resetAt?: string
}

/**
 * Statut du rate limiting
 */
export interface RateLimitStatus {
  remaining: number
  limit: number
  resetAt: string
  retryAfterMs?: number
  isLimited: boolean
}

/**
 * Incident de monitoring
 */
export interface MonitoringIncident {
  id: string
  type: 'failure' | 'degradation' | 'rate_limit'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  details?: Record<string, unknown>
  occurredAt: string
  resolvedAt?: string
  resolved: boolean
}

/**
 * Service de monitoring Sanity
 */
export class SanityMonitoringService {
  private client: SanityClient
  private config: SanityMonitoringConfig
  private requestCount = 0
  private lastReset = Date.now()
  private requestLatencies: number[] = []
  private incidents: MonitoringIncident[] = []
  private healthCache?: {
    status: HealthStatus
    expiresAt: number
  }

  // Rate limiting state
  private minuteRequests = 0
  private hourRequests = 0
  private lastMinuteReset = Date.now()
  private lastHourReset = Date.now()

  constructor(client: SanityClient, config: Partial<SanityMonitoringConfig> = {}) {
    this.client = client
    this.config = {
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 1000,
      backoffMultiplier: 1.5,
      maxBackoffMs: 60000,
      healthCheckIntervalMs: 30000,
      healthCheckTimeoutMs: 5000,
      alertOnFailure: true,
      alertThreshold: 3,
      cacheHealthResults: true,
      cacheTtlMs: 30000,
      ...config,
    }
  }

  // ─── Health Checks ─────────────────────────────────────────────────────

  /**
   * Vérifie la santé du service Sanity
   */
  async checkHealth(): Promise<HealthStatus> {
    // Vérifier le cache
    if (this.config.cacheHealthResults && this.healthCache) {
      if (Date.now() < this.healthCache.expiresAt) {
        return this.healthCache.status
      }
    }

    const checks: HealthCheck[] = []
    const startTime = Date.now()
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
    const recommendations: string[] = []

    // 1. Test de connectivité basique
    const connectivityCheck = await this.checkConnectivity()
    checks.push(connectivityCheck)

    if (connectivityCheck.status === 'fail') {
      overallStatus = 'unhealthy'
      recommendations.push('Vérifiez la connexion réseau et les credentials Sanity')
    }

    // 2. Test d'authentification
    const authCheck = await this.checkAuthentication()
    checks.push(authCheck)

    if (authCheck.status === 'fail') {
      overallStatus = 'unhealthy'
      recommendations.push('Vérifiez le token API Sanity')
    }

    // 3. Test de latence
    const latencyCheck = await this.checkLatency()
    checks.push(latencyCheck)

    if (latencyCheck.status === 'warn') {
      overallStatus = 'degraded'
      recommendations.push('La latence est élevée, envisagez d\'optimiser les requêtes')
    }

    // 4. Test du rate limit
    const rateLimitCheck = this.checkRateLimitStatus()
    checks.push({
      name: 'Rate Limit',
      status: rateLimitCheck.isLimited ? 'warn' : 'pass',
      message: rateLimitCheck.isLimited
        ? `Rate limit atteint (${rateLimitCheck.remaining} requêtes restantes)`
        : 'Rate limit OK',
      details: {
        remaining: rateLimitCheck.remaining,
        limit: rateLimitCheck.limit,
        resetAt: rateLimitCheck.resetAt,
      },
    })

    // 5. Test de quota
    const quotaCheck = await this.checkQuotaUsage()
    checks.push({
      name: 'Quota Usage',
      status: quotaCheck && quotaCheck.percentUsed > 90 ? 'warn' : 'pass',
      message: quotaCheck
        ? `${quotaCheck.percentUsed.toFixed(1)}% du quota utilisé`
        : 'Quota non disponible',
      details: quotaCheck ? { ...quotaCheck } as Record<string, unknown> : undefined,
    })

    if (quotaCheck && quotaCheck.percentUsed > 90) {
      recommendations.push('Quota presque épuisé, envisagez une mise à niveau du plan Sanity')
    }

    // Calculer le status global
    const failedChecks = checks.filter(c => c.status === 'fail').length
    const warnChecks = checks.filter(c => c.status === 'warn').length

    if (failedChecks > 0) {
      overallStatus = 'unhealthy'
    } else if (warnChecks > 0) {
      overallStatus = 'degraded'
    }

    const status: HealthStatus = {
      healthy: overallStatus === 'healthy',
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      checks,
      overallStatus,
      recommendations: recommendations.length > 0 ? recommendations : undefined,
    }

    // Mettre en cache
    if (this.config.cacheHealthResults) {
      this.healthCache = {
        status,
        expiresAt: Date.now() + (this.config.cacheTtlMs || 30000),
      }
    }

    return status
  }

  /**
   * Check de connectivité
   */
  private async checkConnectivity(): Promise<HealthCheck> {
    const start = Date.now()

    try {
      // Ping simple vers l'API Sanity
      const response = await fetch(
        `https://${this.getProjectId()}.api.sanity.io/v2024-01-01/data/query/production?query=*[_type == "sanity.imageAsset"][0...1]{_id}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(this.config.healthCheckTimeoutMs || 5000),
        }
      )

      return {
        name: 'Connectivity',
        status: response.ok ? 'pass' : 'fail',
        latencyMs: Date.now() - start,
        message: response.ok ? 'Connexion OK' : `Erreur HTTP: ${response.status}`,
      }
    } catch (error) {
      return {
        name: 'Connectivity',
        status: 'fail',
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : 'Erreur de connexion',
      }
    }
  }

  /**
   * Check d'authentification
   */
  private async checkAuthentication(): Promise<HealthCheck> {
    const start = Date.now()

    try {
      // Test avec token
      const response = await fetch(
        `https://${this.getProjectId()}.api.sanity.io/v2024-01-01/users/me`,
        {
          method: 'GET',
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(this.config.healthCheckTimeoutMs || 5000),
        }
      )

      if (response.status === 401) {
        return {
          name: 'Authentication',
          status: 'fail',
          latencyMs: Date.now() - start,
          message: 'Token invalide ou expiré',
        }
      }

      return {
        name: 'Authentication',
        status: response.ok ? 'pass' : 'warn',
        latencyMs: Date.now() - start,
        message: response.ok ? 'Authentification OK' : `HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        name: 'Authentication',
        status: 'fail',
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : 'Erreur d\'authentification',
      }
    }
  }

  /**
   * Check de latence
   */
  private async checkLatency(): Promise<HealthCheck> {
    const start = Date.now()

    try {
      const response = await fetch(
        `https://${this.getProjectId()}.api.sanity.io/v2024-01-01/data/query/production?query=*[_type == "sanity.imageAsset"][0]{_id}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(10000),
        }
      )

      const latency = Date.now() - start

      return {
        name: 'Latency',
        status: latency > 1000 ? 'warn' : 'pass',
        latencyMs: latency,
        message: latency > 1000 ? `Latence élevée: ${latency}ms` : `Latence OK: ${latency}ms`,
        details: { threshold: 1000 },
      }
    } catch (error) {
      return {
        name: 'Latency',
        status: 'fail',
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : 'Timeout',
      }
    }
  }

  // ─── Rate Limiting ─────────────────────────────────────────────────────

  /**
   * Vérifie et met à jour les compteurs de rate limit
   */
  checkRateLimit(): { allowed: boolean; waitMs?: number } {
    this.resetCountersIfNeeded()

    // Vérifier la limite par minute
    if (this.minuteRequests >= (this.config.maxRequestsPerMinute || 60)) {
      const waitMs = 60000 - (Date.now() - this.lastMinuteReset)
      return { allowed: false, waitMs }
    }

    // Vérifier la limite par heure
    if (this.hourRequests >= (this.config.maxRequestsPerHour || 1000)) {
      const waitMs = 3600000 - (Date.now() - this.lastHourReset)
      return { allowed: false, waitMs }
    }

    // Incrémenter les compteurs
    this.minuteRequests++
    this.hourRequests++
    this.requestCount++

    return { allowed: true }
  }

  /**
   * Retourne le statut actuel du rate limit
   */
  checkRateLimitStatus(): RateLimitStatus {
    this.resetCountersIfNeeded()

    return {
      remaining: Math.max(0, (this.config.maxRequestsPerMinute || 60) - this.minuteRequests),
      limit: this.config.maxRequestsPerMinute || 60,
      resetAt: new Date(this.lastMinuteReset + 60000).toISOString(),
      isLimited: this.minuteRequests >= (this.config.maxRequestsPerMinute || 60),
    }
  }

  /**
   * Calcule le backoff pour un retry
   */
  calculateBackoff(attempt: number): number {
    const baseDelay = 1000
    const delay = baseDelay * Math.pow(this.config.backoffMultiplier || 1.5, attempt)
    return Math.min(delay, this.config.maxBackoffMs || 60000)
  }

  private resetCountersIfNeeded(): void {
    const now = Date.now()

    if (now - this.lastMinuteReset > 60000) {
      this.minuteRequests = 0
      this.lastMinuteReset = now
    }

    if (now - this.lastHourReset > 3600000) {
      this.hourRequests = 0
      this.lastHourReset = now
    }
  }

  // ─── Metrics ──────────────────────────────────────────────────────────

  /**
   * Enregistre une latence de requête
   */
  recordLatency(latencyMs: number): void {
    this.requestLatencies.push(latencyMs)

    // Garder seulement les 1000 dernières mesures
    if (this.requestLatencies.length > 1000) {
      this.requestLatencies.shift()
    }
  }

  /**
   * Retourne les métriques de performance
   */
  getMetrics(): PerformanceMetrics {
    const sorted = [...this.requestLatencies].sort((a, b) => a - b)

    return {
      totalRequests: this.requestCount,
      successfulRequests: this.requestCount - this.incidents.length,
      failedRequests: this.incidents.length,
      averageLatencyMs: this.requestLatencies.length > 0
        ? this.requestLatencies.reduce((a, b) => a + b, 0) / this.requestLatencies.length
        : 0,
      p50LatencyMs: this.percentile(sorted, 0.5),
      p95LatencyMs: this.percentile(sorted, 0.95),
      p99LatencyMs: this.percentile(sorted, 0.99),
      rateLimitHits: this.hourRequests,
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil(sorted.length * p) - 1
    return sorted[Math.max(0, index)]
  }

  // ─── Incidents ─────────────────────────────────────────────────────────

  /**
   * Enregistre un incident
   */
  recordIncident(
    type: MonitoringIncident['type'],
    severity: MonitoringIncident['severity'],
    message: string,
    details?: Record<string, unknown>
  ): MonitoringIncident {
    const incident: MonitoringIncident = {
      id: crypto.randomUUID(),
      type,
      severity,
      message,
      details,
      occurredAt: new Date().toISOString(),
      resolved: false,
    }

    this.incidents.push(incident)

    // Garder seulement les 100 derniers incidents
    if (this.incidents.length > 100) {
      this.incidents.shift()
    }

    // Alerte si seuil dépassé
    if (this.config.alertOnFailure) {
      const recentIncidents = this.incidents.filter(
        i => Date.now() - new Date(i.occurredAt).getTime() < 3600000 // 1h
      )

      if (recentIncidents.length >= (this.config.alertThreshold || 3)) {
        this.triggerAlert(recentIncidents)
      }
    }

    return incident
  }

  /**
   * Résout un incident
   */
  resolveIncident(incidentId: string): void {
    const incident = this.incidents.find(i => i.id === incidentId)
    if (incident) {
      incident.resolved = true
      incident.resolvedAt = new Date().toISOString()
    }
  }

  /**
   * Retourne les incidents récents
   */
  getRecentIncidents(hours = 24): MonitoringIncident[] {
    const cutoff = Date.now() - hours * 3600000
    return this.incidents.filter(
      i => Date.parse(i.occurredAt) > cutoff
    )
  }

  private triggerAlert(incidents: MonitoringIncident[]): void {
    // TODO: Implémenter l'envoi d'alertes (email, Slack, webhook)
    console.warn(
      `[SanityMonitoring] ALERT: ${incidents.length} incidents dans la dernière heure`,
      incidents
    )
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private getProjectId(): string {
    // Extraire le project ID depuis l'URL du client
    const url = (this.client as unknown as { baseUrl: string }).baseUrl
    const match = url.match(/https:\/\/(.+?)\.api\.sanity\.io/)
    return match ? match[1] : ''
  }

  private getHeaders(): HeadersInit {
    return (this.client as unknown as { headers: HeadersInit }).headers
  }

  private async checkQuotaUsage(): Promise<QuotaUsage | null> {
    try {
      // Sanity API - Endpoint de quota (si disponible)
      const response = await fetch(
        `https://${this.getProjectId()}.api.sanity.io/v2024-01-01/usage`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        }
      )

      if (!response.ok) return null

      const data = await response.json()
      return {
        operationsUsed: data.usage?.operations || 0,
        operationsLimit: data.usage?.monthlyLimit || 0,
        operationsRemaining: data.usage?.monthlyRemaining || 0,
        percentUsed: data.usage?.percentUsed || 0,
        resetAt: data.usage?.resetAt,
      }
    } catch {
      return null
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSanityMonitoringService(
  client: SanityClient,
  config?: Partial<SanityMonitoringConfig>
): SanityMonitoringService {
  return new SanityMonitoringService(client, config)
}
