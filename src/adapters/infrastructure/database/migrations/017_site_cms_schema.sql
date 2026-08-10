-- ─────────────────────────────────────────────────────────────────────────────
-- 017 — Garder le schema du CMS lu chez le client
-- SEO Engine
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Lire le schema d'un WordPress n'est pas une lecture de base : c'est une
-- authentification puis l'enumeration de chaque type de contenu, de ses champs
-- et de ses groupes ACF — plusieurs allers-retours vers le site du client, sur
-- son serveur de production.
--
-- Rien ne le conservait. Les tables `content_schemas` / `content_types` /
-- `content_fields` de la migration 001 existent mais AUCUN code du depot n'y a
-- jamais ecrit (c'est ecrit dans lib/db.ts:58). Consequence : chaque ouverture
-- de l'ecran refrappait le site du client pour un resultat identique, et
-- `has_schema` ne pouvait etre vrai pour personne.
--
-- On garde le schema la ou le connecteur Next.js garde deja le sien
-- (`sites.repo_profile`) : une colonne JSONB sur le site. Ressusciter quatre
-- tables relationnelles pour une donnee qu'on relit d'un bloc couterait plus
-- que le doute qu'elles laissent.
--
-- Idempotente, comme toutes les migrations de ce projet.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS cms_schema jsonb,
  ADD COLUMN IF NOT EXISTS cms_schema_read_at timestamptz;

COMMENT ON COLUMN public.sites.cms_schema IS
  'Last schema read from the client CMS: content types, fields, taxonomies, SEO plugin. Stored whole rather than split across content_schemas/content_types/content_fields, which nothing in this repository has ever written. Reading it is several authenticated round-trips to the client production site, so it is kept instead of being re-read on every screen.';

COMMENT ON COLUMN public.sites.cms_schema_read_at IS
  'When cms_schema was last read from the site. Shown to the operator so a stale schema is visible as stale rather than assumed current.';
