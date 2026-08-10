-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - Close the loop between what is published and what performs
-- Migration: 010_gsc_performance_loop
-- (numbered 010 because 009 was taken by a concurrent change on the vector
--  store; the two are independent — this one touches gsc_performance,
--  google_connections and generations, nothing else)
-- Purpose: Give the measurement loop the table it has always written to, the
--          unique keys its upserts silently need, and a real publication date.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Four defects motivate this migration:
--
--  1. `gsc_performance` is read by five modules (lib/google/sync.ts,
--     lib/google/context.ts, lib/google/performance.ts, app/api/analytics and
--     app/api/sites/[id]/google/gsc) and is created by NO migration of this
--     repository — see db/README.md section 3. Until now the whole Search
--     Console integration wrote into a table whose only definition lived in the
--     Supabase dashboard. supabase-js reports a missing relation as `error`
--     rather than throwing, so a wrong or absent table degrades to "zero
--     clicks" instead of to an alert.
--
--  2. lib/google/sync.ts upserts with
--     `onConflict: 'site_id,date,page_url,query'`. PostgREST turns that into
--     ON CONFLICT (site_id, date, page_url, query), which PostgreSQL REFUSES
--     unless a matching unique index exists ("there is no unique or exclusion
--     constraint matching the ON CONFLICT specification"). Without that index
--     every single sync chunk was rejected — and the return value of the upsert
--     was never inspected, so the sync reported success while writing nothing.
--
--  3. `google_connections` is upserted per site by lib/google/client.ts. The
--     call had no `onConflict`, so PostgREST fell back to the primary key: a
--     refresh that does not carry `id` is an INSERT, which either duplicates the
--     connection row (no unique key on site_id) or fails outright (unique key
--     present). Both outcomes end the same way: the site loses its Google
--     access. The code now passes `onConflict: 'site_id'`; this index is what
--     makes that legal.
--
--  4. Nothing recorded WHEN a page was published. Every caller approximated it
--     with `generations.updated_at`, which moves on any write — a republish, a
--     status fix, a manual edit — so "30 days after publication" could not be
--     computed. `published_at` is set once and never moves.
--
-- Idempotent: safe to run twice.

-- ─── 1. The table the Search Console integration has always assumed ──────────
--
-- Columns are deduced from the code that reads and writes them:
--   site_id / date / page_url / query / clicks / impressions / ctr / position
-- (lib/google/sync.ts builds exactly this row; lib/google/gsc.ts rounds ctr to
--  3 decimals and position to 1 before insert).

CREATE TABLE IF NOT EXISTS public.gsc_performance (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id      uuid        NOT NULL,
    date         date        NOT NULL,
    page_url     text        NOT NULL,
    query        text        NOT NULL,
    clicks       integer     NOT NULL DEFAULT 0,
    impressions  integer     NOT NULL DEFAULT 0,
    -- GSC returns a ratio (0.0421), not a percentage. Every reader divides
    -- clicks by impressions rather than trusting this column when aggregating,
    -- because averaging ratios across rows is meaningless.
    ctr          numeric(6,4) NOT NULL DEFAULT 0,
    -- Average position over the row's day, one decimal, as GSC reports it.
    position     numeric(6,2) NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gsc_performance IS
    'One Search Console row per (site, day, page, query). Written by lib/google/sync.ts, read by the planner to decide what to write next. This is the only feedback the engine has on whether a published page actually works.';

-- The foreign key is added only if `sites` exists: on a virgin database this
-- repository cannot yet create the business tables (db/README.md section 3), and
-- a hard REFERENCES would make the whole migration fail there.
DO $$
BEGIN
    IF to_regclass('public.sites') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conname = 'gsc_performance_site_id_fkey'
              AND conrelid = 'public.gsc_performance'::regclass
       )
    THEN
        -- Orphan rows would block the constraint; there is nothing to keep in a
        -- performance row whose site no longer exists.
        DELETE FROM public.gsc_performance g
         WHERE NOT EXISTS (SELECT 1 FROM public.sites s WHERE s.id = g.site_id);

        ALTER TABLE public.gsc_performance
            ADD CONSTRAINT gsc_performance_site_id_fkey
            FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ─── 2. The unique key every upsert depends on ───────────────────────────────
--
-- Deduplicate before creating the index: rows written before it existed can
-- repeat the same (site, day, page, query) as many times as the sync ran.
DELETE FROM public.gsc_performance a
 USING public.gsc_performance b
 WHERE a.id       <> b.id
   AND a.site_id   = b.site_id
   AND a.date      = b.date
   AND a.page_url  = b.page_url
   AND a.query     = b.query
   AND (a.created_at, a.id) < (b.created_at, b.id);

-- A PLAIN unique index on purpose: PostgREST can only infer a conflict target
-- from a full, unconditional index. Note the btree size limit (~2704 bytes per
-- entry): a page_url plus a query longer than that would be rejected at insert.
-- Search Console truncates both far below this in practice.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gsc_performance_row
    ON public.gsc_performance (site_id, date, page_url, query);

-- ─── 3. Read paths the loop actually uses ────────────────────────────────────

-- Every planner and analytics query filters on (site_id, date >= …).
CREATE INDEX IF NOT EXISTS idx_gsc_performance_site_date
    ON public.gsc_performance (site_id, date DESC);

-- Joining a published URL to its rows (measurePublishedPages).
CREATE INDEX IF NOT EXISTS idx_gsc_performance_site_page
    ON public.gsc_performance (site_id, page_url);

-- Grouping by query: striking distance and intent cannibalization.
CREATE INDEX IF NOT EXISTS idx_gsc_performance_site_query
    ON public.gsc_performance (site_id, query);

-- ─── 4. One Google connection per site ───────────────────────────────────────

DO $$
BEGIN
    IF to_regclass('public.google_connections') IS NULL THEN
        RAISE NOTICE 'public.google_connections introuvable — etape 4 sans effet.';
        RETURN;
    END IF;

    -- Keep the most recently updated connection per site; the older rows are
    -- the duplicates the missing onConflict produced.
    DELETE FROM public.google_connections a
     USING public.google_connections b
     WHERE a.id <> b.id
       AND a.site_id = b.site_id
       AND (a.updated_at, a.id) < (b.updated_at, b.id);

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_google_connections_site
        ON public.google_connections (site_id);
END $$;

-- ─── 5. A publication date that does not move ────────────────────────────────

DO $$
BEGIN
    IF to_regclass('public.generations') IS NULL THEN
        RAISE NOTICE 'public.generations introuvable — etape 5 sans effet.';
        RETURN;
    END IF;

    ALTER TABLE public.generations
        ADD COLUMN IF NOT EXISTS published_at timestamptz;

    COMMENT ON COLUMN public.generations.published_at IS
        'Instant the page went live, written once by the publisher. Distinct from updated_at, which moves on every write and therefore cannot date a publication. NULL for rows published before this column existed: readers fall back to updated_at.';

    -- Backfill: for already published rows updated_at is the best estimate
    -- available, and it is the estimate every reader used until now.
    UPDATE public.generations
       SET published_at = updated_at
     WHERE published_at IS NULL
       AND status = 'published'
       AND published_url IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_generations_published_at
        ON public.generations (site_id, published_at DESC)
        WHERE status = 'published' AND published_url IS NOT NULL;
END $$;
