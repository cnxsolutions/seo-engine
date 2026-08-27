# SEO Engine

Moteur de publication SEO autonome. On y connecte ses sites (WordPress ou
Next.js), on decrit une campagne, et le moteur redige puis publie des pages
optimisees, tout seul, selon un calendrier editorial.

Ce n'est pas un SaaS. Il n'y a ni compte, ni organisation, ni client : **un seul
operateur, ses propres sites**. Cette decision structure tout le reste — pas de
multi-locataire, pas de RLS par tenant, pas d'onboarding.

---

## Table des matieres

1. [Ce que fait le produit](#1-ce-que-fait-le-produit)
2. [Prerequis](#2-prerequis)
3. [Installation locale](#3-installation-locale)
4. [Configuration des variables](#4-configuration-des-variables)
5. [Migrations SQL](#5-migrations-sql)
6. [Lancer en developpement](#6-lancer-en-developpement)
7. [Deployer sur le VPS](#7-deployer-sur-le-vps)
8. [Verifier que le planificateur tourne](#8-verifier-que-le-planificateur-tourne)
9. [Architecture](#9-architecture)
10. [Limites connues](#10-limites-connues)

---

## 1. Ce que fait le produit

Le cycle complet, du site connecte a la page en ligne :

1. **Connecter un site.** WordPress (URL + identifiant + mot de passe
   d'application) ou Next.js (depot GitHub + jeton). Optionnellement, brancher
   Google Search Console et Google Business Profile pour nourrir la redaction de
   donnees reelles.
2. **Creer une campagne.** Metier, zone geographique, mots-cles, types de pages,
   longueur cible, modele IA, recurrence, publication automatique ou brouillon.
3. **Generer un plan de briefs.** Le moteur analyse le site existant, evite les
   doublons, et produit une liste de briefs — un par page a ecrire.
4. **Derouler un calendrier editorial.** Chaque brief recoit une date, un type de
   page, un mot-cle et une commune.
5. **Le jour J, generer.** Le planificateur repere les creneaux echus, construit
   un contexte (taxonomies du site, concurrents, donnees Google, recherche
   vectorielle sur le contenu existant), et fait rediger l'IA en respectant le
   brief. La page complete est persistee — HTML, JSON-LD, FAQ, maillage interne.
6. **Publier.** Sur WordPress via l'API REST, sur Next.js via un commit GitHub.
   Puis notifier les moteurs de recherche (IndexNow, ping sitemap, API Indexing).

Tout cela se pilote depuis un tableau de bord web, mais le deroule quotidien
n'exige aucune intervention : c'est le planificateur interne qui l'execute.

Ce planificateur ne s'allume pas tout seul, et c'est delibere : il ne demarre
que si `ENABLE_SCHEDULER=true`. Une instance fraichement installee sert des
pages, accepte des campagnes et ne publie **rien** chez personne tant que ce
drapeau n'a pas ete pose. La procedure pour le poser en connaissance de cause
est en [section 7](#7-deployer-sur-le-vps).

---

## 2. Prerequis

| Prerequis | Version | Pourquoi |
|---|---|---|
| Node.js | 20.9+ (22 LTS conseille) | exige par Next.js 16 |
| npm | 10+ | `npm ci` s'appuie sur `package-lock.json` |
| Docker + Docker Compose v2 | — | uniquement pour le deploiement VPS |
| Un projet Supabase | Postgres 15+ avec `pgvector` | persistance et magasin vectoriel |
| Une cle OpenAI | — | redaction et **embeddings** (obligatoire meme en 100 % Claude) |

Optionnels, selon ce que vous activez : une cle Anthropic, un client OAuth
Google, un compte de service Google pour l'API Indexing.

Le projet est ecrit en TypeScript strict, avec React 19, Tailwind 4 et le React
Compiler active.

---

## 3. Installation locale

```bash
git clone <url-du-depot> seo-engine
cd seo-engine
npm ci
cp .env.example .env.local
```

Puis remplir `.env.local` (section suivante) et appliquer les migrations
(section 5).

`npm ci` plutot que `npm install` : il installe exactement l'arbre du lockfile,
ce qui evite les « ca marche chez moi ».

---

## 4. Configuration des variables

Le fichier de reference est [`.env.example`](.env.example) : chaque variable y
est documentee — a quoi elle sert, ou l'obtenir, si elle est obligatoire, et ce
qui casse sans elle. Il est le seul `.env*` commite ; tous les autres sont
ignores par git.

- **en local** → copier vers `.env.local`
- **en conteneur** → copier vers `.env`, lu par `env_file` dans
  `docker-compose.yml`

La liste complete, telle que le code la lit a l'execution. N'y figurent pas :
`NEXT_RUNTIME` et `NODE_ENV` (injectes par Next.js), `BUILD_STANDALONE` (lue au
**build** par `next.config.ts`, posee par le Dockerfile) et `SITE` (outils
manuels de `scripts/`).

| Variable | Statut | Sans elle |
|---|---|---|
| `ENABLE_SCHEDULER` | **obligatoire pour que le moteur agisse** | le serveur web tourne et **rien ne part tout seul** : ni generation, ni publication, ni crawl. Seule la chaine `true` allume ; toute autre valeur eteint. C'est l'etat sur, et l'etat par defaut du modele |
| `OPENAI_API_KEY` | **obligatoire** | `/api/generate` repond 500 ; les embeddings du magasin vectoriel echouent, donc tout le RAG
| `NEXT_PUBLIC_SUPABASE_URL` | **obligatoire** | chaque appel base leve « NEXT_PUBLIC_SUPABASE_URL is required. » — tableau de bord, API et cron sont morts |
| `SUPABASE_SERVICE_ROLE_KEY` | **obligatoire** | idem : plus aucune lecture ni ecriture |
| `ANTHROPIC_API_KEY` | obligatoire si un modele `claude-*` est utilise | les campagnes en `claude-*` passent en `failed` ; celles en `gpt-*` continuent |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | optionnelle (inerte aujourd'hui) | rien, tant qu'aucun composant client n'attaque Supabase |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optionnelles | impossible de connecter GSC / GBP ; la generation continue sans contexte Google |
| `GOOGLE_REDIRECT_URI` | optionnelle en local, **obligatoire en production** | Google renvoie vers `localhost`, la connexion d'un site n'aboutit jamais |
| `GOOGLE_INDEXING_CREDENTIALS` | optionnelle | l'API Indexing de Google est sautee ; IndexNow et le ping sitemap continuent |
| `INDEXNOW_KEY` | optionnelle | Bing / Yandex / Seznam / Naver ne sont pas prevenus ; la publication reussit |
| `SEO_DUPLICATE_GATE` | optionnelle (`observe` par defaut) | rien : le gate anti-duplication mesure et laisse passer. Seul `block` retient une page trop proche d'une page existante |
| `TZ` | **obligatoire en conteneur** | le cron part a la mauvaise heure et le « jour J » bascule au mauvais moment |
| `PORT` / `HOSTNAME` | optionnelles | defauts `3000` et `0.0.0.0`, deja fixes dans le Dockerfile |

Aucune variable n'est necessaire au moment du **build** — verifie : `npm run
build` passe sur un depot depourvu de tout fichier `.env`. Tout est lu a
l'execution.

---

## 5. Migrations SQL

Les migrations vivent dans `src/adapters/infrastructure/database/migrations/`.
La procedure complete, l'ordre d'application et la maniere de sauvegarder le
schema sont dans **[`db/README.md`](db/README.md)**.

En resume :

```bash
MIG=src/adapters/infrastructure/database/migrations
psql "<CONNECTION_STRING>" -f $MIG/001_schema_federation.sql
psql "<CONNECTION_STRING>" -f $MIG/005_add_vector_store.sql
psql "<CONNECTION_STRING>" -f $MIG/006_generation_page_payload.sql
psql "<CONNECTION_STRING>" -f $MIG/007_scheduler_reliability.sql
```

Ou, plus simplement, en collant chaque fichier dans le *SQL Editor* du tableau
de bord Supabase.

> **A lire avant de croire que cela suffit.** Le depot contient `001`, `005`,
> `006` et `007`. Les migrations `002`, `003` et `004` sont absentes, et **12
> des 19 tables interrogees par le code ne sont creees par aucun fichier du
> depot** — dont `sites`, `campaigns`, `generations` et `editorial_calendar`,
> c'est-a-dire le coeur du produit. Elles ont ete creees a la main dans
> Supabase, a une epoque ou `.gitignore` ignorait `supabase/`. Le fichier
> `lib/types.ts` s'ouvre encore sur un commentaire renvoyant a
> `supabase/schema.sql`, un fichier qui n'a jamais existe dans le depot.
>
> Consequence pratique : `006` et `007` sont des `ALTER TABLE` sur des tables
> que le depot ne cree pas. Sur une base reellement vierge, ils echouent.
>
> **Consequence : on ne peut pas encore reconstruire la base a partir du code.**
> La premiere chose a faire, avant toute autre, est de produire la baseline
> decrite en [section 4 de `db/README.md`](db/README.md#4-exporter-le-schema-de-production-en-baseline-versionnee).
> Tant qu'elle n'existe pas, perdre l'instance Supabase revient a perdre le
> produit.

---

## 6. Lancer en developpement

```bash
npm run dev          # http://localhost:3000 — redirige vers /dashboard
npm run build        # build de production
npm start            # sert le build de production
npm run lint         # ESLint
npm test             # Vitest
```

**Le planificateur ne demarre pas en developpement, sauf demande explicite.**
`instrumentation.ts` consulte `ENABLE_SCHEDULER` avant meme d'importer le graphe
du planificateur : absente de votre `.env.local` — et elle l'est, puisque
`.env.example` la porte a `false` — le serveur Node se leve, le tableau de bord
fonctionne, et aucun cron n'est arme. Vous lirez au demarrage :

```
[instrumentation] Planificateur ETEINT : ENABLE_SCHEDULER absente ou differente de "true". ...
```

C'est l'etat attendu d'un poste de developpement, pas une panne.

> **Si vous posez `ENABLE_SCHEDULER=true` en local, lisez d'abord d'ou vient
> votre `.env.local`.** Un poste pointe sur la base de **production** devient
> une seconde instance : il publie pour de vrai, chez les vrais clients, en
> concurrence avec le VPS. La reclamation atomique des creneaux et des
> publications empeche qu'une meme page sorte deux fois (voir l'encadre
> « instance unique » en section 7), mais elle ne protege ni le job de campagne
> ni le renouvellement de cycle : vous declencheriez un second crawl et un
> second plan sur les memes campagnes. Travaillez sur une base Supabase separee.

---

## 7. Deployer sur le VPS

### Cible assumee

Un VPS **toujours allume**, **un seul conteneur**. Le planificateur node-cron
tourne dans le process Next.js ; il n'y a pas de declencheur externe. Cela
impose deux choses :

- l'application ne doit **jamais** s'endormir (pas de plateforme serverless, pas
  de scale-to-zero : un process endormi ne declenche aucun cron) ;
- il ne doit **jamais** y avoir deux instances simultanees.

> **⚠ Instance unique, sans exception — et pas pour la raison qu'on croit.**
>
> Le garde-fou d'idempotence `runningJobs` (`lib/scheduler/cron.ts`) est une
> `Map` en memoire : il empeche deux executions du meme job **dans un process**,
> et rien d'autre. Deux conteneurs sur la meme base font donc tourner deux crons
> qui ne se voient pas.
>
> **Ce qu'un second process ne dupliquerait PAS.** Les creneaux editoriaux et
> les publications sont proteges en base, pas en memoire : `claimEditorialSlot`
> et `claimGenerationForPublishing` (`lib/scheduler/editorial.ts`) sont des
> compare-and-swap — exactement un runner obtient le creneau, le perdant passe
> au suivant. Une meme page ne sort donc pas deux fois, meme a deux process.
>
> **Ce qu'il dupliquerait reellement, ce sont les deux jobs sans reclamation :**
>
> - le **job de campagne** — `runDueCampaigns` prend `listDueCampaigns`
>   (`lib/db.ts:243-254`, un `SELECT` nu sur `next_run_at <= now`) et se protege
>   par `runWithConcurrencyControl('campaign_<id>')` (`cron.ts:1198-1203`),
>   c'est-a-dire par la `Map` locale au process. Deux process = deux analyses et
>   deux plans concurrents sur la meme campagne ;
> - le **renouvellement de cycle** — `checkCycleCompletion` lit
>   `getCampaignsWithExpiringCycles` (`lib/db.ts:514-524`, `SELECT` nu lui
>   aussi), sans reclamation **et sans plafond** de rattrapage, contrairement
>   aux creneaux et aux campagnes. Deux process = **deux crawls de 300 pages
>   simultanes contre le serveur du client**, deux factures d'embeddings, et
>   deux reecritures du meme calendrier editorial.
>
> C'est cette contrainte-la qu'il ne faut pas relacher en croyant proteger les
> creneaux : les creneaux, eux, sont deja proteges. Interdits : `--scale`,
> `replicas > 1`, Swarm, Kubernetes, et tout deploiement « rolling » faisant
> cohabiter ancien et nouveau conteneur. `docker-compose.yml` fixe
> `container_name`, ce qui rend la mise a l'echelle mecaniquement impossible :
> c'est voulu, et c'est le garde-fou a conserver.

### Premier demarrage — la procedure, et pourquoi cet ordre

Le planificateur n'ecrit pas dans un bac a sable : il depense des tokens et il
publie sur les sites de clients reels. Il ne demarre donc que si
`ENABLE_SCHEDULER` vaut exactement `true` — toute autre valeur, y compris
l'absence, laisse le moteur eteint (`lib/scheduler/enabled.ts`).

Les six etapes ci-dessous servent a **arriver a ce `true` en sachant ce qu'il
declenche**, plutot qu'a le decouvrir. L'ordre n'est pas decoratif : chaque
etape produit l'information qui rend la suivante decidable, et **(d) et (e)
doivent etre terminees avant (f)** — apres (f), le premier tick tombe dans les
15 minutes, et rien de ce qu'il fait ne se defait.

#### (a) Demarrer moteur eteint

```bash
git clone <url-du-depot> seo-engine
cd seo-engine
cp .env.example .env      # ENABLE_SCHEDULER=false y est deja : ne pas y toucher
                          # remplir toutes les AUTRES valeurs
docker compose up -d --build
docker compose logs -f seo-engine
```

**Pourquoi d'abord.** L'image, le reseau, le reverse proxy, le secret d'acces et
la connexion Supabase se verifient tous sans qu'une seule page ne parte. Un
premier demarrage rate est ainsi un incident de deploiement, pas un incident
client. Attendu dans les journaux — **ce n'est pas une panne** :

```
[instrumentation] Planificateur ETEINT : ENABLE_SCHEDULER absente ou differente de "true". ...
```

#### (b) Lire le pre-vol

```bash
curl -s -H "X-App-Secret: $APP_ACCESS_SECRET" http://127.0.0.1:3000/api/preflight
```

**Pourquoi maintenant.** Cette route **lit** : elle n'arme aucun cron, ne genere
rien et ne publie rien. Elle se consulte donc autant de fois qu'on veut, avant
d'allumer, et c'est le seul endroit ou l'on voit *a la fois* la configuration et
ce que la base contient. Elle repond deux choses.

**Les controles nommes** de [`lib/config/preflight.ts`](lib/config/preflight.ts),
chacun avec son niveau et le bug qu'il empeche :

| Controle | Niveau | Ce que son echec provoque |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | bloquant | le client de service leve avant la premiere lecture : chaque tick se termine sans avoir rien lu ni rien ecrit, et se journalise comme un tick reussi |
| `SUPABASE_SERVICE_ROLE_KEY` | bloquant | idem, plus aucune ecriture serveur : ni reclamation de creneau, ni enregistrement de generation |
| `OPENAI_API_KEY` | bloquant | **detruit un calendrier** : la generation leve *a l'interieur* du creneau deja reclame, la tentative est comptee, et au troisieme tick le creneau passe `failed`. 45 minutes suffisent. Obligatoire meme en 100 % Claude (embeddings) |
| `APP_ACCESS_SECRET` | bloquant | toute l'interface repond 503 pendant que le cron, lui, continue de publier chez les clients |
| `ANTHROPIC_API_KEY` | recommande | une fonction pure ne peut pas trancher : c'est la route qui croise `campaigns.ai_model` avec la presence de la cle. Les campagnes `claude-*` echouent comme avec une cle OpenAI manquante ; les `gpt-*` ne sont pas concernees |
| `WORDPRESS_WEBHOOK_SECRET` | recommande | aucun statut de publication ne remonte : les pages partent, le moteur les croit non publiees, et peut republier sur un etat faux |
| `TZ` | recommande | hors Docker : le « jour J » du calendrier bascule au mauvais moment |

Si un **bloquant** echoue, `instrumentation.ts` refusera de demarrer le cron
meme avec `ENABLE_SCHEDULER=true`, et le dira une ligne par controle. Corrigez
avant de continuer : les etapes suivantes n'ont pas de sens sur une instance qui
ne pourra pas demarrer.

#### (c) Lire les comptes : ce que le prochain tick ferait vraiment

La meme reponse porte les comptes du travail **deja echu**. Ce ne sont pas des
indicateurs : c'est la liste de ce qui part dans le quart d'heure suivant (f).

| Compte | Ce que le tick en fait |
|---|---|
| **creneaux editoriaux echus** | une generation reelle chacun, tokens factures, plafonne a 10 par tick (`MAX_CATCHUP_SLOTS_PER_RUN`, `cron.ts:96`). Le reste passe aux ticks suivants — le plafond etale la depense, il ne l'annule pas |
| **campagnes echues** (`next_run_at <= maintenant`) | le job de campagne complet : analyse, plan, calendrier. Plafonne a 10 par tick (`MAX_CAMPAIGNS_PER_RUN`) |
| **campagnes `auto_publish = true`** | **c'est la ligne dangereuse.** Leurs pages partent SEULES sur le site du client, par les deux chemins : la publication en ligne du job (`cron.ts:1629`) et la file differee |
| **file de publication differee** | les generations `status = 'generated'`, `intent = 'create'` dont la campagne porte `auto_publish` (`lib/db.ts:335-346`), 10 par tick. Le filtre `intent = 'create'` est ce qui garantit qu'aucun **rafraichissement** ne part seul |
| **cycles a renouveler** | **le plus couteux des trois jobs, et le plus facile a oublier.** Un cycle `executing` echu sur une campagne `cycle_auto_renew` declenche `endCycleAndStartNew` : un **crawl de 300 pages contre le serveur de production du client** (`lib/scheduler/cycle-manager.ts:62-66`), puis l'indexation par embeddings, puis un appel modele, puis la **suppression et la reecriture du calendrier editorial** de la campagne. `getCampaignsWithExpiringCycles` (`lib/db.ts:514-524`) n'a **ni reclamation ni plafond** : les cycles echus partent tous, dans le meme tick |

> Une raison de plus de compter cette derniere ligne avant d'allumer :
> `cycle-manager.ts:54` marque le cycle `completed` **avant** de faire le
> travail. Si le crawl echoue ou si le plan revient vide, la campagne reste
> accrochee a un cycle clos sans nouveau plan — et comme la requete filtre
> `status = 'executing'`, elle ne sera **jamais** revue. C'est une porte a sens
> unique, sur des campagnes clientes reelles.

#### (d) Repousser les creneaux echus qu'on ne veut pas voir partir

**Ce geste existe a l'ecran.** L'ecran calendrier appelle
`PATCH /api/calendar/<id>`, qui accepte `scheduled_date`
([`app/api/calendar/[id]/route.ts:19-24`](app/api/calendar/[id]/route.ts)) :

```bash
curl -s -X PATCH -H "X-App-Secret: $APP_ACCESS_SECRET" \
     -H 'Content-Type: application/json' \
     -d '{"scheduled_date":"2026-09-30"}' \
     http://127.0.0.1:3000/api/calendar/<id-du-creneau>
```

Reculer la date sort le creneau du lot « echu » : au premier tick, il n'est plus
du. C'est la facon **reversible** de reprendre la main, creneau par creneau,
sans toucher au drapeau global.

**Pourquoi `status` n'est pas modifiable par la meme route.** Cette colonne
appartient au planificateur, qui la deplace par compare-and-swap
(`claimEditorialSlot` / `releaseEditorialSlot`) precisement pour qu'un seul
runner possede un creneau. Une ecriture aveugle rendrait a `planned` un creneau
en cours de generation — il serait produit deux fois — ou remettrait a zero le
budget de tentatives d'un creneau casse, qui brulerait alors des tokens
indefiniment. Meme motif pour `attempt_count`, `campaign_id` et
`generation_id`. Les champs acceptes sont `scheduled_date`, `page_type`,
`target_keyword` et `target_city`, et rien d'autre.

#### (e) Couper la publication autonome — en SQL, il n'y a pas de bouton

**Ne cherchez pas ce reglage dans l'interface : il n'y existe pas.**
`auto_publish` n'est ecrit qu'a la **creation** d'une campagne
(`app/api/campaigns/route.ts:45`, alimente par la case a cocher de
`app/(dashboard)/strategy/new/page.tsx:445`). `app/api/campaigns/[id]/route.ts`
n'expose que `GET` : ni `PATCH`, ni `PUT`. Aucun ecran n'affiche ni ne modifie
ce champ sur une campagne existante.

Le geste reel est un `UPDATE` depuis le *SQL Editor* de la console Supabase :

```sql
-- Reperer les campagnes qui publieraient seules
select id, name, auto_publish from campaigns where auto_publish = true;

-- Fermer la vanne, une campagne a la fois
update campaigns set auto_publish = false where id = '<id>';
```

Ce geste est honore par **les deux** chemins de publication, ce qui est ce qui
le rend suffisant : la publication en ligne du job de campagne teste
`campaign.auto_publish` (`lib/scheduler/cron.ts:1629`), et la file differee
filtre `campaign.auto_publish = true` (`lib/db.ts:342`). Une campagne remise a
`false` continue de **generer** — les pages sont produites et visibles dans
l'ecran de publication — mais plus rien ne part sans qu'un humain le demande.

> **Pourquoi cette verite est ecrite noir sur blanc.** Un README qui dirait
> « couper depuis l'ecran » enverrait l'operateur chercher un bouton inexistant
> au moment le plus dangereux de la procedure. Il lui resterait alors
> `ENABLE_SCHEDULER`, c'est-a-dire tout ou rien : ne pas ouvrir, ou ouvrir
> **avec** la publication autonome armee.
>
> L'ajout d'un `PATCH` sur les campagnes est une surface d'ecriture nouvelle sur
> la colonne la plus dangereuse du produit. Elle merite son propre chantier, pas
> une ligne glissee dans celui-ci.

#### (f) Seulement alors, allumer

```bash
# dans .env
ENABLE_SCHEDULER=true

docker compose up -d          # recree le conteneur avec le nouvel environnement
docker compose logs -f seo-engine
```

`ENABLE_SCHEDULER` est lue **au demarrage du process**, par `instrumentation.ts`
avant tout import du planificateur : la changer dans `.env` n'a aucun effet
tant que le conteneur n'est pas recree. Attendu, dans les secondes qui suivent :

```
[INFO] [scheduler] Initializing SEO Engine job scheduler { timezone: 'Europe/Paris', ... }
[INFO] [scheduler] All cron jobs scheduled successfully
```

**Comptez le quart d'heure et relisez les journaux du premier tick** (section 8,
point B). C'est l'unique execution du chemin complet dont vous ayez la certitude
de connaitre l'heure — apres, elle se noie dans les 96 ticks du jour.

### Mettre a jour

```bash
git pull
docker compose up -d --build   # recree le conteneur, ne le double pas
```

### Ce que le Dockerfile fait

Build multi-etapes : `deps` (installation depuis le lockfile) → `builder`
(`next build`) → `runner` (image finale). Seule la sortie `standalone` de Next
est copiee dans l'image finale, avec `public/` et `.next/static/` : pas de
`node_modules` complet, pas de sources, pas de secret. Le conteneur tourne sous
l'utilisateur non-root `node`.

> **`output: 'standalone'` est conditionnel, et c'est voulu.** `next.config.ts`
> ne l'active que si `BUILD_STANDALONE=1`, ce que l'etape `builder` du Dockerfile
> positionne. Raison : le tracage standalone ne peut pas s'achever sur Windows —
> Turbopack emet des chunks nommes `[externals]_node:fs_<hash>._.js`, NTFS
> interdit le `:` dans un nom de fichier, la copie echoue en `EINVAL` et le build
> laisse ce chunk hors de l'arbre standalone en se contentant d'un avertissement.
> Sur Linux le nom est legal. Consequence pratique : `npm run build` reste sans
> aucun avertissement sur un poste de developpement, et l'image Docker obtient
> quand meme une sortie standalone complete. Le Dockerfile verifie ensuite la
> presence de `.next/standalone/server.js` plutot que de produire une image
> silencieusement cassee.

### Fuseau horaire

`TZ=Europe/Paris` est fixe dans `docker-compose.yml` **et** dans le Dockerfile,
et le paquet `tzdata` est installe dans l'image. Ce n'est pas cosmetique :
node-cron planifie sur l'heure **locale** du process. Un conteneur laisse en UTC
decale toutes les expressions cron (la synchro Search Console de 4h00 partirait
a 5h00 heure de Paris en ete) et fait basculer le « jour J » du calendrier
editorial au mauvais moment — les generations partent le mauvais jour.

### Reseau et securite

Le service ecoute sur `127.0.0.1:3000` uniquement.

**L'application est fermee par un secret partage unique.** `proxy.ts` compare
`APP_ACCESS_SECRET` en temps constant devant toutes les pages et toutes les
routes `/api`, a la seule exception de `/api/webhook/wordpress`, qui verifie son
propre `WORDPRESS_WEBHOOK_SECRET`. Sans `APP_ACCESS_SECRET` — ou avec une valeur
de moins de 16 caracteres — l'application entiere repond `503` : la barriere
refuse de tourner plutot que de s'ouvrir. Il n'y a ni compte, ni session, ni page
de connexion : le navigateur affiche sa propre fenetre (HTTP Basic, identifiant
quelconque, ce secret en mot de passe) ; les scripts envoient `X-App-Secret:` ou
`Authorization: Bearer`. `next-auth` reste dans les dependances sans etre branche
nulle part, et peut etre desinstalle.

> **Deux consequences a ne pas negliger.**
>
> 1. Le Basic transmet le secret en base64, qui est reversible : le reverse proxy
>    (Caddy, nginx) **doit** servir en HTTPS, et le binding **doit** rester sur
>    `127.0.0.1`.
> 2. Avant cette fermeture, `GET /api/sites` et `GET /api/campaigns` renvoyaient
>    les lignes brutes de `sites` : mots de passe d'application WordPress et
>    jetons GitHub en clair, sur une API ouverte. Les projections de `lib/db.ts`
>    ont ferme la porte, mais **tout identifiant deja stocke doit etre considere
>    comme compromis** : revoquez chaque Application Password cote WordPress,
>    chaque PAT cote GitHub, recreez-les et ressaisissez-les.

Si vous connectez Google, le proxy doit servir un domaine public en HTTPS, et
`GOOGLE_REDIRECT_URI` doit valoir `https://<votre-domaine>/api/google/callback`,
declare a l'identique dans la console Google Cloud.

---

## 8. Verifier que le planificateur tourne

**Trois instruments, trois questions differentes. Ne les confondez pas :**

| Instrument | Question | Quand |
|---|---|---|
| `GET /api/preflight` | *que ferait le prochain tick ?* | **AVANT** — il lit, il ne declenche rien, il se consulte a volonte |
| les journaux | *qu'a fait le tick qui vient de passer ?* | **APRES** — c'est le seul temoin de l'execution reelle |
| le `healthcheck` de Compose | *le process web repond-il ?* | ni l'un ni l'autre |

Le `healthcheck` n'interroge que `/` (`docker-compose.yml:85-90`, ce que son
propre commentaire `:83` admet deja) : il passe au vert avec un cron eteint,
avec un cron mort, et meme avec une instance qui repond 503 partout ailleurs.
**Il ne prouve jamais rien sur le planificateur.**

### A. Au demarrage

```bash
docker compose logs seo-engine | grep -E '\[scheduler\]|\[instrumentation\]'
```

**Cas 1 — le planificateur est volontairement eteint.** Une seule ligne, et
c'est l'etat attendu de l'etape (a) de la procedure de premier demarrage :

```
[instrumentation] Planificateur ETEINT : ENABLE_SCHEDULER absente ou differente de "true". Aucune generation, aucune publication, aucun crawl ne partira. ...
```

**Cette ligne n'est pas une panne, et il faut la reconnaitre comme telle** — la
prendre pour un incident conduit a poser `ENABLE_SCHEDULER=true` en urgence, ce
qui est exactement le geste que toute la section 7 sert a ne pas faire dans la
precipitation.

**Cas 2 — le planificateur tourne.** `initScheduler()` journalise deux lignes,
dans les secondes qui suivent le lancement :

```
[INFO] [scheduler] Initializing SEO Engine job scheduler {
  timezone: 'Europe/Paris',
  localTime: 'Fri Jul 31 2026 11:04:12 GMT+0200 (Central European Summer Time)'
}
[INFO] [scheduler] All cron jobs scheduled successfully
```

La premiere ligne porte le fuseau **resolu par le process** et son heure locale :
c'est la verification de fuseau la plus directe, et elle est gratuite. Si elle
affiche `UTC`, le conteneur partira le mauvais jour — voir le point C.

**Cas 3 — on a demande a demarrer et le pre-vol a refuse.** `ENABLE_SCHEDULER`
vaut `true`, mais un controle bloquant echoue :

```
[instrumentation] Planificateur NON DEMARRE : ENABLE_SCHEDULER est a "true" mais 1 controle(s) bloquant(s) echouent. ...
[instrumentation]   - OPENAI_API_KEY : Sans elle la generation leve a l'interieur du creneau DEJA reclame ...
```

Le serveur web reste allume — deliberement : c'est la surface dont vous avez
besoin pour lire `/api/preflight`, corriger l'environnement et redemarrer. Une
ligne par controle en echec, avec le bug qu'il empeche.

**Aucune de ces trois lignes ?** Le hook n'a pas tourne. `instrumentation.ts`
est compile dans la sortie `standalone`, il n'y a donc pas de fichier a verifier
dans l'image : cherchez une exception au demarrage, et assurez-vous que le
process tourne bien en runtime Node — le hook s'auto-desactive sur le runtime
Edge (`process.env.NEXT_RUNTIME !== 'nodejs'`).

Un `[WARN] [scheduler] Scheduler already started or running in edge runtime` sur
un conteneur fraichement demarre est un symptome, pas un detail : le
planificateur a ete initialise deux fois, ou pas du tout dans le bon runtime.

### B. Toutes les 15 minutes

Le job principal tourne au quart d'heure. Il journalise meme quand il n'a rien a
faire, ce qui en fait un excellent battement de coeur :

```bash
docker compose logs --since 20m seo-engine | grep -E '\[(editorial|publish|campaign|main|reaper)\]'
```

Attendu, au moins une fois par tranche de 15 minutes :

```
[INFO] [editorial] Checking for due editorial slots { date: '2026-07-31' }
[INFO] [editorial] Found 0 due slots
[INFO] [publish] Found 0 pending publications
[INFO] [campaign] Found 0 due campaigns
[INFO] [main] Job completed { duration: 412 }
```

Aucune de ces lignes sur 20 minutes = le cron ne tourne pas, meme si le
conteneur est `healthy`. Deux causes, a distinguer par le point A avant de
chercher plus loin : soit il n'a jamais ete arme (`ENABLE_SCHEDULER` eteinte, ou
pre-vol refuse — cas 1 et 3), soit il est mort apres avoir demarre (cas 2 suivi
du silence).

Les lignes `[reaper]` n'apparaissent que lorsqu'il y a quelque chose a
recuperer : un `[WARN] [reaper] N slot(s) abandoned in 'generating'` juste apres
un demarrage est normal — c'est la reprise des creneaux interrompus par l'arret
precedent. Le meme message qui revient a chaque tick ne l'est pas.

### C. Verifier l'heure du conteneur

Le decalage de fuseau est silencieux : rien n'echoue, tout part au mauvais
moment. La ligne de demarrage du point A le dit deja ; pour le controler a tout
instant :

```bash
docker compose exec seo-engine date
docker compose exec seo-engine node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date().toString())"
```

Attendu : `Europe/Paris`, et une heure en `CEST` (ete) ou `CET` (hiver). Si vous
lisez `UTC`, la variable `TZ` n'a pas pris — verifiez qu'elle est bien dans le
bloc `environment` de `docker-compose.yml` et que `tzdata` est present dans
l'image (le Dockerfile l'installe).

### D. Verifier ce qui s'est reellement passe

L'historique durable est en base, pas dans les journaux : chaque execution
ecrit une ligne dans `job_executions` (type de job, statut, URL publiee, erreur,
duree). Cela suppose que la migration `007` ait ete appliquee — c'est elle qui
cree la table. Sans elle, les insertions sont rejetees en silence et la table
reste introuvable. Depuis le *SQL Editor* de Supabase :

```sql
select executed_at, job_type, status, published_url, error_message
from job_executions
order by executed_at desc
limit 20;
```

Les journaux en memoire du process (`getJobLogs()`, 1 000 entrees maximum) ne
sont exposes par aucune route HTTP : ils disparaissent a chaque redemarrage.
`job_executions` est purge automatiquement au-dela de 7 jours.

---

## 9. Architecture

### Le flux, de bout en bout

```
  Site connecte
      │  WordPress (URL + mot de passe d'application)
      │  ou Next.js (depot GitHub + jeton)
      ▼
  Campagne                    table `campaigns`
      │  metier, communes, mots-cles, types de pages, longueur,
      │  modele IA, recurrence, publication auto ou brouillon
      ▼
  Plan de briefs              tables `analysis_runs`, `cycle_plans`
      │  crawl du site + analyse concurrentielle → un brief par page,
      │  deduplique contre les slugs et mots-cles deja utilises
      ▼
  Calendrier editorial        table `editorial_calendar`
      │  un creneau par brief : date, type de page, mot-cle, commune
      ▼
  ── Jour J ─────────────────── cron toutes les 15 min ──────────────
      │
      │  1. reperer les creneaux echus (statut `planned`, date <= aujourd'hui)
      │  2. construire le contexte : taxonomies du site, concurrents,
      │     donnees Google (GSC/GBP), recherche vectorielle sur l'existant
      │  3. faire rediger l'IA en respectant le brief
      │  4. persister la page COMPLETE dans `generations.page_payload`
      │     (HTML, JSON-LD, FAQ, maillage interne, CTA)
      ▼
  Publication                 table `generations`
      │  WordPress → POST /wp-json/wp/v2/pages
      │  Next.js   → commit via l'API GitHub Contents
      ▼
  Notification aux moteurs    IndexNow · ping sitemap · API Indexing Google
```

Le cycle est renouvelable : `cycle-manager.ts` detecte la fin d'un cycle,
recrawle le site pour tenir compte des pages fraichement publiees, et regenere
un plan pour le cycle suivant.

### Les repertoires qui comptent

| Chemin | Role |
|---|---|
| `app/` | App Router — **la seule racine de routage**. Tableau de bord `(dashboard)/` et routes `api/`. |
| `app/api/` | Routes metier : sites, campagnes, calendrier, generation, publication, extraction de schema, OAuth Google, webhook WordPress, analytics. |
| `lib/` | Le coeur. `scheduler/` (cron, calendrier editorial, cycles), `ai/` (generateurs, types de pages, RAG), `publishers/` (WordPress, Next.js), `google/` (OAuth, GSC, GBP), `analyzer/` (crawl, concurrence), `planning/` (briefs), `seo/` (indexation, maillage), `db.ts` (acces Supabase), `types.ts`. |
| `src/adapters/rag/` | Couche RAG : magasin vectoriel `pgvector`, agregation de contexte (`context/`), moteur de gabarits, pipeline de validation (`validation/`). C'est ce qui fait qu'une page generee tient compte du site reel. |
| `src/adapters/infrastructure/database/migrations/` | Les migrations SQL. Voir `db/README.md`. |
| `src/adapters/extractors/` | Extraction des schemas de contenu d'un site WordPress. |
| `src/core/` | Entites de domaine partagees (`FederatedSite`, `ContentTemplate`, `ContentSchema`…), consommees des deux cotes. |
| `wordpress-plugin/` | Plugin **optionnel** « SEO Engine Connector ». La publication de base n'en a pas besoin (elle passe par l'API REST standard de WordPress avec un mot de passe d'application). Le plugin ajoute la remontee d'analytics, la synchronisation du maillage interne et un webhook vers `/api/webhook/wordpress`. A installer a la main sur le site cible. |
| `instrumentation.ts` | Hook de demarrage Next.js, et **le point d'entree du cron**. Trois portes dans cet ordre : runtime Node, puis `ENABLE_SCHEDULER` (`lib/scheduler/enabled.ts`), puis le pre-vol de configuration (`lib/config/preflight.ts`). Ce n'est qu'apres les trois qu'il importe dynamiquement le planificateur — l'import tardif le tient hors du bundle Edge et evite d'evaluer tout ce graphe pour rien. Il ne leve jamais : l'etat le moins dangereux est « web allume, cron eteint ». |

### Deux perimetres qui cohabitent

Le depot porte deux organisations : `app/` + `lib/` (le produit historique, en
service) et `src/` (une couche hexagonale plus recente : adaptateurs RAG,
federation de schemas). `src/` ne contient plus de routes — tout le routage est
remonte dans `app/` — mais les deux couches se dependent **dans les deux
sens** :

- `lib/ai/full-rag-context.ts` importe `src/adapters/rag/context/UnifiedContextAggregator`
  et le moteur de gabarits ;
- en retour, presque tout `src/adapters/rag/` importe `createServiceClient` de
  `lib/supabase`, ainsi que `lib/google/*` et `lib/analyzer/*`.

Ce n'est pas une belle architecture — c'est un cycle entre deux couches censees
etre superposees. C'en est l'etat reel : autant le savoir avant de chercher un
fichier ou de croire que `src/` peut etre extrait tel quel.

---

## 10. Limites connues

A garder en tete, par ordre de gravite :

1. **Le schema de base n'est pas versionne.** 12 tables sur 19 n'existent que
   dans l'instance Supabase. Voir `db/README.md` — c'est le chantier prioritaire.
2. **Identifiants a regenerer.** Tout mot de passe d'application WordPress ou
   jeton GitHub saisi avant la fermeture de l'instance a ete servi en clair par
   l'API : a revoquer et recreer (section 7).
3. **Une seule barriere, un seul secret.** `APP_ACCESS_SECRET` protege tout, mais
   le Basic n'offre pas de deconnexion propre (le navigateur garde le secret
   jusqu'a sa fermeture complete) et le secret du webhook est global a tous les
   sites WordPress connectes, pas par site.
4. **Instance unique obligatoire.** Pas pour les creneaux — ceux-la sont
   proteges par reclamation atomique en base (`claimEditorialSlot`,
   `claimGenerationForPublishing`), et une meme page ne sort pas deux fois. Mais
   le **job de campagne** et le **renouvellement de cycle** n'ont aucune
   reclamation : deux process = deux crawls et deux plans concurrents sur la
   meme campagne (section 7).
5. **Pas de suivi des migrations appliquees.** Aucune table ne memorise ce qui a
   deja tourne ; `001` n'est pas rejouable.
6. **Migrations `002`, `003`, `004` absentes** du depot, definitivement.
7. **Couverture de tests inegale.** La suite compte **1017 tests** repartis sur
   54 fichiers (`npx vitest run`), et ne se limite plus a
   `src/adapters/rag/validation` : `lib/db.test.ts`,
   `lib/gbp/posts/schedule.test.ts`, `app/api/workflow/state.test.ts`,
   `lib/config/preflight.test.ts`, `lib/scheduler/enabled.test.ts`,
   `app/api/preflight/summary.test.ts`, `instrumentation.test.ts` et
   `lib/scheduler/cleanup.test.ts` existent, entre autres.

   Les trois portes de demarrage sont couvertes AU CABLAGE et pas seulement a la
   decision : `instrumentation.test.ts` appelle `register()` avec
   `@/lib/scheduler/cron` moque et verifie qu'`initScheduler` n'est PAS atteint
   sans `ENABLE_SCHEDULER=true`. La distinction n'est pas theorique — tant que
   seul `schedulerEnabled()` etait teste, on pouvait supprimer les neuf lignes du
   garde dans `instrumentation.ts` sans faire rougir un seul test, pendant que le
   planificateur demarrait sans condition.

   Restent peu ou pas couverts : le corps du planificateur
   (`lib/scheduler/cron.ts`, dont seule la purge nocturne a un filet), le
   renouvellement de cycle et les publishers WordPress / Next.js — c'est-a-dire
   les chemins qui ecrivent chez les clients.
