# SEO Engine — cadrage : espace client, demandes de mots-clés, refonte UI/UX

Chantier demandé par CNX Solutions le 25/11/2026. Ce document est à valider avant la première ligne de code.

**Sources, dans l'ordre où elles prévalent**

1. **La demande de CNX** (25/11/2026) : donner un accès aux clients branchés sur le moteur ; leur permettre de
   proposer des mots-clés ; le moteur intègre une demande au cycle en cours si c'est judicieux, sinon la garde pour
   un cycle suivant ; refondre l'UI/UX de tout le projet selon la DA de CNX Solutions (site et films).
2. **Le code**, pour tout ce qui existe déjà : `origin/main` à `450da64` (#28), relevé le 25/11/2026 —
   1 283 tests verts sur 79 fichiers, graphe graphify à jour (3 859 nœuds).
3. **La DA de CNX**, pour toute valeur visuelle : `cnx-solutions/brand/README.md`,
   `cnx-solutions/wp-content/themes/cnx-solutions/assets/css/theme.css` (jetons `:root`), et
   `cnx-videos/film-presentation/SPEC.md` + `assets/cnx.css` (le registre des films).

En cas d'écart, la demande l'emporte sur ce document, et le thème du site l'emporte sur toute valeur visuelle
recopiée ici.

Documents liés : [design.md](design.md) (identité visuelle, composants, écrans) · [../CLAUDE.md](../CLAUDE.md)
(règles de travail, instance unique) · [deploiement.md](deploiement.md) · [../db/README.md](../db/README.md).

---

## 1. Le projet en une page

| Élément | Valeur |
|---|---|
| Objectif | Chaque client branché sur le moteur a son espace : il voit sa campagne et ses résultats Google, propose ses mots-clés, et sait toujours ce que le moteur en a fait et pourquoi |
| Deux publics | **Le client** (dirigeant de TPE/PME, artisan, surtout sur téléphone) · **l'opérateur** (CNX, sur ordinateur) |
| Référence figée | `origin/main` `450da64`, 25/11/2026 |
| Échéance | **À fixer** (§ 7, décision 14) |
| Cibles | Espace client : mobile d'abord, utilisable à 375 px, < 2 s · Console opérateur : desktop d'abord, utilisable sur mobile |
| Distribution | La **même** application, le **même** conteneur, le **même** domaine (`seo.cnx-solutions.fr/espace`) |
| Données | La base Supabase existante, trois tables et deux fonctions ajoutées (migrations `022` espace client, `023` résultats Google, `024` demandes ; la `021` du L0 active le RLS) |
| Environnements | **Développement, tests et recette : Supabase en local** (CLI + Docker, § 4.8) · Production : le projet Supabase hébergé, touché seulement pour appliquer une migration avant un merge (décision 16) |
| E-mails | Expéditeur **`contact@cnx-solutions.fr`**, par le compte SMTP déjà utilisé par le site CNX ; en local, aucun envoi réel (décision 17) |
| Contrainte qui prime | **Une seule instance** : le planificateur `node-cron` tourne dans le process (CLAUDE.md). Rien dans ce chantier ne la remet en cause |

**La demande, découpée en trois.**

1. **Un accès client.** Un client invité par CNX se connecte et ne voit que son ou ses sites.
2. **Les demandes de mots-clés.** Le client propose un mot-clé. Le moteur l'analyse en moins d'une minute et rend
   un verdict motivé : *intégrée à la période en cours* (une page prévue est remplacée), *gardée pour la période
   suivante* (stockée, consommée en priorité au prochain plan), *déjà couverte* (lien vers la page) ou *à l'étude
   chez CNX*. **Aucune demande n'est jamais perdue** : une demande reportée reste en tête de file jusqu'à ce qu'un
   plan la consomme.
3. **La refonte UI/UX** de tout le projet aux couleurs, à la typographie, aux formes et au mouvement de CNX
   Solutions, avec la suppression du jargon technique visible.

**Hors périmètre (V1)** — chaque point est une demande à part :

- le client ne modifie **ni** la campagne (fréquence, communes, types de pages, publication automatique), **ni** un
  contenu, **ni** un réglage de site ; il ne relit pas les pages avant publication ;
- aucune inscription libre : un client n'existe que parce que CNX l'a invité ;
- ni facturation, ni abonnement, ni messagerie, ni application mobile, ni autre langue que le français ;
- le client ne voit ni les modèles d'IA, ni les coûts, ni les prompts, ni les données SERP brutes, ni les autres
  clients ; de Search Console, il ne voit que ses propres résultats, simplifiés (ESP-5) ;
- pas de mode sombre (le bloc sombre actuel de `components/tokens.css` n'est pas maintenu, décision 11) ;
- pas de sous-domaine dédié ni de nouveau vhost sur le VPS partagé.

**Conséquences techniques** (YAGNI) : pas de route d'inscription ; pas de rôle au-delà de « membre d'un client » ;
l'opérateur garde la barrière HTTP Basic actuelle en V1 (décision 7) ; pas de temps réel (un rafraîchissement
suffit) ; pas de framework i18n (un module de libellés centralisé, comme `lib/publishing/refusal-labels.ts`).

---

## 2. Inventaire des fonctionnalités

Les identifiants nomment les branches et les PR (`feat/L3-KW-4-verdict`). État : ✅ existe · 🟡 partiel ou à
reprendre · ❌ absent · ❓ à vérifier.

### ACC — Accès et comptes

| ID | Fonctionnalité | Source | État | Lot |
|---|---|---|---|---|
| ACC-1 | L'opérateur invite un client depuis les **Réglages** d'un site (nom du client, e-mail) ; le client reçoit un e-mail d'invitation | demande | ✅ L1 (invitation = compte confirmé + code, voir § 4.4) | L1 |
| ACC-2 | Connexion **sans mot de passe** : code à 6 chiffres reçu par e-mail (lien en secours), seuls les e-mails invités reçoivent un code | décision 3 | ✅ L1 | L1 |
| ACC-3 | **Cloisonnement** : un membre ne lit et n'écrit que sur les sites de son client, vérifié côté serveur à chaque requête | règles dev | ✅ L1 (`scope.ts`, 3 contrôles) | L1 |
| ACC-4 | Révocation d'un accès par l'opérateur (effet immédiat), déconnexion, session qui expire | règles dev | ✅ L1 (révocation + blocage du compte ; 30 jours comptés depuis le code de LA session — claim `amr` —, sessions antérieures à une révocation refusées) | L1 |
| ACC-5 | Barrière : `/espace`, `/api/espace`, `/auth` sortent de la barrière Basic et passent par la session client ; tout le reste reste derrière `APP_ACCESS_SECRET`, fermé par défaut | `proxy.ts` | ✅ L1 (`lib/client-space/gate.ts`) | L1 |
| ACC-6 | Pages connexion, code expiré, accès révoqué, 403/404/500 de l'espace, en français, à la DA CNX | règles dev | ✅ L1 (accès retiré = page de connexion qui le dit ; 404 pour un site d'un autre client) | L1 |
| ACC-7 | L'opérateur voit qui a accès à chaque site et la dernière connexion | — | ✅ L1 (section « Accès client » des Réglages) | L1 |

