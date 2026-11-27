-- ─────────────────────────────────────────────────────────────────────────────
-- 027 — Les e-mails des demandes : la file d'envoi et la desinscription (L7)
-- docs/cadrage.md KW-12, decisions 17, 20, 21, 22
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Une demande qui change de statut met une ligne dans `email_outbox` DANS LA
-- MEME transaction, par un declencheur : aucun chemin d'ecriture (verdict du
-- moteur, decision de CNX, suivi de production) ne peut l'oublier, et un
-- changement annule n'annonce rien. La tache `emails` du planificateur
-- (lib/email/send-due.ts) lit la file toutes les deux minutes, relit la demande
-- et son membre AU MOMENT D'ENVOYER — un membre revoque ou desinscrit entre-temps
-- ne recoit rien — et regroupe les nouvelles d'un meme destinataire.
--
-- Ce qui part (decisions 20 a 22) :
--   - au membre qui a envoye la demande : prevue, deja couverte, gardee pour la
--     periode suivante, non retenue, en ligne ;
--   - a CNX (OPERATOR_EMAIL) : une demande passe « a examiner ».
--
-- `dedupe_key` (demande + statut) : on ne previent qu'une fois d'un meme
-- statut. Une demande qui revient a un statut deja annonce n'envoie rien de plus.
--
-- La desinscription : `client_members.email_opt_out_at` (null = abonne) et
-- `unsubscribe_token`, un uuid aleatoire propre au membre, porte par le lien de
-- chaque e-mail. Il ne donne acces a rien d'autre qu'a ce reglage.
--
-- RLS active, aucune politique : seule la cle de service lit et ecrit la file.
-- Idempotente : IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

-- ─── La desinscription, par membre ──────────────────────────────────────────

ALTER TABLE public.client_members ADD COLUMN IF NOT EXISTS email_opt_out_at timestamptz;
ALTER TABLE public.client_members ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS client_members_unsubscribe_token_key
  ON public.client_members (unsubscribe_token);

-- ─── La file d'envoi ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text        NOT NULL CHECK (kind IN ('client_request', 'operator_review')),
  keyword_request_id  uuid        NOT NULL REFERENCES public.keyword_requests(id) ON DELETE CASCADE,
  -- Le statut annonce : si la demande en a change avant l'envoi, la ligne est
  -- ecartee (la nouvelle a sa propre ligne).
  request_status      text        NOT NULL,
  dedupe_key          text        NOT NULL UNIQUE,
  status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  attempts            integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  -- Pourquoi une ligne n'est pas partie (ecartee) ou le dernier refus du SMTP.
  last_error          text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON public.email_outbox (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS email_outbox_request_idx
  ON public.email_outbox (keyword_request_id);

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- ─── Le declencheur ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enqueue_keyword_request_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('scheduled', 'covered', 'deferred', 'declined', 'published') THEN
    INSERT INTO public.email_outbox (kind, keyword_request_id, request_status, dedupe_key)
    VALUES ('client_request', NEW.id, NEW.status, 'client:' || NEW.id || ':' || NEW.status)
    ON CONFLICT (dedupe_key) DO NOTHING;
  ELSIF NEW.status = 'review' THEN
    INSERT INTO public.email_outbox (kind, keyword_request_id, request_status, dedupe_key)
    VALUES ('operator_review', NEW.id, NEW.status, 'operator:' || NEW.id || ':review')
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Pas de REVOKE : une fonction qui rend `trigger` ne s'appelle que par un
-- declencheur, jamais par PostgREST.

DROP TRIGGER IF EXISTS trigger_keyword_requests_email ON public.keyword_requests;
CREATE TRIGGER trigger_keyword_requests_email
  AFTER UPDATE OF status ON public.keyword_requests
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_keyword_request_email();
