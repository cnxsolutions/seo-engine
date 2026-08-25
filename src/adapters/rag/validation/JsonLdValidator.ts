// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD Validator
// SEO Engine - Validation Pipeline
// Validates the schema.org markup the generator actually emits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This validator answers a different question from `SchemaValidator`.
 *
 *   SchemaValidator  → do the CMS FIELDS match the content type declared by the
 *                      CMS (required fields, types, min/max length)?
 *   JsonLdValidator  → is the schema.org JSON-LD shipped inside the page valid
 *                      and eligible for a rich result?
 *
 * The generator produces three JSON-LD strings per page — `schemaLocalBusiness`,
 * `schemaFaqPage`, `schemaBreadcrumb` — which the WordPress publisher writes both
 * into RankMath meta and into the page body. Nothing checked them until now.
 */

export type JsonLdSeverity = 'error' | 'warning' | 'info'

export type JsonLdIssueCode =
  | 'MALFORMED_JSON'
  | 'NOT_AN_OBJECT'
  | 'MISSING_CONTEXT'
  | 'INVALID_CONTEXT'
  | 'MISSING_TYPE'
  | 'MISSING_REQUIRED_PROPERTY'
  | 'EMPTY_REQUIRED_PROPERTY'
  | 'INVALID_PROPERTY_TYPE'
  | 'INVALID_URL'
  | 'BREADCRUMB_POSITION_INVALID'
  | 'RATING_INCOMPLETE'
  | 'RATING_OUT_OF_RANGE'
  | 'SELF_SERVING_REVIEW'
  | 'RECOMMENDED_PROPERTY_MISSING'
  | 'NO_RICH_RESULT'
  | 'UNEXPECTED_TYPE'
  | 'SCHEMA_ABSENT'

export interface JsonLdIssue {
  /** Node path, e.g. "LocalBusiness" or "BreadcrumbList.itemListElement[2]". */
  node: string
  code: JsonLdIssueCode
  message: string
  severity: JsonLdSeverity
}

export interface JsonLdValidationResult {
  /** True when no `error`-severity issue was raised. Absent markup is valid. */
  isValid: boolean
  /** False when the input was empty, `'{}'` or missing entirely. */
  isPresent: boolean
  types: string[]
  errors: JsonLdIssue[]
  warnings: JsonLdIssue[]
  infos: JsonLdIssue[]
  nodesValidated: number
}

export interface JsonLdValidationConfig {
  /** Require `@context` to be schema.org on root nodes. Default true. */
  requireContext?: boolean
  /** Emit `RECOMMENDED_PROPERTY_MISSING` warnings. Default true. */
  checkRecommended?: boolean
  /** Emit the FAQ / review "no rich result" notices. Default true. */
  checkRichResultEligibility?: boolean
}

/** What a caller expects a given slot to contain. */
export interface JsonLdExpectation {
  expectedType?: string
  /** Label used in issue paths; defaults to the detected @type. */
  label?: string
}

type JsonObject = Record<string, unknown>

// ─── Type vocabulary ─────────────────────────────────────────────────────────

/**
 * The schema.org LocalBusiness subtypes a local-SEO generator realistically
 * emits. A page for a plumber is `@type: "Plumber"`, which IS a LocalBusiness —
 * rejecting it because the literal string differs would block valid markup.
 */
const LOCAL_BUSINESS_TYPES = new Set([
  'LocalBusiness', 'ProfessionalService', 'HomeAndConstructionBusiness', 'GeneralContractor',
  'Plumber', 'Electrician', 'HVACBusiness', 'RoofingContractor', 'HousePainter', 'Locksmith',
  'MovingCompany', 'Notary', 'AccountingService', 'InsuranceAgency', 'LegalService', 'Attorney',
  'RealEstateAgent', 'TravelAgency', 'AutoRepair', 'AutoDealer', 'AutomotiveBusiness',
  'Restaurant', 'FoodEstablishment', 'Bakery', 'CafeOrCoffeeShop', 'BarOrPub',
  'HairSalon', 'BeautySalon', 'DaySpa', 'HealthAndBeautyBusiness', 'NailSalon',
  'Dentist', 'Physician', 'MedicalBusiness', 'VeterinaryCare', 'Pharmacy',
  'Store', 'ClothingStore', 'FurnitureStore', 'HardwareStore', 'GardenStore',
  'ChildCare', 'EmergencyService', 'FinancialService', 'EntertainmentBusiness',
  'SportsActivityLocation', 'ExerciseGym', 'Hotel', 'LodgingBusiness', 'SelfStorage',
  'CleaningService', 'DryCleaningOrLaundry', 'PetStore', 'ShoppingCenter',
])

