# Deploiement — de la branche a la production

Ce document est le mode d'emploi complet de la chaine CI/CD. Il remplace la
procedure « `git pull` puis `docker compose up -d --build` sur le VPS » : le
serveur ne construit plus rien.

---

## 1. La chaine, en une image

```
  branche feat/xxx
        |
        +-- push ----------> CI (ci.yml)
        |                    |- lint + types + tests (889 tests)
        |                    +- build Docker, sans publication
        |                          |
        |                    PR verte ?
        v
   merge sur main
        |
        +-- push ----------> Deploiement (deploy.yml)
                             |- lint + types + tests  (a nouveau : main est la
                             |                         seule branche qui compte)
                             |- build + push
                             |    ghcr.io/cnxsolutions/seo-engine:sha-xxxxxxx
                             +- ssh VPS
                                  |- docker compose pull   (image deja construite)
                                  |- docker compose up -d  (~10 s de coupure)
                                  |- attente du healthcheck (max 120 s)
                                  +- echec ? retour arriere automatique
```

Duree typique : **2 min de CI sur la PR, 3 a 4 min du merge a la production.**

---

## 2. Mise en place — a faire une seule fois

### 2.1 Le serveur

Sur le VPS Contabo neuf, en root :

```bash
curl -fsSL https://raw.githubusercontent.com/cnxsolutions/seo-engine/main/deploy/bootstrap.sh -o bootstrap.sh
bash bootstrap.sh seo.mondomaine.fr
```

> Le domaine doit **deja** pointer sur l'IP du serveur. Caddy demande son
> certificat des le demarrage ; si le DNS n'est pas propage, la demande echoue
> et Let's Encrypt limite fortement les reessais.

Le script installe Docker, Caddy (TLS automatique), un utilisateur `deploy`
non-root, un pare-feu qui ne laisse passer que 22/80/443, et les mises a jour
de securite automatiques. Il termine en affichant les quatre valeurs a copier
dans GitHub.

**Dimensionnement.** Le VPS ne construit plus l'image : il ne fait que la tirer
et l'executer. Le conteneur tourne confortablement avec **2 Go de RAM**. C'est
le `next build`, desormais fait par GitHub, qui en reclamait 2 a lui seul.

### 2.2 Le fichier de configuration

Il n'est **jamais** televerse par la CI, et aucune cle applicative ne transite
par GitHub. Sur le serveur :

```bash
curl -fsSL https://raw.githubusercontent.com/cnxsolutions/seo-engine/main/.env.example \
  -o /opt/seo-engine/.env
nano /opt/seo-engine/.env
chown deploy:deploy /opt/seo-engine/.env && chmod 600 /opt/seo-engine/.env
```

`.env.example` documente chaque variable. Deux sont bloquantes :
`APP_ACCESS_SECRET` et `WORDPRESS_WEBHOOK_SECRET` — sans elles l'application
repond `503` sur tout. Les generer avec `openssl rand -base64 32`.

Si tu branches Google, `GOOGLE_REDIRECT_URI` doit valoir
`https://seo.mondomaine.fr/api/google/callback`, declare a l'identique dans la
console Google Cloud.

### 2.3 Les secrets GitHub

*Settings > Secrets and variables > Actions > New repository secret*

| Secret | Valeur |
|---|---|
| `VPS_HOST` | IP ou nom DNS du VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | la cle **privee** affichee par `bootstrap.sh`, bloc entier |
| `VPS_KNOWN_HOSTS` | la ligne affichee par `bootstrap.sh` |

Optionnel, dans l'onglet *Variables* : `PRODUCTION_URL` =
`https://seo.mondomaine.fr`, pour que GitHub affiche un lien cliquable a cote
de chaque deploiement.

### 2.4 Le premier deploiement

Pousser sur `main`. Il part tout seul. Suivre dans l'onglet *Actions*.

---

## 3. Le quotidien

```bash
git checkout main && git pull
git checkout -b feat/ma-fonctionnalite
# ... developper ...
npm run lint && npm run typecheck && npm test    # la meme chose que la CI
git push -u origin feat/ma-fonctionnalite
gh pr create --fill
```

CI verte -> *Squash and merge* -> la production suit dans les trois minutes.

**Verifier avant de pousser, pas apres.** Les trois commandes ci-dessus sont
exactement celles de la CI. Les lancer en local coute quinze secondes et evite
un aller-retour de trois minutes.

> **Ne developpe jamais contre la base de production.** `instrumentation.ts`
> demarre le planificateur **aussi en developpement** : un `npm run dev` dont le
> `.env.local` pointe sur la base de prod publie pour de vrai, en concurrence
> avec le VPS, et la meme page sort deux fois. Utilise un second projet Supabase.

