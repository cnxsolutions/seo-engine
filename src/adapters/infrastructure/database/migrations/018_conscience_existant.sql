-- ─────────────────────────────────────────────────────────────────────────────
-- 018 — Conscience de l'existant (chantier A)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POURQUOI CETTE MIGRATION EXISTE
--
-- Le moteur ecrivait sans savoir ce qui etait deja en ligne. Quatre bouts de
-- code simulaient cette connaissance, chacun a moitie, et aucun ne disposait
-- des colonnes necessaires pour repondre a la seule question qui compte :
-- « cette URL est-elle occupee, ou ce sujet est-il deja couvert ? » — deux
-- faits differents que le schema ne permettait pas de distinguer.
--
-- Idempotente et rejouable : tous les ajouts sont IF NOT EXISTS, tous les CHECK
-- sont precedes d'un DROP IF EXISTS.
--
-- Tous les index sont crees en mode ordinaire, jamais en mode « concurrent » :
-- ce mode refuse de s'executer dans un bloc transactionnel, et db-migrate.mjs
-- en pose un autour du fichier.
--
-- NE PAS ecrire ici la sequence exacte que ce mode emploie, meme en commentaire.
-- db-migrate.mjs la detecte par expression reguliere sur le TEXTE du fichier,
-- sans distinguer le code du commentaire : la mentionner suffisait a faire
-- appliquer cette migration hors transaction, donc a la rendre partiellement
-- applicable en cas d'echec. C'est arrive une fois, ici meme.
--
-- Tous les CHECK sont NOT VALID : ils s'appliquent aux ecritures futures sans
-- jamais faire echouer la migration sur une ligne historique. Une ligne
-- existante qui les violerait est un fait a corriger, pas un motif de blocage.

-- ─── 1. site_pages : distinguer « URL occupee » de « sujet couvert » ─────────
--
-- Le crawler n'extrayait ni la canonique ni la directive robots, et la table
-- n'avait aucune colonne pour les accueillir. Sans elles, une page canonisee
-- vers une autre ou explicitement desindexee comptait comme une occupation
-- ferme de son URL — ce qu'elle n'est pas.
--
-- `origin` et `generation_id` permettent a recordPublication d'inscrire une
-- page dans l'inventaire AU MOMENT de sa publication, au lieu d'attendre le
-- prochain crawl. Sans cela, un site en production genere pendant des semaines
-- contre un inventaire artificiellement vide.

ALTER TABLE public.site_pages
  ADD COLUMN IF NOT EXISTS canonical_path text,
  ADD COLUMN IF NOT EXISTS robots_noindex boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'crawl',
  ADD COLUMN IF NOT EXISTS generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL;

ALTER TABLE public.site_pages DROP CONSTRAINT IF EXISTS site_pages_origin_check;
ALTER TABLE public.site_pages
  ADD CONSTRAINT site_pages_origin_check CHECK (origin IN ('crawl', 'engine')) NOT VALID;

-- La fraicheur de l'inventaire se lit par site, du plus recent au plus ancien.
CREATE INDEX IF NOT EXISTS site_pages_site_crawled_idx
  ON public.site_pages (site_id, crawled_at DESC);

-- ─── 2. generations : intention, cible de rafraichissement, verdict ──────────
--
-- AUCUN STATUT NOUVEAU. `generations_status_check` enumere sept statuts ; en
-- ajouter un huitieme obligerait a toucher le feed, les sept compteurs exacts
-- de /api/generate, le calendrier et l'index partiel de slug. Une mise a jour
-- en attente est une ligne `generated` portant intent = 'refresh' : le feed
-- existant la voit deja, il ne lui manque qu'un panneau.
--
-- `duplicate_verdict` porte les preuves ET la trace de decision (decidedBy,
-- decidedAt, reasons) dans UN champ jsonb plutot que dans quatre colonnes. Un
-- refus sans objet est inexploitable par l'operateur : il doit pouvoir lire
-- CONTRE QUOI sa page a ete refusee.

ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS intent text NOT NULL DEFAULT 'create',
  ADD COLUMN IF NOT EXISTS refresh_target_path text,
  ADD COLUMN IF NOT EXISTS refresh_target_generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refresh_plan jsonb,
  ADD COLUMN IF NOT EXISTS duplicate_verdict jsonb;

ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_intent_check;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_intent_check CHECK (intent IN ('create', 'refresh')) NOT VALID;

