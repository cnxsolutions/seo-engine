-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - SERP snapshot cache
-- Migration: 011_serp_snapshots
-- Purpose: Make reading the SERP sustainable by fetching each query at most
--          once per freshness window.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Briefs are regenerated far more often than the search results actually move:
-- previewing a cycle, cancelling it, adjusting a campaign and previewing again
-- all replay the same queries. Without this table a 30-brief plan costs 30 live
-- fetches EVERY time it is rebuilt; with it, a cycle re-planned three times in a
-- morning costs one round of fetches.
--
-- That ratio is the whole reason the scraping approach is viable at all: the
-- cache is what keeps the request volume in the tens per week rather than the
-- thousands.
--
-- The payload is stored whole rather than normalised into columns. It is a
-- snapshot of an external system we do not control — its shape will change when
-- the parser is updated, and a jsonb blob absorbs that without a migration.

CREATE TABLE IF NOT EXISTS public.serp_snapshots (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    query       text NOT NULL,
    locale      text NOT NULL DEFAULT 'fr-FR',
    payload     jsonb NOT NULL,
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.serp_snapshots IS
    'Cached search result pages, keyed by normalised query + locale. Read by lib/serp; entries older than the freshness window are refetched, older than the retention window are pruned.';

COMMENT ON COLUMN public.serp_snapshots.query IS
    'Normalised query (trimmed, lowercased, whitespace collapsed) so that casing and spacing variants share one cache entry.';

COMMENT ON COLUMN public.serp_snapshots.payload IS
    'SerpParseResult as captured: organic results, People Also Ask, related searches. Shape follows lib/serp/types.ts and may change with the parser.';

-- One live entry per query+locale. The upsert in lib/serp/cache.ts targets this
-- constraint by name, so removing it silently turns every write into an insert
-- and the table grows without ever being read.
CREATE UNIQUE INDEX IF NOT EXISTS idx_serp_snapshots_query_locale
    ON public.serp_snapshots (query, locale);

-- Freshness lookups and the pruning job both order by age.
CREATE INDEX IF NOT EXISTS idx_serp_snapshots_fetched_at
    ON public.serp_snapshots (fetched_at DESC);
