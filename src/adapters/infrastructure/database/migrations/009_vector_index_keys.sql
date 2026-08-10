-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - Make the vector store fillable
-- Migration: 009_vector_index_keys
-- (numbered 009 because a concurrent change took 008; the two are independent —
--  this one touches vector_embeddings, site_pages and sites, nothing else)
-- Purpose: Give `vector_embeddings` a stable per-document identity so a site can
--          be indexed more than once, and keep enough page text around for an
--          embedding to mean something.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Three defects motivate this migration:
--
--  1. `unique_content_hash UNIQUE (content_hash)` was the ONLY key on the table.
--     It is global, so two sites sharing one sentence collide, and the winner's
--     `site_id` is overwritten by the loser's. Worse: it made re-indexation
--     impossible, because a page whose text changed produces a new hash and
--     therefore a new row — the old row was never replaced, only accumulated.
--     Worse still: a batch containing two identical pages (pagination stubs,
--     empty archives — routine on a WordPress crawl) makes PostgreSQL reject the
--     whole INSERT with "ON CONFLICT DO UPDATE cannot affect row a second time".
--
--     The logical identity of a document is (site, document_key) — "this page,
--     on this site" — not its text. The hash keeps a different job: telling
--     whether the text moved, so an unchanged page is never re-embedded (an
--     embedding call is billed).
--
--  2. `site_pages` stored the crawler's METADATA (title, h1, h2s, keywords) but
--     never a line of the page body, so an embedding built from those rows
--     described a table of contents, not a page. `content_excerpt` keeps the
--     first readable characters of the body — enough for semantic neighbours,
--     small enough to stay far below the embedding token limit.
--
--  3. Nothing recorded WHEN a site was last indexed, so an index that quietly
--     stopped filling looked exactly like one that had never been asked to.
--
-- Idempotent: safe to run twice.

-- ─── 1. Stable document identity on vector_embeddings ────────────────────────────

ALTER TABLE public.vector_embeddings
    ADD COLUMN IF NOT EXISTS document_key text;

COMMENT ON COLUMN public.vector_embeddings.document_key IS
    'Stable logical identity of the indexed document within its site, e.g. ''page:/tarifs'' or ''generation:<uuid>''. Upserts key on (site_id, document_key): re-indexing a page REPLACES its row instead of adding one.';

-- Existing rows predate the column. In practice the table is empty — nothing has
-- ever written to it — but the backfill keeps the migration safe if it is not.
UPDATE public.vector_embeddings
SET document_key = COALESCE(metadata->>'documentId', id::text)
WHERE document_key IS NULL;

-- Same guard for the unique index below: drop any duplicate that the old global
-- hash constraint could not have prevented, keeping the most recently updated.
DELETE FROM public.vector_embeddings a
USING public.vector_embeddings b
WHERE a.id <> b.id
  AND a.site_id IS NOT DISTINCT FROM b.site_id
  AND a.document_key = b.document_key
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

ALTER TABLE public.vector_embeddings
    ALTER COLUMN document_key SET NOT NULL;

-- A PLAIN unique index on purpose: PostgREST cannot express an index predicate in
-- its `on_conflict` parameter, so a partial index would silently stop being
-- usable for conflict inference and every upsert would insert a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_embeddings_site_document_key
    ON public.vector_embeddings (site_id, document_key);

-- ─── 2. Demote the content hash from key to change-detector ──────────────────────

ALTER TABLE public.vector_embeddings
    DROP CONSTRAINT IF EXISTS unique_content_hash;

-- Still indexed: the indexer reads (document_key, content_hash) for a whole site
-- before embedding anything, to skip the documents whose text has not moved.
CREATE INDEX IF NOT EXISTS idx_embeddings_content_hash
    ON public.vector_embeddings (content_hash);

-- ─── 3. Keep readable body text on crawled pages ─────────────────────────────────

ALTER TABLE public.site_pages
    ADD COLUMN IF NOT EXISTS content_excerpt text;

COMMENT ON COLUMN public.site_pages.content_excerpt IS
    'First readable characters of the page body, script/style/nav stripped, captured by lib/analyzer/crawler.ts. Feeds the vector index; NULL for rows crawled before this column existed, in which case the indexer falls back to title + h1 + h2s + keywords.';

-- ─── 4. Observability: when was this site last indexed ───────────────────────────

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS last_indexed_at timestamptz;

COMMENT ON COLUMN public.sites.last_indexed_at IS
    'Completion time of the last vector indexing run for this site. NULL means the site has never been indexed — which used to be true of every site, silently.';

-- ─── 5. Site-level index counters (read by getSiteIndexStatus) ───────────────────

CREATE OR REPLACE FUNCTION public.get_site_index_status(p_site_id UUID)
RETURNS TABLE (
    total_documents BIGINT,
    documents_by_type JSONB,
    last_indexed_at TIMESTAMPTZ
) AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_site_index_status(UUID) IS
    'How full the vector index is for one site. An empty index that fails silently is the defect this whole migration exists to make visible.';
