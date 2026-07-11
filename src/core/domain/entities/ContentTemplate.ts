// ─────────────────────────────────────────────────────────────────────────────
// ContentTemplate Model
// SEO Engine - Universal Template System
// Defines templates for content generation per content type and platform
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Template de contenu
 * Définit la structure et les instructions pour générer du contenu
 */
export interface ContentTemplate {
  id: string
  name: string
  description?: string

  // Platform et type
  platform: Platform
  contentTypeKey: string

  // Structure du template
  structure: TemplateStructure

  // Variations disponibles
  variants: TemplateVariant[]

  // SEO requirements
  seoRequirements: SeoRequirements

  // Configuration
  config: TemplateConfig

  // Versioning
  version: number
  parentTemplateId?: string

  // Audit
  createdAt: Date
  updatedAt: Date
  createdBy?: string
}

/**
 * Plateforme cible
 */
export type Platform = 'wordpress' | 'sanity' | 'nextjs'

/**
 * Structure d'un template
 */
export interface TemplateStructure {
  // Sections du template (ordre d'exécution)
  sections: TemplateSection[]

  // Champs requis
  requiredFields: string[]

  // Champs optionnels
  optionalFields: string[]

  // Mapping vers les champs du CMS
  fieldMapping: FieldMapping[]

  // Blocks réutilisables
  blocks: TemplateBlock[]
}

/**
 * Section d'un template
 */
export interface TemplateSection {
  id: string
  name: string
  type: SectionType

  // Contenu/instructions
  instructions: string
  promptTemplate?: string

  // Configuration
  config: SectionConfig

  // Conditions d'inclusion
  conditions?: TemplateCondition[]

  // Sous-sections
  subsections?: TemplateSection[]
}

/**
 * Types de sections
 */
export type SectionType =
  | 'introduction'    // Introduction du contenu
  | 'main_content'    // Corps principal
  | 'faq'            // Section FAQ
  | 'conclusion'     // Conclusion
  | 'cta'            // Call to action
  | 'schema'         // Schema.org markup
  | 'meta'           // Meta tags (title, description)
  | 'header'         // Header/Hero
  | 'sidebar'        // Sidebar content
  | 'related'        // Contenu lié
  | 'custom'         // Section personnalisée

/**
 * Configuration de section
 */
export interface SectionConfig {
  // Longueur
  minWords?: number
  maxWords?: number
  targetWords?: number

  // Structure
  requiredHeadings?: string[] // H2, H3 requis
  maxHeadings?: number

  // Contenu
  keywordsToInclude?: string[]
  keywordsToExclude?: string[]
  requiredElements?: string[] // 'image', 'list', 'table'

  // Formatage
  format?: 'plain' | 'html' | 'markdown' | 'portable_text'

  // Position
  position?: 'start' | 'end' | 'middle'
  positionAfter?: string // Section ID
}

/**
 * Condition pour inclure une section
 */
export interface TemplateCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'exists' | 'greater_than' | 'less_than'
  value: string | number | boolean
}

/**
 * Bloc réutilisable
 */
export interface TemplateBlock {
  id: string
  name: string
  type: BlockType
  content: string
  config: BlockConfig
}

/**
 * Types de blocs
 */
export type BlockType =
  | 'text'           // Bloc texte simple
  | 'heading'        // Titre (H2, H3, etc.)
  | 'list'           // Liste (ul, ol)
  | 'table'          // Tableau
  | 'quote'          // Citation
  | 'callout'        // Encadré d'information
  | 'cta'            // Bouton/Lien CTA
  | 'image'          // Image avec caption
  | 'video'          // Vidéo embed
  | 'accordion'      // Accordion FAQ
  | 'schema'         // Schema.org markup
  | 'social'         // Liens sociaux

/**
 * Configuration de bloc
 */
export interface BlockConfig {
  // Pour images
  altRequired?: boolean
  captionRequired?: boolean
  maxImages?: number

  // Pour listes
  ordered?: boolean
  minItems?: number
  maxItems?: number

  // Pour CTA
  buttonText?: string
  buttonUrl?: string

  // Pour schema
  schemaType?: string
  schemaProperties?: Record<string, unknown>
}

/**
 * Mapping vers les champs CMS
 */
export interface FieldMapping {
  // Champ dans notre système
  templateField: string

  // Champ cible selon la plateforme
  wordpressField?: string
  sanityField?: string
  nextjsField?: string

  // Configuration
  transform?: FieldTransform
  validation?: FieldValidation
}

/**
 * Transformation de champ
 */
