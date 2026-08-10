# Base de donnees — migrations et sauvegarde du schema

Ce dossier n'accueille qu'un seul fichier, mais c'est le plus important du
depot : la **baseline** du schema de production. Ce document explique pourquoi
elle doit exister, comment la produire, et comment appliquer les migrations en
attendant.

---

## 1. Ou vivent les migrations

Les migrations SQL ne sont **pas** dans ce dossier. Elles vivent dans :

```
src/adapters/infrastructure/database/migrations/
```

C'est un emplacement inhabituel (heritage de l'organisation hexagonale du
dossier `src/adapters/`), mais c'est le seul, et il ne faut pas en creer un
second. Le dossier `db/` sert uniquement a la baseline decrite en section 4.

---

## 2. Ce qui existe reellement

| Fichier | Contenu | Statut |
|---|---|---|
| `001_schema_federation.sql` | Federation de schemas : `federated_sites`, `content_schemas`, `content_types`, `content_fields`, `content_drafts`, `taxonomies`, `taxonomy_terms`, `schema_sync_logs` | present |
| `002_*.sql` | — | **ABSENT du depot** |
| `003_*.sql` | — | **ABSENT du depot** |
| `004_*.sql` | — | **ABSENT du depot** |
| `005_add_vector_store.sql` | Extension `pgvector`, `vector_embeddings`, `content_embeddings`, `schema_embeddings`, `similarity_cache`, `rag_context_cache`, `indexing_queue`, et les fonctions `vector_search`, `get_vector_store_stats`, `cleanup_expired_cache` appelees en RPC par le code | present |
| `006_generation_page_payload.sql` | `ALTER TABLE generations ADD COLUMN page_payload jsonb` + index partiel | present, **deja applique en production** |
| `007_scheduler_reliability.sql` | Fiabilisation du planificateur : `editorial_calendar.error_message`, `updated_at` + trigger, statut `failed`, index de reprise, et **creation de `job_executions`** — table dans laquelle le cron ecrivait depuis toujours sans qu'aucune migration ne la cree | present |
| `008_generation_rejected_status.sql` | Elargit la contrainte CHECK de `generations.status` a `'rejected'` (bloc `DO` idempotent quel que soit le nom de la contrainte) + index partiel `idx_generations_rejected`. Sans elle, un article refuse par le gate retombe sur `'failed'` et on ne distingue plus « la generation a plante » de « le controle qualite a refuse » | present |
| `009_vector_index_keys.sql` | Identite stable des documents vectoriels : colonne `vector_embeddings.document_key` + index unique `(site_id, document_key)`, suppression de l'`UNIQUE(content_hash)` **global** qui faisait se voler leurs lignes a deux sites partageant une phrase, colonne `site_pages.content_excerpt`, colonne `sites.last_indexed_at`, fonction `get_site_index_status(uuid)` | present |
| `010_gsc_performance_loop.sql` | **Creation de `gsc_performance`** (jusqu'ici definie nulle part) + son index unique `(site_id, date, page_url, query)` **sans lequel tout upsert du sync GSC etait refuse en silence**, index unique `google_connections(site_id)` exige par le nouveau `onConflict`, et `generations.published_at` avec backfill depuis `updated_at` | present |

### L'ordre d'application

Sur une base vierge, dans cet ordre strict, sans en sauter :

```
001_schema_federation.sql
005_add_vector_store.sql
006_generation_page_payload.sql
007_scheduler_reliability.sql
008_generation_rejected_status.sql
009_vector_index_keys.sql
010_gsc_performance_loop.sql
```

`008`, `009` et `010` ont ete ecrites en parallele par trois chantiers
differents. Leurs objets sont disjoints — `008` touche la contrainte de statut
de `generations`, `009` le stockage vectoriel et `site_pages`, `010` la table
`gsc_performance`, `google_connections` et une colonne `published_at` sur
`generations` — donc leur ordre relatif est indifferent. Les trois sont
idempotentes et rejouables.

Deux d'entre elles sont **bloquantes pour une fonctionnalite entiere** :
sans `009`, l'upsert d'indexation echoue sur un `onConflict` introuvable et le
vector store reste vide ; sans `010`, la synchronisation Search Console continue
d'ecrire dans le vide en rapportant un succes.

L'ordre est impose par le numero, mais il ne suffit pas : `006` fait un
`ALTER TABLE generations` et `007` un `ALTER TABLE public.editorial_calendar`.
Ces deux tables ne sont creees par aucun fichier du depot (voir la section
suivante). **Sur une base reellement vierge, `006` et `007` echouent.** Ils ne
s'appliquent que sur une base ou les tables metier ont deja ete creees a la
main.

Les migrations sont ecrites en SQL brut, sans outil de migration ni table de
suivi : **rien n'enregistre ce qui a deja ete applique**. C'est a l'operateur de
le savoir. `001` n'est pas idempotent (`CREATE TABLE` sans `IF NOT EXISTS`) et
echouera si vous le rejouez ; `005`, `006`, `007`, `008`, `009` et `010`
sont ecrits en `IF NOT EXISTS` (ou en blocs `DO` gardes) et peuvent etre rejoues
sans dommage.

### Comment les appliquer

Au choix :

- **Tableau de bord Supabase** → *SQL Editor* → coller le contenu du fichier →
  *Run*. C'est la voie la plus simple pour une base distante.
- **psql**, si vous avez la chaine de connexion (voir section 4) :
  ```bash
  psql "<CONNECTION_STRING>" -f src/adapters/infrastructure/database/migrations/001_schema_federation.sql
  ```

Appliquez-les une par une et lisez la sortie : une erreur au milieu d'un fichier
laisse la base a moitie migree, sans transaction englobante pour l'annuler.

---

## 3. Le trou : 11 tables sur 19 ne sont definies nulle part

Le code interroge 19 tables. Huit seulement sont creees par une migration du
depot : `federated_sites`, `content_schemas`, `content_types`, `taxonomies`,
`taxonomy_terms` (001), `vector_embeddings` (005), `job_executions` (007) et
`gsc_performance` (010).

Les **11 autres n'ont aucune definition SQL versionnee** :

```
analysis_runs        articles          backlinks
campaigns            cycle_plans       editorial_calendar
gbp_profiles         generations       google_connections
site_pages           sites
```

Ce sont pourtant les tables du coeur metier : `sites`, `campaigns`,
`generations`, `editorial_calendar`, `cycle_plans`. Elles ont ete creees a la
main dans l'interface Supabase et n'ont jamais ete decrites ailleurs que dans
l'instance elle-meme.

Le desequilibre inverse existe aussi : huit tables sont creees par les
migrations sans qu'aucune ligne de code ne les interroge (`content_drafts`,
`content_fields`, `schema_sync_logs`, `content_embeddings`, `schema_embeddings`,
`similarity_cache`, `rag_context_cache`, `indexing_queue`). Le depot et la base
ont diverge dans les deux sens.

