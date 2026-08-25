-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine — schema baseline
-- Generated from the live database on 2026-08-10 by scripts/db-baseline.mjs
-- ─────────────────────────────────────────────────────────────────────────────
--
-- THE definition of record for every table this application uses. Most of them
-- were created by hand in the Supabase dashboard and appear in no migration:
-- without this file, losing the Supabase project means losing the schema.
--
-- Apply this FIRST on an empty database, then the numbered migrations in order.
-- Data is not included — this is structure only.
--
-- Regenerate after any hand-made change in the dashboard:
--     node scripts/db-baseline.mjs


-- ─── Extensions ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- ─── Functions ──────────────────────────────────────────────────────────────
--
-- Before the tables: a column default or a trigger may call one.

CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
 RETURNS TABLE(deleted_count bigint)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_deleted BIGINT;
    v_batch   BIGINT;
BEGIN
    DELETE FROM rag_context_cache WHERE expires_at < NOW();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    DELETE FROM similarity_cache WHERE expires_at < NOW();
    -- GET DIAGNOSTICS assigns a diagnostic item to a variable; it cannot evaluate
    -- an expression, so `v_deleted = v_deleted + ROW_COUNT` is a syntax error.
    -- The second count lands in its own variable and is added afterwards.
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted := v_deleted + v_batch;

    RETURN QUERY SELECT v_deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.editorial_calendar_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_similar_sites(p_field_type character varying, p_required boolean)
 RETURNS TABLE(site_id uuid, site_name character varying, site_type character varying, matching_types_count bigint)
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_schema_stats(p_schema_id uuid)
 RETURNS TABLE(content_types_count bigint, total_fields bigint, required_fields bigint, optional_fields bigint, taxonomies_count bigint, terms_count bigint, has_seo boolean, has_acf boolean)
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_site_index_status(p_site_id uuid)
 RETURNS TABLE(total_documents bigint, documents_by_type jsonb, last_indexed_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT,
        COALESCE(
            (
                SELECT jsonb_object_agg(t.document_type, t.n)
                FROM (
                    SELECT ve.document_type, COUNT(*) AS n
                    FROM public.vector_embeddings ve
                    WHERE ve.site_id = p_site_id
                    GROUP BY ve.document_type
                ) t
            ),
            '{}'::jsonb
        ),
        MAX(v.updated_at)
    FROM public.vector_embeddings v
    WHERE v.site_id = p_site_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_vector_store_stats()
 RETURNS TABLE(total_documents bigint, documents_by_type jsonb, documents_by_site jsonb, avg_dimension bigint)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        -- `FROM vector_embeddings` is load-bearing: without it COUNT(*) counts
        -- the single implicit row of a FROM-less SELECT and this function reports
        -- exactly 1 document forever, however full the index really is.
        (SELECT COUNT(*) FROM vector_embeddings)::BIGINT,
        (
            SELECT COALESCE(jsonb_object_agg(doc_type, n), '{}'::JSONB)
            FROM (
                SELECT document_type AS doc_type, COUNT(*) AS n
                FROM vector_embeddings
                GROUP BY document_type
            ) sub
        )::JSONB,
        (
            SELECT COALESCE(jsonb_object_agg(site_id::TEXT, n), '{}'::JSONB)
            FROM (
                SELECT site_id, COUNT(*) AS n
                FROM vector_embeddings
                WHERE site_id IS NOT NULL
                GROUP BY site_id
            ) sub
        )::JSONB,
        1536::BIGINT AS avg_dimension;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_vector_embeddings_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.vector_search(p_embedding vector, p_limit integer DEFAULT 10, p_threshold real DEFAULT 0.7, p_site_id uuid DEFAULT NULL::uuid, p_document_type character varying DEFAULT NULL::character varying, p_content_type_key character varying DEFAULT NULL::character varying)
 RETURNS TABLE(id uuid, content text, score real, metadata jsonb)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        ve.id,
        ve.content,
        -- Cast explicit: the `<=>` operator yields double precision while the
        -- RETURNS TABLE above declares `score REAL`. RETURN QUERY compares the
        -- row type strictly, so without this the function creates cleanly and
        -- then fails on its first call with "structure of query does not match".
        (1 - (ve.embedding <=> p_embedding))::REAL AS score,
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
$function$
;


-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.analysis_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid,
    status text DEFAULT 'running'::text,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    analysis_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    site_id uuid,
    pillar_page_slug text,
    article_type text NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    content text NOT NULL,
    status text DEFAULT 'draft'::text,
    published_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.backlinks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid,
    source_url text NOT NULL,
    anchor_text text,
    link_type text NOT NULL,
    domain_authority integer,
    is_verified boolean DEFAULT false,
    obtained_at date,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid,
    name text NOT NULL,
    business_type text NOT NULL,
    business_name text NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    department text,
    communes text[] DEFAULT '{}'::text[],
    frequency_hours integer DEFAULT 24,
    schedule_frequency text DEFAULT 'daily'::text,
    schedule_days integer[] DEFAULT '{}'::integer[],
    schedule_time text DEFAULT '09:00'::text,
    ai_model text DEFAULT 'gpt-4o'::text,
    page_types text[] DEFAULT '{pillar,child}'::text[],
    publish_status text DEFAULT 'draft'::text,
    auto_publish boolean DEFAULT false,
    target_length integer DEFAULT 800,
    system_prompt text,
    enable_external_links boolean DEFAULT true,
    external_link_count integer DEFAULT 3,
    enable_images boolean DEFAULT true,
    image_per_page integer DEFAULT 2,
    is_active boolean DEFAULT true,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cycle_duration_days integer DEFAULT 14,
    current_cycle_id uuid,
    cycle_auto_renew boolean DEFAULT true,
    last_crawl_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.content_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    federated_site_id uuid NOT NULL,
    content_type_key character varying(255) NOT NULL,
    payload jsonb NOT NULL,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    validation jsonb,
    generation_meta jsonb DEFAULT '{}'::jsonb,
    publish_result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.content_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    federated_site_id uuid NOT NULL,
    content_id character varying(255) NOT NULL,
    content_type_key character varying(255) NOT NULL,
    content_embedding vector(1536) NOT NULL,
    section_embeddings jsonb DEFAULT '[]'::jsonb,
    url text,
    title text NOT NULL,
    slug character varying(500),
    focus_keyword character varying(500),
    meta_description text,
    word_count integer,
    reading_time_minutes integer GENERATED ALWAYS AS (
CASE
    WHEN (word_count IS NOT NULL) THEN (word_count / 200)
    ELSE NULL::integer
END) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.content_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_type_id uuid NOT NULL,
    parent_field_id uuid,
    key character varying(255) NOT NULL,
    label character varying(255) NOT NULL,
    field_type character varying(50) NOT NULL,
    is_required boolean DEFAULT false NOT NULL,
    description text,
    config jsonb DEFAULT '{}'::jsonb,
    acf_config jsonb,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.content_schemas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    federated_site_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    label character varying(255) NOT NULL,
    description text,
    seo_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    publish_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_source jsonb,
    version integer DEFAULT 1 NOT NULL,
    extracted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.content_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schema_id uuid NOT NULL,
    key character varying(255) NOT NULL,
    label character varying(255) NOT NULL,
    description text,
    supports jsonb DEFAULT '[]'::jsonb,
    parent_key character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cycle_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    cycle_number integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text,
    cycle_duration_days integer DEFAULT 14,
    cycle_started_at timestamp with time zone,
    cycle_ends_at timestamp with time zone,
    plan_data jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_pages integer DEFAULT 0,
    total_estimated_words integer DEFAULT 0,
    crawl_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.editorial_calendar (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    generation_id uuid,
    scheduled_date date NOT NULL,
    page_type text NOT NULL,
    target_keyword text NOT NULL,
    target_city text,
    status text DEFAULT 'planned'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    plan_item_id text,
    error_message text,
    attempt_count integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.federated_sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    url character varying(500) NOT NULL,
    credentials jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.gbp_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid,
    business_name text,
    address jsonb,
    phone text,
    website text,
    categories jsonb,
    hours jsonb,
    reviews jsonb,
    reviews_summary jsonb,
    photos jsonb,
    posts jsonb,
    qa jsonb,
    attributes jsonb,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    site_id uuid,
    city text NOT NULL,
    slug text,
    title text,
    meta_description text,
    focus_keyword text,
    content text,
    page_type text DEFAULT 'child'::text,
    parent_generation_id uuid,
    internal_links_to uuid[] DEFAULT '{}'::uuid[],
    external_links jsonb DEFAULT '[]'::jsonb,
    image_alts text[] DEFAULT '{}'::text[],
    status text DEFAULT 'pending'::text,
    published_url text,
    published_page_id integer,
    ai_model text DEFAULT 'gpt-4o'::text,
    tokens_used integer,
    error_message text,
    scheduled_for timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    page_payload jsonb,
    published_at timestamp with time zone,
    publish_mode text,
    publish_live boolean,
    publish_notes text[],
    refusal_kind text
);

CREATE TABLE IF NOT EXISTS public.google_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid,
    google_email text NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    token_expires_at timestamp with time zone NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    gbp_account_id text,
    gbp_location_id text,
    gsc_site_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    gsc_last_sync_at timestamp with time zone,
    gsc_last_sync_status text,
    gsc_last_sync_rows integer,
    gsc_last_sync_range_start date,
    gsc_last_sync_range_end date,
    gsc_last_sync_truncated boolean,
    gsc_last_sync_error text,
    gbp_last_sync_at timestamp with time zone,
    gbp_last_sync_status text,
    gbp_last_sync_error text
);