export interface FieldTransform {
  type: 'none' | 'html_to_plain' | 'plain_to_html' | 'markdown_to_html' | 'html_to_portable_text' | 'sanity_portable_text' | 'custom'
  customFunction?: string // Nom de la fonction JS
}

/**
 * Validation de champ
 */
export interface FieldValidation {
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: string
  customValidation?: string
}

/**
 * Variation de template
 */
export interface TemplateVariant {
  id: string
  name: string
  description?: string
  type: VariantType

  // Règles de sélection
  selectionRules: VariantSelectionRule[]

  // Personnalisations
  modifications: VariantModifications

  //权重 pour A/B testing
  weight?: number // 0-100

  // Active ou non
  isActive: boolean
}

/**
 * Types de variants
 */
export type VariantType =
  | 'seasonal'        // Noël, été, etc.
  | 'localized'       // Par région/langue
  | 'audience'        // Par persona
  | 'ab_test'         // A/B testing
  | 'format'          // Format différent (list vs paragraphes)
  | 'length'          // Court vs long

/**
 * Règle de sélection de variant
 */
export interface VariantSelectionRule {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'in' | 'date_range' | 'user_agent' | 'exists' | 'greater_than' | 'less_than'
  value: string | string[] | { start: string; end: string } | number
  weight?: number
}

/**
 * Modifications apportées par un variant
 */
export interface VariantModifications {
  // Sections à ajouter/supprimer
  addSections?: string[]
  removeSections?: string[]
  modifySections?: Record<string, Partial<TemplateSection>>

  // Modifications de prompts
  modifyInstructions?: Record<string, string>
  prependPrompt?: string
  appendPrompt?: string

  // Modifications SEO
  seoOverrides?: Partial<SeoRequirements>
}

/**
 * Requirements SEO pour un template
 */
export interface SeoRequirements {
  // Meta
  metaTitle?: MetaRequirement
  metaDescription?: MetaRequirement

  // Contenu
  minWordCount: number
  maxWordCount?: number
  targetWordCount?: number

  // Structure
  minHeadings?: number
  maxHeadings?: number
  requiredHeadings?: string[]
  headingHierarchy?: string[] // ['h2', 'h3', 'h4']

  // Keywords
  primaryKeyword?: KeywordRequirement
  secondaryKeywords?: KeywordRequirement[]
  keywordDensity?: {
    min: number
    max: number
  }

  // Éléments SEO
  requiredElements?: SeoElement[]
  recommendedElements?: SeoElement[]

  // Images
  minImages?: number
  maxImages?: number
  imageAltRequired?: boolean

  // Liens
  minInternalLinks?: number
  maxInternalLinks?: number
  minExternalLinks?: number

  // Schema.org
  recommendedSchemaTypes?: string[]
  requiredSchemaTypes?: string[]
}

/**
 * Requirement de meta
 */
export interface MetaRequirement {
  minLength: number
  maxLength: number
  targetLength?: number
  includeKeyword?: boolean
  keywordPosition?: 'start' | 'any' | 'end'
}

/**
 * Requirement de keyword
 */
export interface KeywordRequirement {
  keyword: string
  density?: {
    min: number
    max: number
  }
  positions?: {
    title?: boolean
    firstParagraph?: boolean
    headings?: boolean
  }
}

/**
 * Éléments SEO
 */
export type SeoElement =
  | 'faq'              // Section FAQ avec Schema FAQPage
  | 'breadcrumbs'     // Fil d'Ariane
  | 'table_of_contents' // Table des matières
  | 'author_bio'      // Bio auteur
  | 'share_buttons'   // Boutons de partage
  | 'related_posts'   // Articles liés
  | 'schema_org'      // Markup Schema.org
  | 'open_graph'      // Open Graph tags
  | 'twitter_card'    // Twitter Card
  | 'cta'             // Call-to-action

/**
 * Configuration globale du template
 */
export interface TemplateConfig {
  // Génération
  temperature?: number
  topP?: number
  maxTokens?: number

  // Contexte
  includeExamples?: boolean
  maxExamples?: number
  includeSchemaContext?: boolean

  // Fallback
  fallbackTemplateId?: string

  // Tags
  tags?: string[]
}

// ─── Factory Functions ────────────────────────────────────────────────────────

/**
 * Crée un template de base
 */
