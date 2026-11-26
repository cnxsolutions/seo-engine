# SEO Engine — instructions de travail

Moteur SEO : analyse un site, planifie un calendrier editorial, genere les pages
avec un LLM, les publie (WordPress, Next.js/GitHub, Sanity, Google Business
Profile), puis mesure via Search Console. Next.js 16, Supabase, TypeScript.

---

## La contrainte qui prime sur tout

**Le planificateur `node-cron` tourne DANS le process Next.js.**
`instrumentation.ts` appelle `initScheduler()` au demarrage
(`lib/scheduler/cron.ts`), et son garde-fou d'idempotence — `runningJobs` — est
une `Map` **en memoire**, locale au process.

Consequence : **une seule instance, toujours.** Deux process sur la meme base
font tourner deux crons, generent chaque creneau deux fois et **publient les
articles en double sur le site du client**.

Ne jamais proposer, et refuser si on le demande sans avoir d'abord retire le
cron du process : `--scale`, `replicas > 1`, Swarm, Kubernetes, un deploiement
« rolling », une plateforme serverless ou scale-to-zero (Vercel, Cloud Run). La
micro-coupure de ~10 s a chaque deploiement est la contrepartie assumee de cette
architecture, pas un defaut a corriger.

**Ne developpe jamais contre la base de production.** Le planificateur demarre
**aussi** en `npm run dev` : un `.env.local` pointant sur la base de prod publie
pour de vrai, en concurrence avec le VPS. Developpement, tests et recette se
font **contre le Supabase local** (`npx supabase start`, Docker), avec des sites
de demonstration sans identifiants de publication — mis en place au L0 du
chantier en cours, voir [`docs/cadrage.md`](docs/cadrage.md) § 4.8. La
production n'est touchee que pour appliquer une migration avant un merge.

---

## Commandes

```bash
npm run dev          # http://localhost:3000
npm run lint         # ESLint          — 0 erreur attendue (33 warnings tolerees)
npm run typecheck    # tsc --noEmit    — 0 erreur attendue
npm test             # Vitest          — 1 414 tests (99 fichiers), tous verts
npm run build        # build local (sans sortie standalone, voir next.config.ts)
```

Les trois commandes du milieu sont **exactement** celles de la CI. Les lancer
avant de pousser coute quinze secondes et evite un aller-retour de trois minutes.

Node 22 (`.nvmrc`), source unique pour la CI, Docker et le poste local.

La base de developpement est un **Supabase local** (Docker Desktop doit tourner) :

```bash
npm run db:local:start   # API :54321 · Postgres :54322 · Studio :54323 · Mailpit :54324
npm run db:local:reset   # baseline + migrations + demonstration (sites fictifs, campagnes inactives)
npm run test:db          # tests d'integration *.db.test.ts (63) — rejoues en CI dans le job « base »
```

`.env.local` pointe sur cette base ; il ne contient **aucun** acces a la
production. Details : [`db/README.md`](db/README.md) § 0.

Deux membres de demonstration ouvrent l'espace client en local :
`marie@martin-batiment.test` (Plomberie Martin, Toitures Lambert) et
`luc@electricite-durand.test` (Electricite Durand). Le code arrive dans Mailpit,
http://127.0.0.1:54324 — aucun e-mail ne sort du poste.

---

## Le flux de developpement

```
branche feat/xxx  ->  PR  ->  CI verte  ->  squash merge  ->  prod en ~3 min
```

**Ne jamais pousser directement sur `main`.** Un push sur `main` declenche le
deploiement en production, sans relecture.

```bash
git checkout main && git pull
git checkout -b feat/ma-fonctionnalite
npm run lint && npm run typecheck && npm test
git push -u origin feat/ma-fonctionnalite && gh pr create --fill
```

Ce que fait la chaine :

| Declencheur | Workflow | Effet |
|---|---|---|
| Pull request | `ci.yml` | lint + types + tests, build Docker **sans** publication, et tests d'integration contre un Supabase local |
| Push sur `main` | `deploy.yml` | memes controles, image `ghcr.io/cnxsolutions/seo-engine:sha-<court>`, puis SSH vers le VPS : `pull`, bascule, attente du healthcheck, **retour arriere automatique** si le conteneur ne repond jamais |

Le VPS ne construit rien : il tire une image deja verifiee.

---

## Migrations SQL

Elles ne sont **pas** automatisees, deliberement. Elles s'appliquent a la main,
depuis le poste, **avant** de merger la PR qui en depend — le conteneur redemarre
trente secondes apres le merge, et echouerait sur une colonne absente.

Une migration s'ecrit et se prouve **en local d'abord**, puis part en
production par un geste explicite :

