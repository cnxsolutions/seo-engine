-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - Schema Federation
-- Clean SQL Migration
-- Version: 001
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- SITES FÉDÉRÉS
-- Sites cibles (WordPress / Sanity) dont on extrait les schémas
-- ─────────────────────────────────────────────────────────────

CREATE TABLE federated_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('wordpress', 'sanity')),
    url VARCHAR(500) NOT NULL,

    -- Credentials (à chiffrer en production avec Vault)
    credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Structure pour WordPress:
    -- { "wpUsername": "admin", "wpAppPassword": "xxxx", "wpRestBase": "/wp-json" }
    -- Structure pour Sanity:
    -- { "sanityProjectId": "abc123", "sanityDataset": "production", "sanityToken": "sk..." }

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_sync_at TIMESTAMPTZ,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_site_url UNIQUE (url)
);

COMMENT ON TABLE federated_sites IS 'Sites cibles dont SEO Engine extrait les schémas de contenu (WordPress, Sanity)';

CREATE INDEX idx_federated_sites_type ON federated_sites(type);
CREATE INDEX idx_federated_sites_active ON federated_sites(is_active);

-- ─────────────────────────────────────────────────────────────
-- SCHÉMAS EXTRAITS
-- Schémas de contenu récupérés depuis les sites fédérés
-- ─────────────────────────────────────────────────────────────

CREATE TABLE content_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    federated_site_id UUID NOT NULL REFERENCES federated_sites(id) ON DELETE CASCADE,

    -- Identification
    name VARCHAR(255) NOT NULL,           -- 'post', 'article', 'localPage'
    label VARCHAR(255) NOT NULL,          -- 'Articles', 'Pages', etc.
    description TEXT,

    -- Configuration
    seo_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Structure:
    -- {
    --   "hasSeoPlugin": true,
    --   "seoFields": [{"key": "rank_math_title", "type": "text", "plugin": "rankmath"}],
    --   "schemaTypes": ["Article", "LocalBusiness", "FAQPage"]
    -- }

    publish_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Structure:
    -- {
    --   "requiresReview": false,
    --   "defaultStatus": "draft",
    --   "supportedStatuses": ["draft", "publish", "pending"],
    --   "autoPublish": false
    -- }

    -- Raw source pour audit/debug
    raw_source JSONB,

    -- Versioning
    version INTEGER NOT NULL DEFAULT 1,
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_schema_site_name UNIQUE (federated_site_id, name)
);

COMMENT ON TABLE content_schemas IS 'Schémas de contenu extraits des sites WordPress/Sanity';

CREATE INDEX idx_content_schemas_site ON content_schemas(federated_site_id);

-- ─────────────────────────────────────────────────────────────
-- TYPES DE CONTENU
-- Ex: post, page, article, hero_section, etc.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE content_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_id UUID NOT NULL REFERENCES content_schemas(id) ON DELETE CASCADE,

    -- Identification
    key VARCHAR(255) NOT NULL,            -- 'post', 'acf_hero_section'
    label VARCHAR(255) NOT NULL,          -- 'Article', 'Section Héro'
    description TEXT,

    -- Support (WordPress)
    supports JSONB DEFAULT '[]'::jsonb,   -- ['title', 'editor', 'thumbnail']

    -- Parent pour les types groupés
    parent_key VARCHAR(255),

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_content_type_schema_key UNIQUE (schema_id, key)
);

COMMENT ON TABLE content_types IS 'Types de contenu (CPT WordPress, types Sanity)';

CREATE INDEX idx_content_types_schema ON content_types(schema_id);
CREATE INDEX idx_content_types_parent ON content_types(parent_key);

-- ─────────────────────────────────────────────────────────────
-- CHAMPS DE CONTENU
-- Tous les champs de chaque type de contenu
-- ─────────────────────────────────────────────────────────────

