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
pour de vrai, en concurrence avec le VPS. Utiliser un projet Supabase separe.

---

## Commandes

```bash
npm run dev          # http://localhost:3000
npm run lint         # ESLint          — 0 erreur attendue (33 warnings tolerees)
npm run typecheck    # tsc --noEmit    — 0 erreur attendue
npm test             # Vitest          — 889 tests, tous verts
npm run build        # build local (sans sortie standalone, voir next.config.ts)
```

Les trois commandes du milieu sont **exactement** celles de la CI. Les lancer
avant de pousser coute quinze secondes et evite un aller-retour de trois minutes.

Node 22 (`.nvmrc`), source unique pour la CI, Docker et le poste local.

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
| Pull request | `ci.yml` | lint + types + tests, et build Docker **sans** publication |
| Push sur `main` | `deploy.yml` | memes controles, image `ghcr.io/cnxsolutions/seo-engine:sha-<court>`, puis SSH vers le VPS : `pull`, bascule, attente du healthcheck, **retour arriere automatique** si le conteneur ne repond jamais |

Le VPS ne construit rien : il tire une image deja verifiee.

---

## Migrations SQL

Elles ne sont **pas** automatisees, deliberement. Elles s'appliquent a la main,
depuis le poste, **avant** de merger la PR qui en depend — le conteneur redemarre
trente secondes apres le merge, et echouerait sur une colonne absente.

```bash
node scripts/db-migrate.mjs --list
node scripts/db-migrate.mjs 020 --dry     # lire avant d'appliquer
node scripts/db-migrate.mjs 020
```

Les fichiers vivent dans `src/adapters/infrastructure/database/migrations/`
(`001` a `019`), **jamais** dans `db/`. Ils doivent etre idempotents
(`IF NOT EXISTS`, `CREATE OR REPLACE`) : la base elle-meme fait office de
journal, il n'y a pas de table de suivi.

`db/000_baseline.sql` est la **definition de reference du schema** (28 tables) :
beaucoup ont ete creees a la main dans Supabase et n'apparaissent dans aucune
migration. **Regenerer apres toute modification faite dans le tableau de bord**,
sinon la baseline derive en silence :

```bash
node scripts/db-baseline.mjs
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

## Pieges connus

- **`npm run typecheck` echoue en local mais passe en CI** : un `.next` perime
  apres un changement de branche. Les erreurs pointent des fichiers **generes**
  (`.next/types/validator.ts`), pas ton code. `rm -rf .next`.
- **`output: 'standalone'` est conditionnel** (`BUILD_STANDALONE=1`), et c'est
  voulu : le tracage ne peut pas s'achever sur Windows (Turbopack emet des
  chunks nommes `[externals]_node:fs_<hash>._.js`, NTFS interdit le `:`). Seul
  le Dockerfile, sur Linux, demande la sortie complete.
- **Secrets poses depuis PowerShell** : un pipe PowerShell reecrit tout en CRLF.
  Le workflow retire les `\r` et valide la cle, mais en cas de doute poser le
  secret depuis Git Bash ou WSL.
- **Cache GitHub Actions cloisonne par branche** : `main` ne lit pas le cache
  cree sur une branche de PR. Le premier build apres un merge repart de zero.

---

## Ou lire la suite

| Sujet | Fichier |
|---|---|
| Produit, architecture, verifier que le cron tourne | [`README.md`](README.md) |
| Deploiement : mise en place, quotidien, rollback, diagnostic | [`docs/deploiement.md`](docs/deploiement.md) |
| Migrations et baseline | [`db/README.md`](db/README.md) |
| Acces API Google Business Profile | [`docs/gbp-acces-api.md`](docs/gbp-acces-api.md) |

Les fichiers d'infrastructure (`Dockerfile`, `docker-compose.prod.yml`,
`deploy/*.sh`, `.github/workflows/*`) portent leur raisonnement en commentaire :
les lire avant de les modifier, les contraintes y sont expliquees.
