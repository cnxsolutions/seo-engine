-- ─────────────────────────────────────────────────────────────────────────────
-- 014 — Promotion automatique vers la branche de production
-- SEO Engine
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Migration 012 a ajoute `github_branch` pour qu'une page generee atterrisse
-- dans une branche relisible plutot qu'en production. L'effet de bord n'est
-- apparu qu'a l'usage : Vercel deploie `main`, la branche accumule les pages, et
-- AUCUNE page publiee n'est jamais visible sur le site. Cinq commits d'avance,
-- zero en ligne.
--
-- Cette colonne tranche, par site plutot que globalement : un site peut vouloir
-- une branche de recette, un autre vouloir que la page soit en ligne le jour J.
--
-- Idempotente, comme toutes les migrations de ce projet.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS auto_promote boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sites.auto_promote IS
  'When true and github_branch is set, the publisher merges that branch into the repository default branch right after a successful publication, so the page reaches production. False leaves the branch as a staging area to be merged by hand. No effect when github_branch is NULL, since publication already targets the default branch.';
