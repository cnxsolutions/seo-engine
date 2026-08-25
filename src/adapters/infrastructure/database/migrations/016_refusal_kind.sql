-- ─────────────────────────────────────────────────────────────────────────────
-- 016 — Distinguer un refus d'une panne
-- SEO Engine
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Un refus et une panne finissent tous deux en `failed`, et l'operateur ne peut
-- les distinguer ni agir sur eux.
--
-- Ils n'appellent pourtant pas la meme chose. Une panne — reseau coupe, API qui
-- tombe — se reessaie toute seule au passage suivant. Un refus — le slug est
-- deja servi par une page du proprietaire, l'URL est une source de redirection —
-- sera exactement aussi vrai dans un quart d'heure : il attend une decision
-- humaine, et le produit ne donnait aucun bouton pour la prendre.
--
-- La colonne porte cette decision. Elle vaut NULL sur une panne.
--
-- Idempotente, comme toutes les migrations de ce projet.

ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS refusal_kind text;

COMMENT ON COLUMN public.generations.refusal_kind IS
  'Why the engine DECLINED to publish, when it declined on purpose: occupe (the slug is served by a page the engine did not write), redirection (the URL redirects elsewhere), identifiants (credentials missing). NULL means the publication broke rather than being refused, and the deferred job will retry it on its own.';
