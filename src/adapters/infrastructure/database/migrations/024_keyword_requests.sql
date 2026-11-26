-- ─────────────────────────────────────────────────────────────────────────────
-- 024 — Les demandes de mots-cles des clients (L3)
-- docs/cadrage.md § 3.1 a 3.3, § 3.8, § 4.3, KW-1 a KW-9
-- ─────────────────────────────────────────────────────────────────────────────
--
-- UNE DEMANDE, UN MOT-CLE, UN SITE. Le client propose depuis son espace ; la
-- tache du planificateur (lib/keyword-requests/analyze.ts, toutes les 2 min)
-- rend le verdict ; le statut suit la machine a etats du domaine
-- (src/core/domain/keyword-requests/lifecycle.ts). Aucune demande n'est jamais
-- supprimee : une demande retiree ou couverte garde sa ligne et ses preuves.
--
-- `keyword_normalized` est la RECHERCHE de la demande (mot-cle + ville quand la
-- ville n'y est pas deja), passee par normalizeForMatch : « Plombier » a Troyes
-- et « plombier troyes » sont la meme demande. L'index unique partiel en fait
-- une garantie : deux demandes OUVERTES du meme site ne portent jamais la meme
-- recherche. Les statuts ouverts sont ceux de OPEN_STATUSES (lifecycle.ts) ; un
-- test d'integration les confronte a cet index.
--
-- DEUX FONCTIONS, pour ce que Node ne sait pas faire sans course :
--  - submit_keyword_requests : plafond de demandes ouvertes par site ET doublons,
--    sous un verrou consultatif du site — deux envois simultanes se voient ;
--  - apply_keyword_verdicts : les verdicts d'un lot en UNE ecriture, chacun
--    seulement si la demande est encore `received` — un retrait arrive pendant
--    l'analyse n'est jamais ecrase.
-- `swap_plan_item` (integrer une demande au cycle en cours) arrive au L4, dans sa
-- propre migration.
--
-- DROITS. RLS active sans politique (la regle de la 021). EXECUTE retire a anon
-- et authenticated : seule la cle de service, cote serveur, appelle ces
-- fonctions, avec un client et un site resolus depuis la session
-- (lib/client-space/scope.ts) — jamais un identifiant venu du navigateur seul.
--
-- Idempotente : IF NOT EXISTS, CREATE OR REPLACE, triggers recrees.

CREATE TABLE IF NOT EXISTS public.keyword_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  site_id             uuid        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  -- La campagne qui a rendu le verdict ; nulle tant que la demande n'est pas analysee.
  campaign_id         uuid        REFERENCES public.campaigns(id) ON DELETE SET NULL,
  submitted_by        uuid        REFERENCES public.client_members(id) ON DELETE SET NULL,
  keyword             text        NOT NULL CHECK (length(btrim(keyword)) BETWEEN 1 AND 80),
  keyword_normalized  text        NOT NULL CHECK (length(keyword_normalized) BETWEEN 1 AND 200),
  city                text        CHECK (city IS NULL OR length(btrim(city)) BETWEEN 1 AND 80),
  -- « Pourquoi » : lu par CNX, jamais envoye au modele (§ 3.1).
  note                text        CHECK (note IS NULL OR length(note) <= 500),
  desired_by          date,
  status              text        NOT NULL DEFAULT 'received' CHECK (status IN (
                        'received', 'review', 'deferred', 'scheduled', 'in_production',
                        'published', 'covered', 'declined', 'withdrawn')),
  -- Le motif du verdict, sous un code que l'espace client traduit (labels.ts).
  reason_code         text,
  -- Les motifs en clair pour l'operateur. Pour `declined`, le premier est le motif montre au client.
  reasons             text[]      NOT NULL DEFAULT '{}',
  -- Les preuves : page, position, date prevue, ville. Jamais une SERP brute.
  evidence            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  decided_by          text        CHECK (decided_by IS NULL OR decided_by IN ('engine', 'operator')),
  decided_at          timestamptz,
  cycle_plan_id       uuid        REFERENCES public.cycle_plans(id) ON DELETE SET NULL,
  plan_item_id        text,
  scheduled_for       date,
  published_url       text,
  published_at        timestamptz,
  deferred_cycles     integer     NOT NULL DEFAULT 0 CHECK (deferred_cycles >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS keyword_requests_site_status_idx     ON public.keyword_requests (site_id, status);
CREATE INDEX IF NOT EXISTS keyword_requests_campaign_status_idx ON public.keyword_requests (campaign_id, status);
CREATE INDEX IF NOT EXISTS keyword_requests_status_created_idx  ON public.keyword_requests (status, created_at);
CREATE INDEX IF NOT EXISTS keyword_requests_client_created_idx  ON public.keyword_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS keyword_requests_site_created_idx    ON public.keyword_requests (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS keyword_requests_submitted_by_idx    ON public.keyword_requests (submitted_by);
CREATE INDEX IF NOT EXISTS keyword_requests_cycle_plan_idx      ON public.keyword_requests (cycle_plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS keyword_requests_open_keyword_key
  ON public.keyword_requests (site_id, keyword_normalized)
  WHERE status IN ('received', 'review', 'deferred', 'scheduled', 'in_production');

DROP TRIGGER IF EXISTS trigger_keyword_requests_updated_at ON public.keyword_requests;
CREATE TRIGGER trigger_keyword_requests_updated_at BEFORE UPDATE ON public.keyword_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.keyword_requests ENABLE ROW LEVEL SECURITY;

-- ─── L'envoi : plafond et doublons, ensemble ────────────────────────────────
--
-- p_items : [{ "keyword": "…", "keyword_normalized": "…" }], deja valides et
-- dedoublonnes par le domaine (normalize.ts). Rend, dans l'ordre recu :
--   { keyword, outcome: 'created',   id }
--   { keyword, outcome: 'duplicate', id, created_at }   -- rattachee a la demande ouverte
--   { keyword, outcome: 'full' }                        -- plafond du site atteint
-- Le site doit appartenir au client : une defense de plus, la portee l'a deja verifie.

CREATE OR REPLACE FUNCTION public.submit_keyword_requests(
  p_client_id   uuid,
  p_site_id     uuid,
  p_member_id   uuid,
  p_items       jsonb,
  p_city        text,
  p_note        text,
  p_desired_by  date,
  p_open_max    integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_open     integer;
  v_item     jsonb;
  v_existing record;
  v_id       uuid;
  v_result   jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND client_id = p_client_id) THEN
    RAISE EXCEPTION 'site % hors du client %', p_site_id, p_client_id USING ERRCODE = '42501';
  END IF;

  -- Un envoi a la fois par site : le plafond et les doublons voient les envois concurrents.
  PERFORM pg_advisory_xact_lock(hashtextextended('keyword_requests:' || p_site_id::text, 0));

  SELECT count(*) INTO v_open
    FROM keyword_requests
   WHERE site_id = p_site_id
     AND status IN ('received', 'review', 'deferred', 'scheduled', 'in_production');

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT id, created_at INTO v_existing
      FROM keyword_requests
     WHERE site_id = p_site_id
       AND keyword_normalized = v_item->>'keyword_normalized'
       AND status IN ('received', 'review', 'deferred', 'scheduled', 'in_production')
     LIMIT 1;

    IF FOUND THEN
      v_result := v_result || jsonb_build_object(
        'keyword', v_item->>'keyword', 'outcome', 'duplicate',
        'id', v_existing.id, 'created_at', v_existing.created_at);
    ELSIF v_open >= p_open_max THEN
      v_result := v_result || jsonb_build_object('keyword', v_item->>'keyword', 'outcome', 'full');
    ELSE
      INSERT INTO keyword_requests (client_id, site_id, submitted_by, keyword, keyword_normalized, city, note, desired_by)
      VALUES (p_client_id, p_site_id, p_member_id, v_item->>'keyword', v_item->>'keyword_normalized',
              p_city, p_note, p_desired_by)
      RETURNING id INTO v_id;
      v_open := v_open + 1;
      v_result := v_result || jsonb_build_object('keyword', v_item->>'keyword', 'outcome', 'created', 'id', v_id);
    END IF;
  END LOOP;

  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION public.submit_keyword_requests(uuid, uuid, uuid, jsonb, text, text, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_keyword_requests(uuid, uuid, uuid, jsonb, text, text, date, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_keyword_requests(uuid, uuid, uuid, jsonb, text, text, date, integer) TO service_role;

-- ─── Les verdicts d'un lot, en une ecriture ─────────────────────────────────
--
-- p_verdicts : [{ id, status, reason_code, reasons: [..], evidence: [..],
--                 campaign_id, cycle_plan_id, plan_item_id, scheduled_for }]
-- N'ecrit QUE les demandes encore `received` ; rend les identifiants ecrits.

CREATE OR REPLACE FUNCTION public.apply_keyword_verdicts(p_verdicts jsonb)
RETURNS uuid[]
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH verdicts AS (
    SELECT *
      FROM jsonb_to_recordset(p_verdicts) AS v(
        id uuid, status text, reason_code text, reasons jsonb, evidence jsonb,
        campaign_id uuid, cycle_plan_id uuid, plan_item_id text, scheduled_for date)
  ),
  written AS (
    UPDATE keyword_requests AS request
       SET status        = verdicts.status,
           reason_code   = verdicts.reason_code,
           reasons       = ARRAY(SELECT jsonb_array_elements_text(coalesce(verdicts.reasons, '[]'::jsonb))),
           evidence      = coalesce(verdicts.evidence, '[]'::jsonb),
           campaign_id   = verdicts.campaign_id,
           cycle_plan_id = verdicts.cycle_plan_id,
           plan_item_id  = verdicts.plan_item_id,
           scheduled_for = verdicts.scheduled_for,
           decided_by    = 'engine',
           decided_at    = now()
      FROM verdicts
     WHERE request.id = verdicts.id
       AND request.status = 'received'
       AND verdicts.status IN ('review', 'deferred', 'scheduled', 'covered')
    RETURNING request.id
  )
  SELECT coalesce(array_agg(id), '{}') FROM written
$$;

REVOKE ALL ON FUNCTION public.apply_keyword_verdicts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_keyword_verdicts(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_keyword_verdicts(jsonb) TO service_role;
