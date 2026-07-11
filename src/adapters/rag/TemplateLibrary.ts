// ─────────────────────────────────────────────────────────────────────────────
// Platform Template Library
// SEO Engine - Universal Template System
// Predefined templates for WordPress and Sanity content types
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ContentTemplate,
  TemplateSection,
  SeoRequirements,
} from '@/src/core/domain/entities/ContentTemplate'
import { createContentTemplate, createTemplateSection, createTemplateVariant } from '@/src/core/domain/entities/ContentTemplate'

/**
 * Templates WordPress prédéfinis
 */
export const WORDPRESS_TEMPLATES = {
  /**
   * Template Article de blog standard
   */
  blogPost: createContentTemplate({
    name: 'Article de Blog',
    description: 'Template complet pour articles de blog avec FAQ et schema.org',
    platform: 'wordpress',
    contentTypeKey: 'post',
    structure: {
      sections: [
        createTemplateSection({
          name: 'Introduction',
          type: 'introduction',
          instructions: 'Rédige une introduction captivante de 2-3 paragraphes qui présente le sujet et crée une accroche pour le lecteur. L\'introduction doit inclure naturellement le mot-clé principal.',
          config: { targetWords: 80, format: 'html' },
        }),
        createTemplateSection({
          name: 'Corps Principal',
          type: 'main_content',
          instructions: 'Développe le sujet de manière approfondie avec des sections H2 et H3 bien structurées. Utilise des listes à puces, des exemples concrets, et des données chiffrées quand c\'est pertinent. Chaque section doit apporter une valeur ajoutée.',
          config: {
            targetWords: 700,
            minWords: 500,
            maxWords: 1200,
            requiredHeadings: ['h2'],
            maxHeadings: 8,
            requiredElements: ['image'],
            format: 'html',
          },
        }),
        createTemplateSection({
          name: 'Section FAQ',
          type: 'faq',
          instructions: 'Ajoute 4-6 questions fréquentes avec leurs réponses détaillées. Les questions doivent couvrir les interrogations courantes des utilisateurs sur ce sujet. Utilise le format accordéon pour une meilleure lisibilité.',
          config: { targetWords: 250, format: 'html' },
          conditions: [{ field: 'includeFaq', operator: 'equals', value: true }],
        }),
        createTemplateSection({
          name: 'Conclusion',
          type: 'conclusion',
          instructions: 'Résume les points clés de l\'article en 1-2 paragraphes et propose un call-to-action engageant pour le lecteur.',
          config: { targetWords: 70, format: 'html' },
        }),
      ],
      requiredFields: ['title', 'content', 'excerpt'],
      optionalFields: ['featured_image', 'categories', 'tags', 'author'],
      fieldMapping: [
        { templateField: 'title', wordpressField: 'title' },
        { templateField: 'content', wordpressField: 'content' },
        { templateField: 'excerpt', wordpressField: 'excerpt' },
        { templateField: 'featured_image', wordpressField: 'featured_media' },
        { templateField: 'categories', wordpressField: 'categories' },
        { templateField: 'tags', wordpressField: 'tags' },
        { templateField: 'meta_title', wordpressField: 'meta_input[_rank_math_title]' },
        { templateField: 'meta_description', wordpressField: 'meta_input[_rank_math_description]' },
        { templateField: 'focus_keyword', wordpressField: 'meta_input[_rank_math_focus_keyword]' },
      ],
      blocks: [],
    },
    variants: [
      createTemplateVariant({
        name: 'Version Longue (Ultimate)',
        type: 'length',
        selectionRules: [
          { field: 'targetWordCount', operator: 'greater_than', value: 1500 },
        ],
        modifications: {
          seoOverrides: {
            minWordCount: 2000,
            targetWordCount: 3000,
          },
        },
        weight: 30,
        isActive: true,
      }),
      createTemplateVariant({
        name: 'Version Courte (Quick Read)',
        type: 'length',
        selectionRules: [
          { field: 'targetWordCount', operator: 'less_than', value: 600 },
        ],
        modifications: {
          seoOverrides: {
            minWordCount: 300,
            targetWordCount: 500,
          },
        },
        weight: 20,
        isActive: true,
      }),
      createTemplateVariant({
        name: 'Guide Complet',
        type: 'format',
        selectionRules: [
          { field: 'contentFormat', operator: 'equals', value: 'guide' },
        ],
        modifications: {
          modifyInstructions: {
            main_content: 'Crée un guide exhaustif avec des sections détaillées, des sous-sections H3, des exemples pratiques, et une progression pédagogique claire du débutant à l\'expert.',
          },
        },
        isActive: true,
      }),
      createTemplateVariant({
        name: 'Liste Top 10',
        type: 'format',
        selectionRules: [
          { field: 'contentFormat', operator: 'equals', value: 'list' },
        ],
        modifications: {
          modifyInstructions: {
            main_content: 'Structure le contenu comme une liste numérotée de 10 éléments. Chaque élément doit être détaillé avec description, avantages, et exemple concret.',
          },
        },
        isActive: true,
      }),
    ],
    seoRequirements: {
      metaTitle: { minLength: 40, maxLength: 60, targetLength: 55, includeKeyword: true },
      metaDescription: { minLength: 120, maxLength: 160, targetLength: 150, includeKeyword: true },
      minWordCount: 600,
      targetWordCount: 1000,
      minHeadings: 2,
      requiredHeadings: ['h2'],
      keywordDensity: { min: 0.5, max: 3 },
      requiredElements: ['faq', 'schema_org'],
      minImages: 1,
      maxImages: 8,
      imageAltRequired: true,
      minInternalLinks: 2,
      recommendedSchemaTypes: ['Article', 'FAQPage'],
    },
    config: {
      temperature: 0.7,
      maxTokens: 4000,
      includeExamples: true,
      maxExamples: 3,
    },
  }),

  /**
   * Template Page de service (Local SEO)
   */
  servicePage: createContentTemplate({
    name: 'Page de Service',
    description: 'Template optimisé pour les pages de services en local SEO',
    platform: 'wordpress',
    contentTypeKey: 'page',
    structure: {
      sections: [
        createTemplateSection({
          name: 'Hero Section',
          type: 'header',
          instructions: 'Titre H1 avec le nom du service + localisation. Sous-titre accrocheur décrivant la proposition de valeur unique.',
          config: { targetWords: 30, format: 'html' },
        }),
        createTemplateSection({
          name: 'Présentation du Service',
          type: 'introduction',
          instructions: 'Description détaillée du service proposé en incluant: ce que c\'est, pour qui c\'est destiné, les bénéfices clés. Mentionner la zone géographique servie.',
          config: { targetWords: 150, format: 'html' },
        }),
        createTemplateSection({
          name: 'Caractéristiques',
          type: 'main_content',
          instructions: 'Liste des caractéristiques ou étapes du service avec descriptions détaillées. Utiliser des icônes ou listes pour la lisibilité.',
          config: { targetWords: 300, format: 'html', requiredElements: ['list'] },
        }),
        createTemplateSection({
          name: 'Zone d\'Intervention',
          type: 'custom',
          instructions: 'Section dédiée aux localités desservies avec liste des communes ou quartiers. Inclure une carte si possible.',
          config: { targetWords: 100, format: 'html' },
          conditions: [{ field: 'includeLocalCoverage', operator: 'equals', value: true }],
        }),
        createTemplateSection({
          name: 'Témoignages',
          type: 'custom',
          instructions: 'Ajoute 2-3 témoignages clients fictifs mais réalistes avec nom, localisation, et étoiles.',
          config: { targetWords: 150, format: 'html' },
          conditions: [{ field: 'includeTestimonials', operator: 'equals', value: true }],
        }),
        createTemplateSection({
          name: 'FAQ Local',
          type: 'faq',
          instructions: 'Questions fréquentes spécifiques au service local: délais, zones, tarifs, urgence, etc.',
          config: { targetWords: 200, format: 'html' },
        }),
        createTemplateSection({
          name: 'CTA Final',
          type: 'cta',
          instructions: 'Call-to-action avec numéro de téléphone, formulaire de contact, et incitation à l\'action.',
          config: { targetWords: 30, format: 'html' },
        }),
      ],
      requiredFields: ['title', 'content'],
      optionalFields: ['featured_image', 'categories'],
      fieldMapping: [
        { templateField: 'title', wordpressField: 'title' },
        { templateField: 'content', wordpressField: 'content' },
        { templateField: 'meta_title', wordpressField: 'meta_input[_rank_math_title]' },
        { templateField: 'meta_description', wordpressField: 'meta_input[_rank_math_description]' },
      ],
      blocks: [],
    },
    seoRequirements: {
      metaTitle: { minLength: 40, maxLength: 60, targetLength: 55 },
      metaDescription: { minLength: 120, maxLength: 160, targetLength: 145 },
      minWordCount: 400,
      targetWordCount: 800,
      requiredElements: ['faq', 'schema_org'],
      recommendedSchemaTypes: ['LocalBusiness', 'Service'],
      minImages: 1,
    },
    config: { temperature: 0.7, maxTokens: 3000 },
  }),

  /**
   * Template Page Local Business
   */
  localBusinessPage: createContentTemplate({
    name: 'Page Établissement Local',
    description: 'Template pour pages de présentation d\'établissement local',
    platform: 'wordpress',
    contentTypeKey: 'page',
    structure: {
      sections: [
        createTemplateSection({
          name: 'Présentation',
          type: 'introduction',
          instructions: 'Introduction de l\'établissement: nom, type, localisation, proposition de valeur.',
          config: { targetWords: 100 },
        }),
        createTemplateSection({
          name: 'Services/Produits',
          type: 'main_content',
          instructions: 'Liste détaillée des services ou produits proposés avec descriptions.',
          config: { targetWords: 250 },
        }),
        createTemplateSection({
          name: 'Informations Pratiques',
          type: 'custom',
          instructions: 'Horaires d\'ouverture, moyens de contact,parking, accès PMR.',
          config: { targetWords: 100 },
        }),
        createTemplateSection({
          name: 'FAQ',
          type: 'faq',
          instructions: 'Questions sur l\'établissement, les services, la réservation.',
          config: { targetWords: 150 },
        }),
      ],
      requiredFields: ['title', 'content'],
      optionalFields: [],
      fieldMapping: [],
      blocks: [],
    },
    seoRequirements: {
      minWordCount: 300,
      targetWordCount: 600,
      recommendedSchemaTypes: ['LocalBusiness', 'Restaurant', 'Store'],
      requiredElements: ['schema_org'],
    },
  }),

  /**
   * Template fiche produit
   */
  productPage: createContentTemplate({
    name: 'Fiche Produit',
    description: 'Template pour fiches produits e-commerce',
    platform: 'wordpress',
    contentTypeKey: 'product',
    structure: {
      sections: [
        createTemplateSection({
          name: 'Vue d\'Ensemble',
          type: 'introduction',
          instructions: 'Présentation concise du produit avec ses points forts.',
          config: { targetWords: 80 },
        }),
        createTemplateSection({
          name: 'Description Détaillée',
          type: 'main_content',
          instructions: 'Description approfondie du produit: caractéristiques, matériaux, dimensions,使用方法.',
          config: { targetWords: 300 },
        }),
        createTemplateSection({
          name: 'Avantages',
          type: 'custom',
          instructions: 'Liste des avantages clés avec iconographie.',
          config: { targetWords: 100, requiredElements: ['list'] },
        }),
        createTemplateSection({
          name: 'Utilisation',
          type: 'custom',
          instructions: 'Guide d\'utilisation ou d\'installation si pertinent.',
          config: { targetWords: 150 },
          conditions: [{ field: 'includeUsageGuide', operator: 'equals', value: true }],
        }),
        createTemplateSection({
          name: 'FAQ',
          type: 'faq',
          instructions: 'Questions fréquentes sur le produit, livraison, garantie.',
          config: { targetWords: 150 },
        }),
      ],
      requiredFields: ['title', 'content', 'excerpt'],
      optionalFields: ['featured_image', 'product_image_gallery'],
      fieldMapping: [
        { templateField: 'title', wordpressField: 'title' },
        { templateField: 'content', wordpressField: 'content' },
        { templateField: 'excerpt', wordpressField: 'excerpt' },
      ],
      blocks: [],
    },
    seoRequirements: {
      minWordCount: 400,
      targetWordCount: 800,
      requiredElements: ['schema_org'],
      recommendedSchemaTypes: ['Product'],
      minImages: 2,
    },
  }),
}

