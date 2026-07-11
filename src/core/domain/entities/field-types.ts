// ─────────────────────────────────────────────────────────────────────────────
// Field Types - TypeScript types for field definitions
// ─────────────────────────────────────────────────────────────────────────────

// ─── Core Field Types ─────────────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'rich-text'
  | 'html'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'image'
  | 'gallery'
  | 'file'
  | 'url'
  | 'email'
  | 'phone'
  | 'address'
  | 'object'
  | 'array'
  | 'reference'
  | 'block-content'
  | 'slug'
  | 'select'
  | 'checkbox'
  | 'repeater'
  | 'group'
  | 'flexible-content'
  | 'meta'
  | 'json'

// ─── Field Configuration ────────────────────────────────────────────────────────

export interface FieldConfig {
  // Text constraints
  minLength?: number
  maxLength?: number
  pattern?: string

  // Number constraints
  min?: number
  max?: number
  step?: number

  // Array/Collection constraints
  options?: string[]
  maxItems?: number
  minItems?: number

  // Object/Group - nested fields
  fields?: import('../entities').ContentField[]

  // Reference constraints
  to?: string[]
  maxReferences?: number

  // Block Content (Sanity) - allowed block types
  blockTypes?: string[]

  // Select options with labels
  optionLabels?: Record<string, string>

  // Default value
  defaultValue?: unknown

  // Placeholder
  placeholder?: string
}

// ─── ACF Field Configuration (WordPress) ──────────────────────────────────────

export interface AcfFieldConfig {
  type: string
  name: string
  groupId: number | string
  groupName?: string
  rules?: AcfLocationRule[]
  subFields?: import('../entities').ContentField[]
  layouts?: AcfFlexibleLayout[]
}

export interface AcfLocationRule {
  param: string
  operator: string
  value: string | number
}

export interface AcfFlexibleLayout {
  name: string
  label: string
  fields: import('../entities').ContentField[]
}

// ─── Type Mapping for ACF ─────────────────────────────────────────────────────

export const ACF_TYPE_MAPPING: Record<string, FieldType> = {
  text: 'text',
  textarea: 'text',
  wysiwyg: 'html',
  number: 'number',
  email: 'email',
  url: 'url',
  password: 'text',
  image: 'image',
  file: 'file',
  gallery: 'gallery',
  select: 'select',
  checkbox: 'checkbox',
  radio: 'select',
  true_false: 'boolean',
  date_picker: 'date',
  date_time_picker: 'datetime',
  time_picker: 'datetime',
  repeater: 'repeater',
  flexible_content: 'flexible-content',
  group: 'group',
  clone: 'group',
  oembed: 'url',
  google_map: 'address',
  relationship: 'reference',
  post_object: 'reference',
  page_link: 'url',
  taxonomy: 'reference',
  user: 'reference',
  color_picker: 'text',
  font_awesome: 'select',
}

// ─── Type Mapping for Sanity ──────────────────────────────────────────────────

export const SANITY_TYPE_MAPPING: Record<string, FieldType> = {
  string: 'text',
  text: 'rich-text',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  image: 'image',
  file: 'file',
  url: 'url',
  email: 'email',
  slug: 'slug',
  object: 'object',
  array: 'array',
  reference: 'reference',
  document: 'group',
  block: 'block-content',
  span: 'rich-text',
  geopoint: 'object',
  crossDatasetReference: 'reference',
  crossDatasetReferences: 'array',
}

// ─── Validation Functions ─────────────────────────────────────────────────────

export function isTextType(type: FieldType): boolean {
  return ['text', 'rich-text', 'html'].includes(type)
}

export function isNumericType(type: FieldType): boolean {
  return type === 'number'
}

export function isMediaType(type: FieldType): boolean {
  return ['image', 'gallery', 'file'].includes(type)
}

export function isComplexType(type: FieldType): boolean {
  return ['object', 'array', 'group', 'repeater', 'flexible-content', 'block-content'].includes(type)
}

export function isReferenceType(type: FieldType): boolean {
  return type === 'reference'
}

export function isSeoType(type: FieldType): boolean {
  return type === 'meta'
}

// ─── Default Examples ─────────────────────────────────────────────────────────

