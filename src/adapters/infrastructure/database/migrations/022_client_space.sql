-- ─────────────────────────────────────────────────────────────────────────────
-- 022 — L'espace client : clients, membres, rattachement des sites (L1)
-- docs/cadrage.md § 4.3, ACC-1 a ACC-7
-- ─────────────────────────────────────────────────────────────────────────────
--
-- UN CLIENT, des sites, des membres. Un client est une entreprise suivie par
-- CNX ; ses sites lui sont rattaches par `sites.client_id` ; ses membres sont les
-- personnes qui se connectent a son espace, chacune liee a un compte Supabase
-- Auth (`auth.users`). Un membre ne voit QUE les sites de son client : le
-- cloisonnement vit dans lib/client-space/scope.ts, et se teste contre le
-- Supabase local (db/client-space.db.test.ts).
--
-- UNE ADRESSE, UN CLIENT. L'unicite porte sur lower(email) et sur user_id : une
-- personne qui travaille pour deux clients aurait deux espaces a distinguer, ce
-- que la V1 ne fait pas (hors perimetre).
--
-- REVOCATION. Un acces retire garde sa ligne (`revoked_at`) : l'operateur voit
-- qui a eu acces, et une nouvelle invitation rouvre la meme ligne.
--
-- `sites.client_id` est NULLABLE, sans backfill : un site sans client est le cas
-- de tous les sites existants, et rien ne change pour eux.
--
-- RLS active, AUCUNE politique : seule la cle de service lit ces tables (la regle
-- de la 021). Le navigateur ne recoit aucune cle Supabase.
--
-- Idempotent : IF NOT EXISTS partout, triggers recrees.

CREATE TABLE IF NOT EXISTS public.clients (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_members (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Le compte Supabase Auth. Supprime cote Auth, le membre disparait avec lui.
  user_id        uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text        NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  -- Derniere connexion reussie (code ou lien verifie). Sert aussi de borne a la
  -- duree d'une session : lib/client-space/session.ts.
  last_login_at  timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_members_client_id_idx ON public.client_members (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_members_email_key ON public.client_members (lower(email));

ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sites_client_id_idx ON public.sites (client_id);

DROP TRIGGER IF EXISTS trigger_clients_updated_at ON public.clients;
CREATE TRIGGER trigger_clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_members ENABLE ROW LEVEL SECURITY;
