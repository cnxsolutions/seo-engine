-- ─────────────────────────────────────────────────────────────────────────────
-- 021 — Row-level security on every public table (QA-1, docs/cadrage.md)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POURQUOI. L'application ne parle a Supabase qu'avec la cle de SERVICE, cote
-- serveur, et cette cle contourne le RLS : rien ne change pour elle. La cle
-- PUBLIQUE (anon), elle, est publique par definition (NEXT_PUBLIC_*), et
-- l'espace client (L1) amene Supabase Auth jusqu'au navigateur. Une table sans
-- RLS est lisible par quiconque detient l'URL du projet et cette cle — `sites`
-- compris, avec ses mots de passe WordPress et ses jetons GitHub. RLS active
-- SANS politique : personne d'autre que la cle de service.
--
-- AUCUN APPELANT N'EST CASSE. Verifie le 25/11/2026 : la cle publique n'est lue
-- que par createBrowserClient (lib/supabase.ts), qui n'a aucun appelant, et
-- l'extension WordPress n'appelle pas Supabase.
--
-- LISTE EXPLICITE, et non une boucle sur toutes les tables : une boucle
-- protegerait aussi, en local, une table creee plus tard a la main SANS RLS en
-- production, et masquerait exactement l'oubli que db/rls.db.test.ts doit
-- attraper (la baseline enregistre desormais l'etat RLS de la production).
-- Toute nouvelle table active son RLS dans SA propre migration.
--
-- Idempotent : activer un RLS deja actif ne fait rien.

ALTER TABLE IF EXISTS public.analysis_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.articles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.backlinks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.content_drafts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.content_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.content_fields     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.content_schemas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.content_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cycle_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.editorial_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.federated_sites    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.gbp_posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.gbp_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.generations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.google_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.gsc_performance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.indexing_queue     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_executions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.page_indexing      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.rag_context_cache  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.schema_embeddings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.schema_sync_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.serp_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.similarity_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.site_pages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sites              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.taxonomies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.taxonomy_terms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.vector_embeddings  ENABLE ROW LEVEL SECURITY;