export function getDefaultExample(type: FieldType, config?: FieldConfig): string {
  switch (type) {
    case 'text':
    case 'slug':
      return 'exemple-de-texte'

    case 'rich-text':
    case 'html':
      return '<p>Contenu avec <strong>formatage</strong></p>'

    case 'block-content':
      return '[{"_type":"block","_key":"abc123","children":[{"_type":"span","text":"Contenu du bloc"}]}]'

    case 'number':
      return '42'

    case 'boolean':
      return 'true'

    case 'date':
      return new Date().toISOString().split('T')[0]

    case 'datetime':
      return new Date().toISOString()

    case 'image':
      return '{"_type":"image","alt":"Description de l\'image"}'

    case 'gallery':
      return '[{"_type":"image","alt":"Image 1"},{"_type":"image","alt":"Image 2"}]'

    case 'file':
      return '{"_type":"file","title":"Document PDF"}'

    case 'url':
      return 'https://example.com'

    case 'email':
      return 'contact@example.com'

    case 'phone':
      return '+33 1 23 45 67 89'

    case 'address':
      return '{"street":"1 Rue de la Paix","city":"Paris","postalCode":"75001"}'

    case 'select':
      return `"${config?.options?.[0] ?? 'option1'}"`

    case 'checkbox':
      return 'true'

    case 'reference':
      return '{"_type":"reference","_ref":"document-id"}'

    case 'object':
      return '{}'

    case 'array':
      return '[{"key":"item1"},{"key":"item2"}]'

    case 'group':
      return '{}'

    case 'repeater':
      return '[{"field1":"value1"},{"field1":"value2"}]'

    case 'flexible-content':
      return '[{"_type":"layout1","content":"..."}]'

    case 'meta':
      return '"Texte optimisé pour le SEO"'

    case 'json':
      return '{}'

    default:
      return '"valeur"'
  }
}

// ─── Format Rules ─────────────────────────────────────────────────────────────

export function getFormatRule(type: FieldType, config?: FieldConfig): string {
  switch (type) {
    case 'text':
      return `Texte plain, max ${config?.maxLength ?? 255} caractères`

    case 'slug':
      return 'Format URL-safe (ex: "ma-page-seo-troyes")'

    case 'rich-text':
    case 'html':
      return 'HTML valide avec balises sémantiques (<p>, <h2>, <ul>, <strong>)'

    case 'block-content':
      return 'Portable Text Sanity: array de blocks avec _type, _key, children'

    case 'number':
      return `Nombre${config?.min !== undefined ? ` entre ${config.min}` : ''}${config?.max !== undefined ? ` et ${config.max}` : ''}`

    case 'boolean':
      return 'true ou false'

    case 'date':
      return 'Format ISO: YYYY-MM-DD'

    case 'datetime':
      return 'Format ISO: YYYY-MM-DDTHH:mm:ssZ'

    case 'image':
      return 'Objet avec _type: "image" et alt text'

    case 'gallery':
      return 'Array d\'objets image'

    case 'file':
      return 'Objet avec _type: "file"'

    case 'url':
      return 'URL absolue valide (https://...)'

    case 'email':
      return 'Adresse email valide'

    case 'phone':
      return 'Numéro de téléphone (format international recommandé)'

    case 'address':
      return 'Objet avec rue, ville, code postal'

    case 'select':
      return `Une des options: ${config?.options?.join(', ') ?? 'options'}`

    case 'checkbox':
      return 'true ou false'

    case 'reference':
      return `Référence vers un document de type: ${config?.to?.join(', ') ?? 'document'}`

    case 'object':
      return 'Objet JSON structuré'

    case 'array':
      return `Array de ${config?.maxItems ? `max ${config.maxItems} items` : 'items'}`

    case 'group':
      return 'Groupe de champs imbriqués'

    case 'repeater':
      return `Array répétable de ${config?.fields?.map(f => f.label).join(', ') ?? 'champs'}`

    case 'flexible-content':
      return 'Array de layouts flexibles'

    case 'meta':
      return 'Texte optimisé SEO (title: ~60 chars, description: ~160 chars)'

    case 'json':
      return 'JSON valide'

    default:
      return `Valeur de type: ${type}`
  }
}
