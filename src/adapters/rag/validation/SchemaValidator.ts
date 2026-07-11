// ─────────────────────────────────────────────────────────────────────────────
// Schema Validator
// SEO Engine - Validation Pipeline
// Validates content against CMS schema requirements
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentSchema, ContentType, ContentField } from '@/src/core/domain/entities'

/**
 * Configuration de validation
 */
export interface SchemaValidationConfig {
  strict?: boolean
  validateRequired?: boolean
  validateTypes?: boolean
  validateConstraints?: boolean
  validateCrossField?: boolean
}

/**
 * Résultat de validation
 */
export interface SchemaValidationResult {
  isValid: boolean
  errors: SchemaValidationError[]
  warnings: SchemaValidationWarning[]
  metadata: SchemaValidationMetadata
}

/**
 * Erreur de validation
 */
export interface SchemaValidationError {
  field: string
  code: SchemaValidationErrorCode
  message: string
  value?: unknown
  constraint?: string
}

/**
 * Avertissement de validation
 */
export interface SchemaValidationWarning {
  field: string
  code: SchemaValidationWarningCode
  message: string
  suggestion?: string
}

/**
 * Codes d'erreur
 */
export type SchemaValidationErrorCode =
  | 'REQUIRED_FIELD_MISSING'
  | 'INVALID_TYPE'
  | 'CONSTRAINT_VIOLATION'
  | 'FIELD_NOT_IN_SCHEMA'
  | 'INVALID_VALUE'
  | 'MAX_LENGTH_EXCEEDED'
  | 'MIN_LENGTH_NOT_MET'
  | 'PATTERN_MISMATCH'
  | 'OPTIONS_MISMATCH'

/**
 * Codes d'avertissement
 */
export type SchemaValidationWarningCode =
  | 'SUGGESTED_FIELD_MISSING'
  | 'TYPE_COERCION'
  | 'FORMAT_WARNING'
  | 'DEPRECATED_FIELD'
  | 'EMPTY_FIELD'

/**
 * Métadonnées de validation
 */
export interface SchemaValidationMetadata {
  schemaId: string
  contentType: string
  validatedAt: string
  fieldsValidated: number
  fieldsPassed: number
  fieldsFailed: number
  validationLevel: 'strict' | 'standard' | 'lenient'
}

/**
 * Contenu à valider
 */
export interface ValidatableContent {
  fields: Record<string, unknown>
  contentType: string
}

/**
 * Validateur de schéma
 */
export class SchemaValidator {
  private schema: ContentSchema
  private config: SchemaValidationConfig

  constructor(schema: ContentSchema, config: SchemaValidationConfig = {}) {
    this.schema = schema
    this.config = {
      strict: false,
      validateRequired: true,
      validateTypes: true,
      validateConstraints: true,
      validateCrossField: false,
      ...config,
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Valide du contenu contre le schéma
   */
  validate(content: ValidatableContent): SchemaValidationResult {
    const errors: SchemaValidationError[] = []
    const warnings: SchemaValidationWarning[] = []

    // Trouver le content type
    const contentType = this.schema.contentTypes.find(
      ct => ct.key === content.contentType
    )

    if (!contentType) {
      errors.push({
        field: 'contentType',
        code: 'FIELD_NOT_IN_SCHEMA',
        message: `Content type "${content.contentType}" not found in schema`,
      })

      return this.buildResult(false, errors, warnings, contentType)
    }

    // Valider chaque champ
    const validatedFields = this.validateFields(content.fields, contentType, errors, warnings)

    // Validation cross-field si activée
    if (this.config.validateCrossField) {
      this.validateCrossFields(content.fields, contentType, errors, warnings)
    }

    const isValid = errors.length === 0

    return this.buildResult(isValid, errors, warnings, contentType, validatedFields)
  }

  /**
   * Valide un seul champ
   */
  validateField(fieldKey: string, value: unknown): SchemaValidationResult {
    const errors: SchemaValidationError[] = []
    const warnings: SchemaValidationWarning[] = []

    // Trouver le champ dans tous les content types
    let field: ContentField | undefined
    let contentType: ContentType | undefined

    for (const ct of this.schema.contentTypes) {
      const found = ct.fields.find(f => f.key === fieldKey)
      if (found) {
        field = found
        contentType = ct
        break
      }
    }

    if (!field) {
      errors.push({
        field: fieldKey,
        code: 'FIELD_NOT_IN_SCHEMA',
        message: `Field "${fieldKey}" not found in schema`,
      })
      return this.buildResult(false, errors, warnings, contentType)
    }

    // Valider la présence si requis
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: fieldKey,
        code: 'REQUIRED_FIELD_MISSING',
        message: `Required field "${field.label}" is missing`,
      })
    }