export function createContentTemplate(
  partial: Partial<ContentTemplate> &
    Pick<ContentTemplate, 'name' | 'platform' | 'contentTypeKey'>
): ContentTemplate {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    description: partial.description,
    platform: partial.platform,
    contentTypeKey: partial.contentTypeKey,
    structure: partial.structure ?? {
      sections: [],
      requiredFields: [],
      optionalFields: [],
      fieldMapping: [],
      blocks: [],
    },
    variants: partial.variants ?? [],
    seoRequirements: partial.seoRequirements ?? {
      minWordCount: 300,
    },
    config: partial.config ?? {},
    version: partial.version ?? 1,
    parentTemplateId: partial.parentTemplateId,
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
    createdBy: partial.createdBy,
  }
}

/**
 * Crée une section de template
 */
export function createTemplateSection(
  partial: Partial<TemplateSection> &
    Pick<TemplateSection, 'name' | 'type' | 'instructions'>
): TemplateSection {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    type: partial.type,
    instructions: partial.instructions,
    promptTemplate: partial.promptTemplate,
    config: partial.config ?? {},
    conditions: partial.conditions,
    subsections: partial.subsections,
  }
}

/**
 * Crée un variant de template
 */
export function createTemplateVariant(
  partial: Partial<TemplateVariant> &
    Pick<TemplateVariant, 'name' | 'type' | 'selectionRules' | 'modifications'>
): TemplateVariant {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    description: partial.description,
    type: partial.type,
    selectionRules: partial.selectionRules,
    modifications: partial.modifications,
    weight: partial.weight,
    isActive: partial.isActive ?? true,
  }
}

// ─── Default Templates ────────────────────────────────────────────────────────

/**
 * Template par défaut pour article WordPress
 */
export const DEFAULT_WORDPRESS_POST_TEMPLATE: ContentTemplate = {
  id: 'wordpress-post-default',
  name: 'Blog Post (WordPress)',
  description: 'Template par défaut pour les articles de blog WordPress',
  platform: 'wordpress',
  contentTypeKey: 'post',
  structure: {
    sections: [
      {
        id: 'header',
        name: 'Header / Hero',
        type: 'header',
        instructions: 'Génère un titre accrocheur et une introduction captivante de 2-3 phrases qui présentent le sujet.',
        config: {
          targetWords: 50,
          format: 'html',
        },
      },
      {
        id: 'main_content',
        name: 'Corps de l\'article',
        type: 'main_content',
        instructions: 'Développe le sujet de manière approfondie avec des sections bien structurées (H2, H3). Utilise des exemples concrets et des données si pertinent.',
        config: {
          targetWords: 800,
          minWords: 600,
          maxWords: 1500,
          requiredHeadings: ['h2'],
          maxHeadings: 6,
          requiredElements: ['image'],
        },
      },
      {
        id: 'faq',
        name: 'Section FAQ',
        type: 'faq',
        instructions: 'Ajoute 3-5 questions fréquentes avec leurs réponses basées sur les recherches des utilisateurs.',
        config: {
          targetWords: 200,
          format: 'html',
        },
        conditions: [
          { field: 'includeFaq', operator: 'equals', value: true },
        ],
      },
      {
        id: 'conclusion',
        name: 'Conclusion',
        type: 'conclusion',
        instructions: 'Résume les points clés et inclut un call-to-action si pertinent.',
        config: {
          targetWords: 100,
          format: 'html',
        },
      },
    ],
    requiredFields: ['title', 'content', 'excerpt'],
    optionalFields: ['featured_image', 'categories', 'tags'],
    fieldMapping: [
      { templateField: 'title', wordpressField: 'title' },
      { templateField: 'content', wordpressField: 'content' },
      { templateField: 'excerpt', wordpressField: 'excerpt' },
      { templateField: 'featured_image', wordpressField: 'featured_media' },
      { templateField: 'categories', wordpressField: 'categories' },
      { templateField: 'tags', wordpressField: 'tags' },
      { templateField: 'meta_title', wordpressField: 'meta_input[_rank_math_title]' },
      { templateField: 'meta_description', wordpressField: 'meta_input[_rank_math_description]' },
    ],
    blocks: [
      {
        id: 'cta_block',
        name: 'CTA Principal',
        type: 'cta',
        content: 'Découvrez nos solutions',
        config: { buttonText: 'En savoir plus' },
      },
    ],
  },
  variants: [
    createTemplateVariant({
      name: 'Version Longue',
      type: 'length',
      selectionRules: [
        { field: 'targetWordCount', operator: 'greater_than', value: 1000 },
      ],
      modifications: {
        seoOverrides: {
          minWordCount: 1500,
          targetWordCount: 2000,
        },
      },
      isActive: true,
    }),
    createTemplateVariant({
      name: 'Version Courte',
      type: 'length',
      selectionRules: [
        { field: 'targetWordCount', operator: 'less_than', value: 800 },
      ],
      modifications: {
        seoOverrides: {
          minWordCount: 300,
          targetWordCount: 500,
        },
      },
      isActive: true,
    }),
  ],
  seoRequirements: {
    metaTitle: {
      minLength: 30,
      maxLength: 60,
      targetLength: 55,
      includeKeyword: true,
      keywordPosition: 'any',
    },
    metaDescription: {
      minLength: 120,
      maxLength: 160,
      targetLength: 150,
      includeKeyword: true,
    },
    minWordCount: 600,
    maxWordCount: 3000,
    targetWordCount: 1000,
    minHeadings: 2,
    requiredHeadings: ['h2'],
    keywordDensity: { min: 0.5, max: 3 },
    requiredElements: ['faq', 'schema_org'],
    minImages: 1,
    maxImages: 5,
    imageAltRequired: true,
    minInternalLinks: 2,
    recommendedElements: ['breadcrumbs', 'table_of_contents'],
  },
  config: {
    temperature: 0.7,
    maxTokens: 4000,
    includeExamples: true,
    maxExamples: 3,
    includeSchemaContext: true,
  },
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}

