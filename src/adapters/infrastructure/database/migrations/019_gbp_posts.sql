-- ─────────────────────────────────────────────────────────────────────────────
-- 019 — Posts de fiche Google Business Profile (chantier B)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POURQUOI CETTE MIGRATION EXISTE.
--
-- `gbp_profiles.posts` est un jsonb ECRASE a chaque synchronisation (upsert sur
-- site_id), reduit aux dix derniers posts, et la lecture jette deja le champ
-- `name` de l'API. Impossible d'y tracer un post que nous aurions ecrit, d'y
-- detecter un doublon, ou d'y ancrer une idempotence : la trace disparaitrait
-- a la synchro suivante.
--
-- Deux tables suffisent a corriger cela sans rien detruire. `gbp_profiles.posts`
-- cesse d'etre ecrite ; elle N'EST PAS supprimee. Cesser d'ecrire une colonne
-- est reversible, la supprimer ne l'est pas.
--
-- Idempotente et rejouable. Tous les CHECK sont NOT VALID : ils gouvernent les
-- ecritures futures sans faire echouer la migration sur une ligne historique.

-- ─── 1. Le journal des posts ────────────────────────────────────────────────
--
-- `source` fait entrer dans le MEME corpus les posts ecrits a la main par le
-- proprietaire sur sa fiche. Sans cette colonne, l'anti-duplication ignorerait
-- la moitie de ce qui est publie et proposerait joyeusement de redire ce que le
-- proprietaire vient d'ecrire.
--
-- `status = 'incertain'` materialise le doute d'ecriture. Un POST localPosts
-- n'est PAS idempotent : sur un timeout ou un 5xx, nous ne savons pas si le
-- post existe. Ce n'est ni un succes ni un echec, et le retenter a l'aveugle
-- publierait un doublon sur la fiche d'un client.

CREATE TABLE IF NOT EXISTS public.gbp_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  calendar_slot_id uuid REFERENCES public.editorial_calendar(id) ON DELETE SET NULL,
  linked_generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'engine',
  angle text,
  summary text NOT NULL,
  summary_fingerprint text NOT NULL,
  language_code text NOT NULL DEFAULT 'fr',
  cta_action_type text,
  cta_url text,
  status text NOT NULL DEFAULT 'pending',
  refusal_kind text,
  error_message text,
  remote_name text,
  remote_search_url text,
  remote_state text,
  ai_model text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gbp_posts_source_check CHECK (source IN ('engine', 'remote')),
  CONSTRAINT gbp_posts_status_check CHECK (status IN (
    'pending', 'generating', 'generated', 'publishing',
    'published', 'rejected', 'failed', 'incertain'
  )),
  CONSTRAINT gbp_posts_angle_check CHECK (
    angle IS NULL
    OR angle IN ('service', 'zone', 'horaires', 'avis', 'faq', 'saison', 'nouvelle-page')
  ),
  CONSTRAINT gbp_posts_refusal_check CHECK (
    refusal_kind IS NULL
    OR refusal_kind IN ('duplicat', 'identifiants', 'quota', 'format')
  ),
  CONSTRAINT gbp_posts_engine_needs_angle CHECK (source = 'remote' OR angle IS NOT NULL),

  -- Le maillage post -> page devient une contrainte de BASE, pas une intention.
  -- 'rejected' et 'failed' sont exemptes : sinon la trace d'un refus « aucune
  -- page a annoncer » serait elle-meme rejetee par la base, et le motif perdu.
  CONSTRAINT gbp_posts_engine_needs_link CHECK (
    source = 'remote'
    OR status IN ('pending', 'generating', 'rejected', 'failed')
    OR linked_generation_id IS NOT NULL
  )
);

