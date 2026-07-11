// ─────────────────────────────────────────────────────────────────────────────
// SchemaValidator Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { SchemaValidator, createSchemaValidator } from './SchemaValidator'
import type { ContentSchema, ContentField } from '@/src/core/domain/entities'

// Helper to create a test schema
function createTestSchema(overrides?: Partial<ContentSchema>): ContentSchema {
  return {
    id: 'test-schema',
    name: 'Test Schema',
    contentTypes: [
      {
        key: 'post',
        name: 'Blog Post',
        fields: [
          {
            key: 'title',
            label: 'Title',
            type: 'text',
            required: true,
            config: { minLength: 5, maxLength: 100 },
          },
          {
            key: 'content',
            label: 'Content',
            type: 'html',
            required: true,
            config: { minLength: 100 },
          },
          {
            key: 'slug',
            label: 'Slug',
            type: 'slug',
            required: true,
            config: { pattern: '^[a-z0-9-]+$' },
          },
          {
            key: 'category',
            label: 'Category',
            type: 'select',
            required: false,
            config: { options: ['news', 'tutorial', 'guide'] },
          },
          {
            key: 'featured_image',
            label: 'Featured Image',
            type: 'image',
            required: false,
          },
          {
            key: 'image_alt',
            label: 'Image Alt Text',
            type: 'text',
            required: false,
          },
          {
            key: 'publish_date',
            label: 'Publish Date',
            type: 'datetime',
            required: false,
          },
          {
            key: 'word_count',
            label: 'Word Count',
            type: 'integer',
            required: false,
            config: { min: 0, max: 50000 },
          },
          {
            key: 'is_featured',
            label: 'Featured',
            type: 'boolean',
            required: false,
          },
          {
            key: 'tags',
            label: 'Tags',
            type: 'array',
            required: false,
          },
          {
            key: 'metadata',
            label: 'Metadata',
            type: 'object',
            required: false,
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe('SchemaValidator', () => {
  let validator: SchemaValidator
  let testSchema: ContentSchema

  beforeEach(() => {
    testSchema = createTestSchema()
    validator = new SchemaValidator(testSchema)
  })

  describe('validate()', () => {
    it('should return isValid=true for valid content', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Mon premier article',
          content: '<p>Contenu avec plus de cent mots pour dépasser la validation minimale. '.repeat(10),
          slug: 'mon-premier-article',
          category: 'news',
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect missing required fields', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Mon titre',
          // missing content and slug
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'REQUIRED_FIELD_MISSING')).toBe(true)
    })

    it('should detect invalid content type', () => {
      const content = {
        contentType: 'nonexistent',
        fields: {},
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'FIELD_NOT_IN_SCHEMA')).toBe(true)
    })

    it('should detect invalid field types', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 123, // should be string
          content: '<p>Test</p>'.repeat(20),
          slug: 'valid-slug',
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_TYPE')).toBe(true)
    })

    it('should detect minLength violations', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Hi', // too short, min is 5
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'MIN_LENGTH_NOT_MET')).toBe(true)
    })

    it('should detect maxLength violations', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'A'.repeat(150), // too long, max is 100
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'MAX_LENGTH_EXCEEDED')).toBe(true)
    })

    it('should detect pattern mismatches', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Valid Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'Invalid Slug With Spaces', // should not have spaces
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'PATTERN_MISMATCH')).toBe(true)
    })

    it('should validate select field', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          category: 'news',
        },
      }

      const result = validator.validate(content)

      expect(result.errors.some(e => e.code === 'OPTIONS_MISMATCH')).toBe(false)
    })

    it('should warn about empty optional fields', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          // missing optional fields
        },
      }

      const result = validator.validate(content)

      expect(result.warnings.some(w => w.code === 'EMPTY_FIELD')).toBe(true)
    })

    it('should detect invalid integer values', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          word_count: 'not a number',
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_TYPE')).toBe(true)
    })

    it('should validate integer constraints', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          word_count: -100, // negative, min is 0
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'CONSTRAINT_VIOLATION')).toBe(true)
    })

    it('should detect non-boolean for boolean field', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          is_featured: 'yes', // should be boolean
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_TYPE')).toBe(true)
    })

    it('should detect non-array for array field', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          tags: 'not an array',
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_TYPE')).toBe(true)
    })

    it('should validate object fields', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          metadata: { key: 'value' },
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(true)
    })

    it('should detect invalid date format', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          publish_date: 'not-a-date',
        },
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_TYPE')).toBe(true)
    })

    it('should warn about deprecated fields', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
          deprecated_field: 'some value', // not in schema
        },
      }

      const result = validator.validate(content)

      expect(result.warnings.some(w => w.code === 'DEPRECATED_FIELD')).toBe(true)
    })
  })

  describe('validateField()', () => {
    it('should validate a single field', () => {
      const result = validator.validateField('title', 'Valid Title')

      expect(result.isValid).toBe(true)
    })

    it('should detect missing required field', () => {
      const result = validator.validateField('title', '')

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'REQUIRED_FIELD_MISSING')).toBe(true)
    })

    it('should detect invalid field type', () => {
      const result = validator.validateField('title', 123)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_TYPE')).toBe(true)
    })

    it('should return error for unknown field', () => {
      const result = validator.validateField('unknown_field', 'value')

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'FIELD_NOT_IN_SCHEMA')).toBe(true)
    })
  })

  describe('isValid()', () => {
    it('should return true for valid content', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Valid Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
        },
      }

      expect(validator.isValid(content)).toBe(true)
    })

    it('should return false for invalid content', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Hi', // too short
          content: '<p>Short</p>',
          slug: 'valid',
        },
      }

      expect(validator.isValid(content)).toBe(false)
    })
  })

  describe('strict mode', () => {
    it('should set validation level to strict', () => {
      const strictValidator = new SchemaValidator(testSchema, { strict: true })
      const content = {
        contentType: 'post',
        fields: {
          title: 'Valid',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
        },
      }

      const result = strictValidator.validate(content)

      expect(result.metadata.validationLevel).toBe('strict')
    })
  })

  describe('metadata', () => {
    it('should include correct metadata in result', () => {
      const content = {
        contentType: 'post',
        fields: {
          title: 'Valid Title',
          content: '<p>Long content here.</p>'.repeat(20),
          slug: 'valid-slug',
        },
      }

      const result = validator.validate(content)

      expect(result.metadata.schemaId).toBe('test-schema')
      expect(result.metadata.contentType).toBe('post')
      expect(result.metadata.fieldsValidated).toBeGreaterThan(0)
    })
  })

  describe('createSchemaValidator factory', () => {
    it('should create validator with default config', () => {
      const v = createSchemaValidator(testSchema)
      expect(v).toBeInstanceOf(SchemaValidator)
    })

    it('should create validator with custom config', () => {
      const v = createSchemaValidator(testSchema, { strict: true })
      expect(v).toBeInstanceOf(SchemaValidator)
    })
  })
})
