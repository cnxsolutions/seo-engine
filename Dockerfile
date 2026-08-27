# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# SEO Engine — image de production
#
# CONTRAINTE STRUCTURANTE — PROCESS UNIQUE ET PERSISTANT
#
# Le planificateur node-cron tourne DANS le process Next.js : `instrumentation.ts`
# demarre `initScheduler()` (lib/scheduler/cron.ts) quand ENABLE_SCHEDULER vaut
# 'true'. Le garde-fou d'idempotence de ce planificateur, `runningJobs`, est une
# Map EN MEMOIRE : il empeche deux executions simultanees du meme job dans un
# process, et rien d'autre.
#
# CE QUE DEUX CONTENEURS NE DUPLIQUERAIENT PAS — la raison de cette contrainte a
# change, et s'en tenir a l'ancienne ferait relacher la mauvaise chose. Les
# creneaux editoriaux et les publications sont desormais proteges EN BASE, par
# reclamation atomique : `claimEditorialSlot` et `claimGenerationForPublishing`
# (lib/scheduler/editorial.ts) sont des compare-and-swap, exactement un runner
# obtient le creneau et le perdant passe au suivant. Une meme page ne sort donc
# PAS deux fois, meme a deux process.
#
# CE QU'ILS DUPLIQUERAIENT REELLEMENT, ce sont les deux jobs restes sans
# reclamation :
#   - le job de campagne : `runDueCampaigns` lit un SELECT nu
#     (listDueCampaigns, lib/db.ts:243-254) et ne se protege que par la Map
#     locale au process (cron.ts:1198-1203). Deux process = deux analyses et
#     deux plans concurrents sur la MEME campagne ;
#   - le renouvellement de cycle : `checkCycleCompletion`
#     (lib/scheduler/cycle-manager.ts:25-50) lit lui aussi un SELECT nu
#     (lib/db.ts:514-524), sans reclamation ET SANS PLAFOND. Deux process =
#     DEUX CRAWLS DE 300 PAGES SIMULTANES contre le serveur de production du
#     client, deux factures d'embeddings, deux reecritures du meme calendrier.
#
# Cette image doit donc tourner en INSTANCE UNIQUE :
#   - pas de `--scale`, pas de `replicas > 1`, pas de mode Swarm/Kubernetes ;
#   - pas de deploiement « rolling » qui ferait cohabiter ancien et nouveau
#     conteneur : arreter avant de redemarrer (`docker compose up -d` recree le
#     conteneur, il ne le double pas) ;
#   - pas de plateforme serverless / scale-to-zero : un process endormi ne
#     declenche aucun cron.
# docker-compose.yml applique et documente cette contrainte.
# ─────────────────────────────────────────────────────────────────────────────

# Node 22 LTS. Variante Debian « bookworm-slim » et non Alpine : le fuseau
# horaire du conteneur est ici une exigence fonctionnelle (voir plus bas), et la
# glibc + tzdata de Debian rendent `TZ` fiable sans bricolage musl.
# Pour un build parfaitement reproductible, remplacer ce tag par un digest
# (`node:22-bookworm-slim@sha256:...`).
ARG NODE_IMAGE=node:22-bookworm-slim


# ─── Etape 1 — dependances ────────────────────────────────────────────────────
# Isolee pour que le cache Docker ne soit invalide que par package*.json.
FROM ${NODE_IMAGE} AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# `npm ci` et non `npm install` : installation stricte depuis le lockfile, seule
# facon d'obtenir le meme arbre de dependances qu'en local.
# Les devDependencies sont necessaires ici — Tailwind 4, TypeScript et
# babel-plugin-react-compiler (next.config.ts active `reactCompiler`) sont
# consommes par le build. Elles ne sont PAS copiees dans l'image finale.
RUN npm ci


# ─── Etape 2 — build ──────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# AUCUN secret n'est injecte ici, et c'est verifie : le build passe sur un depot
# sans le moindre fichier .env. Tout `process.env.*` du code serveur est lu a
# l'execution, y compris les variables prefixees `NEXT_PUBLIC_` — aucun composant
# client ne les lit, donc Next ne les fige pas dans le bundle.
# Si un jour un composant client lit une variable `NEXT_PUBLIC_*`, elle devra
# devenir un `ARG` de cette etape : elle serait alors figee dans l'image au
# moment du build et ne pourrait plus etre changee a l'execution.
#
# BUILD_STANDALONE=1 active `output: 'standalone'` dans next.config.ts, qui est
# volontairement conditionnel : le tracage standalone ne peut pas s'achever sur
# Windows (Turbopack emet des chunks nommes `[externals]_node:fs_<hash>._.js`, et
# NTFS interdit le `:`), donc `npm run build` reste propre sur un poste de
# developpement et c'est ICI, sur Linux, qu'on demande la sortie complete.
RUN BUILD_STANDALONE=1 npm run build

# Sans `.next/standalone/server.js`, l'etape suivante produirait une image
# silencieusement inutilisable. On echoue ici, avec le motif exact.
RUN test -f .next/standalone/server.js || { \
      echo ""; \
      echo "ERREUR — .next/standalone/server.js est absent."; \
      echo "Le build a tourne sans BUILD_STANDALONE=1, ou next.config.ts ne lit"; \
      echo "plus cette variable. next.config.ts doit contenir :"; \
      echo ""; \
      echo "  ...(process.env.BUILD_STANDALONE === '1'"; \
      echo "    ? { output: 'standalone' as const }"; \
      echo "    : {}),"; \
      echo ""; \
      exit 1; \
    }


# ─── Etape 3 — execution ──────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Fuseau horaire du conteneur. node-cron planifie sur l'heure LOCALE du process :
# un conteneur laisse en UTC decale toutes les expressions cron et fait basculer
# le « jour J » du calendrier editorial au mauvais moment. La valeur est aussi
# fixee dans docker-compose.yml, qui reste la source de verite si vous changez
# de fuseau ; celle-ci sert de defaut si l'image est lancee par `docker run`.
ENV TZ=Europe/Paris
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime \
 && echo "${TZ}" > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

# La sortie `standalone` embarque un serveur Node autonome et uniquement les
# dependances reellement atteintes par le code — pas de node_modules complet
# dans l'image finale, pas de sources, pas de devDependencies. Les assets
# statiques et /public restent a copier a la main : Next les laisse
# volontairement hors du dossier standalone.
#
# `--chown=node:node` a la copie : l'image Node fournit deja l'utilisateur
# non-root `node` (uid 1000), inutile d'en creer un autre.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Next ecrit son cache (fetch, ISR) dans .next/cache a l'execution. Le dossier
# n'existe pas dans la sortie standalone : il faut le creer et le donner a
# `node`, sinon chaque ecriture echoue et le serveur recalcule tout a chaque
# requete.
RUN mkdir -p .next/cache && chown node:node .next .next/cache

USER node

EXPOSE 3000

# Le healthcheck est declare dans docker-compose.yml pour garder une seule
# source de verite avec la politique de redemarrage.

# Un seul process au premier plan, qui ne rend jamais la main : c'est lui qui
# porte le planificateur. `docker compose` est configure avec `init: true` pour
# que les signaux d'arret lui parviennent proprement.
CMD ["node", "server.js"]
