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

La liste complete, telle que le code la lit (`NEXT_RUNTIME` est injecte par
Next.js et n'est pas a configurer) :

| Variable | Statut | Sans elle |
|---|---|---|
| `OPENAI_API_KEY` | **obligatoire** | `/api/generate` repond 500 ; les embeddings du magasin vectoriel echouent, donc tout le RAG |
| `NEXT_PUBLIC_SUPABASE_URL` | **obligatoire** | chaque appel base leve « NEXT_PUBLIC_SUPABASE_URL is required. » — tableau de bord, API et cron sont morts |
| `SUPABASE_SERVICE_ROLE_KEY` | **obligatoire** | idem : plus aucune lecture ni ecriture |
| `ANTHROPIC_API_KEY` | obligatoire si un modele `claude-*` est utilise | les campagnes en `claude-*` passent en `failed` ; celles en `gpt-*` continuent |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | optionnelle (inerte aujourd'hui) | rien, tant qu'aucun composant client n'attaque Supabase |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optionnelles | impossible de connecter GSC / GBP ; la generation continue sans contexte Google |
| `GOOGLE_REDIRECT_URI` | optionnelle en local, **obligatoire en production** | Google renvoie vers `localhost`, la connexion d'un site n'aboutit jamais |
| `GOOGLE_INDEXING_CREDENTIALS` | optionnelle | l'API Indexing de Google est sautee ; IndexNow et le ping sitemap continuent |
| `INDEXNOW_KEY` | optionnelle | Bing / Yandex / Seznam / Naver ne sont pas prevenus ; la publication reussit |
| `TZ` | **obligatoire en conteneur** | le cron part a la mauvaise heure et le « jour J » bascule au mauvais moment |
| `PORT` / `HOSTNAME` | optionnelles | defauts `3000` et `0.0.0.0`, deja fixes dans le Dockerfile |

Aucune variable n'est necessaire au moment du **build** — verifie : `npm run
build` passe sur un depot depourvu de tout fichier `.env`. Tout est lu a
l'execution.

---

## 5. Migrations SQL

Les migrations vivent dans `src/adapters/infrastructure/database/migrations/`
(`001` a `019` a ce jour). La procedure complete, l'ordre d'application et la
maniere de sauvegarder le schema sont dans **[`db/README.md`](db/README.md)**.

En resume, sur une base **existante**, une migration a la fois :

```bash
node scripts/db-migrate.mjs --list      # ce qui existe
node scripts/db-migrate.mjs 019 --dry   # lire avant d appliquer
node scripts/db-migrate.mjs 019
```

Les migrations sont ecrites idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`) :
les rejouer ne coute rien, et la base elle-meme fait office de journal de ce qui
a ete applique.

Sur une base **vierge**, appliquer d'abord la baseline, puis les migrations
numerotees dans l'ordre :

```bash
psql "<CONNECTION_STRING>" -f db/000_baseline.sql
```

> **La baseline est la definition de reference du schema.**
> [`db/000_baseline.sql`](db/000_baseline.sql) est un export de la base de
> production (28 tables, extensions, fonctions et index compris). Beaucoup de
> ces tables — dont `sites`, `campaigns`, `generations` et `editorial_calendar` —
> ont ete creees a la main dans le tableau de bord Supabase et n'apparaissent
> dans aucune migration : sans ce fichier, perdre le projet Supabase revient a
> perdre le schema. C'est aussi pour cette raison que les migrations `002` a
> `004` sont absentes du depot, et que `006` et `007` sont des `ALTER TABLE` sur
> des tables qu'aucun fichier numerote ne cree.
>
> **A regenerer apres toute modification faite a la main dans le tableau de
> bord**, sans quoi il derive en silence :
>
> ```bash
> node scripts/db-baseline.mjs
> ```
>
> Elle ne contient que la structure, jamais les donnees. Les sauvegardes de
> donnees restent du ressort de Supabase.

Le deploiement n'applique **aucune** migration : elles se lancent a la main,
depuis ton poste, **avant** de merger la PR qui en depend. La raison est
expliquee en [section 4 de `docs/deploiement.md`](docs/deploiement.md#4-migrations-sql).

---

## 6. Lancer en developpement

```bash
npm run dev          # http://localhost:3000 — redirige vers /dashboard
npm run build        # build de production
npm start            # sert le build de production
npm run lint         # ESLint
npm test             # Vitest
```

Le planificateur demarre **aussi en developpement** : `instrumentation.ts`
appelle `initScheduler()` des que le serveur Node se leve. Si vous pointez votre
`.env.local` sur la base de production, votre poste publiera pour de vrai, en
concurrence avec le VPS — et une meme page sortira deux fois. Travaillez sur une
base Supabase separee, ou coupez le conteneur pendant vos sessions de dev.

---

## 7. Deployer sur le VPS

### Cible assumee

Un VPS **toujours allume**, **un seul conteneur**. Le planificateur node-cron
tourne dans le process Next.js ; il n'y a pas de declencheur externe. Cela
impose deux choses :

- l'application ne doit **jamais** s'endormir (pas de plateforme serverless, pas
  de scale-to-zero : un process endormi ne declenche aucun cron) ;
- il ne doit **jamais** y avoir deux instances simultanees.

> **⚠ Instance unique, sans exception.** Le garde-fou d'idempotence du
> planificateur (`runningJobs`, `lib/scheduler/cron.ts`) est une `Map` en
> memoire : il empeche deux executions du meme job **dans un process**, et rien
> d'autre. Deux conteneurs sur la meme base font tourner deux crons, generent
> chaque creneau deux fois et **publient les articles en double sur le site
> client**. Interdits : `--scale`, `replicas > 1`, Swarm, Kubernetes, et tout
> deploiement « rolling » faisant cohabiter ancien et nouveau conteneur.
> `docker-compose.yml` fixe `container_name`, ce qui rend la mise a l'echelle
> mecaniquement impossible : c'est voulu.

### Deployer et mettre a jour

**Le VPS ne construit plus rien.** Tout passe par GitHub Actions : chaque merge
sur `main` declenche lint + types + tests, publie une image sur GHCR, puis le
serveur la tire et recree le conteneur. Environ dix secondes de coupure, avec
retour arriere automatique si le healthcheck ne passe pas.

La procedure complete — provisionnement du VPS, secrets a renseigner, flux de
travail quotidien, retour arriere, diagnostic — est dans
**[`docs/deploiement.md`](docs/deploiement.md)**.

En resume, une fois pour toutes, sur le serveur neuf :

```bash
bash deploy/bootstrap.sh seo.mondomaine.fr   # Docker, vhost nginx + certbot, utilisateur deploy
# puis remplir /opt/seo-engine/.env et copier les 4 secrets dans GitHub
```

Ensuite, deployer = merger sur `main`. Rien a faire sur le serveur.

> **`docker compose up -d --build` sur le VPS est desormais deconseille.**
> `next build` (React Compiler + Tailwind 4) demande plusieurs minutes et ~2 Go
> de RAM : sur un petit VPS il finit en OOM-kill, la coupure dure le temps du
> build, et l'image obtenue n'est pas celle que la CI a verifiee. Le fichier
> `docker-compose.yml` de la racine reste utile en local ; c'est
> `docker-compose.prod.yml` qui tourne sur le serveur, et il n'a pas de section
> `build`.

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

Le `healthcheck` de Compose prouve que le serveur web repond. **Il ne prouve pas
que le cron tourne.** Ces deux verifications sont independantes.

### A. Au demarrage

`initScheduler()` journalise deux lignes. Elles doivent apparaitre dans les
secondes qui suivent le lancement :

```bash
docker compose logs seo-engine | grep '\[scheduler\]'
```

Attendu :

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

Si ces lignes manquent, le planificateur n'a jamais demarre. `instrumentation.ts`
est compile dans la sortie `standalone`, il n'y a donc pas de fichier a verifier
dans l'image : cherchez plutot une exception au demarrage dans les journaux, et
assurez-vous que le process tourne bien en runtime Node — le hook s'auto-desactive
sur le runtime Edge (`process.env.NEXT_RUNTIME !== 'nodejs'`).

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

Aucune de ces lignes sur 20 minutes = le cron est mort, meme si le conteneur est
`healthy`.

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
| `instrumentation.ts` | Hook de demarrage Next.js. Importe dynamiquement le planificateur pour le tenir hors du bundle Edge, puis l'initialise. **C'est le point d'entree du cron.** |

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
4. **Instance unique obligatoire.** Deux process = publications en double
   (section 7).
5. **Pas de suivi des migrations appliquees.** Aucune table ne memorise ce qui a
   deja tourne ; `001` n'est pas rejouable.
6. **Migrations `002`, `003`, `004` absentes** du depot, definitivement.
7. **Couverture de tests tres partielle.** La suite passe (82 tests), mais elle
   ne couvre que `src/adapters/rag/validation`. Le planificateur, `lib/db.ts` et
   les publishers n'ont aucun test.
