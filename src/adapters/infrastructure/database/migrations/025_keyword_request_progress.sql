-- ─────────────────────────────────────────────────────────────────────────────
-- 025 — Les demandes dans le moteur : planifiees, produites, retirees (L4b)
-- docs/cadrage.md § 3.3, § 3.5, § 3.6, KW-5, KW-8, KW-9, KW-11, KW-13
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Aucune table, aucune colonne : `keyword_requests` (024) porte deja tout ce
-- qu'une demande planifiee devient (cycle_plan_id, plan_item_id, scheduled_for,
-- published_url, published_at, deferred_cycles). Deux fonctions, pour ce que
-- Node ne sait pas faire sans course :
--
--  - advance_keyword_requests : les changements d'un lot en UNE ecriture,
--    chacun seulement si la demande est encore dans le statut attendu
--    (compare-and-swap). Le domaine decide (src/core/domain/keyword-requests/
--    production.ts, consumption.ts) ; cette fonction n'ecrit que ce qu'on lui
--    nomme : une cle absente du changement laisse la colonne telle quelle.
--
--  - withdraw_keyword_request : le retrait par le client (KW-9). Une demande
--    deja planifiee a un creneau ; le retrait l'ecarte DANS LA MEME transaction,
--    sous verrou. Sinon le planificateur, qui reclame ses creneaux par un
--    compare-and-swap (claimEditorialSlot), pourrait commencer a ecrire la page
--    entre le retrait et l'ecart. Un creneau deja reclame rend le retrait
--    impossible : la page est en redaction.
--
-- DROITS. EXECUTE retire a anon et authenticated, comme en 024 : seule la cle
-- de service, cote serveur, appelle ces fonctions.
--
-- Idempotente : CREATE OR REPLACE.

-- ─── Les changements d'un lot ───────────────────────────────────────────────
--
-- p_changes : [{ id, from, status, [from_deferred_cycles], [reason_code],
--               [reasons], [evidence], [campaign_id], [cycle_plan_id],
--               [plan_item_id], [scheduled_for], [published_url],
--               [published_at], [deferred_cycles] }]
-- Rend les identifiants ecrits. Une demande qui a change entre-temps (retiree,
-- avancee par un autre passage) n'est pas touchee.

CREATE OR REPLACE FUNCTION public.advance_keyword_requests(p_changes jsonb)
RETURNS uuid[]
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH changes AS (
    SELECT (value->>'id')::uuid AS id, value AS c
      FROM jsonb_array_elements(coalesce(p_changes, '[]'::jsonb))
  ),
  written AS (
    UPDATE keyword_requests AS request
       SET status          = changes.c->>'status',
           reason_code     = CASE WHEN changes.c ? 'reason_code'     THEN changes.c->>'reason_code'                ELSE request.reason_code END,
           reasons         = CASE WHEN changes.c ? 'reasons'
                                  THEN ARRAY(SELECT jsonb_array_elements_text(coalesce(changes.c->'reasons', '[]'::jsonb)))
                                  ELSE request.reasons END,
           evidence        = CASE WHEN changes.c ? 'evidence'        THEN coalesce(changes.c->'evidence', '[]'::jsonb) ELSE request.evidence END,
           campaign_id     = CASE WHEN changes.c ? 'campaign_id'     THEN (changes.c->>'campaign_id')::uuid        ELSE request.campaign_id END,
           cycle_plan_id   = CASE WHEN changes.c ? 'cycle_plan_id'   THEN (changes.c->>'cycle_plan_id')::uuid      ELSE request.cycle_plan_id END,
           plan_item_id    = CASE WHEN changes.c ? 'plan_item_id'    THEN changes.c->>'plan_item_id'               ELSE request.plan_item_id END,
           scheduled_for   = CASE WHEN changes.c ? 'scheduled_for'   THEN (changes.c->>'scheduled_for')::date      ELSE request.scheduled_for END,
           published_url   = CASE WHEN changes.c ? 'published_url'   THEN changes.c->>'published_url'              ELSE request.published_url END,
           published_at    = CASE WHEN changes.c ? 'published_at'    THEN (changes.c->>'published_at')::timestamptz ELSE request.published_at END,
           deferred_cycles = CASE WHEN changes.c ? 'deferred_cycles' THEN (changes.c->>'deferred_cycles')::integer ELSE request.deferred_cycles END
      FROM changes
     WHERE request.id = changes.id
       AND request.status = changes.c->>'from'
       AND (NOT changes.c ? 'from_deferred_cycles'
            OR request.deferred_cycles = (changes.c->>'from_deferred_cycles')::integer)
       -- Ce que le moteur peut conclure seul : jamais recue, jamais refusee, jamais retiree.
       AND changes.c->>'status' IN ('deferred', 'scheduled', 'in_production', 'published', 'covered', 'review')
    RETURNING request.id
  )
  SELECT coalesce(array_agg(id), '{}') FROM written
$$;

REVOKE ALL ON FUNCTION public.advance_keyword_requests(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_keyword_requests(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_keyword_requests(jsonb) TO service_role;

-- ─── Le retrait par le client ───────────────────────────────────────────────
--
-- Rend 'withdrawn', 'not_found' (pas une demande de ce site) ou 'locked'
-- (en redaction, en ligne, conclue). Le site vient de la portee de la session
-- (lib/client-space/scope.ts), jamais du navigateur seul.

CREATE OR REPLACE FUNCTION public.withdraw_keyword_request(p_site_id uuid, p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request record;
BEGIN
  SELECT id, status, campaign_id, plan_item_id INTO v_request
    FROM keyword_requests
   WHERE id = p_request_id AND site_id = p_site_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_request.status NOT IN ('received', 'review', 'deferred', 'scheduled') THEN
    RETURN 'locked';
  END IF;

  IF v_request.status = 'scheduled' AND v_request.plan_item_id IS NOT NULL THEN
    -- Les creneaux de ce brief, verrouilles : le planificateur attend, ou a deja gagne.
    PERFORM 1
       FROM editorial_calendar
      WHERE campaign_id = v_request.campaign_id
        AND plan_item_id = v_request.plan_item_id
        FOR UPDATE;

    IF EXISTS (
      SELECT 1 FROM editorial_calendar
       WHERE campaign_id = v_request.campaign_id
         AND plan_item_id = v_request.plan_item_id
         AND status <> 'planned'
    ) THEN
      RETURN 'locked';
    END IF;

    UPDATE editorial_calendar
       SET status = 'skipped',
           error_message = 'Demande retiree par le client : aucune page a produire.'
     WHERE campaign_id = v_request.campaign_id
       AND plan_item_id = v_request.plan_item_id
       AND status = 'planned';
  END IF;

  UPDATE keyword_requests SET status = 'withdrawn' WHERE id = v_request.id;
  RETURN 'withdrawn';
END
$$;

REVOKE ALL ON FUNCTION public.withdraw_keyword_request(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_keyword_request(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_keyword_request(uuid, uuid) TO service_role;
