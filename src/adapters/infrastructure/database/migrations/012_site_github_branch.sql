-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine - Target branch for Next.js publishing
-- Migration: 012_site_github_branch
-- Purpose: Stop committing generated pages straight onto production.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `publishToNextJs` writes through the GitHub Contents API without naming a
-- branch, and GitHub then defaults to the repository's default branch — which on
-- most repositories is what the host deploys. A generated page was therefore
-- live the moment it was committed, with no review and no build check: the
-- engine has no way to verify that the `page.tsx` it just wrote even compiles.
--
-- With a branch set, the same publication lands somewhere reviewable and the
-- operator merges when satisfied. Left NULL, behaviour is unchanged — existing
-- sites keep publishing exactly as before.

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS github_branch text;

COMMENT ON COLUMN public.sites.github_branch IS
    'Branch that generated pages are committed to (reads use it as ?ref= too). NULL means the repository default branch, i.e. production on most setups.';