/**
 * Templates Sanity prédéfinis
 */
export const SANITY_TEMPLATES = {
  /**
   * Template Article Sanity avec Portable Text
   */
  article: createContentTemplate({
    name: 'Article (Sanity)',
    description: 'Template pour articles Sanity avec Portable Text blocks',
    platform: 'sanity',
    contentTypeKey: 'article',
    structure: {
      sections: [
        createTemplateSection({
          name: 'En-tête',
          type: 'header',
          instructions: 'Génère le titre principal et le sous-titre de l\'article. Le titre doit être accrocheur et contenir le mot-clé principal.',
          config: { format: 'portable_text' },
        }),
        createTemplateSection({
          name: 'Introduction',
          type: 'introduction',
          instructions: 'Introduction de 2-3 paragraphes qui pose le contexte et présente la promesse de l\'article.',
          config: { targetWords: 80, format: 'portable_text' },
        }),
        createTemplateSection({
          name: 'Corps Principal',
          type: 'main_content',
          instructions: 'Contenu principal structuré en sections avec titres H2 et H3. Utilise des blocs Portable Text variés: paragraphes, listes, images, citations.',
          config: {
            targetWords: 800,
            minWords: 500,
            maxWords: 1500,
            requiredHeadings: ['h2'],
            format: 'portable_text',
          },
        }),
        createTemplateSection({
          name: 'Section FAQ',
          type: 'faq',
          instructions: 'Questions-réponses au format accordéon ou liste. Génère 4-6 questions pertinentes.',
          config: { targetWords: 250, format: 'portable_text' },
          conditions: [{ field: 'includeFaq', operator: 'equals', value: true }],
        }),
        createTemplateSection({
          name: 'Conclusion',
          type: 'conclusion',
          instructions: 'Synthèse et call-to-action en 1-2 paragraphes.',
          config: { targetWords: 60, format: 'portable_text' },
        }),
      ],
      requiredFields: ['title', 'slug', 'body'],
      optionalFields: ['excerpt', 'mainImage', 'author', 'categories', 'publishedAt'],
      fieldMapping: [
        { templateField: 'title', sanityField: 'title' },
        { templateField: 'slug', sanityField: 'slug.current' },
        {
          templateField: 'body',
          sanityField: 'body',
          transform: { type: 'html_to_portable_text' },
        },
        { templateField: 'excerpt', sanityField: 'excerpt' },
        { templateField: 'mainImage', sanityField: 'mainImage' },
        { templateField: 'categories', sanityField: 'categories' },
        {
          templateField: 'meta_title',
          sanityField: 'seo.metaTitle',
        },
        {
          templateField: 'meta_description',
          sanityField: 'seo.metaDescription',
        },
      ],
      blocks: [],
    },
    variants: [
      createTemplateVariant({
        name: 'Tutorial',
        type: 'format',
        selectionRules: [{ field: 'articleType', operator: 'equals', value: 'tutorial' }],
        modifications: {
          modifyInstructions: {
            main_content: 'Structure le contenu comme un tutoriel pas-à-pas avec des étapes numérotées, des captures d\'écran potentielles, et des conseils pratiques.',
          },
        },
        isActive: true,
      }),
      createTemplateVariant({
        name: 'Liste',
        type: 'format',
        selectionRules: [{ field: 'articleType', operator: 'equals', value: 'list' }],
        modifications: {
          modifyInstructions: {
            main_content: 'Organise le contenu comme une liste structurée de 7-15 éléments. Chaque élément doit être autonome et détaillé.',
          },
        },
        isActive: true,
      }),
    ],
    seoRequirements: {
      metaTitle: { minLength: 30, maxLength: 60 },
      metaDescription: { minLength: 120, maxLength: 160 },
      minWordCount: 500,
      targetWordCount: 1000,
      requiredElements: ['schema_org', 'faq'],
      recommendedSchemaTypes: ['Article', 'FAQPage'],
      minImages: 1,
    },
    config: { temperature: 0.7, maxTokens: 4000 },
  }),

  /**
   * Template Page simple Sanity
   */
  page: createContentTemplate({
    name: 'Page (Sanity)',
    description: 'Template pour pages de contenu Sanity',
    platform: 'sanity',
    contentTypeKey: 'page',
    structure: {
      sections: [
        createTemplateSection({
          name: 'Contenu',
          type: 'main_content',
          instructions: 'Contenu principal de la page avec titre H1 implicite.',
          config: { targetWords: 500, format: 'portable_text' },
        }),
      ],
      requiredFields: ['title', 'slug', 'body'],
      optionalFields: ['excerpt', 'mainImage'],
      fieldMapping: [
        { templateField: 'title', sanityField: 'title' },
        { templateField: 'slug', sanityField: 'slug.current' },
        {
          templateField: 'body',
          sanityField: 'body',
          transform: { type: 'html_to_portable_text' },
        },
      ],
      blocks: [],
    },
    seoRequirements: {
      minWordCount: 200,
      targetWordCount: 500,
      requiredElements: ['schema_org'],
      recommendedSchemaTypes: ['WebPage'],
    },
  }),

  /**
   * Template Landing Page Sanity
   */
  landingPage: createContentTemplate({
    name: 'Landing Page (Sanity)',
    description: 'Template pour landing pages avec CTA',
    platform: 'sanity',
    contentTypeKey: 'landingPage',
    structure: {
      sections: [
        createTemplateSection({
          name: 'Hero',
          type: 'header',
          instructions: 'Titre accrocheur + sous-titre + CTA principal.',
          config: { targetWords: 40 },
        }),
        createTemplateSection({
          name: 'Proposition de Valeur',
          type: 'introduction',
          instructions: 'Présentation des bénéfices clés en 2-3 bullets ou paragraphes courts.',
          config: { targetWords: 100 },
        }),
        createTemplateSection({
          name: 'Fonctionnalités',
          type: 'main_content',
          instructions: 'Liste des fonctionnalités ou services avec descriptions courtes.',
          config: { targetWords: 200, requiredElements: ['list'] },
        }),
        createTemplateSection({
          name: 'Témoignages',
          type: 'custom',
          instructions: '2-3 citations clients avec nom et fonction.',
          config: { targetWords: 100 },
        }),
        createTemplateSection({
          name: 'FAQ',
          type: 'faq',
          instructions: 'Questions sur le produit/service.',
          config: { targetWords: 150 },
        }),
        createTemplateSection({
          name: 'CTA Final',
          type: 'cta',
          instructions: 'Call-to-action final avec formulaire ou lien.',
          config: { targetWords: 30 },
        }),
      ],
      requiredFields: ['title', 'slug', 'body'],
      optionalFields: ['heroImage', 'testimonials'],
      fieldMapping: [
        { templateField: 'title', sanityField: 'title' },
        { templateField: 'slug', sanityField: 'slug.current' },
        { templateField: 'body', sanityField: 'body' },
      ],
      blocks: [],
    },
    seoRequirements: {
      minWordCount: 300,
      targetWordCount: 600,
      requiredElements: ['schema_org', 'cta'],
      recommendedSchemaTypes: ['WebPage', 'Product'],
    },
  }),
}

