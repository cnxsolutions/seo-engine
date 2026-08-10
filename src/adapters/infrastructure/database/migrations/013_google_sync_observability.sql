-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - Make the Google synchronisation say what it did
-- Migration: 013_google_sync_observability
-- Purpose: Store the outcome of the last Search Console / Business Profile
--          synchronisation next to the connection that produced it.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Until now nothing recorded whether a sync had run. `gsc_performance` empty
-- meant four different things at once — Google never connected, no property
-- selected, the sync failed, or the site genuinely has no impressions — and the
-- interface showed the same "0 clic" for all four. The operator's only way to
-- tell them apart was to trigger a job by hand and watch the server logs.
--
-- These columns are the missing evidence. They live on `google_connections`
-- rather than on `sites` because that is where the rest of the Google state
-- already is (`gsc_site_url` IS the property, so a `sites.gsc_property` column
-- would be a second copy of it, free to drift). Disconnecting a site deletes the
-- connection row and the sync history with it, which is the correct lifetime:
-- the numbers describe a connection, not a site.
--
-- Nothing here is required for the code to run: lib/google/sync.ts writes these
-- columns best-effort and logs a warning if they are absent, so a database that
-- has not received this migration keeps synchronising — it just stays blind.
--
-- Idempotent: safe to run twice.

DO $$
BEGIN
    IF to_regclass('public.google_connections') IS NULL THEN
        RAISE NOTICE 'public.google_connections introuvable — migration 013 sans effet.';
        RETURN;
    END IF;

    -- ─── Search Console ──────────────────────────────────────────────────────

    ALTER TABLE public.google_connections
        ADD COLUMN IF NOT EXISTS gsc_last_sync_at          timestamptz,
        ADD COLUMN IF NOT EXISTS gsc_last_sync_status      text,
        ADD COLUMN IF NOT EXISTS gsc_last_sync_rows        integer,
        ADD COLUMN IF NOT EXISTS gsc_last_sync_range_start date,
        ADD COLUMN IF NOT EXISTS gsc_last_sync_range_end   date,
        ADD COLUMN IF NOT EXISTS gsc_last_sync_truncated   boolean,
        ADD COLUMN IF NOT EXISTS gsc_last_sync_error       text;

    -- ─── Business Profile ────────────────────────────────────────────────────
    --
    -- `quota_exhausted` is a first-class status, not an error: on a recent
    -- Google Cloud project the Business Profile APIs ship with a default quota
    -- of zero requests per minute and answer 429 RESOURCE_EXHAUSTED to every
    -- call until Google grants an increase. The engine must show that as a
    -- pending administrative step, never as a failure of the product.

    ALTER TABLE public.google_connections
        ADD COLUMN IF NOT EXISTS gbp_last_sync_at     timestamptz,
        ADD COLUMN IF NOT EXISTS gbp_last_sync_status text,
        ADD COLUMN IF NOT EXISTS gbp_last_sync_error  text;
END $$;

-- Comments are applied outside the guard block so re-running on an already
-- migrated database refreshes them; each is a no-op if the column is missing.
DO $$
BEGIN
    IF to_regclass('public.google_connections') IS NULL THEN
        RETURN;
    END IF;

    COMMENT ON COLUMN public.google_connections.gsc_last_sync_at IS
        'When lib/google/sync.ts last finished a Search Console read for this site, successful or not. NULL means it never ran — which is NOT the same as "no data".';
    COMMENT ON COLUMN public.google_connections.gsc_last_sync_status IS
        'running | success | skipped | failed. running is written before a background sync starts, so the interface does not show "jamais synchronise" while it works; skipped = no property selected yet, so there was nothing to query.';
    COMMENT ON COLUMN public.google_connections.gsc_last_sync_rows IS
        'Rows actually written to gsc_performance by that run. 0 with status success means Search Console reported no impression over the window.';
    COMMENT ON COLUMN public.google_connections.gsc_last_sync_range_start IS
        'First day of the window read. Search Console publishes with a ~3 day lag, so the range never reaches today.';
    COMMENT ON COLUMN public.google_connections.gsc_last_sync_range_end IS
        'Last day of the window read.';
    COMMENT ON COLUMN public.google_connections.gsc_last_sync_truncated IS
        'true when the paginated read hit its own row ceiling: Search Console holds MORE than what was stored, and the figures shown are a floor.';
    COMMENT ON COLUMN public.google_connections.gsc_last_sync_error IS
        'Message of the last failure, kept so the interface can explain a silent sync instead of showing an empty chart.';
    COMMENT ON COLUMN public.google_connections.gbp_last_sync_status IS
        'success | skipped | quota_exhausted | failed. quota_exhausted is the default state of a new Google Cloud project (Business Profile APIs start at 0 req/min) and requires a quota increase request to Google, not a code change.';
END $$;