CREATE TABLE IF NOT EXISTS public.gsc_performance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid,
    date date NOT NULL,
    page_url text NOT NULL,
    query text NOT NULL,
    clicks integer DEFAULT 0,
    impressions integer DEFAULT 0,
    ctr real DEFAULT 0,
    position real DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.indexing_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id character varying(100) NOT NULL,
    job_type character varying(50) NOT NULL,
    site_id uuid,
    schema_id uuid,
    content_ids jsonb DEFAULT '[]'::jsonb,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    total_documents integer DEFAULT 0,
    processed_documents integer DEFAULT 0,
    result jsonb,
    error_message text,
    scheduled_for timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    last_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.job_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_type text NOT NULL,
    job_id text NOT NULL,
    campaign_id uuid,
    generation_id uuid,
    status text NOT NULL,
    published_url text,
    error_message text,
    duration_ms bigint,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rag_context_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cache_key character varying(255) NOT NULL,
    params jsonb NOT NULL,
    context jsonb NOT NULL,
    tokens_used integer,
    generation_time_ms integer,
    expires_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
    is_fresh boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.schema_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schema_id uuid NOT NULL,
    content_type_key character varying(255) NOT NULL,
    schema_embedding vector(1536) NOT NULL,
    schema_content text NOT NULL,
    field_embeddings jsonb DEFAULT '{}'::jsonb,
    rag_instructions jsonb DEFAULT '{}'::jsonb,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.schema_sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    federated_site_id uuid NOT NULL,
    status character varying(50) NOT NULL,
    fields_count integer,
    content_types_count integer,
    taxonomies_count integer,
    terms_count integer,
    errors jsonb DEFAULT '[]'::jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer GENERATED ALWAYS AS ((EXTRACT(epoch FROM (completed_at - started_at)) * (1000)::numeric)) STORED
);

