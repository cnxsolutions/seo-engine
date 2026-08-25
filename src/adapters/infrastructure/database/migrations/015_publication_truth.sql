-- ─────────────────────────────────────────────────────────────────────────────
-- 015 — La verite de publication
-- SEO Engine
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `status = 'published'` couvrait quatre etats differents et n'en distinguait
-- aucun : page commitee sur une branche que personne ne deploie, brouillon
-- WordPress, page en ligne, page en ligne et referencee au sitemap. Le moteur
-- les enregistrait a l'identique et soumettait les quatre a l'indexation.
--
-- Le connecteur calcule ces informations depuis longtemps — `PageBuildMode`
-- existe cote Next.js et n'etait lu par personne. Ces colonnes les gardent, pour
-- que le proprietaire sache dans quel etat une page est sortie sans avoir a
-- ouvrir un navigateur.
--
-- Idempotente, comme toutes les migrations de ce projet.

ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS publish_mode text,
  ADD COLUMN IF NOT EXISTS publish_live boolean,
  ADD COLUMN IF NOT EXISTS publish_notes text[];

COMMENT ON COLUMN public.generations.publish_mode IS
  'How the connector produced the page, in its own words: contrat / charpente / secours for Next.js, wp-creation-rankmath and friends for WordPress. A free string, read by humans, never branched on.';

COMMENT ON COLUMN public.generations.publish_live IS
  'Whether a visitor could reach the page at publication time. False for a commit on an unpromoted branch and for a WordPress draft — both of which used to be stamped published_at and submitted for indexing.';

COMMENT ON COLUMN public.generations.publish_notes IS
  'What the connector needed to say and which is not an error: structured data stripped by KSES, no SEO plugin installed, page awaiting review, branch not merged.';