CREATE TABLE content_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type_id UUID NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
    parent_field_id UUID REFERENCES content_fields(id),

    -- Identification
    key VARCHAR(255) NOT NULL,            -- 'title', 'acf_hero_text', 'body'
    label VARCHAR(255) NOT NULL,          -- 'Titre', 'Texte du Héro', 'Corps'
    field_type VARCHAR(50) NOT NULL,      -- 'text', 'html', 'image', etc.

    -- Constraints
    is_required BOOLEAN NOT NULL DEFAULT false,
    description TEXT,

    -- Configuration selon le type
    config JSONB DEFAULT '{}'::jsonb,
    -- Structure:
    -- {
    --   "minLength": 10,
    --   "maxLength": 255,
    --   "options": ["opt1", "opt2"],
    --   "blockTypes": ["block", "image", "cta"]
    -- }

    -- Configuration ACF (WordPress only)
    acf_config JSONB,
    -- Structure:
    -- {
    --   "type": "wysiwyg",
    --   "name": "hero_text",
    --   "groupId": 1,
    --   "rules": [{"param": "post_type", "operator": "==", "value": "post"}]
    -- }

    -- Ordering
    sort_order INTEGER NOT NULL DEFAULT 0,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_field_type_key UNIQUE (content_type_id, key)
);

COMMENT ON TABLE content_fields IS 'Champs de contenu avec leurs types et configurations';

CREATE INDEX idx_content_fields_type ON content_fields(content_type_id);
CREATE INDEX idx_content_fields_parent ON content_fields(parent_field_id);
CREATE INDEX idx_content_fields_type_name ON content_fields(field_type);

-- ─────────────────────────────────────────────────────────────
-- TAXONOMIES (WordPress)
-- Catégories, tags, taxinomies personnalisées
-- ─────────────────────────────────────────────────────────────

CREATE TABLE taxonomies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type_id UUID NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,

    -- Identification
    key VARCHAR(255) NOT NULL,            -- 'category', 'post_tag', 'service_cat'
    label VARCHAR(255) NOT NULL,          -- 'Catégories', 'Tags', 'Services'
    description TEXT,

    -- Configuration
    is_hierarchical BOOLEAN NOT NULL DEFAULT false,
    supported_types JSONB DEFAULT '[]'::jsonb,  -- Types qui supportent cette taxonomie

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_taxonomy_key UNIQUE (content_type_id, key)
);

COMMENT ON TABLE taxonomies IS 'Taxinomies WordPress (catégories, tags, taxinomies personnalisées)';

CREATE INDEX idx_taxonomies_type ON taxonomies(content_type_id);

-- ─────────────────────────────────────────────────────────────
-- TERMES DE TAXINOMIE
-- Catégories, tags spécifiques du site
-- ─────────────────────────────────────────────────────────────

CREATE TABLE taxonomy_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    taxonomy_id UUID NOT NULL REFERENCES taxonomies(id) ON DELETE CASCADE,

    -- ID distant (WordPress/Sanity)
    remote_id BIGINT NOT NULL,

    -- Données
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,

    -- Hiérarchie
    parent_remote_id BIGINT,
    level INTEGER NOT NULL DEFAULT 0,

    -- Comptage
    count INTEGER NOT NULL DEFAULT 0,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_term_remote UNIQUE (taxonomy_id, remote_id),
    CONSTRAINT unique_term_slug UNIQUE (taxonomy_id, slug)
);

COMMENT ON TABLE taxonomy_terms IS 'Termes de taxinomie (catégories, tags)';

CREATE INDEX idx_taxonomy_terms_taxon ON taxonomy_terms(taxonomy_id);
CREATE INDEX idx_taxonomy_terms_slug ON taxonomy_terms(slug);
CREATE INDEX idx_taxonomy_terms_parent ON taxonomy_terms(parent_remote_id);
CREATE INDEX idx_taxonomy_terms_level ON taxonomy_terms(level);

-- ─────────────────────────────────────────────────────────────
-- DRAFTS DE CONTENU
-- Contenus générés en attente de publication
-- ─────────────────────────────────────────────────────────────

