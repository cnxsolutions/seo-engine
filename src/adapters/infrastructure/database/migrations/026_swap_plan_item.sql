-- ─────────────────────────────────────────────────────────────────────────────
-- 026 — Une demande integree au cycle en cours (L4c)
-- docs/cadrage.md § 3.2, § 3.4, KW-4
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Une demande recevable prend la place d'une page prevue et non entamee du
-- cycle en cours : son brief REMPLACE un item du plan (decision 5), le creneau
-- du calendrier porte desormais sa recherche, et la demande passe « prevue ».
--
-- Trois ecritures qui doivent arriver ensemble ou pas du tout, contre deux
-- ecrivains qui tournent en meme temps :
--  - `cycle_plans.plan_data` est un tableau JSONB reecrit en entier : une
--    lecture-modification-ecriture depuis Node perdrait une ecriture ;
--  - la tache principale (toutes les 15 min) reclame ses creneaux par un
--    compare-and-swap (claimEditorialSlot) : un creneau reclame pendant la
--    redaction du brief ne doit plus etre remplace ;
--  - le client peut retirer sa demande pendant ce temps (withdraw_keyword_request,
--    025) : un brief ne doit jamais prendre un creneau pour une demande retiree.
--
-- D'ou UNE fonction, sous verrous, dans l'ordre que prend aussi le retrait
-- (la demande d'abord, puis le reste) pour qu'aucun des deux n'attende l'autre
-- en sens inverse : demande → plan → creneau. Elle rend :
--   'placed'        tout est ecrit ;
--   'request_gone'  la demande n'attend plus (retiree, deja placee) ;
--   'plan_gone'     le plan ne tourne plus ;
--   'slot_taken'    le creneau a ete reclame, ou son item a change, ou une
--                   autre demande y est deja rattachee : le service essaie le
--                   creneau suivant, puis garde la demande pour la periode
--                   suivante.
--
-- DROITS. EXECUTE retire a anon et authenticated : seule la cle de service,
-- cote serveur (la tache du planificateur), l'appelle.
--
-- Idempotente : CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.swap_plan_item(
  p_plan_id     uuid,
  p_slot_id     uuid,
  p_old_item_id text,
  p_new_item    jsonb,
  p_request_id  uuid,
  p_reasons     text[]
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request record;
  v_plan    record;
  v_slot    record;
  v_item    jsonb;
  v_data    jsonb;
BEGIN
  IF p_new_item->>'id' IS NULL OR p_new_item->>'client_request_id' IS DISTINCT FROM p_request_id::text THEN
    RAISE EXCEPTION 'swap_plan_item : le nouvel item doit porter un id et la demande %', p_request_id USING ERRCODE = '22023';
  END IF;

  SELECT id, status INTO v_request
    FROM keyword_requests
   WHERE id = p_request_id
     FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'deferred' THEN
    RETURN 'request_gone';
  END IF;

  SELECT id, campaign_id, plan_data INTO v_plan
    FROM cycle_plans
   WHERE id = p_plan_id AND status = 'executing'
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'plan_gone';
  END IF;

  SELECT id, status, scheduled_date INTO v_slot
    FROM editorial_calendar
   WHERE id = p_slot_id
     AND campaign_id = v_plan.campaign_id
     AND plan_item_id = p_old_item_id
     FOR UPDATE;
  IF NOT FOUND OR v_slot.status <> 'planned' THEN
    RETURN 'slot_taken';
  END IF;

  -- L'item a remplacer est encore dans le plan, n'est pas un pilier, ne sert
  -- deja aucune demande — ni par son brief, ni par une demande « deja prevue »
  -- qui le designe (024, regle 3) et le perdrait de vue.
  SELECT item INTO v_item
    FROM jsonb_array_elements(v_plan.plan_data) AS item
   WHERE item->>'id' = p_old_item_id
   LIMIT 1;
  IF v_item IS NULL
     OR v_item->>'page_type' = 'pillar'
     OR v_item ? 'client_request_id'
     OR EXISTS (
       SELECT 1 FROM keyword_requests
        WHERE plan_item_id = p_old_item_id
          AND status IN ('scheduled', 'in_production')
     ) THEN
    RETURN 'slot_taken';
  END IF;

  SELECT jsonb_agg(
           CASE WHEN item->>'id' = p_old_item_id
                THEN p_new_item || jsonb_build_object('scheduled_date', to_char(v_slot.scheduled_date, 'YYYY-MM-DD'))
                ELSE item END
           ORDER BY position)
    INTO v_data
    FROM jsonb_array_elements(v_plan.plan_data) WITH ORDINALITY AS entries(item, position);

  UPDATE cycle_plans
     SET plan_data = v_data,
         total_estimated_words = (
           SELECT coalesce(sum(coalesce((item->>'estimated_word_count')::integer, 0)), 0)
             FROM jsonb_array_elements(v_data) AS item
         )
   WHERE id = p_plan_id;

  UPDATE editorial_calendar
     SET plan_item_id   = p_new_item->>'id',
         target_keyword = p_new_item->>'target_keyword',
         target_city    = p_new_item->>'target_city',
         page_type      = coalesce(p_new_item->>'page_type', page_type)
   WHERE id = p_slot_id;

  UPDATE keyword_requests
     SET status        = 'scheduled',
         reason_code   = 'PLACED_IN_CYCLE',
         reasons       = coalesce(p_reasons, '{}'),
         campaign_id   = v_plan.campaign_id,
         cycle_plan_id = p_plan_id,
         plan_item_id  = p_new_item->>'id',
         scheduled_for = v_slot.scheduled_date
   WHERE id = p_request_id;

  RETURN 'placed';
END
$$;

REVOKE ALL ON FUNCTION public.swap_plan_item(uuid, uuid, text, jsonb, uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.swap_plan_item(uuid, uuid, text, jsonb, uuid, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_plan_item(uuid, uuid, text, jsonb, uuid, text[]) TO service_role;
