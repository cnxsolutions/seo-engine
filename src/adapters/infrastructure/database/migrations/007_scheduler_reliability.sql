-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - Make the "day D" trigger reliable
-- Migration: 007_scheduler_reliability
-- Purpose: Give the scheduler what it needs to be idempotent, recoverable and
--          observable — a failure state, a freshness marker, and the audit
--          table its code has always written to.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Four defects motivate this migration:
--
--  1. `editorial_calendar.status` had no failure value. A slot moved to
--     'generating' that then failed stayed in 'generating' forever, and the
--     scheduler only ever looks at 'planned' slots — the slot was lost, silently.
--
--  2. Nothing recorded WHY a slot never produced its page, nor how many times it
--     had already been tried.
--
--  3. Nothing guaranteed that `updated_at` moved when the status did, which is
--     the only thing telling an abandoned slot from a running one.
--
--  4. `job_executions` is written to by lib/scheduler/cron.ts but was never
--     created by any migration. supabase-js returns insert errors instead of
--     throwing, so every job execution was being dropped without a trace.
--
-- Idempotent: safe to run twice.
--
-- One caveat if `status` turns out to be a native enum: PostgreSQL only allows
-- ALTER TYPE ... ADD VALUE inside a transaction from version 12 onwards. On an
-- older server, run that single statement on its own.

-- ─── 1. Failure message and attempt budget on editorial slots ────────────────────

ALTER TABLE public.editorial_calendar
    ADD COLUMN IF NOT EXISTS error_message text;

COMMENT ON COLUMN public.editorial_calendar.error_message IS
    'Why the last attempt failed. Set together with status = ''failed'' once the scheduler has exhausted its attempts; cleared when the slot is claimed again.';

-- A generation cannot be cancelled: retrying it seconds after a timeout runs two
-- of them at once, which is how one slot produced several articles. The scheduler
-- therefore retries a slot at the NEXT tick instead, and this counter is what
-- bounds those retries.
ALTER TABLE public.editorial_calendar
    ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.editorial_calendar.attempt_count IS
    'Attempts already spent on this slot, incremented when the scheduler claims it. Beyond JOB_CONFIGS.editorial.maxAttempts the slot is marked failed instead of being re-planned.';

-- ─── 2. Freshness marker (the reaper depends on it) ──────────────────────────────
--
-- The reaper puts back to 'planned' any slot left in 'generating' for more than
-- 30 minutes — which only works if updated_at really moves when the status does.
-- The scheduler sets it explicitly, but the calendar is also editable through the
-- API, so a trigger guarantees it for every writer.

ALTER TABLE public.editorial_calendar
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.editorial_calendar_touch_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_editorial_calendar_updated_at ON public.editorial_calendar;

CREATE TRIGGER trg_editorial_calendar_updated_at
    BEFORE UPDATE ON public.editorial_calendar
    FOR EACH ROW
    EXECUTE FUNCTION public.editorial_calendar_touch_updated_at();

-- ─── 3. The 'failed' status ──────────────────────────────────────────────────────
--
-- The base schema is not in this repository, so `status` may be a text column
-- guarded by a CHECK, or a native enum. Both cases are handled: the CHECK is
-- rebuilt with the new value, the enum gets the label added.

DO $$
DECLARE
    status_type_name text;
    status_type_kind char;
    existing_constraint text;
BEGIN
    SELECT t.typname, t.typtype
      INTO status_type_name, status_type_kind
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
     WHERE n.nspname = 'public'
       AND c.relname = 'editorial_calendar'
       AND a.attname = 'status'
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF status_type_name IS NULL THEN
        RAISE EXCEPTION 'editorial_calendar.status not found — run the base schema first';
    END IF;

    IF status_type_kind = 'e' THEN
        -- Native enum: add the label, keep every existing one.
        EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS %L', status_type_name, 'failed');
    ELSE
        -- Text column: drop whatever CHECK currently constrains `status`
        -- (its name is unknown here) and reinstate it with 'failed' allowed.
        FOR existing_constraint IN
            SELECT con.conname
              FROM pg_constraint con
              JOIN pg_class rel ON rel.oid = con.conrelid
              JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
             WHERE nsp.nspname = 'public'
               AND rel.relname = 'editorial_calendar'
               AND con.contype = 'c'
               AND pg_get_constraintdef(con.oid) ILIKE '%status%'
        LOOP
            EXECUTE format('ALTER TABLE public.editorial_calendar DROP CONSTRAINT %I', existing_constraint);
        END LOOP;

        ALTER TABLE public.editorial_calendar
            ADD CONSTRAINT editorial_calendar_status_check
            CHECK (status IN ('planned', 'generating', 'generated', 'published', 'skipped', 'failed'));
    END IF;
END $$;

-- ─── 4. Indexes for the two scheduler queries ────────────────────────────────────
--
-- Partial indexes: both queries only ever look at one status, and the vast
-- majority of rows end up 'generated' or 'published'.

-- "Which slots are due?" — status = 'planned' ordered by scheduled_date.
CREATE INDEX IF NOT EXISTS idx_editorial_calendar_due
    ON public.editorial_calendar (scheduled_date, created_at)
    WHERE status = 'planned';

-- "Which slots are abandoned?" — status = 'generating' older than the threshold.
CREATE INDEX IF NOT EXISTS idx_editorial_calendar_stale
    ON public.editorial_calendar (updated_at)
    WHERE status = 'generating';

-- ─── 5. job_executions ───────────────────────────────────────────────────────────
--
-- Columns deduced from the object inserted by logJobExecution() in
-- lib/scheduler/cron.ts, and from the deletion performed by cleanupOldLogs().
--
-- No foreign keys on purpose: this is an audit trail. It must outlive the rows
-- it refers to (a campaign deleted next month should not erase last month's
-- history), and it must never make an insert fail — a log that can reject a
-- write is worse than no log. `job_id` is polymorphic (a slot, a campaign or a
-- generation id depending on job_type), hence text.

CREATE TABLE IF NOT EXISTS public.job_executions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type      text NOT NULL,
    job_id        text NOT NULL,
    campaign_id   uuid,
    generation_id uuid,
    status        text NOT NULL,
    published_url text,
    error_message text,
    duration_ms   bigint,
    executed_at   timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_executions IS
    'Audit trail of scheduler runs. Written fire-and-forget by lib/scheduler/cron.ts, pruned after 7 days by the daily cleanup job.';

COMMENT ON COLUMN public.job_executions.duration_ms IS
    'Elapsed milliseconds for the whole job. Rows written before 2026-08 hold an epoch timestamp instead: the code used to log Date.now() as if it were a duration.';

COMMENT ON COLUMN public.job_executions.job_id IS
    'Id of the subject of the job: editorial slot, campaign or generation depending on job_type.';

-- The daily cleanup deletes on executed_at, the dashboard reads the latest rows:
-- both are served by a descending index.
CREATE INDEX IF NOT EXISTS idx_job_executions_executed_at
    ON public.job_executions (executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_executions_job
    ON public.job_executions (job_type, job_id);

-- Failures are the only rows worth scanning for on their own.
CREATE INDEX IF NOT EXISTS idx_job_executions_failed
    ON public.job_executions (executed_at DESC)
    WHERE status = 'failed';