La cause racine etait une ligne `supabase/` dans `.gitignore`, corrigee depuis.

**Consequence, a lire lentement : aujourd'hui, ce depot ne permet pas de
reconstruire la base.** Cloner le projet et jouer les trois migrations donne une
base inutilisable. Si l'instance Supabase disparait — suppression accidentelle,
projet mis en pause pour inactivite, incident cote fournisseur — le produit
disparait avec elle. Le code seul ne suffit pas a le reconstruire.

C'est exactement ce que la section suivante repare.

---

## 4. Exporter le schema de production en baseline versionnee

### Recuperer la chaine de connexion

Tableau de bord Supabase → *Project Settings* → *Database* → *Connection
string* → onglet **URI**. Utilisez la connexion **directe** (port `5432`) ou le
*session pooler*. Le *transaction pooler* (port `6543`) ne convient pas :
`pg_dump` a besoin d'instructions que ce mode ne supporte pas.

La chaine contient le mot de passe de la base. Ne la collez ni dans un fichier
du depot, ni dans un historique de shell partage.

### La commande

```bash
pg_dump --schema-only --no-owner --no-privileges "<CONNECTION_STRING>" > db/000_baseline.sql
```

Ce que chaque option apporte :

- `--schema-only` — n'exporte que la **structure**, aucune ligne de donnees. Le
  fichier produit est donc versionnable sans exposer le moindre contenu client,
  aucune cle WordPress, aucun jeton Google.
- `--no-owner` — ne fige pas les proprietaires de tables. Sans cela, le fichier
  ne se rejoue que sur une instance ayant exactement les memes roles.
- `--no-privileges` — meme raison pour les `GRANT`.

Si votre `pg_dump` local est plus ancien que le Postgres de Supabase, il refuse
de tourner (« server version mismatch ») : installez une version au moins egale.
Le plus simple est alors de passer par le conteneur officiel :

```bash
docker run --rm postgres:17 pg_dump --schema-only --no-owner --no-privileges \
  "<CONNECTION_STRING>" > db/000_baseline.sql
```

Le dump inclura aussi les schemas internes de Supabase (`auth`, `storage`,
`extensions`). Ce n'est pas genant — c'est meme utile pour comprendre l'etat
reel de l'instance. Si vous ne voulez que le schema applicatif, ajoutez
`--schema public`.

### Ensuite : commiter

```bash
git add db/000_baseline.sql
git commit -m "db: baseline du schema de production"
```

C'est ce commit, et lui seul, qui transforme « la base est dans Supabase » en
« la base est dans le depot ».

---

## 5. Vivre avec la baseline

Une fois `db/000_baseline.sql` presente, les regles changent :

- **Base vierge** → jouer `000_baseline.sql`, et **rien d'autre**. La baseline
  est un instantane de la production : elle contient deja tout ce que `001`,
  `005`, `006` et `007` ont produit. Les rejouer par-dessus echouerait ou
  dupliquerait des objets.
- **Nouvelle evolution du schema** → ecrire le fichier numerote suivant
  (`008_*.sql`) dans `src/adapters/infrastructure/database/migrations/`, le
  committer **en meme temps que le code qui en depend**, l'appliquer, puis
  regenerer la baseline.
- **Jamais de colonne creee a la main dans l'interface Supabase sans migration
  correspondante.** C'est precisement ce qui a produit le trou de la section 3.

Regenerez la baseline apres chaque migration appliquee en production. Une
baseline vieille de six mois ne vaut guere mieux que pas de baseline.