-- L'ANCRE D'IDEMPOTENCE. `remote_name` est precisement l'identifiant que la
-- lecture actuelle jette. Sans cet index, un timeout suivi d'une reprise cree un
-- SECOND post sur la fiche du client, visible par ses prospects.
CREATE UNIQUE INDEX IF NOT EXISTS gbp_posts_remote_name_key
  ON public.gbp_posts (site_id, remote_name) WHERE remote_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS gbp_posts_site_created_idx
  ON public.gbp_posts (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gbp_posts_fingerprint_idx
  ON public.gbp_posts (site_id, summary_fingerprint);
CREATE INDEX IF NOT EXISTS gbp_posts_link_idx
  ON public.gbp_posts (site_id, linked_generation_id) WHERE linked_generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gbp_posts_due_idx
  ON public.gbp_posts (status, created_at) WHERE status IN ('pending', 'generated', 'incertain');

-- ─── 2. Un seul calendrier, un discriminant ─────────────────────────────────
--
-- En creer un second dupliquerait la reclamation de creneau, le budget de
-- tentatives (attempt_count) et l'ecran /calendar. Un discriminant suffit.
--
-- `page_type` et `target_keyword` sont NOT NULL et `page_type` porte un CHECK a
-- cinq valeurs de PAGE : un creneau de post devrait donc mentir sur son type ou
-- echouer a l'insertion. On relache les deux colonnes, et on RECONSTRUIT
-- l'invariant sous condition — la base interdit desormais en dur la confusion
-- que le front ferait sinon.

ALTER TABLE public.editorial_calendar
  ADD COLUMN IF NOT EXISTS artifact_kind text NOT NULL DEFAULT 'page',
  ADD COLUMN IF NOT EXISTS gbp_post_id uuid;

ALTER TABLE public.editorial_calendar ALTER COLUMN page_type DROP NOT NULL;
ALTER TABLE public.editorial_calendar ALTER COLUMN target_keyword DROP NOT NULL;

ALTER TABLE public.editorial_calendar DROP CONSTRAINT IF EXISTS editorial_calendar_artifact_kind_check;
ALTER TABLE public.editorial_calendar
  ADD CONSTRAINT editorial_calendar_artifact_kind_check
  CHECK (artifact_kind IN ('page', 'gbp_post')) NOT VALID;

ALTER TABLE public.editorial_calendar DROP CONSTRAINT IF EXISTS editorial_calendar_page_type_check;
ALTER TABLE public.editorial_calendar
  ADD CONSTRAINT editorial_calendar_page_type_check CHECK (
    (artifact_kind = 'page' AND page_type IN ('pillar', 'child', 'alternative', 'comparative', 'local_pack'))
    OR (artifact_kind = 'gbp_post' AND page_type IS NULL)
  ) NOT VALID;

-- Reconstruit l'invariant que le DROP NOT NULL ci-dessus vient de relacher.
-- Absent, un creneau de PAGE pourrait naitre sans mot-cle cible et le
-- planificateur produirait une page sans sujet, sans que rien ne l'arrete.
ALTER TABLE public.editorial_calendar DROP CONSTRAINT IF EXISTS editorial_calendar_target_keyword_check;
ALTER TABLE public.editorial_calendar
  ADD CONSTRAINT editorial_calendar_target_keyword_check
  CHECK (artifact_kind <> 'page' OR target_keyword IS NOT NULL) NOT VALID;

ALTER TABLE public.editorial_calendar DROP CONSTRAINT IF EXISTS editorial_calendar_gbp_post_fk;
ALTER TABLE public.editorial_calendar
  ADD CONSTRAINT editorial_calendar_gbp_post_fk
  FOREIGN KEY (gbp_post_id) REFERENCES public.gbp_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS editorial_calendar_kind_date_idx
  ON public.editorial_calendar (campaign_id, artifact_kind, scheduled_date);

-- ─── 3. Opt-in strict, par campagne ─────────────────────────────────────────
--
-- Desactive par defaut : aucune campagne existante ne se met a ecrire sur une
-- fiche etablissement sans decision explicite du proprietaire.
--
-- Le plancher de trois jours est un GARDE-FOU, pas une optimisation. Le quota
-- reellement accorde au projet Google Cloud est inconnu depuis le depot — le
-- defaut documente est de zero requete par minute tant que l'acces de base n'a
-- pas ete accorde. Coder une cadence plus agressive serait deguiser une
-- supposition en regle. Voir docs/gbp-acces-api.md.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS gbp_posts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gbp_post_cadence_days integer NOT NULL DEFAULT 7;

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_gbp_cadence_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_gbp_cadence_check
  CHECK (gbp_post_cadence_days BETWEEN 3 AND 30) NOT VALID;

-- ─── Documentation portee par le schema ─────────────────────────────────────

COMMENT ON TABLE public.gbp_posts IS
  'Journal de nos ecritures sur la fiche + miroir des posts ecrits a la main (source=remote). gbp_profiles.posts cesse d''etre ecrite mais N''EST PAS supprimee : cesser d''ecrire est reversible, supprimer ne l''est pas.';
COMMENT ON COLUMN public.gbp_posts.status IS
  'incertain = l''ecriture distante n''a ni abouti ni echoue franchement. Ni un succes ni un echec, et JAMAIS a retenter a l''aveugle : un POST localPosts n''est pas idempotent.';
COMMENT ON COLUMN public.gbp_posts.remote_name IS
  'accounts/{a}/locations/{l}/localPosts/{id}. L''ancre d''idempotence, precisement le champ que la lecture jetait.';
COMMENT ON COLUMN public.gbp_posts.summary_fingerprint IS
  'Empreinte du resume, pour refuser deux posts qui se ressemblent sans relire tout le corpus.';
COMMENT ON COLUMN public.editorial_calendar.artifact_kind IS
  'page | gbp_post. Un seul calendrier : en creer un second dupliquerait la reclamation de creneau et le budget de tentatives.';
