-- ─────────────────────────────────────────────────────────────────────────────
-- 020 — Etat d'indexation Google de chaque page connue d'un site
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POURQUOI CETTE MIGRATION EXISTE.
--
-- Le moteur renvoie les sitemaps a chaque publication, mais rien ne verifiait
-- ensuite que Google avait indexe la page : le suivi des publications disait au
-- proprietaire d'aller ouvrir « Inspection de l'URL » a la main, page par page.
-- Le job quotidien `indexCheck` (lib/indexing/check.ts) le fait desormais via
-- l'API URL Inspection de Search Console, et garde ici ce que Google a repondu.
--
-- Une ligne par page et par site, quelle que soit son origine : page publiee
-- par le moteur (`generation_id`, `priority` 0) ou page trouvee par le crawl
-- (`site_pages`, `priority` 1). `url_key` est l'URL normalisee (sans protocole,
-- sans www, sans barre finale) : c'est elle qui empeche qu'une meme page lue
-- sous deux formes soit inspectee deux fois et compte double dans le quota de
-- 2 000 inspections par jour et par propriete.
--
-- `next_check_at` porte le rythme : une page non indexee est revue a J+2, J+4,
-- J+7 puis chaque semaine ; une page indexee chaque mois.
--
-- Idempotente et rejouable.

CREATE TABLE IF NOT EXISTS public.page_indexing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  url text NOT NULL,
  url_key text NOT NULL,
  generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL,
  priority smallint NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'unchecked',
  verdict text,
  coverage_state text,
  indexing_state text,
  robots_txt_state text,
  page_fetch_state text,
  google_canonical text,
  user_canonical text,
  inspection_link text,
  last_crawl_at timestamptz,
  inspected_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  miss_streak integer NOT NULL DEFAULT 0,
  resubmit_count integer NOT NULL DEFAULT 0,
  last_resubmitted_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT page_indexing_state_check CHECK (state IN (
    'unchecked', 'indexed', 'not_discovered', 'crawled_not_indexed',
    'blocked', 'fetch_error', 'canonical_elsewhere'
  ))
);

-- Cible de l'upsert `onConflict: 'site_id,url_key'` : sans cet index unique,
-- PostgreSQL refuse l'ON CONFLICT et chaque ecriture du job echoue.
CREATE UNIQUE INDEX IF NOT EXISTS page_indexing_site_key
  ON public.page_indexing (site_id, url_key);

-- La selection du job : pages dues d'un site, celles du moteur d'abord.
CREATE INDEX IF NOT EXISTS page_indexing_due_idx
  ON public.page_indexing (site_id, priority, next_check_at);

-- Les compteurs par etat de l'onglet Indexation.
CREATE INDEX IF NOT EXISTS page_indexing_state_idx
  ON public.page_indexing (site_id, state);

CREATE INDEX IF NOT EXISTS page_indexing_generation_idx
  ON public.page_indexing (generation_id) WHERE generation_id IS NOT NULL;

DROP TRIGGER IF EXISTS trigger_page_indexing_updated_at ON public.page_indexing;
CREATE TRIGGER trigger_page_indexing_updated_at
  BEFORE UPDATE ON public.page_indexing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
