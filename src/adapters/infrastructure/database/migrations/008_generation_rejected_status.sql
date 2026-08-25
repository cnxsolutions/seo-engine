-- ─────────────────────────────────────────────────────────────────────────────
-- 008 — Le statut 'rejected' devient acceptable pour une generation
-- SEO Engine - Pipeline post-generation
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POURQUOI
--
-- `GenerationStatus` (lib/types.ts) declare 'rejected' depuis le debut, mais
-- aucun code ne l'ecrivait : la valeur n'a donc jamais ete confrontee a la
-- contrainte de la table. Le pipeline post-generation l'ecrit desormais des
-- qu'un article echoue au controle bloquant (longueur sous la cible, H1 absent,
-- JSON-LD invalide...). Si la contrainte CHECK de `generations.status` ne
-- connait pas cette valeur, l'UPDATE est refuse et l'article — deja genere et
-- deja paye — reste en 'generated', c'est-a-dire dans la file de publication
-- differee : exactement ce que le rejet devait empecher.
--
-- Le code se protege (lib/pipeline/repository.ts retombe sur 'failed' si l'ecriture
-- est refusee), mais 'failed' ne distingue plus « la generation a plante » de
-- « l'article a ete refuse par le controle qualite ». Cette migration retablit
-- la distinction.
--
-- La table `generations` n'est creee par aucune migration du depot (voir
-- db/README.md, section 3) : ce fichier ne cree donc rien, il ne fait qu'elargir
-- ce qui existe. Il est idempotent et peut etre rejoue.

DO $$
DECLARE
  v_udt   text;
  v_check text;
BEGIN
  SELECT udt_name INTO v_udt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'generations'
     AND column_name  = 'status';

  IF v_udt IS NULL THEN
    RAISE NOTICE 'public.generations.status introuvable — migration 008 sans effet.';
    RETURN;
  END IF;

  -- Cas ENUM : impossible a traiter ici, ALTER TYPE ... ADD VALUE ne peut pas
  -- s'executer depuis un bloc DO. On echoue bruyamment plutot que de laisser
  -- croire que la migration a fonctionne.
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = v_udt AND typtype = 'e') THEN
    RAISE EXCEPTION
      'generations.status est un ENUM (%). Jouez d''abord, seule et hors transaction : ALTER TYPE public.% ADD VALUE IF NOT EXISTS ''rejected'';',
      v_udt, v_udt;
  END IF;

  -- Cas texte + CHECK : on remplace la contrainte existante, quel que soit son
  -- nom (elle a ete creee a la main dans l'interface Supabase).
  FOR v_check IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'generations'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.generations DROP CONSTRAINT %I', v_check);
  END LOOP;

  EXECUTE $ddl$
    ALTER TABLE public.generations
      ADD CONSTRAINT generations_status_check
      CHECK (status IN (
        'pending', 'generating', 'generated', 'publishing', 'published', 'failed', 'rejected'
      ))
  $ddl$;
END $$;

-- Les articles refuses attendent une decision humaine : ils doivent etre
-- listables sans balayer toute la table.
CREATE INDEX IF NOT EXISTS idx_generations_rejected
  ON public.generations (updated_at DESC)
  WHERE status = 'rejected';