### ESP — Espace client

| ID | Fonctionnalité | Source | État | Lot |
|---|---|---|---|---|
| ESP-1 | Accueil : la période en cours (dates, pages prévues / publiées), ses dernières demandes, bouton « Proposer un mot-clé » | demande | ✅ L2a (période, fil, pages prévues et en ligne) · L3 (trois dernières demandes, bouton « Proposer un mot-clé ») | L2 |
| ESP-2 | Pages en ligne : titre, adresse, date, « visible sur Google » ou « en cours d'indexation » | `lib/google/tracking.ts`, `lib/indexing` | ✅ L2a (trois états : visible, en cours d'indexation, « CNX vérifie ») | L2 |
| ESP-3 | Prochaines pages : sujet et date, sans type technique (« Pilier », « Enfant ») | `editorial_calendar` | ✅ L2a (titre du plan, sinon le sujet en français) | L2 |
| ESP-4 | Sélecteur de site quand un client en a plusieurs | — | ✅ L2a | L2 |
| ESP-5 | **Résultats Google** (décision 2) : clics et apparitions sur 28 jours comparés aux 28 précédents, courbe quotidienne, 5 pages et 5 recherches qui amènent le plus de visites ; source et période toujours affichées ; état vide utile si Search Console n'est pas reliée (« CNX s'en occupe ») | `gsc_performance`, `lib/google/performance.ts`, `SourceNote` | ✅ L2b (fonction SQL `client_search_summary`, migration 023 ; état vide « CNX s’en occupe » ou « données en route ») | L2 |
| ESP-6 | Mobile d'abord : tout l'espace utilisable à 375 px, chargé en < 2 s | règles dev | ✅ L2a, L2b (375 px et 1 280 px vérifiés, rendu serveur, une requête agrégée pour les résultats) | L2 |

### KW — Demandes de mots-clés

