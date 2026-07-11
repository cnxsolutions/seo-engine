-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - Vector Store (pg_vector)
-- Migration: 005_add_vector_store
-- Purpose: RAG Infrastructure for semantic search and content generation
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Extension pg_vector ────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "vector";

-- ─── Embeddings Configuration ───────────────────────────────────────────────────

-- Dimension pour OpenAI text-embedding-3-small (1536) ou 3-large (3072)
-- On utilise 1536 par défaut pour optimiser le stockage et la vitesse
DO $$
BEGIN
    -- Vérifier si la constante existe déjà
    IF NOT EXISTS (SELECT 1 FROM pg_settings WHERE name = 'vector.dimension') THEN
        -- pg_vector utilise par défaut la dimension spécifiée dans les opérations
        -- Pas besoin de configuration globale
        NULL;
    END IF;
END $$;

-- ─── Vector Store Tables ────────────────────────────────────────────────────────

-- ─── Table principale: embeddings ───────────────────────────────────────────────
-- Stocke tous les embeddings vectoriels avec leurs métadonnées

CREATE TABLE IF NOT EXISTS vector_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Embedding vectoriel (1536 dimensions par défaut pour text-embedding-3-small)
    embedding VECTOR(1536) NOT NULL,

    -- Contenu original (pour fallback et debug)
    content TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,  -- SHA256 pour déduplication

    -- Métadonnées
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    /*
     * Structure du metadata:
     * {
     *   "siteId": "uuid",
     *   "documentType": "schema|content|taxonomy_term|seo_data|competitor|example",
     *   "contentTypeKey": "post|page|article",
     *   "fieldKey": "title|content|meta_description",
     *   "title": "Titre du document",
     *   "url": "https://...",
     *   "taxonomyTerms": ["cat1", "tag2"],
     *   "focusKeyword": "restaurant troyes",
     *   "wordCount": 1500,
     *   "hasImages": true,
     *   "createdAt": "2024-01-01T00:00:00Z",
     *   "indexedAt": "2024-01-01T00:00:00Z"
     * }
     */

    -- Stats (pour filtering et analytics)
    site_id UUID,  -- References sites(id) - nullable pour flexibilité
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('schema', 'content', 'taxonomy_term', 'seo_data', 'competitor', 'example')),
    content_type_key VARCHAR(255),
    focus_keyword VARCHAR(500),
    word_count INTEGER,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_content_hash UNIQUE (content_hash)
);

COMMENT ON TABLE vector_embeddings IS 'Embeddings vectoriels pour RAG avec métadonnées complètes';

-- ─── Index HNSW pour recherche vectorielle performante ─────────────────────────
-- HNSW (Hierarchical Navigable Small World) est plus rapide que IVFFlat

CREATE INDEX idx_embeddings_hnsw ON vector_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ─── Index secondaires pour filtering ──────────────────────────────────────────

CREATE INDEX idx_embeddings_site ON vector_embeddings(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX idx_embeddings_doc_type ON vector_embeddings(document_type);
CREATE INDEX idx_embeddings_content_type ON vector_embeddings(content_type_key) WHERE content_type_key IS NOT NULL;
CREATE INDEX idx_embeddings_keyword ON vector_embeddings(focus_keyword) WHERE focus_keyword IS NOT NULL;
CREATE INDEX idx_embeddings_created ON vector_embeddings(created_at DESC);

-- ─── Table: schema_embeddings ───────────────────────────────────────────────────
-- Stocket les embeddings spécifiques aux schémas de contenu

CREATE TABLE IF NOT EXISTS schema_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference au schéma source
    schema_id UUID NOT NULL,  -- References content_schemas(id) - pas de FK direct pour éviter les循环
    content_type_key VARCHAR(255) NOT NULL,

    -- Embedding du schéma complet
    schema_embedding VECTOR(1536) NOT NULL,
    schema_content TEXT NOT NULL,  -- Représentation textuelle du schéma

    -- Embedding par champ (pour génération ciblée)
    field_embeddings JSONB DEFAULT '{}'::jsonb,
    /*
     * Structure:
     * {
     *   "title": { "embedding": [0.1, ...], "content": "Le titre de la page" },
     *   "content": { "embedding": [0.2, ...], "content": "Le contenu principal" },
     *   "meta_description": { "embedding": [0.3, ...], "content": "La meta description" }
     * }
     */

    -- Instructions RAG (prompts formatés)
    rag_instructions JSONB DEFAULT '{}'::jsonb,
    /*
     * Structure:
     * {
     *   "title": "Instructions pour générer le titre...",
     *   "content": "Instructions pour générer le contenu...",
     *   "default": "Instructions générales"
     * }
     */

    -- Versioning
    version INTEGER NOT NULL DEFAULT 1,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_schema_content_type UNIQUE (schema_id, content_type_key)
);