CREATE TABLE IF NOT EXISTS public.serp_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    query text NOT NULL,
    locale text DEFAULT 'fr-FR'::text NOT NULL,
    payload jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.similarity_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    query_hash character varying(64) NOT NULL,
    query_params jsonb NOT NULL,
    results jsonb NOT NULL,
    results_count integer NOT NULL,
    avg_score real,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.site_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid,
    url text NOT NULL,
    path text NOT NULL,
    title text,
    meta_description text,
    h1 text,
    h2s text[] DEFAULT '{}'::text[],
    word_count integer DEFAULT 0,
    focus_keyword text,
    keywords text[] DEFAULT '{}'::text[],
    internal_links text[] DEFAULT '{}'::text[],
    external_links text[] DEFAULT '{}'::text[],
    has_schema boolean DEFAULT false,
    schema_types text[] DEFAULT '{}'::text[],
    has_faq boolean DEFAULT false,
    has_local_business boolean DEFAULT false,
    geo_signals text[] DEFAULT '{}'::text[],
    crawled_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    content_excerpt text
);

CREATE TABLE IF NOT EXISTS public.sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    url text NOT NULL,
    wp_username text,
    wp_app_password text,
    wp_page_template text DEFAULT ''::text,
    github_repo text,
    github_token text,
    github_mdx_path text DEFAULT 'content/pages'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    repo_profile jsonb,
    last_indexed_at timestamp with time zone,
    github_branch text,
    auto_promote boolean DEFAULT false NOT NULL,
    cms_schema jsonb,
    cms_schema_read_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.taxonomies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_type_id uuid NOT NULL,
    key character varying(255) NOT NULL,
    label character varying(255) NOT NULL,
    description text,
    is_hierarchical boolean DEFAULT false NOT NULL,
    supported_types jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.taxonomy_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    taxonomy_id uuid NOT NULL,
    remote_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    description text,
    parent_remote_id bigint,
    level integer DEFAULT 0 NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.vector_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    embedding vector(1536) NOT NULL,
    content text NOT NULL,
    content_hash character varying(64) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    site_id uuid,
    document_type character varying(50) NOT NULL,
    content_type_key character varying(255),
    focus_keyword character varying(500),
    word_count integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_key text NOT NULL
);


-- ─── Constraints ────────────────────────────────────────────────────────────
--
-- ALTER TABLE rather than inline, so foreign keys impose no table ordering.