| ID | Fonctionnalité | Source | État | Lot |
|---|---|---|---|---|
| KW-1 | Formulaire : mot-clé (obligatoire), ville (facultative, proposée parmi les communes de la campagne), « pourquoi » (facultatif), « pour quand » (facultatif) ; plusieurs mots-clés d'un coup, un par ligne, 10 au plus | demande | ✅ L3 (affichage optimiste, erreurs sous chaque champ, ligne par ligne) | L3 |
| KW-2 | Validation serveur : longueur, nombre de mots, pas d'URL ; plafond de demandes ouvertes par site ; limite de débit | règles dev | ✅ L3 (domaine `normalize.ts` rejoué par la route ; plafond et doublons dans `submit_keyword_requests`, sous verrou du site ; 30 envois / heure par membre) | L3 |
| KW-3 | Analyse **asynchrone** par une tâche du planificateur (toutes les 2 min, lots de 5) : verdict, motifs, preuves | demande | ✅ L3 (`lib/keyword-requests/analyze.ts`, tâche `keywordRequests` ; contexte chargé une fois par site, verdicts écrits en un appel) | L3 |
| KW-4 | Verdict « Intégrée à la période en cours » : un brief est rédigé, il **remplace** une page prévue non entamée, la date est annoncée | demande | ❌ | L4 |
| KW-5 | Verdict « Gardée pour la période suivante » : stockée, consommée en priorité par le prochain plan | demande | 🟡 L3 : verdict ; consommation au L4 | L3 (verdict) · L4 (consommation) |
| KW-6 | Verdicts « Déjà prévue le JJ/MM », « Déjà couverte par cette page », « Vous êtes déjà en tête sur Google » — avec le lien ou la date | `decideEditorialAction` | ✅ L3 | L3 |
| KW-7 | Verdict « À l'étude chez CNX » : hors zone, hors métier, ambigu | demande | ✅ L3 (+ site sans campagne, avis du modèle indisponible) | L3 |
| KW-8 | Suivi : chronologie reçue → analysée → prévue (date) → en rédaction → en ligne (lien) | demande | 🟡 L3 : chronologie affichée, rafraîchie toutes les 10 s pendant l'analyse ; passages « en rédaction » et « en ligne » au L4 | L3 · L4 |
| KW-9 | Le client retire une demande tant qu'elle n'est pas en rédaction | — | ✅ L3 (modale de confirmation ; retrait conditionnel au statut, jamais écrasé par l'analyse) | L3 |
| KW-10 | Console opérateur : file de toutes les demandes, filtres, arbitrage (intégrer maintenant, reporter, refuser avec motif, rouvrir), compteur « à examiner » dans le rail | demande | ❌ | L5 |
| KW-11 | Report sans perte : une demande non consommée (plan plein, quota atteint) reste en tête au plan suivant ; au-delà de 3 cycles d'attente, elle passe « à examiner » | demande | ❌ | L4 |
| KW-12 | E-mails : au client (verdict, mise en ligne), à l'opérateur (demande à examiner) — par une file d'envoi asynchrone | — | ❌ | L7 |
| KW-13 | Planification : les demandes en attente entrent dans **les deux** chemins de plan (manuel et renouvellement automatique) ; chaque brief issu d'une demande porte `client_request_id` et un repère « Demande du client » dans l'onglet Stratégie | `lib/planning/brief-plan.ts`, `lib/scheduler/cycle-manager.ts` | ❌ | L4 |

### UX — Refonte de l'interface (tout le projet)

| ID | Fonctionnalité | Source | État | Lot |
|---|---|---|---|---|
| UX-1 | Jetons CNX dans `components/tokens.css` : surfaces froides, encre `#08090d`, accent `#0b6cf9`, dégradé de marque, rayons, ombres, mouvement — **noms de jetons et alias conservés** | DA | ✅ L0b (#31) : valeurs du thème CNX, noms et alias conservés, bloc sombre retiré | L0 |
| UX-2 | Typographie : Plus Jakarta Sans (titres, chiffres, boutons) + Inter (texte), par `next/font` | DA | ✅ L0b (#31) | L0 |
| UX-3 | Marque : symbole CNX, nom « CNX SEO Engine », favicon, titres de page ; fin de « AI Content Platform » et de l'éclair générique | DA, captures du site | ✅ L0b (#31) | L0 |
| UX-4 | Composants de base rhabillés : bouton pilule qui s'allonge, badge, carte, en-tête de page avec surtitre, champ, notice, état vide, onglets ; nouvelle **modale de confirmation** (remplace `confirm()`), squelette de chargement, toast | DA, règles dev | 🟡 L0b (#31) : bouton, badge, carte, surtitre, focus, `ConfirmDialog` (remplace les 2 `confirm()`) ; squelette et toast créés quand un écran en aura besoin (L2, L3) | L0 |
| UX-5 | Coquille opérateur repensée : rail (marque, sites, demandes), en-tête de site, navigation mobile | DA | 🟡 sous 1 024 px, le rail garde 248 px et écrase le contenu (constaté au L0b) | L5 |
| UX-6 | Langage : plus de jargon interne visible (« gate », noms de tables, « slots ») ; un glossaire unique opérateur / client | DA (ton) | 🟡 | L5 · L6 |
| UX-7 | Styles en ligne : **675** `style={{…}}` dans `app/` et `components/` → classes de composants ; aucun nouveau style en ligne | règles dev | 🟡 | L6 |
| UX-8 | États : chargement, succès, erreurs en ligne, états vides utiles, pages 403/404/500 en français | règles dev | 🟡 | L6 |
| UX-9 | Accessibilité : contraste AA (valeurs CNX déjà mesurées), focus visible, clavier, `prefers-reduced-motion` | règles dev | 🟡 | L0 · L6 |
| UX-10 | Mouvement CNX : courbe `cubic-bezier(.165,.84,.44,1)`, survols qui glissent, listes échelonnées, aucun rebond | DA | ❌ | L0 · L6 |
| UX-11 | Graphiques : série 1 = accent CNX, palette revalidée (contraste, daltonisme) contre les nouvelles surfaces | `components/charts.tsx` | 🟡 | L6 |
| UX-12 | Écrans hérités : les redirections (`analyze`, `campaigns`, `calendar`…) inventoriées, les écrans morts retirés | — | 🟡 + cartes de `/sites` : bloc « À faire » comprimé, valeurs qui débordent (constaté au L0b, déjà sur `main`) | L6 |

### QA — Qualité, sécurité, exploitation

| ID | Fonctionnalité | Source | État | Lot |
|---|---|---|---|---|
| QA-1 | **RLS activé sur toutes les tables**, sans politique (tout refusé hors clé de service), vérifié par un script — en local par un test, en production par une lecture seule — préalable à toute exposition de Supabase Auth | sécurité | ✅ L0a (#30) : la base reconstruite laissait les 30 tables lisibles par la clé publique ; migration `021`, et la baseline enregistre désormais l'état RLS | L0 |
| QA-2 | Tests d'isolation, **contre le Supabase local** : pour chaque route `/api/espace`, un membre du client A n'obtient rien du client B (404, pas 403) | sécurité | ✅ L1 : `db/client-space.db.test.ts` (isolation du module de portée, connexion réelle, révocation, expiration) · L3 : `db/keyword-requests.db.test.ts` (envoi et retrait sur le site d'un autre client → introuvable) | L1 |
| QA-3 | Limites de débit (connexion, envoi de demandes), en mémoire — compatible avec l'instance unique | sécurité | ✅ L1 : codes demandés et saisis (`lib/rate-limit.ts`) · L3 : envois de demandes (30 / heure par membre) | L1 · L3 |
| QA-4 | Documentation à jour : CLAUDE.md (1 283 tests, piège Vitest sous Git Bash), README, `db/README.md`, baseline régénérée après `021`, `022`, `023`, `024` | — | 🟡 | L0 puis chaque lot |
| QA-5 | Recette par lot sur le Supabase local : captures 375 px et 1 440 px, Lighthouse, parcours complet (codes de connexion lus dans Mailpit), écritures en base listées, puis base remise à zéro | dev-cadrage | ❌ | chaque lot |
| QA-6 | **Supabase local** : `supabase/config.toml`, schéma reconstruit depuis la baseline et les migrations, jeu de démonstration (deux clients, trois sites fictifs), une commande pour tout remettre à zéro (§ 4.8) | décision 16 | ✅ L0a (#30) | L0 |
| QA-7 | Tests d'intégration (`*.db.test.ts`, `npm run test:db`) contre le Supabase local : isolation, RLS, `swap_plan_item` sous concurrence, idempotence des migrations ; rejoués en CI dans un job dédié (décision 18) | décision 16 | 🟡 outillage et 24 tests au L0a (#30) ; isolation au L1, transaction au L4 | L0 (outillage) puis chaque lot |

---

## 3. Règles métier

### 3.1 Le verdict d'une demande — domaine pur, testé

Il vit dans `src/core/domain/keyword-requests/`, sans import de Supabase, de Next ni du modèle, comme
`src/core/domain/existing/action.ts` dont il réutilise la décision. **L'ordre des règles est la politique** :

| # | Règle | Verdict | Ce que voit le client |
|---|---|---|---|
| 1 | Format invalide (vide, > 80 caractères, > 8 mots, URL) | refusée **à la saisie**, jamais stockée | erreur sous le champ |
| 2 | Même mot-clé normalisé qu'une demande ouverte du même site | rattachée à la demande existante | « Vous l'avez déjà demandé le JJ/MM » |
| 3 | Déjà visé par un brief du cycle en cours (mot-clé principal ou secondaire) | `scheduled`, liée à ce brief | « Déjà prévue le JJ/MM » |
| 4 | Requête déjà gagnée (Search Console : position ≤ 3 et ≥ 30 impressions, `blockedQueries`) | `covered` | « Votre site est déjà en position N sur cette recherche » + lien |
| 5 | Déjà portée par une page du site (`decideEditorialAction` ≠ `create` : position 5-20, cannibalisation, page vue non cliquée, identité éditoriale) | `covered` | « Cette page y répond déjà » + lien |
| 6 | Ville détectée hors des communes de la campagne, ou ville sur une campagne nationale | `review` | « À l'étude chez CNX : cette ville n'est pas encore dans votre zone » |
| 7 | Hors métier selon le modèle (`out`) ou incertain (`unsure`) | `review` | « À l'étude chez CNX » |
| 8 | Sinon : recevable → **placement** (§ 3.2) | `scheduled` ou `deferred` | « Prévue le JJ/MM » ou « Gardée pour la période suivante » |

Principes, repris du moteur existant :

- **Une mesure bat une ressemblance** (règles 4-5 avant 6-7), comme dans `decideEditorialAction`.
- **Aucune mise à jour de page** (décision du propriétaire du 17/10/2026) : une demande déjà couverte ne réécrit
  rien et n'ouvre pas une page concurrente. L'opérateur peut forcer un *angle distinct* depuis sa console.
- **Jamais de refus sur la seule opinion du modèle** : un « hors métier » part à l'opérateur, il n'est pas refusé.
- **Une donnée absente n'est pas une donnée à zéro** : sans Search Console, les règles 4-5 ne valent que par
  l'identité éditoriale et le verdict porte `WITHOUT_SEARCH_CONSOLE`, comme aujourd'hui.
- **Chaque verdict porte ses motifs en clair et ses preuves** (adresse de page, position, date) : c'est ce que lit
  le client, et ce que l'opérateur relit avant d'arbitrer.

Le jugement « hors métier » (règle 7) est le seul appel au modèle de l'analyse : un JSON court
(`fit: in | out | unsure`, service reconnu, ville détectée, intention, motif en français), sur un petit modèle. La
détection de ville se fait **d'abord** de façon déterministe contre `lib/geo/communes.ts`.

### 3.2 Le placement : période en cours ou suivante

Une demande recevable entre dans le **cycle en cours** si les quatre conditions tiennent, sinon elle est gardée
pour le suivant (`deferred`) :

1. un cycle est `executing` et se termine dans **3 jours ou plus** ;
2. il reste un **créneau remplaçable** : statut `planned`, date ≥ J+2, brief de type autre que `pillar`, qui n'est
   pas lui-même issu d'une demande ;
3. le **quota** du cycle n'est pas atteint : au plus **un tiers** des créneaux du cycle (au moins un) viennent de
   demandes client (décision 4) ;
4. le brief rédigé pour la demande passe les mêmes gardes que tout brief (`normalizeBriefs` : adresse libre,
   mot-clé non porté, angle distinct). Un brief écarté après rédaction fait passer la demande en `covered` avec le
   motif.

Choix du créneau remplacé : avec une date souhaitée, le dernier créneau remplaçable **avant** cette date ; sinon,
le créneau de **plus basse priorité**, le plus tôt à priorité égale. On **remplace**, on n'ajoute pas
(décision 5) : le volume, la fréquence promise et le coût du cycle restent ceux de la campagne. Un pilier n'est
jamais remplacé, parce que les pages enfants s'y relient.

Ordre de consommation au cycle suivant : date souhaitée la plus proche d'abord, puis ancienneté (FIFO). Même
quota d'un tiers ; le surplus attend le cycle d'après.

### 3.3 Cycle de vie d'une demande

Une machine à états dans le domaine, dont chaque transition est testée.

| Statut (`status`) | Client | Opérateur | Suites possibles |
|---|---|---|---|
| `received` | Reçue — analyse en cours | Reçue | `scheduled`, `deferred`, `covered`, `review`, `withdrawn` |
| `review` | À l'étude chez CNX | À examiner | `scheduled`, `deferred`, `declined`, `withdrawn` |
| `deferred` | Gardée pour la période suivante | Reportée | `scheduled`, `review` (après 3 cycles), `withdrawn` |
| `scheduled` | Prévue le JJ/MM | Planifiée (cycle n, créneau du JJ/MM) | `in_production`, `deferred` (plan annulé), `withdrawn` |
| `in_production` | En rédaction | En génération / publication | `published`, `review` (échec) |
| `published` | En ligne — voir la page | Publiée | — |
| `covered` | Déjà couverte — voir la page | Couverte | `scheduled`, `deferred` (rouverte par l'opérateur) |
| `declined` | Non retenue — motif | Refusée (motif **obligatoire**, montré au client) | rouverte par l'opérateur |
| `withdrawn` | Retirée | Retirée par le client | — |

Le mot « refusé » n'apparaît jamais côté client : il lit ce que le moteur a constaté et ce qui va se passer.

### 3.4 Intégrer au cycle en cours sans course avec le planificateur

`cycle_plans.plan_data` est un tableau JSONB réécrit en entier, et la tâche principale (toutes les 15 min)
réclame des créneaux pendant ce temps. Une lecture-modification-écriture depuis Node perdrait une écriture.

Garantie : une **fonction SQL** `swap_plan_item(plan_id, old_item_id, new_item, slot_id)` fait tout dans une
transaction : verrou `FOR UPDATE` sur le plan **et** le créneau, vérification que le créneau est toujours
`planned`, remplacement de l'item dans le JSONB, mise à jour du créneau (`target_keyword`, `target_city`,
`plan_item_id`). Si le créneau a été réclamé entre-temps, elle renvoie `false` et le service essaie le créneau
suivant, puis reporte la demande. Migration idempotente (`CREATE OR REPLACE FUNCTION`).

Le brief d'une demande est rédigé par **la même** fonction que les briefs d'un plan : `writeBriefs` est extraite
pour accepter un seul sujet (`writeBriefForSubject`), sans copie de prompt.

**Fait au L4a** : `generateBriefPlanWithSignals` se compose désormais de `loadPlanningKnowledge` (l'existant, Search
Console, SERP et suggestions, lus une fois) et de `writePlanBriefs` (le modèle pour les sujets à écrire, puis les
gardes de `normalizeBriefs`). Un brief seul s'écrira `writePlanBriefs(knowledge, [sujet])`. Comportement inchangé,
verrouillé par `lib/planning/brief-plan.flow.test.ts` : le plan entier, modèle et inventaire simulés, prompt et
briefs figés avant l'extraction.

### 3.5 Consommer les demandes au cycle suivant

`generateBriefPlanWithSignals` reçoit les demandes en attente (`clientRequests`) : les premiers créneaux du
calendrier prennent leurs mots-clés **avant** la rotation de `campaign.keywords`, et chaque brief porte
`client_request_id`. Les **deux** chemins passent par cette fonction — plan manuel (`POST /api/campaigns/[id]/plan`)
et renouvellement automatique (`endCycleAndStartNew`) — donc aucun ne peut oublier les demandes.

Un plan manuel naît `draft` : les demandes ne passent `scheduled` qu'à sa confirmation (`startCycle`), et
reviennent `deferred` s'il est annulé.

### 3.6 De la publication au client

Quand une génération issue d'un brief `client_request_id` est publiée (`lib/publishing/record.ts`), la demande
passe `published` avec l'adresse. Un échec ou un refus de publication la renvoie `review` avec le motif : c'est à
l'opérateur de décider, pas au client de deviner.

### 3.7 Cloisonnement et données exposées

- Toute lecture côté client passe par **un seul** module (`lib/client-space/scope.ts`) qui résout, depuis la
  session, les sites du client (membre non révoqué). Aucune route n'accepte un identifiant de site sans vérifier
  qu'il en fait partie ; un site hors périmètre répond **404**, pour ne pas confirmer qu'il existe.
- **Aucun `select('*')` sur `sites`** : la table porte `wp_app_password` et `github_token`. Les objets envoyés au
  client sont des DTO à colonnes listées, testés pour ne contenir aucun secret.
- Le client ne voit jamais : modèle, coût, prompt, SERP brute, erreur technique (message générique côté client,
  détail dans les journaux opérateur).

### 3.8 Plafonds

| Plafond | Valeur | Pourquoi |
|---|---|---|
| Mots-clés par envoi | 10 | un envoi reste lisible et analysable en un passage |
| Demandes ouvertes par site | 30 | au-delà, c'est une stratégie à reprendre avec CNX, pas une file |
| Envois par membre | 30 / heure | abus, coût du jugement par le modèle |
| Codes de connexion | 5 / 15 min par e-mail et par IP | force brute, quota d'e-mails |
| Codes saisis | 10 / 15 min par e-mail et par IP | un code à 6 chiffres se devine ; laisse la place aux fautes de frappe (ajouté au L1) |

Les valeurs sont des constantes nommées du domaine, modifiables en une ligne.

---

## 4. Architecture

### 4.1 Pile

Inchangée : Next.js 16 (App Router, `proxy.ts`), React 19.2, TypeScript strict, Supabase (clé de service côté
serveur uniquement), `node-cron` dans le process, Node 22. Ajouts, en versions épinglées :

| Ajout | Pour | Décision |
|---|---|---|
| `@supabase/ssr` | session client en cookie `HttpOnly`, rafraîchie dans `proxy.ts` | 3 |
| `zod` | validation des entrées des nouvelles routes | 10 |
| Plus Jakarta Sans (`next/font/google`, auto-hébergée au build) | typographie CNX | UX-2 |

Le navigateur ne reçoit **aucune** clé Supabase : l'espace client parle à nos routes `/api/espace`, qui parlent à
Supabase. Le RLS (QA-1) est une défense en profondeur, pas le mécanisme de cloisonnement.

### 4.2 Couches et dossiers

Le projet a déjà ses couches : `src/core/domain` (pur), `lib/*` (services et accès aux données), `app/` (écrans
et routes). On les prolonge sans en inventer d'autres.

```
src/core/domain/keyword-requests/   normalize.ts · verdict.ts · placement.ts · lifecycle.ts  (+ *.test.ts)
lib/keyword-requests/                submit.ts · analyze.ts · schedule-current.ts · consume-next.ts
                                     operator-decide.ts · repository.ts · labels.ts (libellés FR)
lib/client-space/                    session.ts (Supabase SSR) · scope.ts (sites du membre) · dto.ts
lib/planning/brief-plan.ts           + writeBriefForSubject (extraite), + option clientRequests
lib/scheduler/cron.ts                + tâche 'keywordRequests' (*/2 min, runWithConcurrencyControl)
app/(espace)/espace/…                écrans client : accueil, demandes, pages, connexion
app/api/espace/…                     routes client minces : valider → cas d'usage → répondre
app/auth/callback/route.ts           retour du lien de connexion
app/(dashboard)/demandes/page.tsx    file opérateur (tous sites) + onglet « Demandes » d'un site
```

Les routes restent minces (≈ 20 lignes) ; aucune requête Supabase dans un composant ; aucune requête dans une
boucle (les verdicts d'un lot chargent inventaire, signaux et plan **une fois par site**).

### 4.3 Modèle de données

Migration `022_client_space.sql` :

```sql
clients          (id uuid pk, name text not null, created_at, updated_at)
client_members   (id uuid pk, client_id uuid fk→clients on delete cascade, user_id uuid unique,  -- auth.users
                  email text not null, last_login_at timestamptz, revoked_at timestamptz, created_at)
sites.client_id  uuid null fk→clients on delete set null              -- colonne nullable, aucun backfill requis
index : client_members(client_id), client_members(lower(email)) unique, sites(client_id)
RLS activé sur clients, client_members ; aucune politique
```

Migration `024_keyword_requests.sql` (la `023` est prise par les résultats Google du L2b ; `swap_plan_item`
passe dans la `025`, avec le L4 qui s'en sert) :

```sql
keyword_requests (
  id uuid pk, client_id uuid fk, site_id uuid fk, campaign_id uuid fk null,
  submitted_by uuid fk→client_members null,
  keyword text not null, keyword_normalized text not null, city text null,
  note text null, desired_by date null,
  status text not null check (status in ('received','review','deferred','scheduled','in_production',
                                         'published','covered','declined','withdrawn')),
  reason_code text null, reasons text[] not null default '{}', evidence jsonb not null default '[]',
  decided_by text null check (decided_by in ('engine','operator')), decided_at timestamptz null,
  cycle_plan_id uuid null, plan_item_id text null, scheduled_for date null,
  published_url text null, published_at timestamptz null,
  deferred_cycles int not null default 0,
  created_at, updated_at
)
index : (site_id, status), (campaign_id, status), (status, created_at), (client_id, created_at desc)
unique partiel : (site_id, keyword_normalized) where status in ('received','review','deferred','scheduled','in_production')
function submit_keyword_requests(...)  -- plafond et doublons sous verrou du site (ajout du L3)
function apply_keyword_verdicts(jsonb)  -- verdicts d'un lot, seulement sur les demandes `received` (ajout du L3)
RLS activé ; aucune politique
```

**Écarts assumés au L3** (26/11) :

- `keyword_normalized` est la **recherche** (mot-clé + ville quand le mot-clé ne la nomme pas) : « plombier » à
  Troyes et « plombier troyes » sont la même demande (règle 2).
- Règle 5 : avant `decideEditorialAction`, un **fait** — une page en ligne dont le mot-clé principal *est* la
  recherche la couvre, quelle que soit la fraîcheur de l'inventaire (une demande couverte ne réécrit rien).
  `decideEditorialAction` est ensuite appelé tel quel.
- Règle 4 : `GscPlanningSignals` porte désormais `wonQueries` (requête, page, position), la moitié « déjà gagnée »
  de `blockedQueries`, calculée au même seuil.
- Deux motifs « À l'étude » de plus : site **sans campagne** (`NO_CAMPAIGN`) et **avis du modèle indisponible**
  (`OPINION_UNAVAILABLE` : panne, crédit épuisé, réponse illisible). Jamais un refus, jamais une perte.
- La note du client (« pourquoi ») n'est **jamais** envoyée au modèle : seule la recherche, entre balises, est jugée.
- Une demande retirée date son retrait par `updated_at` (statut terminal), sans colonne de plus.

Rien ne change dans `cycle_plans` ni `editorial_calendar` : `client_request_id` vit dans l'item JSONB du plan,
et le lien créneau → brief existe déjà (`editorial_calendar.plan_item_id`). L'historique des statuts tient dans
les colonnes horodatées ; une table d'événements n'est ajoutée que si l'audit le demande (YAGNI).

Une migration s'écrit et se rejoue **d'abord en local** (remise à zéro, puis une seconde application pour prouver
son idempotence, puis `npm run test:db`), et ne s'applique en production qu'avant le merge de sa PR, comme
aujourd'hui. Ensuite : `node scripts/db-baseline.mjs` contre la production, puis `db/README.md`.

### 4.4 Identité et barrière

- **Opérateur** : inchangé en V1, HTTP Basic sur `APP_ACCESS_SECRET`, fermé par défaut, protection
  `Sec-Fetch-Site` sur les écritures.
- **Client** : Supabase Auth, OTP par e-mail, `shouldCreateUser: false` (seuls les invités reçoivent un code),
  invitation depuis la console. **Écart assumé au L1** : pas de `auth.admin.inviteUserByEmail` — un invité reste non confirmé, et une fois l'inscription coupée Supabase refuse de lui envoyer un code (vérifié en local le 26/11). L'invitation crée donc un compte **confirmé** (`auth.admin.createUser`) puis envoie le même e-mail de code que chaque connexion (`supabase/templates/code-connexion.html`). Révocation : `revoked_at`, puis blocage du compte Supabase (`ban_duration`), qui tue la session et coupe les codes. Cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- `proxy.ts` : `/espace`, `/api/espace`, `/auth` sont retirés du matcher Basic **par segment** (même forme
  `(?:/|$)` que l'exception du webhook), et reçoivent leur propre branche : rafraîchir la session, rediriger vers
  `/espace/connexion` sans session, refuser les écritures inter-sites. Le layout de l'espace et chaque route
  revérifient l'appartenance : trois contrôles, aucun ne suffit seul.
- Le chemin opérateur ne renvoie jamais de défi Basic sur `/espace` (sinon le navigateur du client afficherait la
  boîte de dialogue native).

### 4.5 Rendu

Server Components par défaut. Côté client seulement : le formulaire de demande (interface optimiste : la demande
apparaît aussitôt « Reçue — analyse en cours »), et un rafraîchissement toutes les 10 s **tant qu'une demande est
en analyse**, arrêté ensuite. Aucune donnée du client en cache partagé (`Cache-Control: no-store`, comme la
barrière actuelle).

### 4.6 Hébergement

Rien ne change : même image, même conteneur, même nginx, aucun vhost ajouté sur le VPS partagé. Côté Supabase
hébergé : URL du site et redirections vers `https://seo.cnx-solutions.fr/auth/callback`, SMTP personnalisé avec
l'expéditeur `contact@cnx-solutions.fr` (le compte SMTP du site CNX, dont les réglages vivent dans les variables
`SMTP_*` du serveur), modèles d'e-mail en français. Un client qui répond à un e-mail écrit donc à l'adresse de
contact de CNX : c'est voulu. La micro-coupure de ~10 s au déploiement touche désormais aussi les clients : déployer hors heures
ouvrées quand c'est possible.

### 4.7 Qualité et livraison

Chaque lot : une branche `feat/Lx-…`, une PR, la CI verte (`lint`, `typecheck`, `test`, et `test:db` dans son
job), les migrations appliquées en production **avant** le merge, la recette décrite dans la PR. Développement
**exclusivement** contre le Supabase local, jamais contre la production. Tests à chaque couche : domaine (verdict,
placement, cycle de vie, sans base), services (dépôt simulé), puis intégration contre le Supabase local (routes,
isolation, RLS, transaction), et le parcours complet en recette.

### 4.8 L'environnement local

| Élément | Choix |
|---|---|
| Outils | Docker Desktop (installé, à lancer) ; Supabase CLI à une version **épinglée dans `scripts/supabase.mjs`** (2.122.1), lancée par `npx`, même version sur le poste et en CI. Pas une `devDependency` : son postinstall téléchargerait le binaire à chaque build de l'image Docker |
| Services | API `127.0.0.1:54321` · Postgres `:54322` · Studio `:54323` · **Mailpit `:54324`**, qui reçoit les codes de connexion et les invitations : aucun SMTP en local |
| Schéma | Source unique inchangée : `db/000_baseline.sql` puis `src/adapters/infrastructure/database/migrations/*.sql`, appliqués par un script (`npm run db:local:reset`). **Aucun** `supabase/migrations/` : deux dossiers de migrations divergeraient à la première modification. `001` est écartée par son nom : la baseline la contient, elle n'est pas idempotente, et une migration jouée en production ne se modifie pas |
| Démonstration | `db/seed-local.sql` + création des membres par l'API d'administration locale : deux clients, trois sites **fictifs** (`*.test`, aucun identifiant WordPress ni jeton GitHub), campagnes **inactives**, un cycle en cours, des créneaux, des résultats Search Console, une demande dans chaque statut |
| `.env.local` | Pointe sur le local (URL et clés données par `npx supabase status`). Les accès à la production vivent dans un fichier séparé, ignoré par git, que seuls les scripts de migration lisent, et seulement avec `--prod` (décision 19) |
| Ce que le planificateur peut faire en local | Rien chez un vrai client : les sites de démonstration n'ont aucun identifiant de publication et les campagnes sont inactives. Une génération de test se lance à la main, et coûte des jetons d'IA réels |

---

## 5. Ce qu'il faut obtenir

| Élément | Pour quoi | Qui | Quand |
|---|---|---|---|
| Docker Desktop lancé sur le poste (le moteur Docker ne répondait pas le 25/11) | Supabase local | CNX | **L0** |
| Accès production sortis de `.env.local` vers le fichier réservé aux migrations (`--prod`) | `npm run dev` ne peut plus toucher la production | CNX, accompagné | **L0** |
| Réglages SMTP du site CNX (hôte, port, identifiant, mot de passe) reportés dans le SMTP personnalisé de **Supabase hébergé**, expéditeur `contact@cnx-solutions.fr` ; SPF, DKIM et DMARC du domaine vérifiés pour ce fournisseur | codes de connexion en production (le SMTP intégré de Supabase plafonne à quelques e-mails par heure), invitations, notifications | CNX | **L0** (une correction DNS se propage lentement) |
| Réglages Supabase Auth du projet hébergé : inscription publique **coupée** (Authentication > Sign In / Providers > « Allow new users to sign up » à off, fournisseur e-mail **laissé actif**), OTP 6 chiffres valable 1 h, Site URL `https://seo.cnx-solutions.fr`, modèle « Magic Link » = `supabase/templates/code-connexion.html` (objet « Votre code d'accès — CNX SEO Engine ») | ACC-2 | CNX (tableau de bord) | **avant le merge du L1** |
| Liste des premiers clients : nom, e-mail(s), site(s) | invitations, recette réelle | CNX | L2 |
| Relecture des libellés de verdict et des textes de l'espace | ton CNX, aucune promesse intenable | CNX | L3 |
| Lien « Confidentialité » (traitement de l'e-mail des membres) sur cnx-solutions.fr | RGPD | CNX | L1 |
| Logo : `cnx-solutions/brand/logo/cnx-mark.svg` et lockups | UX-3 | disponible | L0 |

---

## 6. Découpage en lots

Ordonnés par **risque** (sécurité d'abord, planificateur ensuite), puis par **valeur pour le client**. Chaque lot
= une branche, une PR, une CI verte, sa Definition of Done et sa recette. Tailles indicatives en jours de travail.

| Lot | Contenu | Couvre | Dépend de | Taille |
|---|---|---|---|---|
| **L0** | **L0a ✅ #30** (local, tests, RLS) · **L0b ✅ #31** (peau CNX). Socle : **Supabase local** (CLI épinglée, `config.toml`, remise à zéro, démo, `test:db`, job CI) ; scripts de migration ciblant le local par défaut ; jetons CNX, polices, marque, composants de base rhabillés, modale de confirmation ; vérification RLS (+ activation si besoin) ; CLAUDE.md à jour. Peut se scinder en L0a (local et tests) / L0b (peau CNX) | UX-1 à UX-4, UX-9, UX-10 (bases), QA-1, QA-4, QA-6, QA-7 | — | L · 4 j |
| **L1** | Identité client : tables `clients`/`client_members`, `@supabase/ssr`, branche de `proxy.ts`, connexion par code, invitation et révocation depuis les Réglages d'un site, pages d'erreur ; tests d'isolation, limites de débit | ACC-1 à ACC-7, QA-2, QA-3 | L0 | ✅ L1 (#32) |
| **L2** | Espace client en lecture : coquille mobile, accueil, pages en ligne, prochaines pages, sélecteur de site, **résultats Google**. Se scinde en L2a (lecture) / L2b (résultats) si la PR grossit | ESP-1 à ESP-6 | L1 | ✅ L2a (#33), L2b (#34) |
| **L3** | Demandes, saisie et verdict : table, domaine (verdict, cycle de vie), tâche d'analyse, formulaire, liste et chronologie, retrait. Les demandes recevables sont **toutes** gardées pour la période suivante (pas encore d'insertion dans le cycle en cours) | KW-1 à KW-3, KW-5 (verdict), KW-6 à KW-9 | L2 | ✅ L3 (#35) |
| **L4** | Demandes dans le moteur : extraction de `writeBriefForSubject` **sans changement de comportement** (PR à part), `swap_plan_item`, placement dans le cycle en cours, consommation au plan suivant, retour de publication | KW-4, KW-5, KW-8, KW-11, KW-13 | L3 | L · 4 j |
| **L5** | Console opérateur des demandes et coquille : file, arbitrage, compteur dans le rail, onglet « Demandes » d'un site, rail et en-tête de site refaits, glossaire | KW-10, UX-5, UX-6 | L3 | M · 3 j |
| **L6** | Refonte des écrans opérateur, un par un : tableau de bord, vue d'ensemble, stratégie, calendrier, publication, performances, pages, réglages — styles en ligne retirés, états, mouvement, graphiques, écrans hérités. Peut se scinder en L6a / L6b | UX-6 à UX-12 | L0, L5 | L · 5-6 j |
| **L7** | E-mails : file d'envoi asynchrone traitée par le planificateur, modèles à la DA, désinscription des notifications | KW-12 | L3, SMTP | S · 2 j |

**Après la V1** : relecture des pages par le client avant publication, connexion opérateur par compte (fin de la
barrière Basic), « voir comme le client » pour le support, mode sombre.

**Ce qu'on coupe si le délai serre** : L6 se livre par écran, dans l'ordre d'usage ; L7 attend (l'espace client
suffit à informer) ; l'envoi de plusieurs mots-clés d'un coup et la date souhaitée (KW-1) passent après la V1 ;
ESP-3 se réduit à une liste sans détail ; ESP-5 se réduit aux deux chiffres et à la courbe (les classements de
pages et de recherches attendent).

**Ce qui ne se coupe jamais** : le cloisonnement et ses tests (ACC-3, QA-2) ; la vérification RLS (QA-1) ; la
barrière fermée par défaut ; la transaction de `swap_plan_item` ; l'instance unique ; le Supabase local et les
tests d'intégration (QA-6, QA-7) ; aucun secret ni jargon dans ce que voit le client ; le contraste AA.

---

## 7. Décisions à prendre

Une recommandation non contestée s'applique par défaut. Une décision tranchée devient « ✅ … (décidé le JJ/MM) ».

| # | Question | Recommandation |
|---|---|---|
| 1 | Qui tranche : le moteur seul, ou CNX valide chaque demande ? | ✅ **Le moteur tranche** les cas nets (déjà prévue, déjà couverte, recevable) ; tout ce qui est ambigu (zone, métier) part à CNX ; CNX peut renverser n'importe quel verdict tant que la page n'est pas en rédaction (décidé le 25/11) |
| 2 | Que voit le client en V1 ? | ✅ Ses demandes, le suivi de sa campagne en lecture (période, pages prévues, pages en ligne) **et ses résultats Google** (ESP-5, dans le L2) (décidé le 25/11) |
| 3 | Comment le client se connecte-t-il ? | ✅ **Code à 6 chiffres par e-mail** (Supabase Auth, sans mot de passe), sur invitation seulement. Un code se tape sur le téléphone sans changer de navigateur, là où un lien s'ouvre souvent dans le navigateur de l'application de messagerie (décidé le 25/11) |
| 4 | Quelle part d'un cycle pour les demandes client ? | **Un tiers** des créneaux au plus ; le surplus attend le cycle suivant, sans perte |
| 5 | Une demande intégrée au cycle en cours remplace-t-elle une page prévue ou s'ajoute-t-elle ? | **Elle remplace** une page non entamée, hors pilier : volume, fréquence et coût du cycle inchangés |
| 6 | « Hors métier » : qui en juge ? | Un petit modèle rend un avis ; un avis `out` ou `unsure` envoie à CNX, jamais un refus automatique |
| 7 | La connexion de l'opérateur change-t-elle ? | **Non en V1** : la barrière Basic reste, elle est éprouvée ; un compte opérateur après la V1 |
| 8 | Où vit l'espace client ? | **Même domaine**, chemin `/espace` : aucun vhost ni certificat à ajouter sur le VPS partagé |
| 9 | CSS : Tailwind ou jetons + composants ? | **Jetons + composants**, la convention en place (`tokens.css`, `globals.css`, `ui.tsx`). Tailwind 4 est installé mais pratiquement inutilisé ; y migrer serait une réécriture sans valeur pour l'utilisateur |
| 10 | Validation des entrées | `zod` épinglé, pour les nouvelles routes ; les routes existantes ne sont pas réécrites |
| 11 | Mode sombre | Hors V1 ; le bloc sombre de `tokens.css` n'est plus maintenu, on le retire au L0 plutôt que de le laisser mentir |
| 12 | Nom affiché | **CNX SEO Engine** — le nom déjà montré sur le site et dans le film de présentation |
| 13 | Ordre : espace client d'abord, ou refonte complète d'abord ? | ✅ **Jetons CNX dès le L0** (tout le projet change de peau d'un coup), puis l'espace client (L1-L4), puis la refonte écran par écran (L5-L6) (décidé le 25/11) |
| 14 | Échéance de la V1 | À fixer. Sans date, l'ordre ci-dessus fait foi |
| 15 | Livraison de ces documents | Branche `docs/cadrage-espace-client` (créée depuis `main`), PR « docs: cadrage espace client » après validation |
| 16 | Où développer et tester ? | ✅ **Supabase en local** pour le développement, tous les tests et la recette ; la production n'est touchée que pour appliquer une migration avant un merge (décidé le 25/11) |
| 17 | Quel expéditeur pour les e-mails ? | ✅ **`contact@cnx-solutions.fr`**, par le compte SMTP du site CNX (décidé le 25/11) |
| 18 | Les tests d'intégration tournent-ils en CI ? | Oui, dans un **job séparé** de `ci.yml` (Supabase CLI + `supabase start` sur le runner, ~2 min), sur les PR seulement : le cloisonnement ne se vérifie pas qu'à la main. `deploy.yml` n'est pas alourdi, une PR n'est mergée que verte |
| 19 | Comment un script de migration atteint-il la production ? | ✅ Il vise le **local par défaut** ; la production exige `--prod=<ref-du-projet>`, lit `.env.prod-db` (ignoré par git, jamais chargé par Next.js, contrairement à `.env.production.local`) et refuse si la ref tapée n'est pas celle du fichier. `db-reset-data` refuse la production, `db-baseline` n'accepte qu'elle (appliqué au L0a, #30) |

---

## 8. Risques

| Risque | Parade |
|---|---|
| Un client lit les données d'un autre (bug de cloisonnement) | Un seul module de portée, DTO à colonnes listées, test d'isolation par route, revue sécurité du L1 avant merge |
| Tables sans RLS alors que l'URL Supabase est publique | Script de vérification au L0 ; activer le RLS sans politique ne gêne rien, la clé de service le contourne |
| Course entre le planificateur et l'insertion d'une demande | `swap_plan_item` transactionnelle avec verrous ; créneau réclamé → créneau suivant, sinon report |
| Le planificateur, modifié, se met à mal planifier | Extraction de `writeBriefForSubject` dans une PR **sans changement de comportement**, couverte par les 1 283 tests existants ; la fonctionnalité vient ensuite |
| Double publication si quelqu'un « scale » l'application | Inchangé et rappelé : la nouvelle tâche vit dans le même cron ; instance unique (CLAUDE.md) |
| Le client attend une page qui ne vient pas | Chaque verdict dit ce qui va se passer et quand ; report sans perte ; au-delà de 3 cycles d'attente, CNX est alerté |
| Demandes en masse ou hors sujet | Plafonds (§ 3.8), arbitrage CNX, quota d'un tiers par cycle |
| Coût de l'analyse | Règles déterministes d'abord ; un seul petit appel de modèle par demande recevable ; le brief n'est rédigé que si la demande prend un créneau, dont la rédaction était déjà budgétée |
| Codes de connexion en spam ou bloqués par le quota Supabase | SMTP personnalisé, SPF/DKIM/DMARC configurés au L0 ; code, pas seulement lien |
| La refonte visuelle casse un écran opérateur | Noms de jetons et alias conservés ; captures avant/après de chaque écran au L0 ; refonte profonde par lots (L5, L6) |
| Le jargon interne fuit chez le client | Libellés client dans un module unique, DTO séparés, case de recette « aucun terme technique » |
| `npm run dev` ou un script touche la production par erreur | `.env.local` pointe sur le Supabase local ; les accès production ne sont lus que par les scripts de migration, avec `--prod` (décision 19) |
| Le schéma local diverge de la production | Le local se reconstruit **depuis** la baseline et les migrations ; la baseline se régénère après toute modification faite dans le tableau de bord (règle existante) ; `test:db` rejoue le tout en CI |
| Le Supabase local ne se comporte pas comme l'hébergé (version de Postgres, d'Auth) | CLI épinglée ; `major_version` de Postgres alignée sur la production dans `config.toml` ; recette finale de chaque lot touchant l'authentification vérifiée aussi en production, sur un compte de test |
| Docker arrêté : `test:db` échoue | Le script le dit en une ligne (« lancez Docker Desktop ») ; les 1 283 tests unitaires restent indépendants de toute base |
| Données de démonstration qui publieraient pour de vrai | Sites fictifs en `.test`, aucun identifiant de publication, campagnes inactives : le planificateur local n'a nulle part où écrire |
| Vitest échoue sous Git Bash quand le lecteur est en minuscule (`c:/…`) : 79 fichiers en échec, « Cannot read properties of undefined (reading 'config') » | Lancer les tests depuis PowerShell, ou `cd /C/laragon/...` ; noté dans CLAUDE.md |
| CLAUDE.md dit 889 tests, il y en a 1 283 | Corrigé avec ce cadrage |