CREATE TABLE content_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    federated_site_id UUID NOT NULL REFERENCES federated_sites(id) ON DELETE CASCADE,

    -- Type de contenu utilisé
    content_type_key VARCHAR(255) NOT NULL,

    -- Payload généré
    payload JSONB NOT NULL,

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'validated', 'published', 'rejected')),

    -- Validation
    validation JSONB,  -- { "isValid": true, "errors": [], "warnings": [] }

    -- Métadonnées de génération
    generation_meta JSONB DEFAULT '{}'::jsonb,
    -- {
    --   "tokensUsed": 1500,
    --   "model": "gpt-4o",
    --   "generatedAt": "2024-01-15T10:30:00Z",
    --   "context": { "city": "Troyes", "businessType": "Restaurant" }
    -- }

    -- Résultat de publication
    publish_result JSONB,
    -- {
    --   "success": true,
    --   "remoteId": "123",
    --   "remoteUrl": "https://site.com/page"
    -- }

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE content_drafts IS 'Drafts de contenu générés par le RAG';

CREATE INDEX idx_content_drafts_site ON content_drafts(federated_site_id);
CREATE INDEX idx_content_drafts_status ON content_drafts(status);
CREATE INDEX idx_content_drafts_type ON content_drafts(content_type_key);
CREATE INDEX idx_content_drafts_created ON content_drafts(created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- HISTORIQUE DE SYNCHRONISATION
-- Logs de synchronisation des schémas
-- ─────────────────────────────────────────────────────────────

CREATE TABLE schema_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    federated_site_id UUID NOT NULL REFERENCES federated_sites(id) ON DELETE CASCADE,

    -- Status
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),

    -- Stats
    fields_count INTEGER,
    content_types_count INTEGER,
    taxonomies_count INTEGER,
    terms_count INTEGER,

    -- Erreurs
    errors JSONB DEFAULT '[]'::jsonb,

    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
    ) STORED
);

COMMENT ON TABLE schema_sync_logs IS 'Historique des synchronisations de schémas';

CREATE INDEX idx_sync_logs_site ON schema_sync_logs(federated_site_id);
CREATE INDEX idx_sync_logs_status ON schema_sync_logs(status);
CREATE INDEX idx_sync_logs_started ON schema_sync_logs(started_at DESC);

-- ─────────────────────────────────────────────────────────────
-- FONCTIONS UTILITAIRES
-- ─────────────────────────────────────────────────────────────

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers pour updated_at automatique
CREATE TRIGGER tr_federated_sites_updated
    BEFORE UPDATE ON federated_sites
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_content_drafts_updated
    BEFORE UPDATE ON content_drafts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_taxonomy_terms_updated
    BEFORE UPDATE ON taxonomy_terms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- VUES UTILES
-- ─────────────────────────────────────────────────────────────

-- Vue: Stats d'un schéma
CREATE OR REPLACE VIEW schema_stats AS
SELECT
    cs.id,
    cs.federated_site_id,
    cs.name AS schema_name,
    fs.name AS site_name,
    fs.type AS site_type,
    COUNT(DISTINCT ct.id) AS content_types_count,
    COUNT(DISTINCT cf.id) AS total_fields,
    COUNT(DISTINCT cf.id) FILTER (WHERE cf.is_required) AS required_fields,
    COUNT(DISTINCT t.id) AS taxonomies_count,
    COUNT(DISTINCT tt.id) AS terms_count,
    cs.extracted_at,
    cs.version
FROM content_schemas cs
JOIN federated_sites fs ON fs.id = cs.federated_site_id
LEFT JOIN content_types ct ON ct.schema_id = cs.id
LEFT JOIN content_fields cf ON cf.content_type_id = ct.id
LEFT JOIN taxonomies t ON t.content_type_id = ct.id
LEFT JOIN taxonomy_terms tt ON tt.taxonomy_id = t.id
GROUP BY cs.id, cs.federated_site_id, cs.name, fs.name, fs.type, cs.extracted_at, cs.version;

