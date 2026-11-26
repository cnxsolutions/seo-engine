-- ─────────────────────────────────────────────────────────────────────────────
-- 023 — Les resultats Google d'un site, agreges en base (L2b, ESP-5)
-- docs/cadrage.md ESP-5, docs/design.md § 9.4
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POURQUOI EN SQL. gsc_performance a une ligne par jour, par page et par
-- recherche : 56 jours d'un site actif font des dizaines de milliers de lignes.
-- Les agreger en memoire, c'est les charger (le helper operateur s'arrete a
-- 20 000 et tronque sans le dire). Cette fonction rend en UN aller-retour ce que
-- l'espace client affiche : les deux totaux des N derniers jours, ceux des N
-- jours d'avant, la courbe quotidienne, les 5 pages et les 5 recherches qui
-- amenent le plus de visites. L'index (site_id, date DESC) porte toutes ses
-- lectures.
--
-- LA FENETRE finit au DERNIER JOUR DE DONNEES, pas a aujourd'hui : Search
-- Console a deux ou trois jours de retard, et une fenetre calee sur aujourd'hui
-- montrerait une chute qui n'existe pas.
--
-- DROITS. SECURITY INVOKER (le defaut, ecrit pour qu'on le voie) : appelee avec
-- la cle publique, elle ne lirait rien, gsc_performance n'ayant aucune politique
-- RLS (021). EXECUTE est de toute facon retire a anon et authenticated : seule
-- la cle de service, cote serveur, l'appelle (lib/client-space/results.ts).
--
-- Idempotente : CREATE OR REPLACE, REVOKE et GRANT rejouables.

CREATE OR REPLACE FUNCTION public.client_search_summary(
  p_site_id uuid,
  p_days integer DEFAULT 28,
  p_top integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT least(greatest(p_days, 1), 90) AS days, least(greatest(p_top, 1), 20) AS top
  ),
  bounds AS (
    SELECT max(date) AS last_day, min(date) AS first_day
      FROM gsc_performance
     WHERE site_id = p_site_id
  ),
  windowed AS (
    SELECT g.date, g.page_url, g.query, g.clicks, g.impressions,
           g.date > b.last_day - p.days AS is_current
      FROM gsc_performance g
      CROSS JOIN bounds b
      CROSS JOIN params p
     WHERE g.site_id = p_site_id
       AND b.last_day IS NOT NULL
       AND g.date > b.last_day - 2 * p.days
  )
  SELECT jsonb_build_object(
    'last_day', (SELECT last_day FROM bounds),
    'first_day', (SELECT first_day FROM bounds),
    'days', (SELECT days FROM params),
    'current', (
      SELECT jsonb_build_object('clicks', coalesce(sum(clicks), 0), 'impressions', coalesce(sum(impressions), 0))
        FROM windowed WHERE is_current
    ),
    'previous', (
      SELECT jsonb_build_object('clicks', coalesce(sum(clicks), 0), 'impressions', coalesce(sum(impressions), 0))
        FROM windowed WHERE NOT is_current
    ),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', day, 'clicks', clicks, 'impressions', impressions) ORDER BY day)
        FROM (
          SELECT date AS day, sum(clicks) AS clicks, sum(impressions) AS impressions
            FROM windowed WHERE is_current
           GROUP BY date
        ) d
    ), '[]'::jsonb),
    'pages', coalesce((
      SELECT jsonb_agg(jsonb_build_object('page', page_url, 'clicks', clicks, 'impressions', impressions) ORDER BY clicks DESC, impressions DESC)
        FROM (
          SELECT page_url, sum(clicks) AS clicks, sum(impressions) AS impressions
            FROM windowed WHERE is_current AND coalesce(page_url, '') <> ''
           GROUP BY page_url
           ORDER BY sum(clicks) DESC, sum(impressions) DESC
           LIMIT (SELECT top FROM params)
        ) pages
    ), '[]'::jsonb),
    'queries', coalesce((
      SELECT jsonb_agg(jsonb_build_object('query', query, 'clicks', clicks, 'impressions', impressions) ORDER BY clicks DESC, impressions DESC)
        FROM (
          SELECT query, sum(clicks) AS clicks, sum(impressions) AS impressions
            FROM windowed WHERE is_current AND coalesce(query, '') <> ''
           GROUP BY query
           ORDER BY sum(clicks) DESC, sum(impressions) DESC
           LIMIT (SELECT top FROM params)
        ) queries
    ), '[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.client_search_summary(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_search_summary(uuid, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_search_summary(uuid, integer, integer) TO service_role;