---

## 4. Migrations SQL

**Elles ne sont pas automatisees, et c'est un choix.** Deux raisons :

1. les appliquer depuis la CI voudrait dire stocker la chaine de connexion
   Postgres dans les secrets GitHub — une cle de plus hors du serveur, pour un
   gain nul : Supabase est joignable depuis ton poste ;
2. du DDL applique automatiquement a chaque merge est la meilleure facon de se
   faire surprendre un vendredi soir.

La sequence correcte, quand une fonctionnalite a besoin d'une colonne :

```bash
node scripts/db-migrate.mjs 014 --dry     # lire ce qui va partir
node scripts/db-migrate.mjs 014           # appliquer sur Supabase
# ... puis seulement maintenant : merger la PR qui utilise la colonne
```

**La migration passe avant le merge, jamais apres.** Le nouveau conteneur
demarre trente secondes apres le merge ; si la colonne n'existe pas encore, il
echoue sur la premiere requete. Les migrations sont ecrites idempotentes
(`IF NOT EXISTS`, `CREATE OR REPLACE`), les rejouer ne coute rien.

Details et ordre d'application : [`db/README.md`](../db/README.md).

---

## 5. Retour arriere

Le script de deploiement annule **automatiquement** un deploiement qui ne
devient jamais `healthy` : il remet la version precedente en service et le
workflow finit en rouge. Tu n'as rien a faire.

Pour revenir en arriere plus tard — une regression fonctionnelle, que le
healthcheck ne peut pas voir :

```bash
ssh deploy@<VPS_HOST>
cd /opt/seo-engine
docker image ls ghcr.io/cnxsolutions/seo-engine        # les tags disponibles
IMAGE=ghcr.io/cnxsolutions/seo-engine IMAGE_TAG=sha-a1b2c3d \
  docker compose -f docker-compose.prod.yml up -d
```

C'est instantane : l'image est deja sur le disque. Le menage du script en garde
une semaine.

Puis corriger dans le depot — sans quoi le prochain merge sur `main` redeploiera
la version fautive.

---

## 6. Quand quelque chose ne va pas

| Symptome | Ou regarder |
|---|---|
| `typecheck` echoue en local mais passe sur GitHub | Un `.next` perime. `rm -rf .next` puis relancer. Les erreurs pointent des fichiers **generes**, pas ton code. |
| Le deploiement echoue au healthcheck | Le workflow affiche les 60 dernieres lignes du conteneur. Neuf fois sur dix : une variable manquante dans `/opt/seo-engine/.env`. |
| Tout repond `503` | `APP_ACCESS_SECRET` absent ou de moins de 16 caracteres. La barriere refuse de tourner plutot que de s'ouvrir. |
| Le site est injoignable, le conteneur est `healthy` | Cote Caddy : `systemctl status caddy` et `journalctl -u caddy -n 50`. |
| Rien n'est genere ni publie | Le conteneur peut etre `healthy` sans que le cron tourne. Section 8 du [README](../README.md). |
| `docker compose pull` echoue a la main sur le VPS | Normal : le jeton GHCR utilise par la CI est ephemere et a expire. Relancer le workflow *Deploiement production* (`Actions` > `Run workflow`). |

---

## 7. Ce que cette pipeline ne fait pas

Dit franchement, pour que personne ne compte dessus :

- **Pas de zero-downtime.** Environ dix secondes de coupure a chaque
  deploiement. Le planificateur `node-cron` vit dans le process Next.js et son
  garde-fou d'idempotence est une `Map` en memoire : faire cohabiter deux
  conteneurs ferait tourner deux crons et **publierait en double** chez le
  client. La coupure est la contrepartie assumee de cette architecture. Deploie
  hors des creneaux cron.
- **Pas d'environnement de preproduction.** `main` va directement en production.
  La porte, ce sont les 889 tests et la revue de PR. Le jour ou cela ne suffit
  plus : un second VPS et un second projet Supabase.
- **Pas de sauvegarde de la base.** Elle est chez Supabase et depend de leur
  plan de retention. La [baseline](../db/000_baseline.sql) permet de recreer le
  **schema**, pas les donnees.
- **Pas de supervision.** Personne ne te previendra si le conteneur tombe a 3 h
  du matin. `restart: unless-stopped` le relance apres un plantage ou un reboot,
  ce qui couvre le cas courant, mais un plantage silencieux du cron passera
  inapercu. Un UptimeRobot gratuit sur `https://seo.mondomaine.fr` est le
  premier filet a ajouter.