ALTER TABLE public.analysis_runs ADD CONSTRAINT analysis_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.articles ADD CONSTRAINT articles_pkey PRIMARY KEY (id);
ALTER TABLE public.backlinks ADD CONSTRAINT backlinks_pkey PRIMARY KEY (id);
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);
ALTER TABLE public.content_drafts ADD CONSTRAINT content_drafts_pkey PRIMARY KEY (id);
ALTER TABLE public.content_embeddings ADD CONSTRAINT content_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE public.content_fields ADD CONSTRAINT content_fields_pkey PRIMARY KEY (id);
ALTER TABLE public.content_schemas ADD CONSTRAINT content_schemas_pkey PRIMARY KEY (id);
ALTER TABLE public.content_types ADD CONSTRAINT content_types_pkey PRIMARY KEY (id);
ALTER TABLE public.cycle_plans ADD CONSTRAINT cycle_plans_pkey PRIMARY KEY (id);
ALTER TABLE public.editorial_calendar ADD CONSTRAINT editorial_calendar_pkey PRIMARY KEY (id);
ALTER TABLE public.federated_sites ADD CONSTRAINT federated_sites_pkey PRIMARY KEY (id);
ALTER TABLE public.gbp_profiles ADD CONSTRAINT gbp_profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.generations ADD CONSTRAINT generations_pkey PRIMARY KEY (id);
ALTER TABLE public.google_connections ADD CONSTRAINT google_connections_pkey PRIMARY KEY (id);
ALTER TABLE public.gsc_performance ADD CONSTRAINT gsc_performance_pkey PRIMARY KEY (id);
ALTER TABLE public.indexing_queue ADD CONSTRAINT indexing_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.job_executions ADD CONSTRAINT job_executions_pkey PRIMARY KEY (id);
ALTER TABLE public.rag_context_cache ADD CONSTRAINT rag_context_cache_pkey PRIMARY KEY (id);
ALTER TABLE public.schema_embeddings ADD CONSTRAINT schema_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE public.schema_sync_logs ADD CONSTRAINT schema_sync_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.serp_snapshots ADD CONSTRAINT serp_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.similarity_cache ADD CONSTRAINT similarity_cache_pkey PRIMARY KEY (id);
ALTER TABLE public.site_pages ADD CONSTRAINT site_pages_pkey PRIMARY KEY (id);
ALTER TABLE public.sites ADD CONSTRAINT sites_pkey PRIMARY KEY (id);
ALTER TABLE public.taxonomies ADD CONSTRAINT taxonomies_pkey PRIMARY KEY (id);
ALTER TABLE public.taxonomy_terms ADD CONSTRAINT taxonomy_terms_pkey PRIMARY KEY (id);
ALTER TABLE public.vector_embeddings ADD CONSTRAINT vector_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE public.content_embeddings ADD CONSTRAINT unique_content_external UNIQUE (federated_site_id, content_id);
ALTER TABLE public.content_fields ADD CONSTRAINT unique_field_type_key UNIQUE (content_type_id, key);
ALTER TABLE public.content_schemas ADD CONSTRAINT unique_schema_site_name UNIQUE (federated_site_id, name);
ALTER TABLE public.content_types ADD CONSTRAINT unique_content_type_schema_key UNIQUE (schema_id, key);
ALTER TABLE public.federated_sites ADD CONSTRAINT unique_site_url UNIQUE (url);
ALTER TABLE public.gbp_profiles ADD CONSTRAINT gbp_profiles_site_id_key UNIQUE (site_id);
ALTER TABLE public.google_connections ADD CONSTRAINT google_connections_site_id_key UNIQUE (site_id);
ALTER TABLE public.indexing_queue ADD CONSTRAINT indexing_queue_job_id_key UNIQUE (job_id);
ALTER TABLE public.rag_context_cache ADD CONSTRAINT rag_context_cache_cache_key_key UNIQUE (cache_key);
ALTER TABLE public.schema_embeddings ADD CONSTRAINT unique_schema_content_type UNIQUE (schema_id, content_type_key);
ALTER TABLE public.taxonomies ADD CONSTRAINT unique_taxonomy_key UNIQUE (content_type_id, key);
ALTER TABLE public.taxonomy_terms ADD CONSTRAINT unique_term_remote UNIQUE (taxonomy_id, remote_id);
ALTER TABLE public.taxonomy_terms ADD CONSTRAINT unique_term_slug UNIQUE (taxonomy_id, slug);
ALTER TABLE public.analysis_runs ADD CONSTRAINT analysis_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])));
ALTER TABLE public.articles ADD CONSTRAINT articles_article_type_check CHECK ((article_type = ANY (ARRAY['tutorial'::text, 'list'::text, 'case_study'::text, 'glossary'::text, 'example'::text])));
ALTER TABLE public.articles ADD CONSTRAINT articles_status_check CHECK ((status = ANY (ARRAY['publish'::text, 'draft'::text, 'pending'::text])));
ALTER TABLE public.backlinks ADD CONSTRAINT backlinks_link_type_check CHECK ((link_type = ANY (ARRAY['thematic'::text, 'local'::text, 'directory'::text, 'guest_post'::text, 'social'::text])));
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_page_types_check CHECK ((page_types <@ ARRAY['pillar'::text, 'child'::text, 'alternative'::text, 'comparative'::text, 'local_pack'::text]));
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_publish_status_check CHECK ((publish_status = ANY (ARRAY['publish'::text, 'draft'::text, 'pending'::text])));
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_schedule_frequency_check CHECK ((schedule_frequency = ANY (ARRAY['manual'::text, 'daily'::text, 'every_2_days'::text, 'every_3_days'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text, 'custom'::text])));
ALTER TABLE public.content_drafts ADD CONSTRAINT content_drafts_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'validated'::character varying, 'published'::character varying, 'rejected'::character varying])::text[])));
ALTER TABLE public.cycle_plans ADD CONSTRAINT cycle_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'executing'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE public.editorial_calendar ADD CONSTRAINT editorial_calendar_page_type_check CHECK ((page_type = ANY (ARRAY['pillar'::text, 'child'::text, 'alternative'::text, 'comparative'::text, 'local_pack'::text])));
ALTER TABLE public.editorial_calendar ADD CONSTRAINT editorial_calendar_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'generating'::text, 'generated'::text, 'published'::text, 'skipped'::text, 'failed'::text])));
ALTER TABLE public.federated_sites ADD CONSTRAINT federated_sites_type_check CHECK (((type)::text = ANY ((ARRAY['wordpress'::character varying, 'sanity'::character varying])::text[])));
ALTER TABLE public.generations ADD CONSTRAINT generations_page_type_check CHECK ((page_type = ANY (ARRAY['pillar'::text, 'child'::text, 'alternative'::text, 'comparative'::text, 'local_pack'::text])));
ALTER TABLE public.generations ADD CONSTRAINT generations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'generating'::text, 'generated'::text, 'publishing'::text, 'published'::text, 'failed'::text, 'rejected'::text])));
ALTER TABLE public.indexing_queue ADD CONSTRAINT indexing_queue_job_type_check CHECK (((job_type)::text = ANY ((ARRAY['index_schema'::character varying, 'index_content'::character varying, 'reindex_site'::character varying, 'delete_site'::character varying, 'cleanup'::character varying])::text[])));
ALTER TABLE public.indexing_queue ADD CONSTRAINT indexing_queue_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])));
ALTER TABLE public.schema_sync_logs ADD CONSTRAINT schema_sync_logs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])));
ALTER TABLE public.sites ADD CONSTRAINT sites_type_check CHECK ((type = ANY (ARRAY['wordpress'::text, 'nextjs'::text])));
ALTER TABLE public.vector_embeddings ADD CONSTRAINT vector_embeddings_document_type_check CHECK (((document_type)::text = ANY ((ARRAY['schema'::character varying, 'content'::character varying, 'taxonomy_term'::character varying, 'seo_data'::character varying, 'competitor'::character varying, 'example'::character varying])::text[])));
ALTER TABLE public.analysis_runs ADD CONSTRAINT analysis_runs_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;
ALTER TABLE public.articles ADD CONSTRAINT articles_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.articles ADD CONSTRAINT articles_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;
ALTER TABLE public.backlinks ADD CONSTRAINT backlinks_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE public.content_drafts ADD CONSTRAINT content_drafts_federated_site_id_fkey FOREIGN KEY (federated_site_id) REFERENCES federated_sites(id) ON DELETE CASCADE;
ALTER TABLE public.content_fields ADD CONSTRAINT content_fields_content_type_id_fkey FOREIGN KEY (content_type_id) REFERENCES content_types(id) ON DELETE CASCADE;
ALTER TABLE public.content_fields ADD CONSTRAINT content_fields_parent_field_id_fkey FOREIGN KEY (parent_field_id) REFERENCES content_fields(id);
ALTER TABLE public.content_schemas ADD CONSTRAINT content_schemas_federated_site_id_fkey FOREIGN KEY (federated_site_id) REFERENCES federated_sites(id) ON DELETE CASCADE;
ALTER TABLE public.content_types ADD CONSTRAINT content_types_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES content_schemas(id) ON DELETE CASCADE;
ALTER TABLE public.cycle_plans ADD CONSTRAINT cycle_plans_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE public.editorial_calendar ADD CONSTRAINT editorial_calendar_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE public.editorial_calendar ADD CONSTRAINT editorial_calendar_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL;
ALTER TABLE public.gbp_profiles ADD CONSTRAINT gbp_profiles_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE public.generations ADD CONSTRAINT generations_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.generations ADD CONSTRAINT generations_parent_generation_id_fkey FOREIGN KEY (parent_generation_id) REFERENCES generations(id) ON DELETE SET NULL;
ALTER TABLE public.generations ADD CONSTRAINT generations_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;
ALTER TABLE public.google_connections ADD CONSTRAINT google_connections_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE public.gsc_performance ADD CONSTRAINT gsc_performance_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE public.schema_sync_logs ADD CONSTRAINT schema_sync_logs_federated_site_id_fkey FOREIGN KEY (federated_site_id) REFERENCES federated_sites(id) ON DELETE CASCADE;
ALTER TABLE public.site_pages ADD CONSTRAINT site_pages_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE public.taxonomies ADD CONSTRAINT taxonomies_content_type_id_fkey FOREIGN KEY (content_type_id) REFERENCES content_types(id) ON DELETE CASCADE;
ALTER TABLE public.taxonomy_terms ADD CONSTRAINT taxonomy_terms_taxonomy_id_fkey FOREIGN KEY (taxonomy_id) REFERENCES taxonomies(id) ON DELETE CASCADE;