COMMENT ON TABLE schema_embeddings IS 'Embeddings optimisés pour les schémas de contenu RAG';

CREATE INDEX idx_schema_embeddings_schema ON schema_embeddings(schema_id);
CREATE INDEX idx_schema_embeddings_hnsw ON schema_embeddings USING hnsw (schema_embedding vector_cosine_ops);

-- ─── Table: content_embeddings ──────────────────────────────────────────────────
-- Stocke les embeddings du contenu existant des sites

CREATE TABLE IF NOT EXISTS content_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference au contenu
    federated_site_id UUID NOT NULL,  -- References federated_sites(id)
    content_id VARCHAR(255) NOT NULL,  -- ID externe (WP post ID, Sanity _id, etc.)
    content_type_key VARCHAR(255) NOT NULL,

    -- Embedding du contenu complet
    content_embedding VECTOR(1536) NOT NULL,

    -- Embeddings partiels (paragraphe, section)
    section_embeddings JSONB DEFAULT '[]'::jsonb,
    /*
     * Structure:
     * [
     *   { "section": "introduction", "embedding": [0.1, ...], "startChar": 0, "endChar": 500 },
     *   { "section": "corps_1", "embedding": [0.2, ...], "startChar": 500, "endChar": 1500 }
     * ]
     */

    -- URL/source
    url TEXT,
    title TEXT NOT NULL,
    slug VARCHAR(500),

    -- SEO
    focus_keyword VARCHAR(500),
    meta_description TEXT,

    -- Stats
    word_count INTEGER,
    reading_time_minutes INTEGER GENERATED ALWAYS AS (
        CASE WHEN word_count IS NOT NULL THEN word_count / 200 ELSE NULL END
    ) STORED,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_content_external UNIQUE (federated_site_id, content_id)
);

COMMENT ON TABLE content_embeddings IS 'Embeddings du contenu existant pour contexte RAG';

CREATE INDEX idx_content_embeddings_site ON content_embeddings(federated_site_id);
CREATE INDEX idx_content_embeddings_type ON content_embeddings(content_type_key);
CREATE INDEX idx_content_embeddings_hnsw ON content_embeddings USING hnsw (content_embedding vector_cosine_ops);
CREATE INDEX idx_content_embeddings_keyword ON content_embeddings(focus_keyword) WHERE focus_keyword IS NOT NULL;

-- ─── Table: rag_context_cache ───────────────────────────────────────────────────
-- Cache les contextes RAG générés pour éviter de recalculer

CREATE TABLE IF NOT EXISTS rag_context_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Clé de cache
    cache_key VARCHAR(255) NOT NULL UNIQUE,
    /*
     * Structure: hash de params
     * {siteId}:{contentType}:{fieldKey}:{topic}:{keywords_hash}
     */

    -- Paramètres de génération
    params JSONB NOT NULL,

    -- Contexte généré
    context JSONB NOT NULL,
    /*
     * Structure:
     * {
     *   "siteContext": {...},
     *   "schemaContext": {...},
     *   "taxonomyContext": {...},
     *   "similarExamples": [...],
     *   "seoContext": {...},
     *   "sources": [...]
     * }
     */

    -- Stats
    tokens_used INTEGER,
    generation_time_ms INTEGER,

    -- TTL et invalidation
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
    is_fresh BOOLEAN NOT NULL DEFAULT true,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rag_context_cache IS 'Cache des contextes RAG pour optimisation';

CREATE INDEX idx_rag_cache_key ON rag_context_cache(cache_key);
CREATE INDEX idx_rag_cache_expires ON rag_context_cache(expires_at);
CREATE INDEX idx_rag_cache_site ON rag_context_cache((params->>'siteId')) WHERE params->>'siteId' IS NOT NULL;

-- ─── Table: indexing_queue ──────────────────────────────────────────────────────
-- File d'attente pour l'indexation asynchrone

CREATE TABLE IF NOT EXISTS indexing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Job info
    job_id VARCHAR(100) NOT NULL UNIQUE,
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('index_schema', 'index_content', 'reindex_site', 'delete_site', 'cleanup')),

    -- Target
    site_id UUID,
    schema_id UUID,
    content_ids JSONB DEFAULT '[]'::jsonb,

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 0,  -- Plus élevé = plus prioritaire

    -- Progress
    total_documents INTEGER DEFAULT 0,
    processed_documents INTEGER DEFAULT 0,

    -- Result
    result JSONB,
    error_message TEXT,

    -- Scheduling
    scheduled_for TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Retry
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_retry_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE indexing_queue IS 'File d\'attente pour l\'indexation vectorielle';