```bash
npm run db:local:reset -- --keep               # rejouee sur la base locale
npm run test:db                                # idempotence, RLS, demonstration
node scripts/db-migrate.mjs 021 --dry          # lire avant d'appliquer
node scripts/db-migrate.mjs 021 --prod=<ref>   # PRODUCTION : lit .env.prod-db, exige la ref du projet
```

Sans `--prod`, les scripts ne touchent **que** la base locale. `.env.prod-db`
(ignore par git, jamais lu par Next.js) est le seul fichier qui contient la
chaine de connexion de production.

Les fichiers vivent dans `src/adapters/infrastructure/database/migrations/`
(`001` a `024`), **jamais** dans `db/` ni dans `supabase/migrations/`. Ils
doivent etre idempotents (`IF NOT EXISTS`, `CREATE OR REPLACE`) : la base
elle-meme fait office de journal, il n'y a pas de table de suivi. Toute nouvelle
table active son RLS dans sa propre migration (`db/rls.db.test.ts`).

`db/000_baseline.sql` est la **definition de reference du schema** : beaucoup de
tables ont ete creees a la main dans Supabase et n'apparaissent dans aucune
migration. **Regenerer apres toute modification faite dans le tableau de bord**,
sinon la baseline derive en silence — elle enregistre aussi l'etat RLS :

```bash
node scripts/db-baseline.mjs --prod=<ref>
```

---

## Production

- **URL** : https://seo.cnx-solutions.fr — fermee par `APP_ACCESS_SECRET`
  (HTTP Basic verifie par `proxy.ts` devant toutes les pages et routes `/api`,
  sauf `/api/webhook/wordpress` qui a son propre secret). Sans ce secret, ou
  avec moins de 16 caracteres, **tout repond 503** : la barriere refuse de
  tourner plutot que de s'ouvrir.
- **Serveur** : un VPS qui **heberge aussi une autre application en production**,
  derriere le meme nginx (adresse et details dans les secrets du depot, pas ici —
  ce depot est public). Toute intervention serveur doit etre compatible avec
  cette cohabitation : ne jamais toucher au pare-feu, ne jamais recharger nginx
  sans un `nginx -t` prealable, ne jamais ecraser un vhost existant. Une conf
  invalide rechargee ferait tomber **les deux** sites, pas seulement celui-ci.
- **Configuration** : `/opt/seo-engine/.env`, sur le serveur uniquement. Aucune
  cle applicative ne transite par GitHub ; les seuls secrets du depot sont
  l'acces SSH.
- **Retour arriere** : `IMAGE_TAG=sha-<precedent> docker compose -f
  docker-compose.prod.yml up -d` depuis `/opt/seo-engine`. Instantane, l'image
  est deja sur le disque.

---

## Interface

La DA est celle de CNX Solutions (site et films), detaillee dans `docs/design.md`.

- **Jetons uniquement** : couleurs, rayons, ombres, polices et mouvement viennent
  de `components/tokens.css`, dont les valeurs sont recopiees du theme CNX
  (`cnx-solutions/.../assets/css/theme.css`). Aucune valeur brute ailleurs.
- **Deux polices** : `--font-display` (Plus Jakarta Sans) pour titres, chiffres,
  boutons, onglets ; `--font-sans` (Inter) pour le texte courant.
- **Aucun nouveau style en ligne** (`style={{…}}`) : une classe de composant.
  Les 675 existants se retirent ecran par ecran (lot L6).
- **Jamais `window.confirm()`** : `components/ConfirmDialog.tsx`, qui garde le
  refus du serveur sous les yeux. **Jamais de jargon interne** dans un texte
  visible (nom de table, « gate », « slot »).
- Tout nouveau couple texte/fond se mesure (AA, 4,5:1) avant d'entrer dans les jetons.

---

## Espace client

`/espace` est ouvert aux clients de CNX (connexion par code e-mail, Supabase
Auth). Une fuite d'un client vers un autre est LE risque du chantier :

- **Une seule porte vers les donnees** : `lib/client-space/scope.ts`, qui part
  de la session et jamais d'un identifiant envoye par le navigateur. Un site
  d'un autre client repond **404**, pas 403. Les lectures d'un site
  (`lib/client-space/overview.ts`) prennent le `ClientSiteDto` qu'elle rend,
  jamais un id : les helpers operateur (`select('*')`, prompts, types de page)
  ne servent pas cote client.
- **Trois controles, aucun ne suffit seul** : `proxy.ts` (une session existe),
  le layout `app/(espace)/espace/(membre)` (un membre non revoque, une session
  ouverte PAR UN CODE il y a moins de 30 jours et apres sa derniere revocation —
  le claim `amr` du jeton, jamais `last_login_at`), puis chaque route ou page
  (le site appartient a son client).
