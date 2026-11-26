-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine — donnees de demonstration, base LOCALE uniquement
-- Appliquees par scripts/db-local-reset.mjs, apres la baseline et les migrations.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Rien ici ne doit pouvoir partir chez un vrai client, meme si `npm run dev`
-- tourne pendant des heures :
--   - sites FICTIFS en .test (domaine reserve, jamais resolu sur Internet), sans
--     identifiant WordPress ni jeton GitHub : aucun connecteur n'a de quoi ecrire ;
--   - campagnes INACTIVES : listDueEditorialSlots ne lit que les campagnes
--     actives, le planificateur ne genere donc aucun creneau d'ici ;
--   - cycle_auto_renew a false : checkCycleCompletion ne relance aucun crawl ni
--     aucun plan (qui couteraient des jetons d'IA) a l'echeance du cycle.
--
-- Les dates sont relatives au jour de la remise a zero : la demonstration montre
-- toujours une periode EN COURS. Les identifiants sont fixes (md5 -> uuid) pour
-- que les tests et les captures designent les memes lignes d'un jour a l'autre.
--
-- Trois sites, deux clients (migration 022) :
--   client A « Martin Batiment »    — Plomberie Martin (cycle en cours, pages en ligne,
--                                     resultats Google) et Toitures Lambert (campagne
--                                     sans cycle : l'etat vide)
--   client B « Electricite Durand » — Electricite Durand (sert aux tests de cloisonnement)
--
-- Les MEMBRES (une personne par client) ont besoin d'un compte Supabase Auth : ils sont
-- crees par scripts/db-local-reset.mjs, par l'API d'administration locale, apres ce
-- fichier. Les codes de connexion arrivent dans Mailpit (http://127.0.0.1:54324).
--
-- Idempotent : `on conflict do nothing` partout, rejouable avec --keep.

-- ─── Sites ──────────────────────────────────────────────────────────────────

insert into public.sites (id, name, type, url, is_active)
values
  (md5('demo-site-martin')::uuid,  'Plomberie Martin',    'wordpress', 'https://plomberie-martin.test',   true),
  (md5('demo-site-lambert')::uuid, 'Toitures Lambert',    'nextjs',    'https://toitures-lambert.test',   true),
  (md5('demo-site-durand')::uuid,  'Électricité Durand',  'wordpress', 'https://electricite-durand.test', true)
on conflict do nothing;

-- ─── Clients (L1) ───────────────────────────────────────────────────────────

insert into public.clients (id, name)
values
  (md5('demo-client-a')::uuid, 'Martin Bâtiment'),
  (md5('demo-client-b')::uuid, 'Électricité Durand')
on conflict do nothing;

update public.sites set client_id = md5('demo-client-a')::uuid
 where id in (md5('demo-site-martin')::uuid, md5('demo-site-lambert')::uuid) and client_id is null;
update public.sites set client_id = md5('demo-client-b')::uuid
 where id = md5('demo-site-durand')::uuid and client_id is null;

-- ─── Campagnes ──────────────────────────────────────────────────────────────

insert into public.campaigns (
  id, site_id, name, business_type, business_name, keywords, department, communes,
  schedule_frequency, schedule_time, page_types, publish_status, auto_publish,
  target_length, is_active, cycle_duration_days, cycle_auto_renew
)
values
  (md5('demo-campaign-martin')::uuid, md5('demo-site-martin')::uuid,
   'Plomberie — Troyes et agglomération', 'plombier', 'Plomberie Martin',
   array['plombier', 'dépannage plomberie', 'chauffe-eau', 'débouchage canalisation'],
   '10', array['Troyes', 'Sainte-Savine', 'La Chapelle-Saint-Luc', 'Saint-André-les-Vergers'],
   'every_2_days', '09:00', array['pillar', 'child'], 'draft', false,
   900, false, 14, false),
  (md5('demo-campaign-lambert')::uuid, md5('demo-site-lambert')::uuid,
   'Couverture — Châlons-en-Champagne', 'couvreur', 'Toitures Lambert',
   array['couvreur', 'réfection de toiture', 'démoussage'],
   '51', array['Châlons-en-Champagne'],
   'weekly', '09:00', array['pillar', 'child'], 'draft', false,
   900, false, 14, false),
  (md5('demo-campaign-durand')::uuid, md5('demo-site-durand')::uuid,
   'Électricité — Reims', 'électricien', 'Électricité Durand',
   array['électricien', 'mise aux normes électrique', 'borne de recharge'],
   '51', array['Reims'],
   'every_3_days', '09:00', array['pillar', 'child'], 'draft', false,
   900, false, 14, false)
on conflict do nothing;

-- ─── Cycle en cours : Plomberie Martin ──────────────────────────────────────
--
-- Sept pages, une tous les deux jours, du jour J-6 au jour J+6 : les trois
-- premieres sont en ligne, les quatre suivantes sont prevues.

with items (n, page_type, priority, city, keyword, title, slug) as (
  values
    (1, 'pillar', 'high',   'Troyes',                   'plombier troyes',                    'Plombier à Troyes : dépannage et installation',            'plombier-troyes'),
    (2, 'child',  'medium', 'Troyes',                   'dépannage plomberie troyes',         'Dépannage plomberie à Troyes, 7 jours sur 7',              'depannage-plomberie-troyes'),
    (3, 'child',  'medium', 'Sainte-Savine',            'chauffe-eau sainte-savine',          'Remplacement de chauffe-eau à Sainte-Savine',              'chauffe-eau-sainte-savine'),
    (4, 'child',  'low',    'La Chapelle-Saint-Luc',    'débouchage canalisation la chapelle-saint-luc', 'Débouchage de canalisation à La Chapelle-Saint-Luc', 'debouchage-canalisation-la-chapelle-saint-luc'),
    (5, 'pillar', 'high',   'Saint-André-les-Vergers',  'plombier saint-andré-les-vergers',   'Plombier à Saint-André-les-Vergers',                       'plombier-saint-andre-les-vergers'),
    (6, 'child',  'low',    'Troyes',                   'fuite d''eau troyes',                'Recherche de fuite d''eau à Troyes',                       'fuite-eau-troyes'),
    (7, 'child',  'medium', 'Sainte-Savine',            'détartrage chauffe-eau sainte-savine', 'Détartrage de chauffe-eau à Sainte-Savine',              'detartrage-chauffe-eau-sainte-savine')
),
dated as (
  select items.*, (current_date + (n - 4) * 2) as day from items
)
insert into public.cycle_plans (
  id, campaign_id, cycle_number, status, cycle_duration_days,
  cycle_started_at, cycle_ends_at, plan_data, total_pages, total_estimated_words, crawl_completed_at
)
select
  md5('demo-cycle-martin-2')::uuid,
  md5('demo-campaign-martin')::uuid,
  2, 'executing', 14,
  (current_date - 7)::timestamptz,
  (current_date + 7)::timestamptz,
  jsonb_agg(jsonb_build_object(
    'id', 'demo-item-' || n,
    'scheduled_date', to_char(day, 'YYYY-MM-DD'),
    'page_type', page_type,
    'priority', priority,
    'target_city', city,
    'target_keyword', keyword,
    'secondary_keywords', jsonb_build_array(),
    'search_intent', 'transactionnelle',
    'proposed_title', title,
    'proposed_slug', slug,
    'page_goal', 'Obtenir des demandes de devis et des appels.',
    'outline', jsonb_build_array('Le service', 'Les tarifs', 'La zone d''intervention', 'Questions fréquentes'),
    'seo_rules', jsonb_build_array(),
    'required_entities', jsonb_build_array(city),
    'internal_link_targets', jsonb_build_array(),
    'competitor_insights', jsonb_build_array(),
    'estimated_word_count', 900,
    'rationale', 'Donnée de démonstration.',
    'action', jsonb_build_object('kind', 'create', 'slug', jsonb_build_object('status', 'free'))
  ) order by n),
  count(*), 900 * count(*),
  (current_date - 7)::timestamptz
from dated
on conflict do nothing;

update public.campaigns
   set current_cycle_id = md5('demo-cycle-martin-2')::uuid
 where id = md5('demo-campaign-martin')::uuid
   and current_cycle_id is null;

-- Les trois pages deja en ligne.
insert into public.generations (
  id, campaign_id, site_id, city, slug, title, meta_description, focus_keyword,
  content, page_type, status, published_url, published_at, publish_live, intent, created_at
)
select
  md5('demo-generation-' || n)::uuid,
  md5('demo-campaign-martin')::uuid,
  md5('demo-site-martin')::uuid,
  city, slug, title, title || ' — intervention rapide, devis gratuit.', keyword,
  '<p>Contenu de démonstration.</p>', page_type, 'published',
  'https://plomberie-martin.test/' || slug,
  (current_date + (n - 4) * 2)::timestamptz + interval '9 hours',
  true, 'create',
  (current_date + (n - 4) * 2)::timestamptz + interval '9 hours'
from (values
  (1, 'pillar', 'Troyes',        'plombier troyes',            'Plombier à Troyes : dépannage et installation', 'plombier-troyes'),
  (2, 'child',  'Troyes',        'dépannage plomberie troyes', 'Dépannage plomberie à Troyes, 7 jours sur 7',   'depannage-plomberie-troyes'),
  (3, 'child',  'Sainte-Savine', 'chauffe-eau sainte-savine',  'Remplacement de chauffe-eau à Sainte-Savine',   'chauffe-eau-sainte-savine')
) as published (n, page_type, city, keyword, title, slug)
on conflict do nothing;

-- Le calendrier, tire du plan : en ligne avant aujourd'hui, prevu ensuite.
insert into public.editorial_calendar (
  id, campaign_id, generation_id, scheduled_date, page_type, target_keyword, target_city,
  status, plan_item_id, artifact_kind
)
select
  md5('demo-slot-' || (item ->> 'id'))::uuid,
  md5('demo-campaign-martin')::uuid,
  case when ordinality <= 3 then md5('demo-generation-' || ordinality)::uuid end,
  (item ->> 'scheduled_date')::date,
  item ->> 'page_type',
  item ->> 'target_keyword',
  item ->> 'target_city',
  case when ordinality <= 3 then 'published' else 'planned' end,
  item ->> 'id',
  'page'
from public.cycle_plans,
     jsonb_array_elements(plan_data) with ordinality as plan(item, ordinality)
where cycle_plans.id = md5('demo-cycle-martin-2')::uuid
on conflict do nothing;

-- ─── Google, vu de l'espace client (L2) ──────────────────────────────────────
--
-- La premiere page est indexee, la deuxieme pas encore decouverte, la troisieme
-- n'a jamais ete verifiee (aucune ligne) : les trois etats que lit le client.

insert into public.page_indexing (site_id, url, url_key, generation_id, priority, state, inspected_at)
select md5('demo-site-martin')::uuid,
       'https://plomberie-martin.test/' || slug,
       'plomberie-martin.test/' || slug,
       md5('demo-generation-' || n)::uuid,
       0, state, now() - interval '1 day'
from (values
  (1, 'plombier-troyes',            'indexed'),
  (2, 'depannage-plomberie-troyes', 'not_discovered')
) as rows (n, slug, state)
on conflict do nothing;

-- ─── Resultats Search Console : Plomberie Martin, 56 jours ──────────────────
--
-- Deux periodes de 28 jours, la recente un peu meilleure : de quoi montrer une
-- variation. Valeurs deterministes (pas de random()) pour des captures stables.

insert into public.gsc_performance (site_id, date, page_url, query, clicks, impressions, ctr, position)
select
  md5('demo-site-martin')::uuid,
  current_date - d,
  'https://plomberie-martin.test/' || page,
  query,
  clicks,
  impressions,
  case when impressions = 0 then 0 else round(clicks::numeric / impressions, 4)::real end,
  position
from generate_series(1, 56) as d,
lateral (values
  ('plombier-troyes',            'plombier troyes',              ((d * 7) % 5) + case when d <= 28 then 3 else 1 end, 60 + (d * 13) % 25, 6.4::real),
  ('depannage-plomberie-troyes', 'dépannage plombier troyes',    ((d * 3) % 4) + case when d <= 28 then 2 else 1 end, 35 + (d * 11) % 20, 8.1::real),
  ('chauffe-eau-sainte-savine',  'chauffe-eau sainte-savine',    ((d * 5) % 3),                                        18 + (d * 7) % 12,  11.3::real),
  ('',                           'plomberie martin',             ((d * 2) % 3) + 1,                                    9 + (d * 3) % 5,    1.2::real)
) as rows (page, query, clicks, impressions, position)
on conflict do nothing;
