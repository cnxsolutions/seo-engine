-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - What is actually in this database?
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Read-only. Run it in the Supabase SQL Editor whenever a migration fails with
-- "relation ... does not exist": the repository has no baseline schema, so the
-- only way to know which migrations were ever applied is to ask the database.
--
-- Replace this file's job entirely by exporting a baseline:
--   pg_dump --schema-only --no-owner --no-privileges "<CONNECTION_STRING>" > db/000_baseline.sql

-- ─── 1. Which tables exist, and are they empty? ─────────────────────────────────

SELECT
    c.relname                                   AS table_name,
    c.reltuples::bigint                         AS approx_rows,
    CASE
        WHEN c.relname IN ('sites', 'campaigns', 'generations', 'editorial_calendar',
                           'cycle_plans', 'site_pages', 'articles', 'analysis_runs',
                           'google_connections')                  THEN 'core (base schema)'
        WHEN c.relname IN ('federated_sites', 'content_schemas', 'content_types',
                           'content_fields', 'taxonomies', 'taxonomy_terms',
                           'content_drafts', 'schema_sync_logs')   THEN '001_schema_federation'
        WHEN c.relname IN ('vector_embeddings', 'schema_embeddings', 'content_embeddings',
                           'rag_context_cache', 'indexing_queue',
                           'similarity_cache')                     THEN '005_add_vector_store'
        WHEN c.relname = 'job_executions'                          THEN '007_scheduler_reliability'
        WHEN c.relname = 'gsc_performance'                         THEN '010_gsc_performance_loop'
        WHEN c.relname = 'serp_snapshots'                          THEN '011_serp_snapshots'
        ELSE 'unknown / manual'
    END                                         AS created_by
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY created_by, table_name;

-- ─── 2. Is pgvector enabled? (005 cannot run without it) ────────────────────────

SELECT
    'vector extension' AS check_name,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS enabled;

-- ─── 3. Which columns added by recent migrations are present? ───────────────────
--
-- Tells apart "the migration ran" from "the table happens to exist".

SELECT
    t.table_name || '.' || t.column_name AS column_ref,
    t.expected_from,
    EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = t.table_name
          AND c.column_name = t.column_name
    ) AS present
FROM (VALUES
    ('generations',        'page_payload',    '006_generation_page_payload'),
    ('editorial_calendar', 'error_message',   '007_scheduler_reliability'),
    ('editorial_calendar', 'attempt_count',   '007_scheduler_reliability'),
    ('editorial_calendar', 'updated_at',      '007_scheduler_reliability'),
    ('vector_embeddings',  'document_key',    '009_vector_index_keys'),
    ('site_pages',         'content_excerpt', '009_vector_index_keys'),
    ('sites',              'last_indexed_at', '009_vector_index_keys'),
    ('generations',        'published_at',    '010_gsc_performance_loop')
) AS t(table_name, column_name, expected_from);

-- ─── 4. Does generations.status accept 'rejected'? (008) ────────────────────────
--
-- The publishing gate writes that value; without it every rejected article
-- falls back to 'failed' and loses the distinction between "refused by the
-- quality gate" and "the run crashed".

SELECT
    con.conname          AS constraint_name,
    pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'generations'
  AND con.contype = 'c';