- Les limites de debit (`lib/rate-limit.ts`) sont bornees en memoire et
  listent l'IP AVANT l'adresse : un limiteur ne doit pas devenir l'attaque, le
  meme processus fait tourner le planificateur.
- **Jamais `select('*')`** sur `sites` cote client : DTO a colonnes nommees
  (`lib/client-space/dto.ts`), sans secret, teste.
- La cle **publique** ne sert qu'a Supabase Auth (`auth-client.ts`) ; toute
  donnee passe par la cle de service, cote serveur. Le navigateur ne recoit
  aucune cle. Sans `NEXT_PUBLIC_SUPABASE_ANON_KEY`, l'espace repond 503.
- Chaque nouvelle route `/api/espace` arrive avec son test d'isolation contre
  le Supabase local (`db/client-space.db.test.ts`).
- L'e-mail de code a une seule source, `supabase/templates/code-connexion.html`,
  servie en local et collee telle quelle dans le projet heberge (modele « Magic
  Link »).

---

## Pieges connus

- **`npm run typecheck` echoue en local mais passe en CI** : un `.next` perime
  apres un changement de branche. Les erreurs pointent des fichiers **generes**
  (`.next/types/validator.ts`), pas ton code. `rm -rf .next`.
- **`npm run dev` sert un CSS d'une autre branche** apres un `git stash` ou un
  changement de branche pendant qu'il tourne : le cache de Turbopack garde
  l'ancien `globals.css` (les jetons, eux, sont a jour), meme apres un
  redemarrage. Arreter le serveur, `rm -rf .next`, relancer.
- **`output: 'standalone'` est conditionnel** (`BUILD_STANDALONE=1`), et c'est
  voulu : le tracage ne peut pas s'achever sur Windows (Turbopack emet des
  chunks nommes `[externals]_node:fs_<hash>._.js`, NTFS interdit le `:`). Seul
  le Dockerfile, sur Linux, demande la sortie complete.
- **Secrets poses depuis PowerShell** : un pipe PowerShell reecrit tout en CRLF.
  Le workflow retire les `\r` et valide la cle, mais en cas de doute poser le
  secret depuis Git Bash ou WSL.
- **Cache GitHub Actions cloisonne par branche** : `main` ne lit pas le cache
  cree sur une branche de PR. Le premier build apres un merge repart de zero.
- **Vitest echoue en bloc sous Git Bash** quand le chemin courant commence par
  un lecteur en minuscule (`c:/laragon/...`) : les 99 fichiers tombent avec
  « Cannot read properties of undefined (reading 'config') », zero test lance.
  Ce n'est pas le code : lancer `npm test` depuis PowerShell, ou `cd /C/laragon/...`.

- **La tache des demandes consulte le modele, en local aussi.** Toutes les
  2 min, `npm run dev` analyse les demandes `received` de la base locale ; une
  demande que les mesures ne reglent pas part au modele avec la cle OpenAI de
  `.env.local` (quelques centaines de jetons). Sans credit ou sans cle, la
  demande passe « A l'etude chez CNX » (`OPINION_UNAVAILABLE`) : c'est voulu,
  pas une panne du code.

- **Horloge de Docker Desktop** : la machine virtuelle a quelques dixiemes de
  seconde d'avance sur Windows. Un test qui compare l'heure de connexion de
  Supabase Auth (a la seconde) a une borne posee par Node garde au moins deux
  secondes de marge (`db/client-space.db.test.ts`).

- **Supabase CLI : `[auth.email] enable_signup` reste a `true`** dans
  `supabase/config.toml`. Pour la CLI, ce drapeau allume le fournisseur e-mail
  lui-meme : a `false`, plus aucun code ne part (« Email logins are
  disabled »). L'inscription libre se coupe par `[auth] enable_signup`.

---

## Ou lire la suite

| Sujet | Fichier |
|---|---|
| Produit, architecture, verifier que le cron tourne | [`README.md`](README.md) |
| Chantier en cours : espace client, demandes de mots-cles, refonte UI/UX (lots, regles, decisions) | [`docs/cadrage.md`](docs/cadrage.md) |
| DA CNX appliquee a l'outil : jetons, typo, composants, ecrans | [`docs/design.md`](docs/design.md) |
| Deploiement : mise en place, quotidien, rollback, diagnostic | [`docs/deploiement.md`](docs/deploiement.md) |
| Migrations et baseline | [`db/README.md`](db/README.md) |
| Acces API Google Business Profile | [`docs/gbp-acces-api.md`](docs/gbp-acces-api.md) |

Les fichiers d'infrastructure (`Dockerfile`, `docker-compose.prod.yml`,
`deploy/*.sh`, `.github/workflows/*`) portent leur raisonnement en commentaire :
les lire avant de les modifier, les contraintes y sont expliquees.
