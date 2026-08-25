-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - Persist the full generated page
-- Migration: 006_generation_page_payload
-- Purpose: Stop losing JSON-LD, FAQ and internal links on the deferred
--          publishing path.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The `generations` table only carries scalar columns (title, content, slug,
-- meta_description, focus_keyword). The generator, however, returns a much
-- richer object: three JSON-LD schemas (LocalBusiness, FAQPage, Breadcrumb),
-- the FAQ items, the internal link suggestions, the secondary keywords and the
-- CTA text.
--
-- The deferred publishing job rebuilds a page from the scalar columns alone and
-- fills every missing field with an empty value ('{}' / []). Every page it
-- publishes therefore ships WITHOUT structured data, WITHOUT its FAQ and
-- WITHOUT internal links — the opposite of what the generator produced and of
-- what the product promises.
--
-- Storing the payload verbatim lets the publisher republish exactly what was
-- generated, on the deferred path as well as the inline one.

-- ─── Column ─────────────────────────────────────────────────────────────────────

ALTER TABLE generations
    ADD COLUMN IF NOT EXISTS page_payload jsonb;

COMMENT ON COLUMN generations.page_payload IS
    'Full GeneratedPage object as returned by the generator (schemas, FAQ, internal links, CTA). NULL for rows created before this migration: the publisher falls back to rebuilding from the scalar columns.';

-- ─── Backfill policy ────────────────────────────────────────────────────────────
--
-- Deliberately NOT backfilled. The data was never persisted, so it cannot be
-- reconstructed after the fact. Existing rows keep page_payload = NULL and the
-- publisher handles them through its fallback path.

-- ─── Index ──────────────────────────────────────────────────────────────────────
--
-- Partial index on the presence of the payload: the publishing job needs to
-- distinguish rows it can republish faithfully from legacy rows, and this stays
-- small because it only covers non-null values.

CREATE INDEX IF NOT EXISTS idx_generations_has_page_payload
    ON generations ((page_payload IS NOT NULL))
    WHERE page_payload IS NOT NULL;