CREATE INDEX idx_indexing_queue_status ON indexing_queue(status) WHERE status IN ('pending', 'running');
CREATE INDEX idx_indexing_queue_priority ON indexing_queue(priority DESC, scheduled_for ASC) WHERE status = 'pending';
CREATE INDEX idx_indexing_queue_site ON indexing_queue(site_id) WHERE site_id IS NOT NULL;

-- ─── Table: similarity_cache ─────────────────────────────────────────────────────
-- Cache les résultats de similarité pour éviter les recalculs

CREATE TABLE IF NOT EXISTS similarity_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Query hash (permet de retrouver les résultats)
    query_hash VARCHAR(64) NOT NULL,
    query_params JSONB NOT NULL,

    -- Results (top-k similaires)
    results JSONB NOT NULL,

    -- Stats
    results_count INTEGER NOT NULL,
    avg_score REAL,

    -- TTL
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE similarity_cache IS 'Cache des recherches de similarité';

CREATE INDEX idx_similarity_hash ON similarity_cache(query_hash);
CREATE INDEX idx_similarity_expires ON similarity_cache(expires_at);

-- ─── Triggers ──────────────────────────────────────────────────────────────────

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_vector_embeddings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_vector_embeddings_updated
    BEFORE UPDATE ON vector_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

CREATE TRIGGER tr_schema_embeddings_updated
    BEFORE UPDATE ON schema_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

CREATE TRIGGER tr_content_embeddings_updated
    BEFORE UPDATE ON content_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

CREATE TRIGGER tr_rag_context_cache_updated
    BEFORE UPDATE ON rag_context_cache
    FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

CREATE TRIGGER tr_indexing_queue_updated
    BEFORE UPDATE ON indexing_queue
    FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

-- ─── Functions utilitaires ───────────────────────────────────────────────────────

-- Recherche vectorielle avec filtering
CREATE OR REPLACE FUNCTION vector_search(
    p_embedding VECTOR,
    p_limit INTEGER DEFAULT 10,
    p_threshold REAL DEFAULT 0.7,
    p_site_id UUID DEFAULT NULL,
    p_document_type VARCHAR DEFAULT NULL,
    p_content_type_key VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    score REAL,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ve.id,
        ve.content,
        1 - (ve.embedding <=> p_embedding) AS score,
        ve.metadata
    FROM vector_embeddings ve
    WHERE
        (p_site_id IS NULL OR ve.site_id = p_site_id)
        AND (p_document_type IS NULL OR ve.document_type = p_document_type)
        AND (p_content_type_key IS NULL OR ve.content_type_key = p_content_type_key)
        AND 1 - (ve.embedding <=> p_embedding) >= p_threshold
    ORDER BY ve.embedding <=> p_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Stats du vector store
CREATE OR REPLACE FUNCTION get_vector_store_stats()
RETURNS TABLE (
    total_documents BIGINT,
    documents_by_type JSONB,
    documents_by_site JSONB,
    avg_dimension BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT,
        (
            SELECT jsonb_object_agg(doc_type, count)
            FROM (
                SELECT document_type AS doc_type, COUNT(*) AS count
                FROM vector_embeddings
                GROUP BY document_type
            ) sub
        )::JSONB,
        (
            SELECT COALESCE(jsonb_object_agg(site_id::TEXT, count), '{}'::JSONB)
            FROM (
                SELECT site_id, COUNT(*) AS count
                FROM vector_embeddings
                WHERE site_id IS NOT NULL
                GROUP BY site_id
            ) sub
        )::JSONB,
        1536::BIGINT AS avg_dimension;
END;
$$ LANGUAGE plpgsql;

-- Nettoyage du cache expiré
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS TABLE (deleted_count BIGINT) AS $$
DECLARE
    v_deleted BIGINT;
BEGIN
    DELETE FROM rag_context_cache WHERE expires_at < NOW();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    DELETE FROM similarity_cache WHERE expires_at < NOW();
    GET DIAGNOSTICS v_deleted = v_deleted + ROW_COUNT;

    RETURN QUERY SELECT v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ─── Grant Permissions ───────────────────────────────────────────────────────────

-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO seo_engine_reader;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO seo_engine_writer;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO seo_engine_writer;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO seo_engine_reader;