-- ─── Indexes ────────────────────────────────────────────────────────────────
--
-- Constraint-backed indexes are omitted: their constraint already creates them.

CREATE INDEX IF NOT EXISTS idx_analysis_runs_site ON public.analysis_runs USING btree (site_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_status ON public.analysis_runs USING btree (status);
CREATE INDEX IF NOT EXISTS idx_articles_campaign ON public.articles USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS idx_backlinks_site ON public.backlinks USING btree (site_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_next_run ON public.campaigns USING btree (next_run_at) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_campaigns_site_id ON public.campaigns USING btree (site_id);
CREATE INDEX IF NOT EXISTS idx_content_drafts_created ON public.content_drafts USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_drafts_site ON public.content_drafts USING btree (federated_site_id);
CREATE INDEX IF NOT EXISTS idx_content_drafts_status ON public.content_drafts USING btree (status);
CREATE INDEX IF NOT EXISTS idx_content_drafts_type ON public.content_drafts USING btree (content_type_key);
CREATE INDEX IF NOT EXISTS idx_content_embeddings_hnsw ON public.content_embeddings USING hnsw (content_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_content_embeddings_keyword ON public.content_embeddings USING btree (focus_keyword) WHERE (focus_keyword IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_content_embeddings_site ON public.content_embeddings USING btree (federated_site_id);
CREATE INDEX IF NOT EXISTS idx_content_embeddings_type ON public.content_embeddings USING btree (content_type_key);
CREATE INDEX IF NOT EXISTS idx_content_fields_parent ON public.content_fields USING btree (parent_field_id);
CREATE INDEX IF NOT EXISTS idx_content_fields_type ON public.content_fields USING btree (content_type_id);
CREATE INDEX IF NOT EXISTS idx_content_fields_type_name ON public.content_fields USING btree (field_type);
CREATE INDEX IF NOT EXISTS idx_content_schemas_site ON public.content_schemas USING btree (federated_site_id);
CREATE INDEX IF NOT EXISTS idx_content_types_parent ON public.content_types USING btree (parent_key);
CREATE INDEX IF NOT EXISTS idx_content_types_schema ON public.content_types USING btree (schema_id);
CREATE INDEX IF NOT EXISTS idx_cycle_plans_active ON public.cycle_plans USING btree (status) WHERE (status = ANY (ARRAY['draft'::text, 'executing'::text]));
CREATE INDEX IF NOT EXISTS idx_cycle_plans_campaign ON public.cycle_plans USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS idx_editorial_calendar_due ON public.editorial_calendar USING btree (scheduled_date, created_at) WHERE (status = 'planned'::text);
CREATE INDEX IF NOT EXISTS idx_editorial_calendar_stale ON public.editorial_calendar USING btree (updated_at) WHERE (status = 'generating'::text);
CREATE INDEX IF NOT EXISTS idx_editorial_campaign ON public.editorial_calendar USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS idx_editorial_date ON public.editorial_calendar USING btree (scheduled_date) WHERE (status = 'planned'::text);
CREATE INDEX IF NOT EXISTS idx_editorial_plan_item ON public.editorial_calendar USING btree (plan_item_id) WHERE (plan_item_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_embeddings_content_hash ON public.vector_embeddings USING btree (content_hash);
CREATE INDEX IF NOT EXISTS idx_embeddings_content_type ON public.vector_embeddings USING btree (content_type_key) WHERE (content_type_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_embeddings_created ON public.vector_embeddings USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_embeddings_doc_type ON public.vector_embeddings USING btree (document_type);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON public.vector_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX IF NOT EXISTS idx_embeddings_keyword ON public.vector_embeddings USING btree (focus_keyword) WHERE (focus_keyword IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_embeddings_site ON public.vector_embeddings USING btree (site_id) WHERE (site_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_federated_sites_active ON public.federated_sites USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_federated_sites_type ON public.federated_sites USING btree (type);
CREATE INDEX IF NOT EXISTS idx_gbp_profiles_site ON public.gbp_profiles USING btree (site_id);
CREATE INDEX IF NOT EXISTS idx_generations_campaign ON public.generations USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS idx_generations_has_page_payload ON public.generations USING btree (((page_payload IS NOT NULL))) WHERE (page_payload IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_generations_page_type ON public.generations USING btree (page_type);
CREATE INDEX IF NOT EXISTS idx_generations_parent ON public.generations USING btree (parent_generation_id);
CREATE INDEX IF NOT EXISTS idx_generations_published_at ON public.generations USING btree (site_id, published_at DESC) WHERE ((status = 'published'::text) AND (published_url IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_generations_rejected ON public.generations USING btree (updated_at DESC) WHERE (status = 'rejected'::text);
CREATE INDEX IF NOT EXISTS idx_generations_scheduled ON public.generations USING btree (scheduled_for) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_generations_site ON public.generations USING btree (site_id);
CREATE INDEX IF NOT EXISTS idx_generations_status ON public.generations USING btree (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_generations_unique_slug_site ON public.generations USING btree (site_id, slug) WHERE ((slug IS NOT NULL) AND (status <> 'failed'::text));
CREATE INDEX IF NOT EXISTS idx_google_connections_site ON public.google_connections USING btree (site_id);
CREATE INDEX IF NOT EXISTS idx_gsc_perf_page ON public.gsc_performance USING btree (site_id, page_url);
CREATE INDEX IF NOT EXISTS idx_gsc_perf_site_date ON public.gsc_performance USING btree (site_id, date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_perf_unique ON public.gsc_performance USING btree (site_id, date, page_url, query);
CREATE INDEX IF NOT EXISTS idx_gsc_performance_site_date ON public.gsc_performance USING btree (site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_performance_site_page ON public.gsc_performance USING btree (site_id, page_url);
CREATE INDEX IF NOT EXISTS idx_gsc_performance_site_query ON public.gsc_performance USING btree (site_id, query);
CREATE INDEX IF NOT EXISTS idx_indexing_queue_priority ON public.indexing_queue USING btree (priority DESC, scheduled_for) WHERE ((status)::text = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_indexing_queue_site ON public.indexing_queue USING btree (site_id) WHERE (site_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_indexing_queue_status ON public.indexing_queue USING btree (status) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying])::text[]));
CREATE INDEX IF NOT EXISTS idx_job_executions_executed_at ON public.job_executions USING btree (executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_executions_failed ON public.job_executions USING btree (executed_at DESC) WHERE (status = 'failed'::text);
CREATE INDEX IF NOT EXISTS idx_job_executions_job ON public.job_executions USING btree (job_type, job_id);
CREATE INDEX IF NOT EXISTS idx_rag_cache_expires ON public.rag_context_cache USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_rag_cache_key ON public.rag_context_cache USING btree (cache_key);
CREATE INDEX IF NOT EXISTS idx_rag_cache_site ON public.rag_context_cache USING btree (((params ->> 'siteId'::text))) WHERE ((params ->> 'siteId'::text) IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_schema_embeddings_hnsw ON public.schema_embeddings USING hnsw (schema_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_schema_embeddings_schema ON public.schema_embeddings USING btree (schema_id);
CREATE INDEX IF NOT EXISTS idx_serp_snapshots_fetched_at ON public.serp_snapshots USING btree (fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_serp_snapshots_query_locale ON public.serp_snapshots USING btree (query, locale);
CREATE INDEX IF NOT EXISTS idx_similarity_expires ON public.similarity_cache USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_similarity_hash ON public.similarity_cache USING btree (query_hash);
CREATE INDEX IF NOT EXISTS idx_site_pages_keyword ON public.site_pages USING btree (focus_keyword) WHERE (focus_keyword IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_site_pages_site ON public.site_pages USING btree (site_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_pages_url ON public.site_pages USING btree (site_id, path);
CREATE INDEX IF NOT EXISTS idx_sync_logs_site ON public.schema_sync_logs USING btree (federated_site_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON public.schema_sync_logs USING btree (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON public.schema_sync_logs USING btree (status);
CREATE INDEX IF NOT EXISTS idx_taxonomies_type ON public.taxonomies USING btree (content_type_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_level ON public.taxonomy_terms USING btree (level);
CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_parent ON public.taxonomy_terms USING btree (parent_remote_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_slug ON public.taxonomy_terms USING btree (slug);
CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_taxon ON public.taxonomy_terms USING btree (taxonomy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_embeddings_site_document_key ON public.vector_embeddings USING btree (site_id, document_key);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_google_connections_site ON public.google_connections USING btree (site_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gsc_performance_row ON public.gsc_performance USING btree (site_id, date, page_url, query);


-- ─── Triggers ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trigger_analysis_runs_updated_at ON public.analysis_runs;
CREATE TRIGGER trigger_analysis_runs_updated_at BEFORE UPDATE ON public.analysis_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_articles_updated_at ON public.articles;
CREATE TRIGGER trigger_articles_updated_at BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_campaigns_updated_at ON public.campaigns;
CREATE TRIGGER trigger_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_content_drafts_updated ON public.content_drafts;
CREATE TRIGGER tr_content_drafts_updated BEFORE UPDATE ON public.content_drafts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS tr_content_embeddings_updated ON public.content_embeddings;
CREATE TRIGGER tr_content_embeddings_updated BEFORE UPDATE ON public.content_embeddings FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

DROP TRIGGER IF EXISTS trigger_cycle_plans_updated_at ON public.cycle_plans;
CREATE TRIGGER trigger_cycle_plans_updated_at BEFORE UPDATE ON public.cycle_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_editorial_calendar_updated_at ON public.editorial_calendar;
CREATE TRIGGER trg_editorial_calendar_updated_at BEFORE UPDATE ON public.editorial_calendar FOR EACH ROW EXECUTE FUNCTION editorial_calendar_touch_updated_at();

DROP TRIGGER IF EXISTS trigger_editorial_updated_at ON public.editorial_calendar;
CREATE TRIGGER trigger_editorial_updated_at BEFORE UPDATE ON public.editorial_calendar FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_federated_sites_updated ON public.federated_sites;
CREATE TRIGGER tr_federated_sites_updated BEFORE UPDATE ON public.federated_sites FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_gbp_profiles_updated_at ON public.gbp_profiles;
CREATE TRIGGER trigger_gbp_profiles_updated_at BEFORE UPDATE ON public.gbp_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_generations_updated_at ON public.generations;
CREATE TRIGGER trigger_generations_updated_at BEFORE UPDATE ON public.generations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_google_connections_updated_at ON public.google_connections;
CREATE TRIGGER trigger_google_connections_updated_at BEFORE UPDATE ON public.google_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_indexing_queue_updated ON public.indexing_queue;
CREATE TRIGGER tr_indexing_queue_updated BEFORE UPDATE ON public.indexing_queue FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

DROP TRIGGER IF EXISTS tr_rag_context_cache_updated ON public.rag_context_cache;
CREATE TRIGGER tr_rag_context_cache_updated BEFORE UPDATE ON public.rag_context_cache FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

DROP TRIGGER IF EXISTS tr_schema_embeddings_updated ON public.schema_embeddings;
CREATE TRIGGER tr_schema_embeddings_updated BEFORE UPDATE ON public.schema_embeddings FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();

DROP TRIGGER IF EXISTS trigger_site_pages_updated_at ON public.site_pages;
CREATE TRIGGER trigger_site_pages_updated_at BEFORE UPDATE ON public.site_pages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_sites_updated_at ON public.sites;
CREATE TRIGGER trigger_sites_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tr_taxonomy_terms_updated ON public.taxonomy_terms;
CREATE TRIGGER tr_taxonomy_terms_updated BEFORE UPDATE ON public.taxonomy_terms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS tr_vector_embeddings_updated ON public.vector_embeddings;
CREATE TRIGGER tr_vector_embeddings_updated BEFORE UPDATE ON public.vector_embeddings FOR EACH ROW EXECUTE FUNCTION update_vector_embeddings_updated_at();


-- ─── Column comments ────────────────────────────────────────────────────────

COMMENT ON COLUMN public.editorial_calendar.error_message IS 'Why the last attempt failed. Set together with status = ''failed'' once the scheduler has exhausted its attempts; cleared when the slot is claimed again.';
COMMENT ON COLUMN public.editorial_calendar.attempt_count IS 'Attempts already spent on this slot, incremented when the scheduler claims it. Beyond JOB_CONFIGS.editorial.maxAttempts the slot is marked failed instead of being re-planned.';
COMMENT ON COLUMN public.generations.page_payload IS 'Full GeneratedPage object as returned by the generator (schemas, FAQ, internal links, CTA). NULL for rows created before this migration: the publisher falls back to rebuilding from the scalar columns.';
COMMENT ON COLUMN public.generations.published_at IS 'Instant the page went live, written once by the publisher. Distinct from updated_at, which moves on every write and therefore cannot date a publication. NULL for rows published before this column existed: readers fall back to updated_at.';
COMMENT ON COLUMN public.generations.publish_mode IS 'How the connector produced the page, in its own words: contrat / charpente / secours for Next.js, wp-creation-rankmath and friends for WordPress. A free string, read by humans, never branched on.';
COMMENT ON COLUMN public.generations.publish_live IS 'Whether a visitor could reach the page at publication time. False for a commit on an unpromoted branch and for a WordPress draft — both of which used to be stamped published_at and submitted for indexing.';
COMMENT ON COLUMN public.generations.publish_notes IS 'What the connector needed to say and which is not an error: structured data stripped by KSES, no SEO plugin installed, page awaiting review, branch not merged.';
COMMENT ON COLUMN public.generations.refusal_kind IS 'Why the engine DECLINED to publish, when it declined on purpose: occupe (the slug is served by a page the engine did not write), redirection (the URL redirects elsewhere), identifiants (credentials missing). NULL means the publication broke rather than being refused, and the deferred job will retry it on its own.';
COMMENT ON COLUMN public.google_connections.gsc_last_sync_at IS 'When lib/google/sync.ts last finished a Search Console read for this site, successful or not. NULL means it never ran — which is NOT the same as "no data".';
COMMENT ON COLUMN public.google_connections.gsc_last_sync_status IS 'running | success | skipped | failed. running is written before a background sync starts, so the interface does not show "jamais synchronise" while it works; skipped = no property selected yet, so there was nothing to query.';
COMMENT ON COLUMN public.google_connections.gsc_last_sync_rows IS 'Rows actually written to gsc_performance by that run. 0 with status success means Search Console reported no impression over the window.';
COMMENT ON COLUMN public.google_connections.gsc_last_sync_range_start IS 'First day of the window read. Search Console publishes with a ~3 day lag, so the range never reaches today.';
COMMENT ON COLUMN public.google_connections.gsc_last_sync_range_end IS 'Last day of the window read.';
COMMENT ON COLUMN public.google_connections.gsc_last_sync_truncated IS 'true when the paginated read hit its own row ceiling: Search Console holds MORE than what was stored, and the figures shown are a floor.';
COMMENT ON COLUMN public.google_connections.gsc_last_sync_error IS 'Message of the last failure, kept so the interface can explain a silent sync instead of showing an empty chart.';
COMMENT ON COLUMN public.google_connections.gbp_last_sync_status IS 'success | skipped | quota_exhausted | failed. quota_exhausted is the default state of a new Google Cloud project (Business Profile APIs start at 0 req/min) and requires a quota increase request to Google, not a code change.';
COMMENT ON COLUMN public.job_executions.job_id IS 'Id of the subject of the job: editorial slot, campaign or generation depending on job_type.';
COMMENT ON COLUMN public.job_executions.duration_ms IS 'Elapsed milliseconds for the whole job. Rows written before 2026-08 hold an epoch timestamp instead: the code used to log Date.now() as if it were a duration.';
COMMENT ON COLUMN public.serp_snapshots.query IS 'Normalised query (trimmed, lowercased, whitespace collapsed) so that casing and spacing variants share one cache entry.';
COMMENT ON COLUMN public.serp_snapshots.payload IS 'SerpParseResult as captured: organic results, People Also Ask, related searches. Shape follows lib/serp/types.ts and may change with the parser.';
COMMENT ON COLUMN public.site_pages.content_excerpt IS 'First readable characters of the page body, script/style/nav stripped, captured by lib/analyzer/crawler.ts. Feeds the vector index; NULL for rows crawled before this column existed, in which case the indexer falls back to title + h1 + h2s + keywords.';
COMMENT ON COLUMN public.sites.last_indexed_at IS 'Completion time of the last vector indexing run for this site. NULL means the site has never been indexed — which used to be true of every site, silently.';
COMMENT ON COLUMN public.sites.github_branch IS 'Branch that generated pages are committed to (reads use it as ?ref= too). NULL means the repository default branch, i.e. production on most setups.';
COMMENT ON COLUMN public.sites.auto_promote IS 'When true and github_branch is set, the publisher merges that branch into the repository default branch right after a successful publication, so the page reaches production. False leaves the branch as a staging area to be merged by hand. No effect when github_branch is NULL, since publication already targets the default branch.';
COMMENT ON COLUMN public.sites.cms_schema IS 'Last schema read from the client CMS: content types, fields, taxonomies, SEO plugin. Stored whole rather than split across content_schemas/content_types/content_fields, which nothing in this repository has ever written. Reading it is several authenticated round-trips to the client production site, so it is kept instead of being re-read on every screen.';
COMMENT ON COLUMN public.sites.cms_schema_read_at IS 'When cms_schema was last read from the site. Shown to the operator so a stale schema is visible as stale rather than assumed current.';
COMMENT ON COLUMN public.vector_embeddings.document_key IS 'Stable logical identity of the indexed document within its site, e.g. ''page:/tarifs'' or ''generation:<uuid>''. Upserts key on (site_id, document_key): re-indexing a page REPLACES its row instead of adding one.';