-- Vue: Schéma complet flatten
CREATE OR REPLACE VIEW schema_full AS
SELECT
    fs.name AS site_name,
    fs.type AS site_type,
    cs.name AS schema_name,
    ct.key AS content_type_key,
    ct.label AS content_type_label,
    cf.key AS field_key,
    cf.label AS field_label,
    cf.field_type,
    cf.is_required,
    cf.config,
    CASE
        WHEN cf.acf_config IS NOT NULL THEN 'wordpress'
        WHEN cf.parent_field_id IS NOT NULL THEN 'nested'
        ELSE 'standard'
    END AS field_origin
FROM federated_sites fs
JOIN content_schemas cs ON cs.federated_site_id = fs.id
JOIN content_types ct ON ct.schema_id = cs.id
JOIN content_fields cf ON cf.content_type_id = ct.id
WHERE cf.parent_field_id IS NULL  -- Uniquement les champs racines
ORDER BY fs.name, cs.name, ct.key, cf.sort_order;

-- Vue: Récents drafts par site
CREATE OR REPLACE VIEW recent_drafts AS
SELECT
    cd.id,
    cd.federated_site_id,
    fs.name AS site_name,
    cd.content_type_key,
    cd.status,
    cd.created_at,
    cd.generation_meta->>'model' AS ai_model,
    jsonb_extract_path_text(cd.payload, 'fields', 'title') AS draft_title
FROM content_drafts cd
JOIN federated_sites fs ON fs.id = cd.federated_site_id
ORDER BY cd.created_at DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────────
-- FONCTIONS PL/PGSQL UTILES
-- ─────────────────────────────────────────────────────────────

-- Obtenir les statistiques d'un schéma
CREATE OR REPLACE FUNCTION get_schema_stats(p_schema_id UUID)
RETURNS TABLE (
    content_types_count BIGINT,
    total_fields BIGINT,
    required_fields BIGINT,
    optional_fields BIGINT,
    taxonomies_count BIGINT,
    terms_count BIGINT,
    has_seo BOOLEAN,
    has_acf BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT ct.id)::BIGINT,
        COUNT(DISTINCT cf.id)::BIGINT,
        COUNT(DISTINCT cf.id) FILTER (WHERE cf.is_required)::BIGINT,
        COUNT(DISTINCT cf.id) FILTER (WHERE NOT cf.is_required)::BIGINT,
        COUNT(DISTINCT t.id)::BIGINT,
        COUNT(DISTINCT tt.id)::BIGINT,
        COALESCE((cs.seo_config->>'hasSeoPlugin')::BOOLEAN, FALSE),
        EXISTS(SELECT 1 FROM content_fields cf2 WHERE cf2.content_type_id = ANY(ARRAY_AGG(ct.id)) AND cf2.acf_config IS NOT NULL)
    FROM content_schemas cs
    LEFT JOIN content_types ct ON ct.schema_id = cs.id
    LEFT JOIN content_fields cf ON cf.content_type_id = ct.id
    LEFT JOIN taxonomies t ON t.content_type_id = ct.id
    LEFT JOIN taxonomy_terms tt ON tt.taxonomy_id = t.id
    WHERE cs.id = p_schema_id
    GROUP BY cs.id;
END;
$$ LANGUAGE plpgsql;

-- Trouver les sites similaires (même types de champs)
CREATE OR REPLACE FUNCTION find_similar_sites(p_field_type VARCHAR, p_required BOOLEAN)
RETURNS TABLE (
    site_id UUID,
    site_name VARCHAR,
    site_type VARCHAR,
    matching_types_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        fs.id,
        fs.name,
        fs.type,
        COUNT(DISTINCT cf.content_type_id)::BIGINT AS matching_types_count
    FROM federated_sites fs
    JOIN content_schemas cs ON cs.federated_site_id = fs.id
    JOIN content_types ct ON ct.schema_id = cs.id
    JOIN content_fields cf ON cf.content_type_id = ct.id
    WHERE cf.field_type = p_field_type
      AND cf.is_required = p_required
    GROUP BY fs.id, fs.name, fs.type
    ORDER BY matching_types_count DESC;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- GRANT PERMISSIONS (à adapter selon votre setup)
-- ─────────────────────────────────────────────────────────────

-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO seo_engine_reader;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO seo_engine_writer;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO seo_engine_writer;