/**
 * Templates Next.js prédéfinis
 */
export const NEXTJS_TEMPLATES = {
  /**
   * Template Page Next.js (App Router)
   */
  appRouterPage: createContentTemplate({
    name: 'Page Next.js (App Router)',
    description: 'Template pour générer des pages Next.js avec App Router',
    platform: 'nextjs',
    contentTypeKey: 'page',
    structure: {
      sections: [
        createTemplateSection({
          name: 'generateMetadata',
          type: 'custom',
          instructions: 'Génère la fonction generateMetadata avec title, description, et Open Graph.',
          config: { format: 'plain' },
        }),
        createTemplateSection({
          name: 'Page Content',
          type: 'main_content',
          instructions: 'Génère le composant React de la page avec le contenu HTML/JSX.',
          config: { targetWords: 500, format: 'html' },
        }),
      ],
      requiredFields: ['title', 'content', 'slug'],
      optionalFields: [],
      fieldMapping: [
        { templateField: 'title', nextjsField: 'metadata.title' },
        { templateField: 'meta_description', nextjsField: 'metadata.description' },
        { templateField: 'content', nextjsField: 'pageContent' },
        { templateField: 'slug', nextjsField: 'generateStaticParams.slug' },
      ],
      blocks: [],
    },
    seoRequirements: {
      metaTitle: { minLength: 30, maxLength: 60 },
      metaDescription: { minLength: 100, maxLength: 160 },
      minWordCount: 300,
      targetWordCount: 600,
      requiredElements: ['schema_org', 'open_graph'],
      recommendedSchemaTypes: ['WebPage'],
    },
  }),

  /**
   * Template Article Next.js (MDX)
   */
  mdxArticle: createContentTemplate({
    name: 'Article MDX (Next.js)',
    description: 'Template pour articles au format MDX',
    platform: 'nextjs',
    contentTypeKey: 'article',
    structure: {
      sections: [
        createTemplateSection({
          name: 'Frontmatter',
          type: 'custom',
          instructions: 'Génère le frontmatter YAML avec title, date, author, excerpt, categories.',
          config: { format: 'plain' },
        }),
        createTemplateSection({
          name: 'Content',
          type: 'main_content',
          instructions: 'Génère le contenu MDX avec syntaxe markdown enrichie.',
          config: { targetWords: 800, format: 'markdown' },
        }),
      ],
      requiredFields: ['title', 'content', 'slug'],
      optionalFields: ['author', 'date', 'excerpt', 'categories'],
      fieldMapping: [
        { templateField: 'title', nextjsField: 'frontmatter.title' },
        { templateField: 'content', nextjsField: 'mdxContent' },
        { templateField: 'slug', nextjsField: 'frontmatter.slug' },
      ],
      blocks: [],
    },
    seoRequirements: {
      minWordCount: 500,
      targetWordCount: 1000,
      requiredElements: ['schema_org'],
      recommendedSchemaTypes: ['Article', 'BlogPosting'],
    },
  }),
}