-- Un rafraichissement sans cible est une ligne qui ment sur ce qu'elle fait.
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_refresh_needs_target;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_refresh_needs_target
  CHECK (intent = 'create' OR refresh_target_path IS NOT NULL) NOT VALID;

-- `refusal_kind` n'avait aucun CHECK (migration 016 n'ajoute que la colonne et
-- son commentaire). 'duplicat' rejoint ici le vocabulaire, en avance sur le
-- lot qui l'ecrira : une contrainte permissive posee tot coute moins qu'une
-- migration de plus au moment ou le code en a besoin.
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_refusal_kind_check;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_refusal_kind_check
  CHECK (refusal_kind IS NULL OR refusal_kind IN ('occupe', 'redirection', 'identifiants', 'duplicat')) NOT VALID;

-- La file « mises a jour a valider » est une lecture frequente et etroite.
CREATE INDEX IF NOT EXISTS generations_refresh_pending_idx
  ON public.generations (site_id, updated_at DESC)
  WHERE (intent = 'refresh' AND status = 'generated');

-- ─── 3. Amorcage de l'inventaire depuis les pages deja publiees ──────────────
--
-- Sans cette etape, un site qui a deja publie cent pages par le moteur repart
-- avec un inventaire vide et genere a l'aveugle jusqu'au prochain crawl.
--
-- lower() + ltrim() parce que la normalisation de chemin cote applicatif
-- minuscule et prefixe d'un seul slash ; sans cela l'amorcage inscrirait des
-- chemins que le code ne retrouverait jamais.
-- site_id IS NOT NULL parce que la colonne est nullable des deux cotes et
-- qu'une ligne orpheline ferait echouer l'insertion.
-- ON CONFLICT s'appuie sur idx_site_pages_url, UNIQUE (site_id, path), ce qui
-- rend l'amorcage rejouable sans duplication.

INSERT INTO public.site_pages (
  site_id, url, path, title, meta_description, focus_keyword,
  origin, generation_id, crawled_at
)
SELECT
  g.site_id,
  g.published_url,
  lower('/' || ltrim(g.slug, '/')),
  g.title,
  g.meta_description,
  g.focus_keyword,
  'engine',
  g.id,
  COALESCE(g.published_at, g.updated_at, now())
FROM public.generations g
WHERE g.status = 'published'
  AND g.published_url IS NOT NULL
  AND g.slug IS NOT NULL
  AND g.site_id IS NOT NULL
ON CONFLICT (site_id, path) DO NOTHING;

-- ─── Documentation portee par le schema lui-meme ─────────────────────────────

COMMENT ON COLUMN public.site_pages.origin IS
  'crawl = observee sur le site, engine = publiee par le moteur et inscrite a la publication';
COMMENT ON COLUMN public.site_pages.canonical_path IS
  'Chemin declare par <link rel="canonical">. Une page canonisee ailleurs n''occupe pas fermement son URL.';
COMMENT ON COLUMN public.site_pages.robots_noindex IS
  'Vrai si <meta name="robots"> porte noindex. Une page desindexee ne cannibalise rien.';
COMMENT ON COLUMN public.generations.intent IS
  'create = nouvelle page, refresh = mise a jour d''une page existante. Une refresh n''est JAMAIS publiee automatiquement.';
COMMENT ON COLUMN public.generations.duplicate_verdict IS
  'Preuves ET trace de decision dans un seul champ : contre quoi la page a ete refusee, par qui, quand.';
COMMENT ON COLUMN public.generations.refresh_plan IS
  'Portee et preuve du rafraichissement : { scope: metadata|content, evidence }';

-- ─── Ce que cette migration ne fait PAS, et pourquoi ─────────────────────────
--
-- Aucun statut nouveau sur generations       — voir section 2.
-- Aucun DROP COLUMN, aucun DROP TABLE        — cesser d'ecrire une colonne est
--                                              reversible, la supprimer ne l'est pas.
-- Aucun ALTER de vector_embeddings           — son CHECK document_type restreint
--                                              la colonne a six valeurs et rien
--                                              ici n'a besoin d'une septieme.
-- Aucune colonne refresh_target_remote_id    — decideTarget retrouve la page par
--                                              son slug, et le connecteur Next.js
--                                              n'a aucun identifiant distant.
-- Aucune colonne intent sur editorial_calendar — aucun lecteur ne la lirait.