const ARTICLE_TYPES = new Set(['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'Report'])

// ─── Validator ───────────────────────────────────────────────────────────────

export class JsonLdValidator {
  private config: Required<JsonLdValidationConfig>

  constructor(config: JsonLdValidationConfig = {}) {
    this.config = {
      requireContext: true,
      checkRecommended: true,
      checkRichResultEligibility: true,
      ...config,
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Validates one JSON-LD payload: a raw JSON string, an already-parsed object,
   * or an HTML fragment containing `<script type="application/ld+json">` blocks.
   */
  validate(
    input: string | object | null | undefined,
    expectation: JsonLdExpectation = {}
  ): JsonLdValidationResult {
    const issues: JsonLdIssue[] = []
    const types: string[] = []
    const label = expectation.label || expectation.expectedType || 'json-ld'

    const payloads = this.collectPayloads(input)

    if (payloads.length === 0) {
      issues.push({
        node: label,
        code: 'SCHEMA_ABSENT',
        message: `No JSON-LD found for "${label}"`,
        severity: 'warning',
      })
      return this.buildResult(issues, types, 0, false)
    }

    let nodesValidated = 0

    for (const payload of payloads) {
      let parsed: unknown

      if (typeof payload === 'string') {
        try {
          parsed = JSON.parse(payload)
        } catch {
          issues.push({
            node: label,
            code: 'MALFORMED_JSON',
            message: `JSON-LD for "${label}" is not parseable JSON`,
            severity: 'error',
          })
          continue
        }
      } else {
        parsed = payload
      }

      for (const node of this.flattenNodes(parsed, label, issues)) {
        nodesValidated++
        this.validateNode(node.value, node.path, issues, types, node.isRoot, expectation)
      }
    }

    return this.buildResult(issues, types, nodesValidated, true)
  }

  /**
   * Validates a named map of payloads in one pass, e.g.
   * `{ localBusiness, faqPage, breadcrumb }`.
   */
  validateAll(
    inputs: Record<string, string | object | null | undefined>,
    expectations: Record<string, JsonLdExpectation> = {}
  ): JsonLdValidationResult {
    const merged: JsonLdValidationResult = {
      isValid: true,
      isPresent: false,
      types: [],
      errors: [],
      warnings: [],
      infos: [],
      nodesValidated: 0,
    }

    for (const [key, value] of Object.entries(inputs)) {
      const expectation = expectations[key] || { label: key }
      const result = this.validate(value, { label: key, ...expectation })

      merged.errors.push(...result.errors)
      merged.warnings.push(...result.warnings)
      merged.infos.push(...result.infos)
      merged.nodesValidated += result.nodesValidated
      merged.isPresent = merged.isPresent || result.isPresent
      for (const type of result.types) {
        if (!merged.types.includes(type)) merged.types.push(type)
      }
    }

    merged.isValid = merged.errors.length === 0
    return merged
  }

  /** Pulls every `<script type="application/ld+json">` body out of an HTML string. */
  extractFromHtml(html: string): string[] {
    const blocks: string[] = []
    const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let match: RegExpExecArray | null

    while ((match = pattern.exec(html || '')) !== null) {
      const body = match[1].trim()
      if (body) blocks.push(body)
    }

    return blocks
  }

  // ─── Input handling ────────────────────────────────────────────────────

  /**
   * Normalizes the many shapes a caller can pass into a list of payloads.
   * `'{}'` counts as ABSENT, not invalid: it is the generator's own fallback
   * when the model omits a schema, and blocking on it would block every page
   * regenerated from a legacy row.
   */
  private collectPayloads(input: string | object | null | undefined): Array<string | object> {
    if (input === null || input === undefined) return []

    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (!trimmed || trimmed === '{}' || trimmed === '[]' || trimmed === 'null') return []

      if (/<script\b/i.test(trimmed)) {
        return this.extractFromHtml(trimmed)
      }
      return [trimmed]
    }

    if (Array.isArray(input)) {
      return input.length === 0 ? [] : [input]
    }

    if (Object.keys(input as JsonObject).length === 0) return []
    return [input]
  }

  /** Expands `@graph` containers and top-level arrays into individual nodes. */
  private flattenNodes(
    parsed: unknown,
    label: string,
    issues: JsonLdIssue[]
  ): Array<{ value: JsonObject; path: string; isRoot: boolean }> {
    const nodes: Array<{ value: JsonObject; path: string; isRoot: boolean }> = []

    const push = (value: unknown, path: string, isRoot: boolean) => {
      if (!isPlainObject(value)) {
        issues.push({
          node: path,
          code: 'NOT_AN_OBJECT',
          message: `JSON-LD node at "${path}" is not an object`,
          severity: 'error',
        })
        return
      }

      const graph = value['@graph']
      if (Array.isArray(graph)) {
        graph.forEach((child, index) => push(child, `${path}@graph[${index}]`, false))
        // A @graph container still owns the @context.
        if (this.config.requireContext) this.checkContext(value, path, issues)
        return
      }

      nodes.push({ value, path, isRoot })
    }

    if (Array.isArray(parsed)) {
      parsed.forEach((child, index) => push(child, `${label}[${index}]`, true))
    } else {
      push(parsed, label, true)
    }

    return nodes
  }

  // ─── Node validation ───────────────────────────────────────────────────

  private validateNode(
    node: JsonObject,
    path: string,
    issues: JsonLdIssue[],
    types: string[],
    isRoot: boolean,
    expectation: JsonLdExpectation
  ): void {
    if (isRoot && this.config.requireContext) {
      this.checkContext(node, path, issues)
    }

    const nodeTypes = readTypes(node)
    if (nodeTypes.length === 0) {
      issues.push({
        node: path,
        code: 'MISSING_TYPE',
        message: `JSON-LD node at "${path}" has no @type`,
        severity: 'error',
      })
      return
    }

    for (const type of nodeTypes) {
      if (!types.includes(type)) types.push(type)
    }

    const expected = expectation.expectedType
    if (expected && !this.matchesExpectedType(nodeTypes, expected)) {
      issues.push({
        node: path,
        code: 'UNEXPECTED_TYPE',
        message: `Expected a ${expected} node, got @type "${nodeTypes.join(', ')}"`,
        severity: 'warning',
      })
    }

    const primary = nodeTypes[0]

    if (nodeTypes.some(type => LOCAL_BUSINESS_TYPES.has(type)) || expected === 'LocalBusiness') {
      this.validateLocalBusiness(node, path, issues)
    } else if (nodeTypes.includes('FAQPage')) {
      this.validateFaqPage(node, path, issues)
    } else if (nodeTypes.includes('BreadcrumbList')) {
      this.validateBreadcrumbList(node, path, issues)
    } else if (nodeTypes.some(type => ARTICLE_TYPES.has(type))) {
      this.validateArticle(node, path, issues)
    } else if (nodeTypes.includes('Organization')) {
      this.requireNonEmptyString(node, 'name', path, primary, issues)
    } else if (nodeTypes.includes('WebPage') || nodeTypes.includes('WebSite')) {
      this.requireNonEmptyString(node, 'name', path, primary, issues)
    }
  }

  private matchesExpectedType(nodeTypes: string[], expected: string): boolean {
    if (nodeTypes.includes(expected)) return true
    if (expected === 'LocalBusiness') return nodeTypes.some(type => LOCAL_BUSINESS_TYPES.has(type))
    if (expected === 'Article') return nodeTypes.some(type => ARTICLE_TYPES.has(type))
    return false
  }

  private checkContext(node: JsonObject, path: string, issues: JsonLdIssue[]): void {
    const context = node['@context']

    if (context === undefined || context === null || context === '') {
      issues.push({
        node: path,
        code: 'MISSING_CONTEXT',
        message: `JSON-LD node at "${path}" has no @context (expected "https://schema.org")`,
        severity: 'error',
      })
      return
    }

    const serialized = typeof context === 'string' ? context : JSON.stringify(context)
    if (!/schema\.org/i.test(serialized)) {
      issues.push({
        node: path,
        code: 'INVALID_CONTEXT',
        message: `@context at "${path}" does not reference schema.org`,
        severity: 'error',
      })
    }
  }

  // ─── LocalBusiness ─────────────────────────────────────────────────────

  private validateLocalBusiness(node: JsonObject, path: string, issues: JsonLdIssue[]): void {
    const label = `${path}`

    this.requireNonEmptyString(node, 'name', label, 'LocalBusiness', issues)

    const address = node.address
    if (address === undefined || address === null || address === '') {
      issues.push({
        node: `${label}.address`,
        code: 'MISSING_REQUIRED_PROPERTY',
        message: 'LocalBusiness requires an "address" (PostalAddress)',
        severity: 'error',
      })
    } else if (isPlainObject(address)) {
      for (const key of ['streetAddress', 'addressLocality']) {
        if (!isNonEmptyString(address[key])) {
          issues.push({
            node: `${label}.address.${key}`,
            code: 'MISSING_REQUIRED_PROPERTY',
            message: `PostalAddress requires "${key}"`,
            severity: 'error',
          })
        }
      }
      if (this.config.checkRecommended) {
        for (const key of ['postalCode', 'addressCountry']) {
          if (!isNonEmptyString(address[key])) {
            issues.push({
              node: `${label}.address.${key}`,
              code: 'RECOMMENDED_PROPERTY_MISSING',
              message: `PostalAddress should carry "${key}"`,
              severity: 'warning',
            })
          }
        }
      }
    } else if (typeof address !== 'string') {
      issues.push({
        node: `${label}.address`,
        code: 'INVALID_PROPERTY_TYPE',
        message: 'LocalBusiness "address" must be a PostalAddress object or a string',
        severity: 'error',
      })
    }

    if (this.config.checkRecommended) {
      for (const key of ['telephone', 'url', 'image', 'openingHours', 'openingHoursSpecification', 'priceRange', 'geo']) {
        if (key === 'openingHours' && node.openingHoursSpecification !== undefined) continue
        if (key === 'openingHoursSpecification' && node.openingHours !== undefined) continue
        if (node[key] === undefined || node[key] === null || node[key] === '') {
          issues.push({
            node: `${label}.${key}`,
            code: 'RECOMMENDED_PROPERTY_MISSING',
            message: `LocalBusiness should carry "${key}" for a complete local rich result`,
            severity: 'warning',
          })
        }
      }
    }

    if (isNonEmptyString(node.url) && !isLikelyUrl(node.url as string)) {
      issues.push({
        node: `${label}.url`,
        code: 'INVALID_URL',
        message: `LocalBusiness "url" is not an absolute URL: "${node.url as string}"`,
        severity: 'error',
      })
    }

    this.validateAggregateRating(node, label, issues)
  }

  /**
   * Google policy, not just syntax.
   *
   * `aggregateRating` must carry a rating value and a count; more importantly a
   * rating a business writes about ITSELF ("self-serving review") has been
   * ineligible for LocalBusiness/Organization rich results since 2019. Emitting
   * one is not a syntax error, so this is a warning — but silently shipping a
   * five-star average the site invented is exactly how a page gets a manual
   * action, so it must be surfaced.
   */
  private validateAggregateRating(node: JsonObject, label: string, issues: JsonLdIssue[]): void {
    const rating = node.aggregateRating
    if (rating === undefined || rating === null) return

    if (!isPlainObject(rating)) {
      issues.push({
        node: `${label}.aggregateRating`,
        code: 'INVALID_PROPERTY_TYPE',
        message: '"aggregateRating" must be an AggregateRating object',
        severity: 'error',
      })
      return
    }

    const value = toNumber(rating.ratingValue)
    if (value === null) {
      issues.push({
        node: `${label}.aggregateRating.ratingValue`,
        code: 'RATING_INCOMPLETE',
        message: 'AggregateRating requires a numeric "ratingValue"',
        severity: 'error',
      })
    } else {
      const best = toNumber(rating.bestRating) ?? 5
      const worst = toNumber(rating.worstRating) ?? 0
      if (value > best || value < worst) {
        issues.push({
          node: `${label}.aggregateRating.ratingValue`,
          code: 'RATING_OUT_OF_RANGE',
          message: `"ratingValue" ${value} is outside [${worst}, ${best}]`,
          severity: 'error',
        })
      }
    }

    const count = toNumber(rating.reviewCount) ?? toNumber(rating.ratingCount)
    if (count === null || count <= 0) {
      issues.push({
        node: `${label}.aggregateRating`,
        code: 'RATING_INCOMPLETE',
        message: 'AggregateRating requires "reviewCount" or "ratingCount" greater than zero',
        severity: 'error',
      })
    }

    if (this.config.checkRichResultEligibility) {
      const reviews = node.review
      const hasReviews = Array.isArray(reviews) ? reviews.length > 0 : isPlainObject(reviews)
      if (!hasReviews) {
        issues.push({
          node: `${label}.aggregateRating`,
          code: 'SELF_SERVING_REVIEW',
          message:
            'aggregateRating without any Review node: Google treats ratings a business publishes about itself as self-serving and ineligible for star rich results',
          severity: 'warning',
        })
      }
    }
  }

  // ─── FAQPage ───────────────────────────────────────────────────────────

  private validateFaqPage(node: JsonObject, path: string, issues: JsonLdIssue[]): void {
    const entities = node.mainEntity

    if (!Array.isArray(entities) || entities.length === 0) {
      issues.push({
        node: `${path}.mainEntity`,
        code: 'MISSING_REQUIRED_PROPERTY',
        message: 'FAQPage requires a non-empty "mainEntity" array of Question nodes',
        severity: 'error',
      })
      return
    }

    entities.forEach((entity, index) => {
      const entityPath = `${path}.mainEntity[${index}]`

      if (!isPlainObject(entity)) {
        issues.push({
          node: entityPath,
          code: 'NOT_AN_OBJECT',
          message: 'FAQPage "mainEntity" entries must be Question objects',
          severity: 'error',
        })
        return
      }

      const types = readTypes(entity)
      if (!types.includes('Question')) {
        issues.push({
          node: entityPath,
          code: 'UNEXPECTED_TYPE',
          message: `FAQPage "mainEntity" entries must be @type "Question", got "${types.join(', ') || 'none'}"`,
          severity: 'error',
        })
      }

      if (!isNonEmptyString(entity.name)) {
        issues.push({
          node: `${entityPath}.name`,
          code: 'EMPTY_REQUIRED_PROPERTY',
          message: 'Question requires a non-empty "name" (the question itself)',
          severity: 'error',
        })
      }

      const answer = entity.acceptedAnswer
      if (!isPlainObject(answer)) {
        issues.push({
          node: `${entityPath}.acceptedAnswer`,
          code: 'MISSING_REQUIRED_PROPERTY',
          message: 'Question requires an "acceptedAnswer" Answer object',
          severity: 'error',
        })
        return
      }

      if (!isNonEmptyString(answer.text)) {
        issues.push({
          node: `${entityPath}.acceptedAnswer.text`,
          code: 'EMPTY_REQUIRED_PROPERTY',
          message: 'Answer requires a non-empty "text"',
          severity: 'error',
        })
      }
    })

    if (this.config.checkRichResultEligibility) {
      issues.push({
        node: path,
        code: 'NO_RICH_RESULT',
        message:
          'FAQPage markup is valid but no longer produces an FAQ rich result: since August 2023 Google restricts it to well-known government and health sites. Keep it for entity understanding, expect no SERP gain.',
        severity: 'info',
      })
    }
  }

  // ─── BreadcrumbList ────────────────────────────────────────────────────

  private validateBreadcrumbList(node: JsonObject, path: string, issues: JsonLdIssue[]): void {
    const items = node.itemListElement

    if (!Array.isArray(items) || items.length === 0) {
      issues.push({
        node: `${path}.itemListElement`,
        code: 'MISSING_REQUIRED_PROPERTY',
        message: 'BreadcrumbList requires a non-empty "itemListElement" array',
        severity: 'error',
      })
      return
    }

    const positions: number[] = []

    items.forEach((item, index) => {
      const itemPath = `${path}.itemListElement[${index}]`

      if (!isPlainObject(item)) {
        issues.push({
          node: itemPath,
          code: 'NOT_AN_OBJECT',
          message: 'BreadcrumbList entries must be ListItem objects',
          severity: 'error',
        })
        return
      }

      const types = readTypes(item)
      if (!types.includes('ListItem')) {
        issues.push({
          node: itemPath,
          code: 'UNEXPECTED_TYPE',
          message: `BreadcrumbList entries must be @type "ListItem", got "${types.join(', ') || 'none'}"`,
          severity: 'error',
        })
      }

      const position = toNumber(item.position)
      if (position === null || !Number.isInteger(position)) {
        issues.push({
          node: `${itemPath}.position`,
          code: 'BREADCRUMB_POSITION_INVALID',
          message: 'ListItem requires an integer "position"',
          severity: 'error',
        })
      } else {
        positions.push(position)
      }

      const name = isNonEmptyString(item.name)
        ? true
        : isPlainObject(item.item) && isNonEmptyString((item.item as JsonObject).name)

      if (!name) {
        issues.push({
          node: `${itemPath}.name`,
          code: 'EMPTY_REQUIRED_PROPERTY',
          message: 'ListItem requires a "name" (or an "item" carrying one)',
          severity: 'error',
        })
      }

      // The final crumb is the current page and may omit "item".
      const isLast = index === items.length - 1
      const target = item.item
      if (!isLast) {
        const url = typeof target === 'string' ? target : isPlainObject(target) ? (target['@id'] ?? target.url) : undefined
        if (!isNonEmptyString(url)) {
          issues.push({
            node: `${itemPath}.item`,
            code: 'MISSING_REQUIRED_PROPERTY',
            message: 'Every ListItem but the last requires an "item" URL',
            severity: 'error',
          })
        } else if (!isLikelyUrl(url as string)) {
          issues.push({
            node: `${itemPath}.item`,
            code: 'INVALID_URL',
            message: `ListItem "item" must be an absolute URL, got "${url as string}"`,
            severity: 'error',
          })
        }
      }
    })

    if (positions.length > 0) {
      const sorted = [...positions].sort((a, b) => a - b)
      const contiguous = sorted.every((value, index) => value === index + 1)
      if (!contiguous) {
        issues.push({
          node: `${path}.itemListElement`,
          code: 'BREADCRUMB_POSITION_INVALID',
          message: `Breadcrumb positions must run 1..n without gaps, got [${sorted.join(', ')}]`,
          severity: 'error',
        })
      }
    }
  }

  // ─── Article ───────────────────────────────────────────────────────────

  private validateArticle(node: JsonObject, path: string, issues: JsonLdIssue[]): void {
    if (!isNonEmptyString(node.headline) && !isNonEmptyString(node.name)) {
      issues.push({
        node: `${path}.headline`,
        code: 'MISSING_REQUIRED_PROPERTY',
        message: 'Article requires a "headline"',
        severity: 'error',
      })
    }

    if (this.config.checkRecommended) {
      for (const key of ['image', 'datePublished', 'author']) {
        if (node[key] === undefined || node[key] === null || node[key] === '') {
          issues.push({
            node: `${path}.${key}`,
            code: 'RECOMMENDED_PROPERTY_MISSING',
            message: `Article should carry "${key}"`,
            severity: 'warning',
          })
        }
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private requireNonEmptyString(
    node: JsonObject,
    key: string,
    path: string,
    typeName: string,
    issues: JsonLdIssue[]
  ): void {
    if (!isNonEmptyString(node[key])) {
      issues.push({
        node: `${path}.${key}`,
        code: node[key] === undefined ? 'MISSING_REQUIRED_PROPERTY' : 'EMPTY_REQUIRED_PROPERTY',
        message: `${typeName} requires a non-empty "${key}"`,
        severity: 'error',
      })
    }
  }

  private buildResult(
    issues: JsonLdIssue[],
    types: string[],
    nodesValidated: number,
    isPresent: boolean
  ): JsonLdValidationResult {
    const errors = issues.filter(issue => issue.severity === 'error')
    const warnings = issues.filter(issue => issue.severity === 'warning')
    const infos = issues.filter(issue => issue.severity === 'info')

    return {
      isValid: errors.length === 0,
      isPresent,
      types,
      errors,
      warnings,
      infos,
      nodesValidated,
    }
  }
}

// ─── Value helpers ───────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value.trim())
}

function readTypes(node: JsonObject): string[] {
  const raw = node['@type']
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : []
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return []
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createJsonLdValidator(config?: JsonLdValidationConfig): JsonLdValidator {
  return new JsonLdValidator(config)
}