    // Valider le type
    if (value !== undefined && value !== null && this.config.validateTypes) {
      this.validateFieldType(field, value, errors)
    }

    // Valider les contraintes
    if (value !== undefined && value !== null && this.config.validateConstraints) {
      this.validateConstraints(field, value, errors, warnings)
    }

    const isValid = errors.length === 0
    return this.buildResult(isValid, errors, warnings, contentType, 1)
  }

  /**
   * Valide rapidement (sans détails)
   */
  isValid(content: ValidatableContent): boolean {
    return this.validate(content).isValid
  }

  // ─── Private Methods ───────────────────────────────────────────────────

  private validateFields(
    fields: Record<string, unknown>,
    contentType: ContentType,
    errors: SchemaValidationError[],
    warnings: SchemaValidationWarning[]
  ): number {
    let validated = 0
    const fieldKeys = new Set(Object.keys(fields))

    // Valider chaque champ défini dans le schéma
    for (const field of contentType.fields) {
      validated++
      const value = fields[field.key]

      // Champ requis mais manquant
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: field.key,
          code: 'REQUIRED_FIELD_MISSING',
          message: `Required field "${field.label}" is missing or empty`,
          value,
        })
        continue
      }

      // Champ vide mais suggéré
      if (!field.required && (value === undefined || value === null || value === '')) {
        warnings.push({
          field: field.key,
          code: 'EMPTY_FIELD',
          message: `Suggested field "${field.label}" is empty`,
          suggestion: `Consider adding content for "${field.label}"`,
        })
      }

      // Champ avec valeur - valider le type
      if (value !== undefined && value !== null && value !== '') {
        if (this.config.validateTypes) {
          this.validateFieldType(field, value, errors)
        }

        if (this.config.validateConstraints) {
          this.validateConstraints(field, value, errors, warnings)
        }
      }
    }

    // Champs non définis dans le schéma
    for (const key of fieldKeys) {
      if (!contentType.fields.find(f => f.key === key)) {
        warnings.push({
          field: key,
          code: 'DEPRECATED_FIELD',
          message: `Field "${key}" is not defined in schema`,
          suggestion: 'Remove or update this field to match the schema',
        })
      }
    }

    return validated
  }

  private validateFieldType(
    field: ContentField,
    value: unknown,
    errors: SchemaValidationError[]
  ): void {
    const typeError = this.checkType(field, value)
    if (typeError) {
      errors.push({
        field: field.key,
        code: 'INVALID_TYPE',
        message: typeError,
        value,
        constraint: `expected type: ${field.type}`,
      })
    }
  }

  private checkType(field: ContentField, value: unknown): string | null {
    const { type } = field

    // Définir les types valides par catégorie
    const stringTypes = ['text', 'slug', 'email', 'url', 'html', 'rich-text', 'meta', 'phone', 'address', 'json']
    const numberTypes = ['number']
    const booleanTypes = ['boolean']
    const arrayTypes = ['array', 'gallery', 'flexible-content', 'repeater']
    const objectTypes = ['object', 'group', 'block-content']
    const mediaTypes = ['image', 'file']
    const referenceTypes = ['reference']

    if (stringTypes.includes(type)) {
      if (typeof value !== 'string') {
        return `Expected string for field "${field.key}", got ${typeof value}`
      }
    } else if (numberTypes.includes(type)) {
      if (typeof value !== 'number') {
        return `Expected number for field "${field.key}", got ${typeof value}`
      }
    } else if (booleanTypes.includes(type)) {
      if (typeof value !== 'boolean') {
        return `Expected boolean for field "${field.key}", got ${typeof value}`
      }
    } else if (arrayTypes.includes(type)) {
      if (!Array.isArray(value)) {
        return `Expected array for field "${field.key}", got ${typeof value}`
      }
    } else if (objectTypes.includes(type)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `Expected object for field "${field.key}", got ${typeof value}`
      }
    } else if (mediaTypes.includes(type) || referenceTypes.includes(type)) {
      if (typeof value !== 'object') {
        return `Expected object for field "${field.key}"`
      }
    }

    return null
  }

  private validateConstraints(
    field: ContentField,
    value: unknown,
    errors: SchemaValidationError[],
    warnings: SchemaValidationWarning[]
  ): void {
    const config = field.config
    if (!config) return

    // Longueur minimale
    if (config.minLength !== undefined && typeof value === 'string') {
      if (value.length < config.minLength) {
        errors.push({
          field: field.key,
          code: 'MIN_LENGTH_NOT_MET',
          message: `Field "${field.key}" must be at least ${config.minLength} characters (current: ${value.length})`,
          value,
          constraint: `minLength: ${config.minLength}`,
        })
      }
    }

    // Longueur maximale
    if (config.maxLength !== undefined && typeof value === 'string') {
      if (value.length > config.maxLength) {
        errors.push({
          field: field.key,
          code: 'MAX_LENGTH_EXCEEDED',
          message: `Field "${field.key}" must be at most ${config.maxLength} characters (current: ${value.length})`,
          value,
          constraint: `maxLength: ${config.maxLength}`,
        })
      }
    }

    // Valeur minimale
    if (config.min !== undefined && typeof value === 'number') {
      if (value < config.min) {
        errors.push({
          field: field.key,
          code: 'CONSTRAINT_VIOLATION',
          message: `Field "${field.key}" must be at least ${config.min} (current: ${value})`,
          value,
          constraint: `min: ${config.min}`,
        })
      }
    }

    // Valeur maximale
    if (config.max !== undefined && typeof value === 'number') {
      if (value > config.max) {
        errors.push({
          field: field.key,
          code: 'CONSTRAINT_VIOLATION',
          message: `Field "${field.key}" must be at most ${config.max} (current: ${value})`,
          value,
          constraint: `max: ${config.max}`,
        })
      }
    }

    // Pattern (regex)
    if (config.pattern && typeof value === 'string') {
      try {
        const regex = new RegExp(config.pattern)
        if (!regex.test(value)) {
          errors.push({
            field: field.key,
            code: 'PATTERN_MISMATCH',
            message: `Field "${field.key}" does not match required pattern`,
            value,
            constraint: `pattern: ${config.pattern}`,
          })
        }
      } catch {
        // Pattern invalide - avertissement
        warnings.push({
          field: field.key,
          code: 'FORMAT_WARNING',
          message: `Invalid regex pattern in field "${field.key}"`,
        })
      }
    }

    // Nombre minimum d'items
    if (config.minItems !== undefined && Array.isArray(value)) {
      if (value.length < config.minItems) {
        errors.push({
          field: field.key,
          code: 'CONSTRAINT_VIOLATION',
          message: `Field "${field.key}" must have at least ${config.minItems} items (current: ${value.length})`,
          value,
          constraint: `minItems: ${config.minItems}`,
        })
      }
    }

    // Nombre maximum d'items
    if (config.maxItems !== undefined && Array.isArray(value)) {
      if (value.length > config.maxItems) {
        errors.push({
          field: field.key,
          code: 'CONSTRAINT_VIOLATION',
          message: `Field "${field.key}" must have at most ${config.maxItems} items (current: ${value.length})`,
          value,
          constraint: `maxItems: ${config.maxItems}`,
        })
      }
    }
  }

  private validateCrossFields(
    fields: Record<string, unknown>,
    contentType: ContentType,
    errors: SchemaValidationError[],
    warnings: SchemaValidationWarning[]
  ): void {
    // Exemple: si featured_image est présent, le champ image doit être rempli
    const hasImage = fields.featured_image || fields.image
    const hasImageAlt = fields.image_alt || fields.alt_text

    if (hasImage && !hasImageAlt) {
      warnings.push({
        field: 'image_alt',
        code: 'EMPTY_FIELD',
        message: 'Image is present but alt text is missing',
        suggestion: 'Add descriptive alt text for accessibility and SEO',
      })
    }

    // Exemple: si slug est personnalisé, vérifier qu'il n'existe pas déjà
    const slug = fields.slug
    if (slug && typeof slug === 'string') {
      if (slug.length < 3) {
        errors.push({
          field: 'slug',
          code: 'MIN_LENGTH_NOT_MET',
          message: 'Slug must be at least 3 characters',
        })
      }
      if (!/^[a-z0-9-]+$/.test(slug)) {
        errors.push({
          field: 'slug',
          code: 'PATTERN_MISMATCH',
          message: 'Slug must contain only lowercase letters, numbers, and hyphens',
          constraint: 'pattern: ^[a-z0-9-]+$',
        })
      }
    }
  }

  private buildResult(
    isValid: boolean,
    errors: SchemaValidationError[],
    warnings: SchemaValidationWarning[],
    contentType?: ContentType,
    fieldsValidated = 0
  ): SchemaValidationResult {
    return {
      isValid,
      errors,
      warnings,
      metadata: {
        schemaId: this.schema.id,
        contentType: contentType?.key || 'unknown',
        validatedAt: new Date().toISOString(),
        fieldsValidated,
        fieldsPassed: fieldsValidated - errors.length,
        fieldsFailed: errors.length,
        validationLevel: this.config.strict ? 'strict' : 'standard',
      },
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSchemaValidator(
  schema: ContentSchema,
  config?: SchemaValidationConfig
): SchemaValidator {
  return new SchemaValidator(schema, config)
}