/**
 * Template par défaut pour article Sanity
 */
export const DEFAULT_SANITY_ARTICLE_TEMPLATE: ContentTemplate = {
  id: 'sanity-article-default',
  name: 'Article (Sanity)',
  description: 'Template par défaut pour les articles Sanity avec Portable Text',
  platform: 'sanity',
  contentTypeKey: 'article',
  structure: {
    sections: [
      {
        id: 'header',
        name: 'Header',
        type: 'header',
        instructions: 'Génère le titre et le sous-titre de l\'article.',
        config: {
          format: 'portable_text',
        },
      },
      {
        id: 'main_content',
        name: 'Corps',
        type: 'main_content',
        instructions: 'Structure le contenu avec des blocs Portable Text: paragraphes, titres, listes, images, etc.',
        config: {
          targetWords: 1000,
          minWords: 600,
          requiredElements: ['image'],
          format: 'portable_text',
        },
      },
      {
        id: 'faq',
        name: 'FAQ',
        type: 'faq',
        instructions: 'Questions fréquentes au format accordéon.',
        config: {
          format: 'portable_text',
        },
        conditions: [
          { field: 'includeFaq', operator: 'equals', value: true },
        ],
      },
    ],
    requiredFields: ['title', 'body', 'slug'],
    optionalFields: ['excerpt', 'mainImage', 'categories', 'author'],
    fieldMapping: [
      { templateField: 'title', sanityField: 'title' },
      { templateField: 'slug', sanityField: 'slug.current' },
      { templateField: 'body', sanityField: 'body' },
      { templateField: 'excerpt', sanityField: 'excerpt' },
      { templateField: 'mainImage', sanityField: 'mainImage' },
      { templateField: 'categories', sanityField: 'categories' },
      {
        templateField: 'content',
        sanityField: 'body',
        transform: {
          type: 'html_to_portable_text',
        },
      },
    ],
    blocks: [],
  },
  variants: [],
  seoRequirements: {
    metaTitle: {
      minLength: 30,
      maxLength: 60,
    },
    metaDescription: {
      minLength: 120,
      maxLength: 160,
    },
    minWordCount: 500,
    targetWordCount: 1000,
    requiredElements: ['schema_org'],
    minImages: 1,
  },
  config: {
    temperature: 0.7,
    maxTokens: 4000,
    includeSchemaContext: true,
  },
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ─── Preset Templates ────────────────────────────────────────────────────────

/**
 * Templates prédéfinis
 */
export const PRESET_TEMPLATES: Record<string, ContentTemplate> = {
  'wordpress-post': DEFAULT_WORDPRESS_POST_TEMPLATE,
  'wordpress-page': createContentTemplate({
    name: 'Page (WordPress)',
    platform: 'wordpress',
    contentTypeKey: 'page',
    seoRequirements: {
      minWordCount: 300,
      targetWordCount: 800,
    },
  }),
  'sanity-article': DEFAULT_SANITY_ARTICLE_TEMPLATE,
  'sanity-post': createContentTemplate({
    name: 'Post (Sanity)',
    platform: 'sanity',
    contentTypeKey: 'post',
    seoRequirements: {
      minWordCount: 500,
      targetWordCount: 1000,
    },
  }),
}