/**
 * Templates par type de contenu
 */
export const CONTENT_TYPE_TEMPLATES: Record<string, ContentTemplate> = {
  // WordPress
  'wordpress:post': WORDPRESS_TEMPLATES.blogPost,
  'wordpress:page': WORDPRESS_TEMPLATES.servicePage,
  'wordpress:product': WORDPRESS_TEMPLATES.productPage,
  // Sanity
  'sanity:article': SANITY_TEMPLATES.article,
  'sanity:page': SANITY_TEMPLATES.page,
  'sanity:landingPage': SANITY_TEMPLATES.landingPage,
  // Next.js
  'nextjs:page': NEXTJS_TEMPLATES.appRouterPage,
  'nextjs:article': NEXTJS_TEMPLATES.mdxArticle,
}

/**
 * Récupère le template approprié
 */
export function getTemplate(platform: string, contentTypeKey: string): ContentTemplate | null {
  const key = `${platform}:${contentTypeKey}`
  return CONTENT_TYPE_TEMPLATES[key] || null
}

/**
 * Liste tous les templates disponibles
 */
export function listTemplates(): Array<{ platform: string; type: string; template: ContentTemplate }> {
  return Object.entries(CONTENT_TYPE_TEMPLATES).map(([key, template]) => {
    const [platform, type] = key.split(':')
    return { platform, type, template }
  })
}

/**
 * Crée un template personnalisé depuis un schéma
 */
export function createTemplateFromSchema(
  platform: 'wordpress' | 'sanity',
  contentTypeKey: string,
  schema: {
    label: string
    description?: string
    fields: Array<{
      key: string
      label: string
      type: string
      required?: boolean
    }>
  }
): ContentTemplate {
  const fieldMapping = schema.fields.map(field => ({
    templateField: field.key,
    wordpressField: field.key,
    sanityField: field.key,
  }))

  const requiredFields = schema.fields.filter(f => f.required).map(f => f.key)

  return createContentTemplate({
    name: schema.label,
    description: schema.description || `Template généré pour ${schema.label}`,
    platform,
    contentTypeKey,
    structure: {
      sections: [
        createTemplateSection({
          name: 'Contenu Principal',
          type: 'main_content',
          instructions: `Génère le contenu pour le type "${schema.label}" en utilisant les champs définis.`,
          config: { targetWords: 500 },
        }),
      ],
      requiredFields,
      optionalFields: schema.fields.filter(f => !f.required).map(f => f.key),
      fieldMapping,
      blocks: [],
    },
    seoRequirements: {
      minWordCount: 300,
      targetWordCount: 600,
    },
  })
}
